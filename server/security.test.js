import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { createClient } from "@libsql/client";
import { createDatabase } from "./database.js";
import { testSchema } from "./test-fixture.js";
import {
  securityConfig,
  signingSecret,
  installSecurityTables,
} from "./security.js";
import { DatabaseRateLimitStore } from "./rate-limit-store.js";
import { sanitizeImage, createUploadGate } from "./uploads.js";
import { EventEmitter } from "node:events";

test("production fails closed for missing origins, insecure URLs and weak signing keys", () => {
  assert.throws(() => securityConfig({ NODE_ENV: "production" }));
  for (const base of [
    "http://store.test",
    "https://store.test/path",
    "https://user:pass@store.test",
    "https://store.test?x=1",
  ])
    assert.throws(() =>
      securityConfig({ NODE_ENV: "production", PUBLIC_BASE_URL: base }),
    );
  const config = securityConfig({
    NODE_ENV: "production",
    PUBLIC_BASE_URL: "https://store.test",
    TRUST_PROXY_HOPS: "1",
  });
  assert.equal(config.allowedOrigin("http://localhost:5173"), false);
  assert.equal(config.allowedOrigin("https://store.test.evil.test"), false);
  assert.equal(config.allowedOrigin("https://store.test"), true);
  assert.throws(() =>
    securityConfig({
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://store.test",
      TRUST_PROXY_HOPS: "true",
    }),
  );
  assert.throws(() => signingSecret({}, "unused", true));
  assert.throws(() =>
    signingSecret({ JWT_SECRET: "a".repeat(96) }, "unused", true),
  );
});

test("image processing rejects spoofed, corrupt and oversized images and strips private metadata", async () => {
  for (const data of [
    "<svg onload='alert(1)'></svg>",
    "<html>fake</html>",
    "\x89PNG\r\n",
  ])
    await assert.rejects(
      sanitizeImage({ mimetype: "image/png", buffer: Buffer.from(data) }),
    );
  const image = await sharp({
    create: { width: 2200, height: 4, channels: 3, background: "blue" },
  })
    .withExif({ IFD0: { Artist: "PRIVATE-METADATA" } })
    .png()
    .toBuffer();
  await assert.rejects(
    sanitizeImage({ mimetype: "image/jpeg", buffer: image }),
  );
  const output = await sanitizeImage({ mimetype: "image/png", buffer: image });
  const meta = await sharp(output).metadata();
  assert.equal(meta.width, 2048);
  assert.equal(meta.exif, undefined);
  assert.equal(output.includes(Buffer.from("PRIVATE-METADATA")), false);
  const large = await sharp({
    create: { width: 4100, height: 4100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await assert.rejects(sanitizeImage({ mimetype: "image/png", buffer: large }));
});

test("upload admission bounds memory and releases a slot exactly once on completion or disconnect", () => {
  const gate = createUploadGate(1);
  const response = () =>
    Object.assign(new EventEmitter(), {
      set() {
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    });
  let admitted = 0;
  const a = response(),
    b = response(),
    c = response();
  gate({}, a, () => admitted++);
  gate({}, b, () => admitted++);
  assert.equal(admitted, 1);
  assert.equal(b.statusCode, 429);
  a.emit("close");
  a.emit("finish");
  gate({}, b, () => admitted++);
  gate({}, c, () => admitted++);
  assert.equal(admitted, 2);
  assert.equal(c.statusCode, 429);
});

test("login counters are atomic and shared across instances without storing usernames or IPs", async () => {
  const db = await createDatabase({
    client: createClient({ url: "file::memory:" }),
  });
  try {
    await db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY)");
    await installSecurityTables(db);
    const a = new DatabaseRateLimitStore(db, "secret", "login"),
      b = new DatabaseRateLimitStore(db, "secret", "login");
    for (const store of [a, b]) store.init({ windowMs: 900000 });
    const key = "private.username:192.0.2.25";
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).increment(key)),
    );
    assert.deepEqual(
      results.map((r) => r.totalHits).sort((x, y) => x - y),
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    const rows = await db.prepare("SELECT * FROM security_rate_limits").all();
    assert.equal(rows.length, 1);
    assert.match(rows[0].key, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(rows).includes("private.username"), false);
    await b.decrement(key);
    assert.equal((await a.increment(key)).totalHits, 20);
    await db.prepare("UPDATE security_rate_limits SET expires_at=0").run();
    assert.equal((await b.increment(key)).totalHits, 1);
  } finally {
    db.close();
  }
});

test("real API protects cookie sessions, origins, logout, idle expiry and private audit records", async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "corese-security-"));
  process.env.NODE_ENV = "test";
  process.env.DATABASE_PATH = path.join(folder, "test.db");
  delete process.env.VERCEL;
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.JWT_SECRET;
  const schema = testSchema(),
    setup = new Database(process.env.DATABASE_PATH);
  for (const row of schema
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all())
    setup.exec(row.sql);
  setup
    .prepare("INSERT INTO users(username,password,role,name) VALUES(?,?,?,?)")
    .run(
      "admin",
      bcrypt.hashSync("AdminPassword123!", 4),
      "admin",
      "Security Admin",
    );
  schema.close();
  setup.close();
  const { default: app, database: db } = await import("./index.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
    await rm(folder, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (
    endpoint,
    { body, headers = {}, method = body ? "POST" : "GET" } = {},
  ) =>
    fetch(base + endpoint, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  const origin = "http://localhost:5173";
  const credentials = {
    username: "admin",
    password: "AdminPassword123!",
    portal: "admin",
  };
  const browserLogin = async () => {
    const response = await request("/login", {
      body: credentials,
      headers: { Origin: origin, "X-Session-Portal": "admin" },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).token, undefined);
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    return cookie.split(";")[0];
  };
  await t.test(
    "cross-site login and unsupported content are rejected",
    async () => {
      assert.equal(
        (
          await request("/login", {
            body: credentials,
            headers: { Origin: "https://attacker.test" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(base + "/login", {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify(credentials),
          })
        ).status,
        415,
      );
      const malformed = await fetch(base + "/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"private-password":"SECRET-SHOULD-NOT-LEAK",broken}',
      });
      assert.equal(malformed.status, 400);
      assert.equal(
        (await malformed.text()).includes("SECRET-SHOULD-NOT-LEAK"),
        false,
      );
      assert.equal(
        (await request("/login", { body: { large: "x".repeat(140000) } }))
          .status,
        413,
      );
    },
  );
  let cookie = await browserLogin();
  await t.test(
    "new passwords reject short values and bcrypt byte truncation",
    async () => {
      for (const [index, password] of [
        "Short123!",
        "Aa1".repeat(25),
        "Ab1" + "é".repeat(35),
        "lowercaseonly12345",
      ].entries()) {
        const response = await request("/customer/register", {
          body: {
            username: `invalid.password${index}`,
            name: "Invalid Password",
            email: "invalid@example.test",
            password,
          },
          headers: { Origin: origin, "X-Session-Portal": "public" },
        });
        assert.equal(response.status, 400);
      }
    },
  );
  const headers = () => ({
    Cookie: cookie,
    Origin: origin,
    "X-Session-Portal": "admin",
  });
  await t.test(
    "cookie auth requires the right portal and an authorized origin for mutations",
    async () => {
      assert.equal((await request("/me", { headers: headers() })).status, 200);
      assert.equal(
        (
          await request("/me", {
            headers: { Cookie: cookie, "X-Session-Portal": "customer" },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request("/logout", {
            body: {},
            headers: { Cookie: cookie, "X-Session-Portal": "admin" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/logout", {
            body: {},
            headers: { ...headers(), Origin: "https://attacker.test" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/me", {
            headers: { ...headers(), Cookie: `${cookie}; ${cookie}` },
          })
        ).status,
        401,
      );
      const user = await (await request("/me", { headers: headers() })).json();
      assert.equal(user.password, undefined);
      assert.equal(user.session_version, undefined);
      assert.equal(
        (
          await request("/me", {
            headers: { Authorization: "Bearer malformed" },
          })
        ).status,
        401,
      );
    },
  );
  await t.test(
    "logout invalidates a captured cookie and idle sessions expire server-side",
    async () => {
      assert.equal(
        (await request("/logout", { body: {}, headers: headers() })).status,
        200,
      );
      assert.equal((await request("/me", { headers: headers() })).status, 401);
      cookie = await browserLogin();
      await db
        .prepare("UPDATE auth_sessions SET last_seen=?")
        .run(Date.now() - 16 * 60000);
      assert.equal((await request("/me", { headers: headers() })).status, 401);
      cookie = await browserLogin();
      assert.equal(
        (await request("/logout-all", { body: {}, headers: headers() })).status,
        200,
      );
      assert.equal((await request("/me", { headers: headers() })).status, 401);
    },
  );
  await t.test(
    "session count is bounded and audit contains no credentials or plaintext IP",
    async () => {
      for (let i = 0; i < 7; i++) cookie = await browserLogin();
      assert.equal(
        (await db.prepare("SELECT count(*) n FROM auth_sessions").get()).n,
        5,
      );
      const rows = await db.prepare("SELECT * FROM security_audit").all();
      assert.ok(rows.some((r) => r.action === "session.revoked"));
      assert.ok(rows.some((r) => r.action === "mutation.result.200"));
      assert.equal(JSON.stringify(rows).includes(credentials.password), false);
      assert.equal(JSON.stringify(rows).includes(cookie.split("=")[1]), false);
      assert.equal(JSON.stringify(rows).includes("127.0.0.1"), false);
      assert.ok(rows.every((r) => /^[a-f0-9]{64}$/.test(r.ip_hash)));
    },
  );
  await t.test(
    "customer and admin cookies are isolated and logout affects only the selected portal",
    async () => {
      const registration = await request("/customer/register", {
        body: {
          username: "customer.security",
          name: "Customer Security",
          email: "customer@example.test",
          password: "CustomerPassword123!",
        },
        headers: { Origin: origin, "X-Session-Portal": "public" },
      });
      assert.equal(registration.status, 201);
      assert.equal((await registration.json()).token, undefined);
      const customerCookie = registration.headers
        .get("set-cookie")
        .split(";")[0];
      const combined = `${cookie}; ${customerCookie}`;
      const account = async (portal) =>
        (
          await request("/me", {
            headers: { Cookie: combined, "X-Session-Portal": portal },
          })
        ).json();
      assert.equal((await account("admin")).role, "admin");
      assert.equal((await account("customer")).role, "cliente");
      assert.equal(
        (
          await request("/security/audit", {
            headers: { Cookie: combined, "X-Session-Portal": "customer" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/logout", {
            body: {},
            headers: {
              Cookie: combined,
              Origin: origin,
              "X-Session-Portal": "customer",
            },
          })
        ).status,
        200,
      );
      assert.equal((await request("/me", { headers: headers() })).status, 200);
      assert.equal(
        (
          await request("/me", {
            headers: { Cookie: customerCookie, "X-Session-Portal": "customer" },
          })
        ).status,
        401,
      );
    },
  );
  await t.test(
    "concurrent demotions cannot remove the last administrator",
    async () => {
      await db
        .prepare(
          "INSERT INTO users(username,password,role,name) VALUES(?,?,?,?)",
        )
        .run(
          "admin.backup",
          bcrypt.hashSync("BackupPassword123!", 4),
          "admin",
          "Backup Admin",
        );
      const second = await db
        .prepare("SELECT id FROM users WHERE username='admin.backup'")
        .get();
      const responses = await Promise.all([
        request("/users/1", {
          method: "PUT",
          body: {
            username: "admin",
            name: "Security Admin",
            role: "funcionario",
          },
          headers: headers(),
        }),
        request(`/users/${second.id}`, {
          method: "PUT",
          body: {
            username: "admin.backup",
            name: "Backup Admin",
            role: "funcionario",
          },
          headers: headers(),
        }),
      ]);
      assert.ok(responses.some((r) => [400, 401, 409].includes(r.status)));
      assert.equal(
        (
          await db
            .prepare("SELECT count(*) n FROM users WHERE role='admin'")
            .get()
        ).n,
        1,
      );
    },
  );
});

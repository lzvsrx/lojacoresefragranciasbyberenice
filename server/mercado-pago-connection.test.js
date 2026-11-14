import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomBytes, createHash } from "node:crypto";
import { createDatabase } from "./database.js";
import {
  installMercadoPagoConnection,
  credentialCipher,
} from "./mercado-pago-connection.js";
import {
  mercadoPagoConfig,
  withMercadoPagoCredentials,
} from "./mercado-pago.js";

test("OAuth encryption rejects modified ciphertext, wrong purposes and missing keys", () => {
  const cipher = credentialCipher(randomBytes(32).toString("hex"));
  const encrypted = cipher.seal({ token: "private-token" }, "tokens");
  assert.equal(encrypted.includes("private-token"), false);
  assert.deepEqual(cipher.open(encrypted, "tokens"), {
    token: "private-token",
  });
  assert.throws(() => cipher.open(encrypted, "state"));
  const parts = encrypted.split(".");
  parts[2] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => cipher.open(parts.join("."), "tokens"));
  assert.throws(() => credentialCipher("short"));
});

test("OAuth account linking, state protection, encrypted storage and refresh lifecycle", async (t) => {
  const names = [
    "PUBLIC_BASE_URL",
    "MERCADO_PAGO_ENCRYPTION_KEY",
    "MERCADO_PAGO_SANDBOX",
    "MERCADO_PAGO_ACCESS_TOKEN",
    "MERCADO_PAGO_PUBLIC_KEY",
    "MERCADO_PAGO_WEBHOOK_SECRET",
    "MERCADO_PAGO_CLIENT_ID",
    "MERCADO_PAGO_CLIENT_SECRET",
  ];
  const original = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  for (const k of names) delete process.env[k];
  process.env.PUBLIC_BASE_URL = "https://store.example.test";
  process.env.MERCADO_PAGO_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const realFetch = globalThis.fetch;
  let timestamp = Date.now(),
    seller = "123456",
    exchanges = 0,
    refreshes = 0,
    invalidRefresh = false,
    offline = true;
  let refreshBody, exchangeBody;
  const provider = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(url.origin, "https://api.mercadopago.com");
    if (url.pathname === "/users/me")
      return Response.json({
        id: Number(seller),
        nickname: "Loja de teste",
        site_id: "MLB",
      });
    assert.equal(url.pathname, "/oauth/token");
    assert.equal(options.headers.Authorization, undefined);
    const body = JSON.parse(options.body);
    const isRefresh = body.grant_type === "refresh_token";
    if (isRefresh) {
      refreshes++;
      refreshBody = body;
    } else {
      exchanges++;
      exchangeBody = body;
    }
    if (isRefresh && invalidRefresh)
      return Response.json(
        { error: "invalid_grant", message: "private-provider-error" },
        { status: 400 },
      );
    if (isRefresh) await new Promise((resolve) => setTimeout(resolve, 40));
    return Response.json({
      access_token: `private-access-${exchanges}-${refreshes}`,
      public_key: "APP_USR-public-key",
      refresh_token: offline
        ? `private-refresh-${exchanges}-${refreshes}`
        : undefined,
      expires_in: 3600,
      live_mode: true,
      user_id: Number(seller),
      scope: offline ? "read write offline_access" : "read write",
    });
  };
  globalThis.fetch = (input, options) =>
    String(typeof input === "string" ? input : input.url).startsWith(
      "https://api.mercadopago.com",
    )
      ? provider(input, options)
      : realFetch(input, options);
  const db = await createDatabase({ url: "file::memory:" });
  await db.exec(
    "CREATE TABLE payment_methods(code TEXT,active INTEGER,updated_at TEXT); INSERT INTO payment_methods VALUES('MP',0,NULL)",
  );
  const app = express();
  app.use(express.json());
  const auth = () => (req, res, next) => {
    if (req.get("x-role") !== "admin")
      return res.status(403).json({ error: "Denied" });
    req.user = { id: 1, role: "admin" };
    req.authSessionHash = req.get("x-session") || "session-one";
    next();
  };
  const service = await installMercadoPagoConnection(app, {
    db,
    auth,
    fetcher: provider,
    now: () => timestamp,
  });
  app.get("/api/shop/test-config", (_req, res) => {
    const c = mercadoPagoConfig();
    res.json({
      configured: c.configured,
      public_key: c.publicKey,
      sandbox: c.sandbox,
    });
  });
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    globalThis.fetch = realFetch;
    for (const k of names)
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
  });
  const request = async (
    path,
    { body, role = "admin", session = "session-one" } = {},
  ) => {
    const response = await realFetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Role": role,
        "X-Session": session,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "manual",
    });
    return {
      status: response.status,
      location: response.headers.get("location"),
      body: response.status === 303 ? null : await response.json(),
    };
  };
  const settings = {
    client_id: "123456789",
    client_secret: "private-application-secret-12345",
    webhook_secret: "private-webhook-secret-67890",
  };
  const start = async (session) => {
    const r = await request("/api/mercado-pago/oauth/start", {
      body: {},
      session,
    });
    assert.equal(r.status, 200);
    return new URL(r.body.authorization_url);
  };
  const callback = (url, options = {}) =>
    request(
      `/api/mercado-pago/oauth/callback?state=${url.searchParams.get("state")}&code=fake-authorization-code`,
      options,
    );

  await t.test(
    "preparation requires admin and never returns credentials",
    async () => {
      assert.equal(
        (await request("/api/mercado-pago/oauth/start", { body: {} })).status,
        503,
      );
      assert.equal(
        (
          await request("/api/mercado-pago/oauth/application", {
            body: settings,
            role: "funcionario",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/api/mercado-pago/oauth/application", {
            body: settings,
          })
        ).status,
        200,
      );
      const raw = await service.read();
      assert.equal(JSON.stringify(raw).includes(settings.client_secret), false);
      const status = await request("/api/mercado-pago/oauth/status");
      assert.equal(status.body.ready, true);
      assert.equal(status.body.connected, false);
      assert.equal(
        JSON.stringify(status.body).includes(settings.webhook_secret),
        false,
      );
    },
  );
  await t.test(
    "PKCE state is session-bound, single-use, and activates payments only after account validation",
    async () => {
      const url = await start();
      assert.equal(url.origin, "https://auth.mercadopago.com");
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      assert.equal(
        url.searchParams.get("redirect_uri"),
        "https://store.example.test/api/mercado-pago/oauth/callback",
      );
      assert.match(
        (await callback(url, { session: "other-session" })).location,
        /failed$/,
      );
      assert.equal(exchanges, 0);
      assert.match((await callback(url)).location, /connected$/);
      assert.equal(exchanges, 1);
      assert.equal(
        createHash("sha256")
          .update(exchangeBody.code_verifier)
          .digest("base64url"),
        url.searchParams.get("code_challenge"),
      );
      assert.match((await callback(url)).location, /failed$/);
      assert.equal(exchanges, 1);
      assert.equal(
        (
          await db
            .prepare("SELECT active FROM payment_methods WHERE code='MP'")
            .get()
        ).active,
        1,
      );
      const row = await service.read();
      assert.equal(JSON.stringify(row).includes("private-access"), false);
      assert.equal(JSON.stringify(row).includes("private-refresh"), false);
      const status = await request("/api/mercado-pago/oauth/status");
      assert.equal(status.body.connected, true);
      assert.equal(status.body.account.id, "123456");
      assert.equal(status.body.automatic_renewal, true);
      const publicConfig = await request("/api/shop/test-config");
      assert.equal(publicConfig.body.configured, true);
      assert.equal(publicConfig.body.public_key, "APP_USR-public-key");
      assert.equal(mercadoPagoConfig().token, undefined);
      await Promise.all([
        withMercadoPagoCredentials({ token: "one" }, async () => {
          await Promise.resolve();
          assert.equal(mercadoPagoConfig().token, "one");
        }),
        withMercadoPagoCredentials({ token: "two" }, async () => {
          await Promise.resolve();
          assert.equal(mercadoPagoConfig().token, "two");
        }),
      ]);
    },
  );
  await t.test(
    "cancelled, expired and altered application states never exchange tokens",
    async () => {
      const cancelled = await start();
      const count = exchanges;
      assert.match(
        (
          await request(
            `/api/mercado-pago/oauth/callback?state=${cancelled.searchParams.get("state")}&error=access_denied`,
          )
        ).location,
        /cancelled$/,
      );
      assert.match((await callback(cancelled)).location, /failed$/);
      const expired = await start();
      timestamp += 600001;
      assert.match((await callback(expired)).location, /failed$/);
      const changed = await start();
      await request("/api/mercado-pago/oauth/application", { body: settings });
      assert.match((await callback(changed)).location, /failed$/);
      assert.equal(exchanges, count);
    },
  );
  await t.test(
    "reauthorization cannot replace the merchant of existing orders",
    async () => {
      seller = "654321";
      const url = await start();
      assert.match((await callback(url)).location, /account_mismatch$/);
      assert.equal((await service.read()).account_id, "123456");
      seller = "123456";
      assert.equal(
        (
          await request("/api/mercado-pago/oauth/application", {
            body: { ...settings, client_id: "999999999" },
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "expired tokens rotate once across concurrent requests and persist the new refresh token",
    async () => {
      await db
        .prepare("UPDATE mercado_pago_connection SET expires_at=?")
        .run(timestamp - 1);
      const before = refreshes,
        responses = await Promise.all([
          request("/api/shop/test-config"),
          request("/api/shop/test-config"),
        ]);
      assert.equal(refreshes, before + 1);
      assert.ok(responses.some((r) => r.status === 200));
      assert.ok(responses.every((r) => [200, 503].includes(r.status)));
      assert.match(refreshBody.refresh_token, /private-refresh/);
      const row = await service.read();
      const tokens = credentialCipher(
        process.env.MERCADO_PAGO_ENCRYPTION_KEY,
      ).open(row.tokens_cipher, "mercadopago:tokens:v1");
      assert.equal(
        tokens.refreshToken,
        `private-refresh-${exchanges}-${refreshes}`,
      );
      assert.ok(row.expires_at > timestamp);
    },
  );
  await t.test(
    "revoked refresh requires reauthorization without leaking provider errors",
    async () => {
      invalidRefresh = true;
      await db
        .prepare("UPDATE mercado_pago_connection SET expires_at=?")
        .run(timestamp - 1);
      const result = await request("/api/shop/test-config");
      assert.equal(result.status, 401);
      assert.equal(
        JSON.stringify(result.body).includes("private-provider-error"),
        false,
      );
      const status = await request("/api/mercado-pago/oauth/status");
      assert.equal(status.body.reconnect_required, true);
      assert.equal(
        (await request("/api/shop/test-config")).body.configured,
        false,
      );
      invalidRefresh = false;
      assert.match((await callback(await start())).location, /connected$/);
    },
  );
  await t.test(
    "an authorization without offline access expires safely and is never silently refreshed",
    async () => {
      offline = false;
      assert.match((await callback(await start())).location, /connected$/);
      assert.equal(
        (await request("/api/mercado-pago/oauth/status")).body
          .automatic_renewal,
        false,
      );
      await db
        .prepare("UPDATE mercado_pago_connection SET expires_at=?")
        .run(timestamp - 1);
      const before = refreshes;
      assert.equal(
        (await request("/api/shop/test-config")).body.configured,
        false,
      );
      assert.equal(refreshes, before);
    },
  );
});

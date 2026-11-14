import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { testSchema } from "../server/test-fixture.js";

// Optional browser smoke test. Requires a build, Playwright and an installed Edge.
// All users, passwords and records are generated in an isolated temporary database.
const folder = mkdtempSync(path.join(tmpdir(), "corese-security-ui-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = path.join(folder, "test.db");
for (const key of [
  "VERCEL",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "JWT_SECRET",
])
  delete process.env[key];
const schema = testSchema(),
  setup = new Database(process.env.DATABASE_PATH);
for (const row of schema
  .prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  )
  .all())
  setup.exec(row.sql);
const password = randomUUID() + "Aa1";
const insert = setup.prepare(
  "INSERT INTO users(username,password,role,name,email) VALUES(?,?,?,?,?)",
);
for (const [username, role] of [
  ["admin", "admin"],
  ["customer.test", "cliente"],
])
  insert.run(
    username,
    bcrypt.hashSync(password, 4),
    role,
    "Security Test",
    `${username}@example.test`,
  );
schema.close();
setup.close();
const { default: app, database: db } = await import("../server/index.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    playwright = await import(
      pathToFileURL(
        process.env.PLAYWRIGHT_MODULE ||
          path.join(
            tmpdir(),
            "corese-security-browser/node_modules/playwright/index.mjs",
          ),
      ).href
    );
  }
  browser = await playwright.chromium.launch({
    channel: "msedge",
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/#/admin`);
  await page.locator('input[autocomplete="username"]').fill("admin");
  await page.locator('input[type="password"]').fill(password);
  const adminResponse = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/login",
  );
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  assert.equal((await (await adminResponse).json()).token, undefined);
  await page.locator(".stats").first().waitFor();
  let cookies = await context.cookies(origin);
  const adminCookie = cookies.find((c) => c.name === "cf_admin");
  assert.equal(adminCookie?.httpOnly, true);
  assert.equal(await page.evaluate(() => localStorage.getItem("token")), null);
  assert.equal(
    await page.evaluate(() => document.cookie.includes("cf_admin")),
    false,
  );
  await page.reload();
  await page.locator(".stats").first().waitFor();

  await page.goto(`${origin}/#/cliente/entrar`);
  await page.locator('input[autocomplete="username"]').fill("customer.test");
  await page.locator('input[type="password"]').fill(password);
  const customerResponse = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/customer/login",
  );
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  assert.equal((await (await customerResponse).json()).token, undefined);
  await page
    .getByRole("button", { name: "Sair da conta", exact: true })
    .waitFor();
  cookies = await context.cookies(origin);
  const customerCookie = cookies.find((c) => c.name === "cf_customer");
  assert.equal(customerCookie?.httpOnly, true);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("customerToken")),
    null,
  );
  await page.goto(`${origin}/#/admin`);
  await page.locator(".stats").first().waitFor();
  await page.getByTitle("Sair", { exact: true }).click();
  await page.getByRole("button", { name: "Entrar no sistema" }).waitFor();
  const replayAdmin = await context.request.get(`${origin}/api/me`, {
    headers: {
      Cookie: `cf_admin=${adminCookie.value}`,
      "X-Session-Portal": "admin",
    },
  });
  assert.equal(replayAdmin.status(), 401);
  await page.goto(`${origin}/#/cliente`);
  await page
    .getByRole("button", { name: "Sair da conta", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Sair de todos os dispositivos" })
    .click();
  await page.goto(`${origin}/#/cliente`);
  await page
    .getByRole("link", { name: "Entrar como cliente", exact: true })
    .waitFor();
  const replayCustomer = await context.request.get(`${origin}/api/me`, {
    headers: {
      Cookie: `cf_customer=${customerCookie.value}`,
      "X-Session-Portal": "customer",
    },
  });
  assert.equal(replayCustomer.status(), 401);
  assert.deepEqual(errors, []);
  console.log(
    "Browser security check passed: HttpOnly sessions, reload, portal isolation and server-side logout.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  if (
    path.dirname(path.resolve(folder)) !== path.resolve(tmpdir()) ||
    !path.basename(folder).startsWith("corese-security-ui-")
  )
    throw new Error("Unexpected test directory");
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

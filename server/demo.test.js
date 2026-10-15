import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("Vercel temporary SQLite allows writes and reports non-persistent storage", async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "corese-demo-test-"));
  process.env.NODE_ENV = "test";
  process.env.VERCEL = "1";
  process.env.DATABASE_PATH = path.join(folder, "store.db");
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  const source = new Database("server/data/store.db", { readonly: true });
  const setup = new Database(process.env.DATABASE_PATH);
  for (const row of source
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all())
    setup.exec(row.sql);
  source.close();
  setup
    .prepare("INSERT INTO users(username,password,role,name) VALUES(?,?,?,?)")
    .run("admin", bcrypt.hashSync("Admin123!", 4), "admin", "Admin Teste");
  setup
    .prepare("INSERT INTO users(username,password,role,name) VALUES(?,?,?,?)")
    .run(
      "cliente",
      bcrypt.hashSync("Cliente123!", 4),
      "cliente",
      "Cliente Teste",
    );
  setup.close();
  const { default: app, database } = await import("./index.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.close();
    await rm(folder, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const status = await fetch(base + "/storage-status");
  assert.deepEqual(await status.json(), { writable: true, persistent: false });
  const login = await fetch(base + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "Admin123!" }),
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const products = await fetch(base + "/products", {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(products.status, 200);
  await products.arrayBuffer();
  const write = await fetch(base + "/products", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Temporary product", price: 20, quantity: 3 }),
  });
  assert.equal(write.status, 201);
  const created = await write.json();
  assert.equal(
    (
      await database
        .prepare("SELECT quantity FROM products WHERE id=?")
        .get(created.id)
    ).quantity,
    3,
  );
  const customerLogin = await fetch(base + "/customer/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "cliente", password: "Cliente123!" }),
  });
  assert.equal(customerLogin.status, 200);
  await customerLogin.json();
  const registration = await fetch(base + "/customer/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "New Customer",
      username: "newcustomer",
      password: "Cliente123!",
      email: "new@example.com",
    }),
  });
  assert.equal(registration.status, 201);
  await registration.json();
  const catalog = await fetch(base + "/catalog");
  assert.equal(catalog.status, 200);
  await catalog.json();
});

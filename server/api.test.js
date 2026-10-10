import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

test("API regression suite uses an isolated database", async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "corese-api-test-"));
  process.env.NODE_ENV = "test";
  delete process.env.VERCEL;
  process.env.DATABASE_PATH = path.join(folder, "store.db");
  const seed = new Database("server/data/store.seed.db", { readonly: true });
  const setup = new Database(process.env.DATABASE_PATH);
  // Copy only the schema, never operational records or customer data.
  for (const row of seed
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all())
    setup.exec(row.sql);
  seed.close();
  setup
    .prepare("INSERT INTO users(username,password,role,name) VALUES(?,?,?,?)")
    .run("admin", bcrypt.hashSync("Admin123!", 4), "admin", "Admin Teste");
  setup.close();
  if (process.env.CORESE_TEST_REMOTE === "1") {
    process.env.TURSO_DATABASE_URL = (await import("node:url")).pathToFileURL(
      process.env.DATABASE_PATH,
    ).href;
    process.env.JWT_SECRET = "isolated-regression-test-secret";
  } else {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
  }
  const { default: app, testDatabase, database } = await import("./index.js");
  const db = testDatabase || new Database(process.env.DATABASE_PATH);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    if (!testDatabase) database.close();
    await rm(folder, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let token;
  async function request(route, method = "GET", body, authenticated = true) {
    const headers =
      authenticated && token ? { Authorization: `Bearer ${token}` } : {};
    if (body && !(body instanceof FormData))
      headers["Content-Type"] = "application/json";
    const response = await fetch(base + route, {
      method,
      headers,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
    return { status: response.status, body: await response.json() };
  }
  const login = await request("/login", "POST", {
    username: "admin",
    password: "Admin123!",
  });
  assert.equal(login.status, 200);
  token = login.body.token;
  const product = {
    name: "Produto Teste",
    brand: "Marca",
    type: "Tipo",
    style: "Estilo",
    price: 12.5,
    quantity: 10,
    expiration_date: "2027-01-10",
  };
  let id, saleId, clientId;
  const methods = await request("/payment-methods");
  const cash = methods.body.find((method) => method.code === "01").id;

  await t.test(
    "authentication, unknown routes and invalid product input",
    async () => {
      assert.equal(
        (await request("/products", "GET", undefined, false)).status,
        401,
      );
      assert.equal((await request("/missing")).status, 404);
      for (const patch of [
        { name: " " },
        { price: -1 },
        { price: "NaN" },
        { quantity: 1.5 },
        { quantity: -1 },
        { expiration_date: "2026-02-30" },
      ])
        assert.equal(
          (await request("/products", "POST", { ...product, ...patch })).status,
          400,
        );
      assert.equal(
        db.prepare("SELECT COUNT(*) count FROM products").get().count,
        0,
      );
      const created = await request("/products", "POST", product);
      assert.equal(created.status, 201);
      id = created.body.id;
      assert.equal(
        (await request("/products/9999", "PUT", product)).status,
        404,
      );
    },
  );

  await t.test(
    "sales reject invalid payments and cancel exactly once",
    async () => {
      const client = await request("/users", "POST", {
        username: "cliente",
        name: "Cliente Teste",
        role: "cliente",
        password: "Client123!",
      });
      assert.equal(client.status, 201);
      clientId = client.body.id;
      const sale = {
        product_id: id,
        quantity: 2,
        payment_method_id: cash,
        amount_received: 30,
        customer_id: clientId,
      };
      for (const patch of [
        { quantity: -1 },
        { quantity: 1.5 },
        { quantity: 11 },
        { amount_received: "NaN" },
        { amount_received: -2 },
        { installments: 1.5 },
        { customer_id: 9999 },
        { order_status: "Cancelado" },
      ])
        assert.equal(
          (await request("/sales", "POST", { ...sale, ...patch })).status,
          400,
        );
      assert.equal(
        db.prepare("SELECT quantity FROM products WHERE id=?").get(id).quantity,
        10,
      );
      const created = await request("/sales", "POST", sale);
      assert.equal(created.status, 201);
      assert.equal(created.body.change, 5);
      saleId = created.body.id;
      assert.equal(
        db.prepare("SELECT quantity FROM products WHERE id=?").get(id).quantity,
        8,
      );
      assert.equal((await request(`/users/${clientId}`, "DELETE")).status, 409);
      assert.equal(
        (await request(`/sales/${saleId}/cancel`, "POST", { reason: "Teste" }))
          .status,
        200,
      );
      assert.equal(
        (await request(`/sales/${saleId}/cancel`, "POST", { reason: "Teste" }))
          .status,
        400,
      );
      assert.equal(
        db.prepare("SELECT quantity FROM products WHERE id=?").get(id).quantity,
        10,
      );
      assert.equal((await request("/dashboard")).body.revenue, 0);
    },
  );

  await t.test(
    "stock edits reject stale quantities and preserve history",
    async () => {
      assert.equal(
        (
          await request("/stock-movements", "POST", {
            product_id: id,
            quantity: 2,
            movement_type: "ENTRADA",
            reason: "Reposição",
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await request(`/products/${id}`, "PUT", {
            ...product,
            original_quantity: 10,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(`/products/${id}`, "PUT", {
            ...product,
            quantity: 5,
            original_quantity: 12,
          })
        ).status,
        200,
      );
      assert.equal(
        db.prepare("SELECT quantity FROM products WHERE id=?").get(id).quantity,
        5,
      );
      assert.equal(
        db
          .prepare(
            "SELECT movement_type FROM stock_movements ORDER BY id DESC LIMIT 1",
          )
          .get().movement_type,
        "AJUSTE",
      );
      const item = await request("/products", "POST", {
        ...product,
        name: "Apenas movimento",
      });
      await request("/stock-movements", "POST", {
        product_id: item.body.id,
        quantity: 1,
        movement_type: "ENTRADA",
        reason: "Reposição",
      });
      assert.equal(
        (await request(`/products/${item.body.id}`, "DELETE")).status,
        409,
      );
      const unused = await request("/products", "POST", {
        ...product,
        name: "Sem histórico",
      });
      assert.equal(
        (await request(`/products/${unused.body.id}`, "DELETE")).status,
        200,
      );
    },
  );

  await t.test(
    "CSV import is atomic and accepts Brazilian dates and decimals",
    async () => {
      const csv = (text) => {
        const form = new FormData();
        form.append(
          "file",
          new Blob([text], { type: "text/csv" }),
          "produtos.csv",
        );
        return form;
      };
      const before = db
        .prepare("SELECT COUNT(*) count FROM products")
        .get().count;
      assert.equal(
        (
          await request(
            "/import/products",
            "POST",
            csv("nome,preco,quantidade\nValido,10,2\nInvalido,-2,3"),
          )
        ).status,
        400,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) count FROM products").get().count,
        before,
      );
      assert.equal(
        (
          await request(
            "/import/products",
            "POST",
            csv(
              "nome;preco;quantidade;data_validade\nImportado;12,50;3;10/01/2027",
            ),
          )
        ).status,
        200,
      );
      const imported = db
        .prepare(
          "SELECT price,expiration_date FROM products WHERE name='Importado'",
        )
        .get();
      assert.equal(imported.price, 12.5);
      assert.equal(imported.expiration_date, "2027-01-10");
      assert.equal(
        (await request("/import/products", "POST", csv("outra\nqualquer")))
          .status,
        400,
      );
    },
  );

  await t.test(
    "profile uploads and payment settings reject invalid values",
    async () => {
      const invalidImage = new FormData();
      invalidImage.append(
        "image",
        new Blob(["csv"], { type: "text/csv" }),
        "file.csv",
      );
      assert.equal(
        (await request("/me/image", "PUT", invalidImage)).status,
        400,
      );
      const method = methods.body.find((item) => item.id === cash);
      assert.equal(
        (
          await request(`/payment-methods/${cash}`, "PUT", {
            ...method,
            max_installments: 1.5,
          })
        ).status,
        400,
      );
    },
  );

  await t.test(
    "concurrent sales and cancellations preserve stock",
    async () => {
      const created = await request("/products", "POST", {
        ...product,
        quantity: 1,
      });
      const sale = {
        product_id: created.body.id,
        quantity: 1,
        payment_method_id: cash,
        amount_received: 20,
      };
      const results = await Promise.all([
        request("/sales", "POST", sale),
        request("/sales", "POST", sale),
      ]);
      assert.deepEqual(
        results.map((result) => result.status).sort(),
        [201, 400],
      );
      const sold = results.find((result) => result.status === 201);
      const cancellations = await Promise.all([
        request(`/sales/${sold.body.id}/cancel`, "POST", {}),
        request(`/sales/${sold.body.id}/cancel`, "POST", {}),
      ]);
      assert.deepEqual(
        cancellations.map((result) => result.status).sort(),
        [200, 400],
      );
      assert.equal(
        db
          .prepare("SELECT quantity FROM products WHERE id=?")
          .get(created.body.id).quantity,
        1,
      );
    },
  );

  await t.test(
    "password change invalidates previously issued sessions",
    async () => {
      const result = await request("/users/1", "PUT", {
        username: "admin",
        name: "Admin Teste",
        role: "admin",
        password: "NewAdmin123!",
      });
      assert.equal(result.status, 200);
      assert.equal((await request("/me")).status, 401);
      assert.equal(
        (
          await request("/login", "POST", {
            username: "admin",
            password: "NewAdmin123!",
          })
        ).status,
        200,
      );
    },
  );
});

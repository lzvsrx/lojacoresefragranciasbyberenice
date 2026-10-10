import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { commerceDefaults, POLICY_VERSION, documentValid } from "./commerce.js";

test("supplier document supports CPF and numeric/alpha CNPJ", () => {
  assert.equal(documentValid("11.222.333/0001-81"), true);
  assert.equal(documentValid("529.982.247-25"), true);
  assert.equal(documentValid("12.ABC.345/01DE-35"), true);
  for (const value of [
    "11111111111",
    "00.000.000/0000-00",
    "11.222.333/0001-82",
    "abc52998224725",
  ])
    assert.equal(documentValid(value), false);
});
test("online commerce uses isolated data and atomic stock", async (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "corese-commerce-"));
  process.env.NODE_ENV = "test";
  delete process.env.VERCEL;
  process.env.DATABASE_PATH = path.join(folder, "store.db");
  const source = new Database("server/data/store.seed.db", { readonly: true }),
    setup = new Database(process.env.DATABASE_PATH);
  for (const row of source
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all())
    setup.exec(row.sql);
  setup
    .prepare("INSERT INTO users(username,password,role,name) VALUES(?,?,?,?)")
    .run(
      "admin",
      bcrypt.hashSync("Admin123!", 4),
      "admin",
      "Administrador de teste",
    );
  setup.close();
  source.close();
  if (process.env.CORESE_TEST_REMOTE === "1") {
    process.env.TURSO_DATABASE_URL = pathToFileURL(
      process.env.DATABASE_PATH,
    ).href;
    process.env.JWT_SECRET = "test-commerce-isolated-secret";
  } else {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
  }
  const { default: app, database: db } = await import("./index.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
    await rm(folder, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (route, method = "GET", body, token) => {
    const r = await fetch(base + route, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  const admin = (
    await request("/login", "POST", {
      username: "admin",
      password: "Admin123!",
    })
  ).body.token;
  const register = async (username) =>
    (
      await request("/customer/register", "POST", {
        username,
        name: "Cliente Teste",
        email: `${username}@example.test`,
        password: "Cliente123!",
      })
    ).body;
  const client = await register("client.one"),
    other = await register("client.two");
  const shop = {
    ...commerceDefaults,
    legal_name: "Fornecedor fictício para testes",
    document: "11222333000181",
    email: "loja@example.test",
    hours: "Segunda a sexta, 9h às 18h",
    checkout_enabled: true,
    delivery_enabled: true,
    delivery_region: "Região de teste",
    cep_start: "37000000",
    cep_end: "37999999",
    delivery_fee_cents: 1250,
  };
  const details = {
    description: "Perfume de teste",
    composition: "Ingredientes de teste",
    precautions: "Não ingerir. Uso externo.",
    volume: "100 ml",
    manufacturer: "Fabricante de teste",
    anvisa_reference: "Referência de teste",
  };
  const p = (
    await request(
      "/products",
      "POST",
      {
        name: "Perfume teste",
        brand: "Marca",
        type: "Perfume",
        style: "Floral",
        price: 20.5,
        quantity: 10,
        expiration_date: "2099-01-01",
      },
      admin,
    )
  ).body.id;
  const method = (await request("/shop/payment-methods")).body[0].id;
  const order = (patch = {}) => ({
    items: [{ id: p, quantity: 2 }],
    payment_method_id: method,
    fulfillment: { type: "pickup" },
    expected_total_cents: 4100,
    policy_version: POLICY_VERSION,
    accepted: true,
    idempotency_key: randomUUID(),
    ...patch,
  });
  const quantity = async () =>
    (await db.prepare("SELECT quantity FROM products WHERE id=?").get(p))
      .quantity;
  let paidId;
  await t.test(
    "legal identity, product details and consent gate checkout",
    async () => {
      assert.equal((await request("/shop")).body.checkout_enabled, false);
      await db
        .prepare(
          "UPDATE payment_methods SET instructions='INTERNAL-PAYMENT-NOTE' WHERE id=?",
        )
        .run(method);
      assert.ok(
        !JSON.stringify((await request("/shop/payment-methods")).body).includes(
          "INTERNAL-PAYMENT-NOTE",
        ),
      );
      assert.equal(
        (await request("/customer/orders", "POST", order(), client.token))
          .status,
        503,
      );
      assert.equal(
        (await request("/shop", "PUT", { ...shop, document: "123" }, admin))
          .status,
        400,
      );
      assert.equal(
        (await request("/shop", "PUT", shop, client.token)).status,
        403,
      );
      assert.equal((await request("/shop", "PUT", shop, admin)).status, 200);
      assert.equal(
        (await request("/customer/orders", "POST", order(), client.token))
          .status,
        409,
      );
      assert.equal(
        (await request(`/product-details/${p}`, "PUT", details, admin)).status,
        200,
      );
      assert.equal(
        (
          await request(
            "/customer/orders",
            "POST",
            order({ accepted: false }),
            client.token,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            "/customer/orders",
            "POST",
            order({ expected_total_cents: 1 }),
            client.token,
          )
        ).status,
        409,
      );
      assert.equal(await quantity(), 10);
    },
  );
  await t.test(
    "checkout reserves once, snapshots prices and prevents IDOR",
    async () => {
      const body = order();
      const results = await Promise.all([
        request("/customer/orders", "POST", body, client.token),
        request("/customer/orders", "POST", body, client.token),
      ]);
      assert.deepEqual(
        results.map((r) => r.status),
        [201, 201],
      );
      paidId = results[0].body.id;
      assert.equal(results[1].body.id, paidId);
      assert.equal(await quantity(), 8);
      assert.equal(results[0].body.total_cents, 4100);
      assert.equal(
        (
          await request(
            `/customer/orders/${paidId}`,
            "GET",
            undefined,
            other.token,
          )
        ).status,
        404,
      );
      assert.equal(
        (await request("/online-orders", "GET", undefined, client.token))
          .status,
        403,
      );
      assert.equal(
        (await request("/customer/orders", "POST", body, other.token)).status,
        409,
      );
      await db.prepare("UPDATE products SET price=30 WHERE id=?").run(p);
      const saved = (
        await request(
          `/customer/orders/${paidId}`,
          "GET",
          undefined,
          client.token,
        )
      ).body;
      assert.equal(saved.items[0].unit_price_cents, 2050);
      assert.equal(saved.items[0].details.composition, details.composition);
      assert.equal(
        (await db.prepare("SELECT COUNT(*) n FROM sales").get()).n,
        0,
      );
    },
  );
  await t.test(
    "payment confirmation cannot duplicate revenue or stock movement",
    async () => {
      const url = `/online-orders/${paidId}/status`;
      assert.equal(
        (await request(url, "POST", { status: "Pago" }, admin)).status,
        400,
      );
      const r = await Promise.all([
        request(
          url,
          "POST",
          { status: "Pago", confirmed: true, reference: "TEST-REF" },
          admin,
        ),
        request(
          url,
          "POST",
          { status: "Pago", confirmed: true, reference: "TEST-REF" },
          admin,
        ),
      ]);
      assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
      assert.equal(await quantity(), 8);
      const sales = await db.prepare("SELECT * FROM sales").all();
      assert.equal(sales.length, 1);
      assert.equal(sales[0].total_value, 41);
      assert.equal(
        (await request(`/sales/${sales[0].id}/cancel`, "POST", {}, admin))
          .status,
        409,
      );
      assert.equal(
        (
          await request(
            `/customer/orders/${paidId}/cancel`,
            "POST",
            {},
            client.token,
          )
        ).status,
        409,
      );
      assert.equal(
        (await request(url, "POST", { status: "Enviado" }, admin)).status,
        409,
      );
    },
  );
  await t.test(
    "delivery totals, unavailable stock, cancellation and expiration",
    async () => {
      const delivery = {
        type: "delivery",
        cep: "37010-100",
        street: "Rua Teste",
        number: "10",
        district: "Centro",
        city: "Cidade Teste",
        state: "MG",
      };
      assert.equal(
        (
          await request(
            "/customer/orders",
            "POST",
            order({
              fulfillment: { ...delivery, cep: "01001000" },
              expected_total_cents: 7250,
            }),
            other.token,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            "/customer/orders",
            "POST",
            order({ fulfillment: delivery, expected_total_cents: 6000 }),
            other.token,
          )
        ).status,
        409,
      );
      const made = await request(
        "/customer/orders",
        "POST",
        order({ fulfillment: delivery, expected_total_cents: 7250 }),
        other.token,
      );
      assert.equal(made.status, 201);
      assert.equal(made.body.shipping_cents, 1250);
      assert.equal(await quantity(), 6);
      const cancel = () =>
        request(
          `/customer/orders/${made.body.id}/cancel`,
          "POST",
          {},
          other.token,
        );
      assert.deepEqual(
        (await Promise.all([cancel(), cancel()])).map((r) => r.status),
        [200, 200],
      );
      assert.equal(await quantity(), 8);
      const pending = await request(
        "/customer/orders",
        "POST",
        order({ expected_total_cents: 6000 }),
        other.token,
      );
      assert.equal(pending.status, 201);
      await db
        .prepare(
          "UPDATE web_orders SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
        )
        .run(pending.body.id);
      await request("/orders/expire", "POST", {}, admin);
      await request("/orders/expire", "POST", {}, admin);
      assert.equal(await quantity(), 8);
      const attempts = await Promise.all([
        request(
          "/customer/orders",
          "POST",
          order({
            items: [{ id: p, quantity: 8 }],
            expected_total_cents: 24000,
          }),
          client.token,
        ),
        request(
          "/customer/orders",
          "POST",
          order({
            items: [{ id: p, quantity: 8 }],
            expected_total_cents: 24000,
          }),
          other.token,
        ),
      ]);
      assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 409]);
      assert.equal(await quantity(), 0);
      const successful = attempts.find((r) => r.status === 201);
      await request(
        `/online-orders/${successful.body.id}/status`,
        "POST",
        { status: "Cancelado" },
        admin,
      );
      assert.equal(await quantity(), 8);
    },
  );
  await t.test(
    "support acknowledges requests, answers and exports only own data",
    async () => {
      assert.equal(
        (
          await request(
            "/customer/requests",
            "POST",
            {
              kind: "Arrependimento",
              order_id: paidId,
              message: "Quero exercer meu direito de arrependimento.",
            },
            other.token,
          )
        ).status,
        404,
      );
      const r = await request(
        "/customer/requests",
        "POST",
        {
          kind: "Arrependimento",
          order_id: paidId,
          message: "Quero exercer meu direito de arrependimento.",
        },
        client.token,
      );
      assert.equal(r.status, 201);
      assert.match(r.body.protocol, /^SAC-/);
      assert.ok(r.body.due_at > r.body.created_at);
      assert.equal(
        (
          await request(
            `/service-requests/${r.body.id}`,
            "PUT",
            {
              response: "Solicitação recebida; vamos orientar a devolução.",
              status: "Respondido",
            },
            admin,
          )
        ).status,
        200,
      );
      assert.equal(
        (await request("/customer/requests", "GET", undefined, client.token))
          .body[0].status,
        "Respondido",
      );
      assert.equal(
        (await request("/customer/requests", "GET", undefined, other.token))
          .body.length,
        0,
      );
      const data = (
        await request("/customer/data", "GET", undefined, client.token)
      ).body;
      assert.equal(data.profile.id, client.user.id);
      assert.equal(data.profile.password, undefined);
      assert.ok(data.orders.every((o) => o.customer_id === client.user.id));
      assert.ok(data.requests.every((r) => r.customer_id === client.user.id));
      assert.equal(
        (
          await request(
            "/customer/profile",
            "PUT",
            { name: "Nome Corrigido", email: "novo@example.test", phone: "" },
            client.token,
          )
        ).status,
        200,
      );
    },
  );
  await t.test(
    "refund requires bank confirmation, removes revenue and does not restock returns",
    async () => {
      const url = `/online-orders/${paidId}/status`;
      assert.equal(
        (await request(url, "POST", { status: "Reembolso solicitado" }, admin))
          .status,
        200,
      );
      assert.equal(
        (
          await request(
            url,
            "POST",
            { status: "Reembolsado", reference: "ESTORNO" },
            admin,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            url,
            "POST",
            { status: "Reembolsado", reference: "ESTORNO", confirmed: true },
            admin,
          )
        ).status,
        200,
      );
      assert.equal(await quantity(), 8);
      assert.equal(
        (await db.prepare("SELECT order_status FROM sales").get()).order_status,
        "Cancelado",
      );
      assert.equal(
        (
          await request(
            url,
            "POST",
            { status: "Reembolsado", reference: "ESTORNO", confirmed: true },
            admin,
          )
        ).status,
        409,
      );
    },
  );
  await t.test(
    "customer password change checks current password and invalidates old sessions",
    async () => {
      assert.equal(
        (
          await request(
            "/customer/password",
            "PUT",
            { current_password: "wrong", password: "NovaSenha123!" },
            client.token,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            "/customer/password",
            "PUT",
            { current_password: "Cliente123!", password: "NovaSenha123!" },
            client.token,
          )
        ).status,
        200,
      );
      assert.equal(
        (await request("/customer/orders", "GET", undefined, client.token))
          .status,
        401,
      );
      assert.equal(
        (
          await request("/customer/login", "POST", {
            username: "client.one",
            password: "NovaSenha123!",
          })
        ).status,
        200,
      );
    },
  );
  await t.test(
    "public seed removes orders, addresses, support, merchant identity and payment instructions",
    async () => {
      const copyRoot = path.join(folder, "seed-copy"),
        dataFolder = path.join(copyRoot, "server/data");
      mkdirSync(dataFolder, { recursive: true });
      const read = new Database(process.env.DATABASE_PATH, { readonly: true });
      await read.backup(path.join(dataFolder, "store.db"));
      read.close();
      execFileSync(process.execPath, [path.resolve("scripts/create-seed.js")], {
        cwd: copyRoot,
        stdio: "pipe",
      });
      const seed = new Database(path.join(dataFolder, "store.seed.db"), {
        readonly: true,
      });
      try {
        for (const table of [
          "web_orders",
          "web_order_items",
          "web_order_events",
          "service_requests",
          "commerce_settings",
        ])
          assert.equal(
            seed.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,
            0,
          );
        assert.equal(
          seed
            .prepare(
              "SELECT COUNT(*) n FROM users WHERE email IS NOT NULL OR phone IS NOT NULL OR cpf IS NOT NULL",
            )
            .get().n,
          0,
        );
        assert.equal(
          seed
            .prepare(
              "SELECT COUNT(*) n FROM payment_methods WHERE instructions<>''",
            )
            .get().n,
          0,
        );
        assert.equal(
          seed
            .prepare(
              "SELECT COUNT(*) n FROM sales WHERE transaction_reference IS NOT NULL OR fiscal_key IS NOT NULL",
            )
            .get().n,
          0,
        );
      } finally {
        seed.close();
      }
    },
  );
});

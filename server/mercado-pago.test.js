import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import { createClient } from "@libsql/client";
import { createDatabase } from "./database.js";
import {
  installCommerce,
  commerceDefaults,
  POLICY_VERSION,
} from "./commerce.js";
import {
  mercadoPagoConfig,
  validWebhook,
  checkoutUrl,
} from "./mercado-pago.js";

test("Mercado Pago configuration and signature reject invalid inputs", () => {
  assert.equal(mercadoPagoConfig({}).configured, false);
  assert.equal(
    mercadoPagoConfig({
      PUBLIC_BASE_URL: "http://store.test",
      MERCADO_PAGO_ACCESS_TOKEN: "token",
      MERCADO_PAGO_WEBHOOK_SECRET: "secret",
    }).configured,
    false,
  );
  assert.equal(
    validWebhook(
      { query: { "data.id": "123" }, get: () => "invalid" },
      "secret",
    ),
    false,
  );
  assert.throws(() =>
    checkoutUrl(
      { init_point: "https://mercadopago.com.br.evil.test/pay" },
      false,
    ),
  );
});

test("Checkout Pro creates one checkout and reconciles verified payments atomically", async (t) => {
  const envKeys = [
    "PUBLIC_BASE_URL",
    "MERCADO_PAGO_ACCESS_TOKEN",
    "MERCADO_PAGO_PUBLIC_KEY",
    "MERCADO_PAGO_WEBHOOK_SECRET",
    "MERCADO_PAGO_SANDBOX",
    "MERCADO_PAGO_AUTO_REFUND_FRAUD",
  ];
  const previousEnv = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, {
    PUBLIC_BASE_URL: "https://store.test",
    MERCADO_PAGO_ACCESS_TOKEN: "test-token",
    MERCADO_PAGO_PUBLIC_KEY: "TEST-public-key",
    MERCADO_PAGO_WEBHOOK_SECRET: "test-secret",
    MERCADO_PAGO_SANDBOX: "true",
    MERCADO_PAGO_AUTO_REFUND_FRAUD: "false",
  });
  const db = await createDatabase({
    client: createClient({ url: "file::memory:" }),
  });
  await db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,phone TEXT,username TEXT);
    CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,price REAL,quantity INTEGER,expiration_date TEXT,image BLOB);
    CREATE TABLE payment_methods(id INTEGER PRIMARY KEY,code TEXT,name TEXT,active INTEGER,max_installments INTEGER);
    CREATE TABLE sales(id INTEGER PRIMARY KEY,product_id INTEGER,quantity INTEGER,total_value REAL,user_id INTEGER,customer_id INTEGER,payment_method TEXT,order_number TEXT,order_status TEXT,transaction_reference TEXT,installments INTEGER,amount_received REAL,change_amount REAL);
    CREATE TABLE stock_movements(id INTEGER PRIMARY KEY,product_id INTEGER,movement_type TEXT,quantity INTEGER,previous_quantity INTEGER,new_quantity INTEGER,reason TEXT,user_id INTEGER,sale_id INTEGER);
    INSERT INTO users VALUES(1,'Cliente','client@example.test','','client');
    INSERT INTO users VALUES(2,'Outro','other@example.test','','other');
    INSERT INTO products(id,name,price,quantity,expiration_date) VALUES(1,'Perfume',20.50,10,'2099-01-01');
    INSERT INTO payment_methods VALUES(1,'MP','Mercado Pago',1,3);
    INSERT INTO payment_methods VALUES(2,'01','Dinheiro',1,1);
  `);
  const app = express();
  app.use(express.json());
  const auth =
    (roles = []) =>
    (req, res, next) => {
      req.user = {
        id: Number(req.get("x-user") || 1),
        role: req.get("x-role") || "cliente",
      };
      if (roles.length && !roles.includes(req.user.role))
        return res.status(403).json({ error: "Sem permissão" });
      next();
    };
  await installCommerce(app, { db, auth, safeUser: (u) => u });
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({ error: err.message }),
  );
  await db.prepare("INSERT INTO commerce_settings VALUES(1,?)").run(
    JSON.stringify({
      ...commerceDefaults,
      legal_name: "Loja",
      document: "11222333000181",
      email: "store@example.test",
      hours: "9h",
      checkout_enabled: true,
    }),
  );
  await db
    .prepare(
      "INSERT INTO product_details(product_id,description,composition,precautions,volume,manufacturer) VALUES(1,'Perfume','Ingredientes','Uso externo','100ml','Fabricante')",
    )
    .run();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const originalFetch = globalThis.fetch;
  let preferenceCalls = 0,
    paymentData,
    sentPreference;
  let refundCalls = 0,
    providerUnavailable = false;
  const paymentRegistry = new Map(),
    merchantRegistry = new Map();
  const disputeRegistry = new Map();
  const refundKeys = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://api.mercadopago.com")) {
      assert.equal(options.headers.Authorization, "Bearer test-token");
      if (providerUnavailable) throw new Error("Network unavailable");
      const parsed = new URL(url);
      if (
        /\/checkout\/preferences\/?$/.test(parsed.pathname) &&
        options.method === "POST"
      ) {
        preferenceCalls++;
        sentPreference = JSON.parse(options.body);
        return Response.json({
          id: `pref-${preferenceCalls}`,
          collector_id: 77,
          sandbox_init_point:
            "https://sandbox.mercadopago.com.br/checkout/pay?pref_id=test",
        });
      }
      if (
        /\/checkout\/preferences\//.test(parsed.pathname) &&
        options.method === "PUT"
      )
        return Response.json({
          id: parsed.pathname.split("/").at(-1),
          expires: true,
        });
      if (parsed.pathname === "/users/me")
        return Response.json({ id: 77, site_id: "MLB", tags: ["test_user"] });
      if (parsed.pathname.startsWith("/v1/chargebacks/")) {
        assert.equal(options.headers["X-Caller-Id"], "77");
        return Response.json(
          disputeRegistry.get(parsed.pathname.split("/").at(-1)),
        );
      }
      if (parsed.pathname === "/v1/payments/search")
        return Response.json({
          results: [...paymentRegistry.values()].filter(
            (p) =>
              p.external_reference ===
              parsed.searchParams.get("external_reference"),
          ),
        });
      if (/\/merchant_orders\//.test(parsed.pathname))
        return Response.json(
          merchantRegistry.get(parsed.pathname.split("/").at(-1)),
        );
      if (parsed.pathname.endsWith("/refunds")) {
        refundCalls++;
        refundKeys.push(options.headers["X-Idempotency-Key"]);
        const p = paymentRegistry.get(parsed.pathname.split("/")[3]);
        const amount = JSON.parse(options.body || "{}").amount;
        p.transaction_amount_refunded = Math.min(
          p.transaction_amount,
          Number(p.transaction_amount_refunded || 0) +
            (amount ??
              p.transaction_amount -
                Number(p.transaction_amount_refunded || 0)),
        );
        if (p.transaction_amount_refunded === p.transaction_amount)
          p.status = "refunded";
        return Response.json({
          id: `refund-${refundCalls}`,
          status: "approved",
        });
      }
      const id = parsed.pathname.split("/").at(-1);
      const p = paymentRegistry.get(id) || paymentData;
      if (options.method === "PUT") p.status = "cancelled";
      return Response.json(p);
    }
    return originalFetch(url, options);
  };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const key of envKeys)
      previousEnv[key] === undefined
        ? delete process.env[key]
        : (process.env[key] = previousEnv[key]);
    await new Promise((r) => server.close(r));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, body, headers = {}) =>
    originalFetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  const place = async (patch = {}) => {
    const response = await request("/customer/orders", {
      items: [{ id: 1, quantity: 2 }],
      payment_method_id: 1,
      fulfillment: { type: "pickup" },
      expected_total_cents: 4100,
      policy_version: POLICY_VERSION,
      accepted: true,
      idempotency_key: randomUUID(),
      ...patch,
    });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  };
  const order = await place();
  assert.equal(order.payment.provider, "mercado_pago");
  assert.equal(
    (await (await request("/shop/payment-methods")).json()).length,
    1,
  );
  assert.equal(
    (
      await request(
        `/customer/orders/${order.id}/payment`,
        {},
        { "x-user": "2" },
      )
    ).status,
    404,
  );
  const payments = await Promise.all([
    request(`/customer/orders/${order.id}/payment`, {
      device_id: "device-123_test",
    }),
    request(`/customer/orders/${order.id}/payment`, {
      device_id: "device-123_test",
    }),
  ]);
  assert.ok(payments.some((r) => r.status === 200));
  assert.ok(payments.every((r) => [200, 409].includes(r.status)));
  assert.equal(preferenceCalls, 1);
  assert.equal(sentPreference.items[0].unit_price, 20.5);
  assert.equal(sentPreference.items[0].quantity, 2);
  assert.equal(sentPreference.shipments.cost, 0);
  assert.equal(sentPreference.payment_methods.installments, 3);
  assert.equal(sentPreference.external_reference, order.number);
  assert.equal(
    (
      await request(
        `/online-orders/${order.id}/status`,
        {
          status: "Pago",
          reference: "fake",
          confirmed: true,
        },
        { "x-role": "admin" },
      )
    ).status,
    409,
  );
  const notify = async (id, signed = true) => {
    paymentRegistry.set(String(paymentData.id), structuredClone(paymentData));
    const ts = String(Math.floor(Date.now() / 1000)),
      requestId = "test-request";
    const v1 = createHmac("sha256", "test-secret")
      .update(`id:${id};request-id:${requestId};ts:${ts};`)
      .digest("hex");
    return request(
      `/mercado-pago/webhook?data.id=${id}&type=payment`,
      { type: "payment" },
      {
        "x-request-id": requestId,
        "x-signature": signed ? `ts=${ts},v1=${v1}` : "bad",
      },
    );
  };
  paymentData = {
    id: 123,
    external_reference: order.number,
    collector_id: 77,
    currency_id: "BRL",
    transaction_amount: 41,
    installments: 3,
    status: "approved",
    live_mode: false,
  };
  assert.equal((await notify(123, false)).status, 401);
  paymentData.transaction_amount = 1;
  assert.equal((await notify(123)).status, 400);
  paymentData.transaction_amount = 41;
  paymentData.collector_id = 88;
  assert.equal((await notify(123)).status, 400);
  paymentData.collector_id = 77;
  paymentData.live_mode = true;
  assert.equal((await notify(123)).status, 400);
  paymentData.live_mode = false;
  paymentData.status = "pending";
  assert.equal((await notify(123)).status, 200);
  assert.equal((await db.prepare("SELECT count(*) n FROM sales").get()).n, 0);
  paymentData.status = "approved";
  const notifications = await Promise.all([notify(123), notify(123)]);
  assert.ok(notifications.some((r) => r.status === 200));
  assert.ok(notifications.every((r) => [200, 503].includes(r.status)));
  assert.equal((await notify(123)).status, 200);
  assert.equal((await db.prepare("SELECT count(*) n FROM sales").get()).n, 1);
  assert.equal(
    (await db.prepare("SELECT installments FROM sales").get()).installments,
    3,
  );
  assert.equal(
    (await db.prepare("SELECT quantity FROM products WHERE id=1").get())
      .quantity,
    8,
  );
  assert.equal(
    (await db.prepare("SELECT status FROM web_orders WHERE id=?").get(order.id))
      .status,
    "Pago",
  );
  assert.equal(
    (await request(`/customer/orders/${order.id}/payment`, {})).status,
    409,
  );
  const expired = await place();
  await request(`/customer/orders/${expired.id}/payment`, {});
  await db
    .prepare(
      "UPDATE web_orders SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    )
    .run(expired.id);
  paymentData = { ...paymentData, id: 124, external_reference: expired.number };
  assert.equal((await notify(124)).status, 200);
  assert.equal((await db.prepare("SELECT count(*) n FROM sales").get()).n, 1);
  assert.equal(
    (await db.prepare("SELECT quantity FROM products WHERE id=1").get())
      .quantity,
    8,
  );
  const events = await db
    .prepare("SELECT note FROM web_order_events WHERE order_id=?")
    .all(expired.id);
  assert.ok(events.some((e) => e.note.includes("reembolso")));
  const adminHeaders = { "x-role": "admin" };
  await t.test(
    "only public credentials are exposed and returns never confirm payments",
    async () => {
      const pub = await (await request("/shop/mercado-pago")).json();
      assert.equal(pub.public_key, "TEST-public-key");
      assert.equal(JSON.stringify(pub).includes("test-token"), false);
      assert.equal(JSON.stringify(pub).includes("test-secret"), false);
      assert.equal((await request("/mercado-pago/status")).status, 403);
      assert.equal(
        (await request("/mercado-pago/verify", {}, adminHeaders)).status,
        200,
      );
      const returned = await originalFetch(
        `${base}/mercado-pago/return/${expired.id}/success?status=approved`,
        { redirect: "manual" },
      );
      assert.equal(returned.status, 303);
      assert.equal(
        returned.headers.get("location"),
        `https://store.test/#/pedidos/${expired.id}?mp_result=success`,
      );
      assert.notEqual(
        (
          await db
            .prepare("SELECT status FROM web_orders WHERE id=?")
            .get(expired.id)
        ).status,
        "Pago",
      );
    },
  );
  await t.test(
    "full and partial refunds are role-restricted, idempotent and reconciled",
    async () => {
      assert.equal(
        (
          await request(`/online-orders/${order.id}/refund`, {
            confirmed: true,
          })
        ).status,
        403,
      );
      assert.equal(
        (await request(`/online-orders/${order.id}/refund`, {}, adminHeaders))
          .status,
        400,
      );
      const partial = {
        confirmed: true,
        amount_cents: 1000,
        payment_id: "123",
        request_id: randomUUID(),
      };
      const first = await request(
        `/online-orders/${order.id}/refund`,
        partial,
        adminHeaders,
      );
      assert.equal(first.status, 200, await first.clone().text());
      assert.equal(refundCalls, 1);
      assert.match(refundKeys[0], /^[a-f0-9]{64}$/);
      assert.equal(
        (
          await db
            .prepare("SELECT total_value FROM sales WHERE order_number=?")
            .get(order.number)
        ).total_value,
        31,
      );
      assert.equal(
        (
          await request(
            `/online-orders/${order.id}/refund`,
            partial,
            adminHeaders,
          )
        ).status,
        200,
      );
      assert.equal(refundCalls, 1);
      assert.equal(
        (
          await request(
            `/online-orders/${order.id}/refund`,
            { ...partial, amount_cents: 999 },
            adminHeaders,
          )
        ).status,
        409,
      );
      const full = await request(
        `/online-orders/${order.id}/refund`,
        { confirmed: true },
        adminHeaders,
      );
      assert.equal(full.status, 200, await full.clone().text());
      assert.equal((await full.json()).status, "Reembolsado");
      assert.equal(
        (
          await db
            .prepare("SELECT order_status FROM sales WHERE order_number=?")
            .get(order.number)
        ).order_status,
        "Cancelado",
      );
      assert.equal(refundCalls, 2);
      assert.equal(
        (
          await request(
            `/online-orders/${order.id}/refund`,
            { confirmed: true },
            adminHeaders,
          )
        ).status,
        200,
      );
      assert.equal(refundCalls, 2);
    },
  );
  await t.test(
    "accepted notifications survive a provider outage and can be retried",
    async () => {
      const retry = await place();
      await request(`/customer/orders/${retry.id}/payment`, {});
      paymentData = {
        ...paymentData,
        id: 125,
        external_reference: retry.number,
        status: "approved",
        transaction_amount_refunded: 0,
      };
      providerUnavailable = true;
      assert.equal((await notify(125)).status, 503);
      assert.equal(
        (
          await db
            .prepare("SELECT status FROM web_orders WHERE id=?")
            .get(retry.id)
        ).status,
        "Aguardando pagamento",
      );
      assert.ok(
        (
          await db
            .prepare(
              "SELECT count(*) n FROM mercado_pago_inbox WHERE processed_revision<revision",
            )
            .get()
        ).n > 0,
      );
      providerUnavailable = false;
      assert.equal(
        (await request("/mercado-pago/retry-notifications", {}, adminHeaders))
          .status,
        200,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT status FROM web_orders WHERE id=?")
            .get(retry.id)
        ).status,
        "Pago",
      );
      assert.equal(
        (
          await request(
            `/customer/orders/${retry.id}/payment-status`,
            {},
            { "x-user": "2" },
          )
        ).status,
        404,
      );
    },
  );
  await t.test(
    "a pending checkout is expired and cancelled before inventory is released",
    async () => {
      const cancelled = await place();
      await request(`/customer/orders/${cancelled.id}/payment`, {});
      paymentData = {
        ...paymentData,
        id: 126,
        external_reference: cancelled.number,
        status: "pending",
        transaction_amount_refunded: 0,
      };
      await notify(126);
      const before = (
        await db.prepare("SELECT quantity FROM products WHERE id=1").get()
      ).quantity;
      const response = await request(
        `/customer/orders/${cancelled.id}/cancel`,
        {},
      );
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).status, "Cancelado");
      assert.equal(paymentRegistry.get("126").status, "cancelled");
      assert.equal(
        (await db.prepare("SELECT quantity FROM products WHERE id=1").get())
          .quantity,
        before + 2,
      );
      assert.equal(
        (await request(`/customer/orders/${cancelled.id}/cancel`, {})).status,
        200,
      );
      assert.equal(
        (await db.prepare("SELECT quantity FROM products WHERE id=1").get())
          .quantity,
        before + 2,
      );
    },
  );
  await t.test(
    "split payments require the same merchant order and do not create partial sales",
    async () => {
      const split = await place();
      await request(`/customer/orders/${split.id}/payment`, {});
      const checkout = await db
        .prepare("SELECT * FROM mercado_pago_checkouts WHERE order_id=?")
        .get(split.id);
      merchantRegistry.set("900", {
        id: 900,
        preference_id: checkout.preference_id,
        external_reference: split.number,
        collector: { id: 77 },
        payments: [{ id: 127 }, { id: 128 }],
      });
      paymentData = {
        id: 127,
        external_reference: split.number,
        collector_id: 77,
        currency_id: "BRL",
        transaction_amount: 20.5,
        status: "approved",
        live_mode: false,
        order: { id: 900 },
      };
      assert.equal((await notify(127)).status, 200);
      assert.equal(
        (
          await db
            .prepare("SELECT status FROM web_orders WHERE id=?")
            .get(split.id)
        ).status,
        "Aguardando pagamento",
      );
      paymentData = { ...paymentData, id: 128 };
      assert.equal((await notify(128)).status, 200);
      assert.equal(
        (
          await db
            .prepare("SELECT status FROM web_orders WHERE id=?")
            .get(split.id)
        ).status,
        "Pago",
      );
      assert.equal(
        (
          await db
            .prepare("SELECT count(*) n FROM sales WHERE order_number=?")
            .get(split.number)
        ).n,
        1,
      );
    },
  );
  await t.test(
    "cron is private and fraud alerts require refund instead of release",
    async () => {
      assert.equal((await request("/mercado-pago/jobs")).status, 401);
      const fraud = await place();
      await request(`/customer/orders/${fraud.id}/payment`, {});
      paymentData = {
        id: 129,
        external_reference: fraud.number,
        collector_id: 77,
        currency_id: "BRL",
        transaction_amount: 41,
        status: "approved",
        live_mode: false,
      };
      await notify(129);
      const id = "129",
        ts = String(Math.floor(Date.now() / 1000)),
        requestId = "fraud-request";
      const signature = createHmac("sha256", "test-secret")
        .update(`id:${id};request-id:${requestId};ts:${ts};`)
        .digest("hex");
      assert.equal(
        (
          await request(
            `/mercado-pago/webhook?data.id=129&type=stop_delivery_op_wh`,
            { type: "stop_delivery_op_wh" },
            {
              "x-request-id": requestId,
              "x-signature": `ts=${ts},v1=${signature}`,
            },
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            `/online-orders/${fraud.id}/status`,
            { status: "Em separação" },
            adminHeaders,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/online-orders/${fraud.id}/payment-review`,
            {
              confirmed: true,
              note: "Conferência concluída na conta do Mercado Pago.",
            },
            adminHeaders,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/online-orders/${fraud.id}/status`,
            { status: "Em separação" },
            adminHeaders,
          )
        ).status,
        409,
      );
    },
  );
  const sendTopic = async (topic, id, extra = {}) => {
    const ts = String(Math.floor(Date.now() / 1000)),
      requestId = `topic-${id}`;
    const signature = createHmac("sha256", "test-secret")
      .update(`id:${id};request-id:${requestId};ts:${ts};`)
      .digest("hex");
    return request(
      `/mercado-pago/webhook?data.id=${id}&type=${topic}`,
      { type: topic, ...extra },
      { "x-request-id": requestId, "x-signature": `ts=${ts},v1=${signature}` },
    );
  };
  await t.test(
    "merchant order notifications do not duplicate split sales",
    async () => {
      const before = (await db.prepare("SELECT count(*) n FROM sales").get()).n;
      assert.equal((await sendTopic("merchant_order", "900")).status, 200);
      assert.equal(
        (await db.prepare("SELECT count(*) n FROM sales").get()).n,
        before,
      );
    },
  );
  await t.test(
    "chargebacks are fetched for the seller and reversed amounts are excluded from revenue",
    async () => {
      disputeRegistry.set("901", { id: 901, payments: [129] });
      paymentRegistry.get("129").status = "charged_back";
      assert.equal(
        (await sendTopic("topic_chargebacks_wh", "901")).status,
        200,
      );
      const sale = await db
        .prepare("SELECT * FROM sales WHERE transaction_reference='129'")
        .get();
      assert.equal(sale.order_status, "Cancelado");
      assert.equal(sale.total_value, 0);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT review_required FROM mercado_pago_payments WHERE payment_id='129'",
            )
            .get()
        ).review_required,
        1,
      );
    },
  );
  await t.test(
    "shipping is separate and partial refunds preserve the accepted order snapshot",
    async () => {
      const shop = JSON.parse(
        (
          await db
            .prepare("SELECT data FROM commerce_settings WHERE id=1")
            .get()
        ).data,
      );
      Object.assign(shop, {
        delivery_enabled: true,
        delivery_fee_cents: 1250,
        delivery_region: "Varginha",
        cep_start: "37000000",
        cep_end: "37999999",
      });
      await db
        .prepare("UPDATE commerce_settings SET data=? WHERE id=1")
        .run(JSON.stringify(shop));
      const delivery = await place({
        expected_total_cents: 5350,
        fulfillment: {
          type: "delivery",
          cep: "37014000",
          street: "Rua de teste",
          number: "66",
          district: "Centro",
          city: "Varginha",
          state: "MG",
        },
      });
      await request(`/customer/orders/${delivery.id}/payment`, {});
      assert.equal(sentPreference.shipments.cost, 12.5);
      assert.equal(
        sentPreference.items[0].unit_price * sentPreference.items[0].quantity +
          sentPreference.shipments.cost,
        53.5,
      );
      assert.equal(sentPreference.payer.address.zip_code, "37014000");
      paymentData = {
        id: 130,
        external_reference: delivery.number,
        collector_id: 77,
        currency_id: "BRL",
        transaction_amount: 53.5,
        status: "approved",
        live_mode: false,
      };
      await notify(130);
      assert.equal(
        (
          await request(
            `/online-orders/${delivery.id}/refund`,
            {
              confirmed: true,
              payment_id: "130",
              amount_cents: 535,
              request_id: randomUUID(),
            },
            adminHeaders,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT total_value FROM sales WHERE order_number=?")
            .get(delivery.number)
        ).total_value,
        36.9,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT total_cents FROM web_orders WHERE id=?")
            .get(delivery.id)
        ).total_cents,
        5350,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT total_cents FROM web_order_items WHERE order_id=?")
            .get(delivery.id)
        ).total_cents,
        4100,
      );
    },
  );
  await t.test(
    "authenticated fraud alerts refund once and never restock delivered inventory",
    async () => {
      process.env.MERCADO_PAGO_AUTO_REFUND_FRAUD = "true";
      await db.prepare("UPDATE products SET quantity=2 WHERE id=1").run();
      const fraud = await place();
      await request(`/customer/orders/${fraud.id}/payment`, {});
      paymentData = {
        id: 131,
        external_reference: fraud.number,
        collector_id: 77,
        currency_id: "BRL",
        transaction_amount: 41,
        status: "approved",
        live_mode: false,
      };
      await notify(131);
      const before = refundCalls;
      assert.equal(
        (
          await sendTopic("stop_delivery_op_wh", "131", {
            data: { payment_id: "999" },
          })
        ).status,
        400,
      );
      assert.equal(refundCalls, before);
      assert.equal(
        (
          await sendTopic("stop_delivery_op_wh", "131", {
            data: { payment_id: "131" },
          })
        ).status,
        200,
      );
      assert.equal(refundCalls, before + 1);
      assert.equal(
        (
          await db
            .prepare("SELECT status FROM web_orders WHERE id=?")
            .get(fraud.id)
        ).status,
        "Reembolsado",
      );
      assert.equal(
        (await db.prepare("SELECT quantity FROM products WHERE id=1").get())
          .quantity,
        0,
      );
      assert.equal(
        (
          await sendTopic("stop_delivery_op_wh", "131", {
            data: { payment_id: "131" },
          })
        ).status,
        200,
      );
      assert.equal(refundCalls, before + 1);
    },
  );
});

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { testSchema } from "../server/test-fixture.js";
import { commerceDefaults } from "../server/commerce.js";

// Local UI integration check: every provider response and SDK button is simulated.
// It never reads the operational database or sends requests/charges to Mercado Pago.
const folder = mkdtempSync(path.join(tmpdir(), "corese-mp-ui-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_PATH: path.join(folder, "test.db"),
  PUBLIC_BASE_URL: "https://store.test",
  MERCADO_PAGO_ACCESS_TOKEN: "test-token",
  MERCADO_PAGO_PUBLIC_KEY: "TEST-public-key",
  MERCADO_PAGO_WEBHOOK_SECRET: "test-secret",
  MERCADO_PAGO_SANDBOX: "true",
  MERCADO_PAGO_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
});
for (const key of [
  "VERCEL",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "JWT_SECRET",
])
  delete process.env[key];
const schema = testSchema(),
  setup = new Database(process.env.DATABASE_PATH),
  password = randomUUID() + "Aa1";
for (const row of schema
  .prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  )
  .all())
  setup.exec(row.sql);
for (const [username, role] of [
  ["admin", "admin"],
  ["customer.test", "cliente"],
])
  setup
    .prepare(
      "INSERT INTO users(username,password,role,name,email) VALUES(?,?,?,?,?)",
    )
    .run(
      username,
      bcrypt.hashSync(password, 4),
      role,
      "Cliente Teste",
      `${username}@example.test`,
    );
setup
  .prepare(
    "INSERT INTO products(name,price,quantity,expiration_date) VALUES('Perfume de teste',20.5,10,'2099-01-01')",
  )
  .run();
schema.close();
setup.close();
const { default: app, database: db } = await import("../server/index.js");
await db.prepare("UPDATE payment_methods SET active=1 WHERE code='MP'").run();
await db.prepare("INSERT INTO commerce_settings VALUES(1,?)").run(
  JSON.stringify({
    ...commerceDefaults,
    legal_name: "Loja de teste",
    document: "11222333000181",
    email: "store@example.test",
    hours: "9h",
    checkout_enabled: true,
  }),
);
await db
  .prepare(
    "INSERT INTO product_details(product_id,description,composition,precautions,volume,manufacturer) VALUES(1,'Perfume de teste','Ingredientes','Uso externo','100ml','Fabricante')",
  )
  .run();
const originalFetch = globalThis.fetch;
let preference,
  deviceHeader,
  refundCalls = 0;
const payment = {
  id: 111,
  collector_id: 77,
  currency_id: "BRL",
  transaction_amount: 41,
  status: "pending",
  live_mode: false,
};
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith("https://api.mercadopago.com"))
    return originalFetch(url, options);
  const endpoint = new URL(url).pathname;
  if (endpoint === "/v1/payment_methods")
    return Response.json([
      {
        id: "pix",
        name: "Pix",
        payment_type_id: "bank_transfer",
        status: "active",
      },
      {
        id: "visa",
        name: "Visa",
        payment_type_id: "credit_card",
        status: "active",
      },
    ]);
  if (endpoint === "/oauth/token")
    return Response.json({
      access_token: "test-oauth-token",
      public_key: "TEST-public-key",
      refresh_token: "test-oauth-refresh",
      expires_in: 3600,
      live_mode: false,
      user_id: 77,
      scope: "read write offline_access",
    });
  if (endpoint === "/users/me")
    return Response.json({
      id: 77,
      site_id: "MLB",
      nickname: "Conta de teste",
    });
  if (/\/checkout\/preferences\/?$/.test(endpoint)) {
    preference = JSON.parse(options.body);
    deviceHeader = options.headers["X-Meli-Session-Id"];
    payment.external_reference = preference.external_reference;
    return Response.json({
      id: "pref-browser",
      collector_id: 77,
      sandbox_init_point:
        "https://sandbox.mercadopago.com.br/checkout/pay?pref_id=pref-browser",
    });
  }
  if (endpoint.endsWith("/search"))
    return Response.json({ results: [payment] });
  if (endpoint.endsWith("/refunds")) {
    refundCalls++;
    payment.status = "refunded";
    payment.transaction_amount_refunded = 41;
    return Response.json({ id: "refund-browser", status: "approved" });
  }
  return Response.json(payment);
};
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
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
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://sdk.mercadopago.com/js/v2", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.MP_DEVICE_SESSION_ID='browser-device_123'; window.MercadoPago=class{bricks(){return{create:async(type,id,settings)=>{const node=document.getElementById(id);const button=document.createElement('button');button.textContent='Pagar no ambiente de teste';button.onclick=()=>{window.testWalletSubmitted=settings.initialization.preferenceId};node.appendChild(button);queueMicrotask(()=>settings.callbacks.onReady());return{unmount:()=>{node.replaceChildren()}}}}}};`,
    }),
  );
  await page.goto(`${origin}/#/cliente/entrar`);
  await page.locator('input[autocomplete="username"]').fill("customer.test");
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Entrar na minha conta" }).click();
  await page
    .getByRole("button", { name: "Sair da conta", exact: true })
    .waitFor();
  await page.evaluate(() =>
    localStorage.setItem(
      "customerCart",
      JSON.stringify([
        { id: 1, quantity: 2, name: "Perfume de teste", price: 20.5 },
      ]),
    ),
  );
  await page.goto(`${origin}/?test=checkout#/checkout`);
  await page
    .getByLabel("Forma de pagamento", { exact: true })
    .selectOption({ label: "Mercado Pago" });
  await page.getByRole("button", { name: "Revisar e continuar" }).click();
  await page.getByLabel(/Li e aceito/).check();
  await page
    .getByRole("button", {
      name: "Confirmar pedido com obrigação de pagamento",
    })
    .click();
  await page
    .getByRole("button", { name: "Pagar no ambiente de teste" })
    .waitFor();
  assert.equal(deviceHeader, "browser-device_123");
  assert.equal(preference.items[0].quantity, 2);
  assert.equal(preference.items[0].unit_price, 20.5);
  await page
    .getByRole("button", { name: "Pagar no ambiente de teste" })
    .click();
  assert.equal(
    await page.evaluate(() => window.testWalletSubmitted),
    "pref-browser",
  );
  payment.status = "approved";
  const statusResponse = page.waitForResponse((r) =>
    new URL(r.url()).pathname.endsWith("/payment-status"),
  );
  await page
    .getByRole("button", { name: "Consultar pagamento no Mercado Pago" })
    .click();
  assert.equal((await statusResponse).status(), 200);
  await page
    .getByText("Pagamento confirmado automaticamente pelo Mercado Pago.", {
      exact: false,
    })
    .waitFor();
  const order = await db.prepare("SELECT * FROM web_orders LIMIT 1").get();
  await page.goto(`${origin}/#/admin`);
  await page.locator('input[autocomplete="username"]').fill("admin");
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await page.locator(".stats").first().waitFor();
  await page.goto(`${origin}/#/admin/pedidos/${order.id}`);
  await page.getByLabel(/Conferi o pedido e confirmo/).check();
  await page
    .getByRole("button", { name: "Confirmar reembolso no Mercado Pago" })
    .click();
  await page.getByText("Reembolsado", { exact: true }).first().waitFor();
  assert.equal(refundCalls, 1);
  assert.equal(
    (await db.prepare("SELECT quantity FROM products WHERE id=1").get())
      .quantity,
    8,
  );
  assert.deepEqual(errors, []);
  await page.route(
    "https://auth.mercadopago.com/authorization**",
    async (route) => {
      const state = new URL(route.request().url()).searchParams.get("state");
      await route.fulfill({
        contentType: "text/html",
        body: `<a href="${origin}/api/mercado-pago/oauth/callback?code=fake-ui-code&state=${state}">Autorizar conta simulada</a>`,
      });
    },
  );
  await page.route("https://store.test/**", (route) =>
    route.fulfill({
      status: 302,
      headers: { location: origin + new URL(route.request().url()).hash },
    }),
  );
  await page.goto(`${origin}/#/admin/pagamentos`);
  await page
    .getByRole("button", { name: "Conectar Mercado Pago", exact: true })
    .click();
  await page.getByLabel("ID da aplicação (Client ID)").fill("123456789");
  await page
    .getByLabel("Segredo da aplicação (Client Secret)")
    .fill("fake-application-secret-12345");
  await page
    .getByLabel("Assinatura secreta das notificações")
    .fill("fake-webhook-secret-12345");
  await page
    .getByRole("button", { name: "Salvar e conectar no Mercado Pago" })
    .click();
  await page.getByRole("link", { name: "Autorizar conta simulada" }).click();
  await page
    .getByText("Conta Mercado Pago conectada", { exact: true })
    .waitFor();
  await page
    .getByText(
      "Conta conectada. As formas de pagamento foram cadastradas e salvas automaticamente.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    (
      await db
        .prepare("SELECT account_id FROM mercado_pago_connection WHERE id=1")
        .get()
    ).account_id,
    "77",
  );
  assert.equal(await page.locator(".mp-imported-methods li").count(), 2);
  await page.reload();
  await page.locator(".mp-imported-methods li").first().waitFor();
  assert.equal(await page.locator(".mp-imported-methods li").count(), 2);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) n FROM mercado_pago_methods WHERE account_id='77'",
        )
        .get()
    ).n,
    2,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Checkout UI check passed with simulated provider: SDK, device ID, payment, refund and OAuth account authorization/return.",
  );
} finally {
  globalThis.fetch = originalFetch;
  await browser?.close();
  await new Promise((r) => server.close(r));
  db.close();
  if (
    path.dirname(path.resolve(folder)) !== path.resolve(tmpdir()) ||
    !path.basename(folder).startsWith("corese-mp-ui-")
  )
    throw new Error("Unexpected test directory");
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { inputError } from "./validation.js";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  MercadoPagoConfig,
  Preference,
  Payment,
  PaymentRefund,
  MerchantOrder,
  User,
} from "mercadopago";
const requestBudget = new AsyncLocalStorage();
const credentialScope = new AsyncLocalStorage();
export const withMercadoPagoCredentials = (credentials, callback) =>
  credentialScope.run(credentials, callback);
export const mercadoPagoBudget = (_req, _res, next) =>
  requestBudget.getStore()
    ? next()
    : requestBudget.run({ deadline: Date.now() + 20000 }, next);

export function mercadoPagoConfig(env = process.env) {
  const credentials = env === process.env ? credentialScope.getStore() : null;
  if (credentials)
    env = {
      ...env,
      MERCADO_PAGO_ACCESS_TOKEN: credentials.token,
      MERCADO_PAGO_PUBLIC_KEY: credentials.publicKey,
      MERCADO_PAGO_WEBHOOK_SECRET: credentials.secret,
      MERCADO_PAGO_SANDBOX: String(credentials.sandbox),
    };
  let base;
  try {
    const url = new URL(env.PUBLIC_BASE_URL);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    )
      base = url.origin;
  } catch {}
  return {
    token: env.MERCADO_PAGO_ACCESS_TOKEN,
    publicKey: env.MERCADO_PAGO_PUBLIC_KEY,
    secret: env.MERCADO_PAGO_WEBHOOK_SECRET,
    base,
    configured: Boolean(
      base &&
      env.MERCADO_PAGO_ACCESS_TOKEN &&
      env.MERCADO_PAGO_PUBLIC_KEY &&
      env.MERCADO_PAGO_WEBHOOK_SECRET,
    ),
    sandbox: env.MERCADO_PAGO_SANDBOX === "true",
    autoRefundFraud: env.MERCADO_PAGO_AUTO_REFUND_FRAUD !== "false",
    integratorId: env.MERCADO_PAGO_INTEGRATOR_ID || undefined,
    descriptor: (env.MERCADO_PAGO_STATEMENT_DESCRIPTOR || "CORESBERENICE")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9 ]/g, "")
      .trim()
      .slice(0, 13),
    category: env.MERCADO_PAGO_CATEGORY_ID || "others",
  };
}

export async function mercadoPagoRequest(
  path,
  {
    body,
    config = mercadoPagoConfig(),
    fetcher,
    method,
    idempotencyKey,
    deviceId,
    headers = {},
  } = {},
) {
  if (!config.configured)
    throw inputError("Mercado Pago ainda não configurado pela loja", 503);
  const verb = method || (body ? "POST" : "GET");
  const timeout = Math.min(
    8000,
    (requestBudget.getStore()?.deadline || Date.now() + 8000) - Date.now(),
  );
  if (timeout <= 0)
    throw inputError(
      "A consulta demorou mais que o esperado. Retome pelo seu pedido.",
      502,
    );
  const options = {
    timeout,
    maxRetries: 0,
    redirect: "error",
    cache: "no-store",
    integratorId: config.integratorId,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(deviceId ? { meliSessionId: deviceId } : {}),
  };
  const client = new MercadoPagoConfig({ accessToken: config.token, options });
  // Official clients for the Checkout Pro payment lifecycle. Unsupported resources
  // use the same bounded HTTPS transport, with an explicit internal path allowlist.
  try {
    if (!fetcher && path === "/checkout/preferences" && verb === "POST")
      return await new Preference(client).create({ body });
    if (
      !fetcher &&
      /^\/checkout\/preferences\/[A-Za-z0-9_-]{1,200}$/.test(path) &&
      verb === "PUT"
    )
      return await new Preference(client).update({
        id: path.split("/").at(-1),
        updatePreferenceRequest: body,
      });
    if (!fetcher && /^\/v1\/payments\/\d+$/.test(path)) {
      const id = path.split("/").at(-1);
      if (verb === "PUT" && body?.status === "cancelled")
        return await new Payment(client).cancel({ id });
      if (verb === "GET") {
        const result = await new Payment(client).get({ id });
        if (String(result.id) !== id)
          throw inputError("Identificador de pagamento incompatível", 502);
        return result;
      }
    }
    if (
      !fetcher &&
      /^\/v1\/payments\/\d+\/refunds$/.test(path) &&
      verb === "POST"
    )
      return await new PaymentRefund(client).create({
        payment_id: path.split("/")[3],
        body: body || {},
      });
    if (!fetcher && /^\/merchant_orders\/\d+$/.test(path) && verb === "GET")
      return await new MerchantOrder(client).get({
        merchantOrderId: path.split("/").at(-1),
      });
    if (!fetcher && path === "/users/me" && verb === "GET")
      return await new User(client).get();
  } catch (error) {
    const status = Number(error.status || error.statusCode);
    throw Object.assign(
      inputError(
        status === 401 || status === 403
          ? "Credenciais ou permissão do Mercado Pago inválidas. A loja deve revisar a configuração."
          : "Mercado Pago indisponível. Tente novamente pelo seu pedido.",
        502,
      ),
      { providerStatus: status || 502 },
    );
  }
  if (
    !/^\/(?:checkout\/preferences$|v1\/payments\/search\?|v1\/payments\/\d+(?:\/refunds)?$|users\/me$|v1\/chargebacks\/\d+$|merchant_orders\/search\?|merchant_orders\/\d+$|item_categories$)/.test(
      path,
    )
  )
    throw inputError("Operação de pagamento não permitida", 400);
  let response;
  try {
    response = await (fetcher || fetch)(`https://api.mercadopago.com${path}`, {
      method: verb,
      redirect: "error",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        ...headers,
        ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw inputError(
      "Mercado Pago indisponível. Tente novamente pelo seu pedido.",
      502,
    );
  }
  if (!response.ok)
    throw inputError(
      "Não foi possível consultar ou criar o pagamento no Mercado Pago",
      502,
    );
  return response.json();
}

export function validWebhook(req, secret) {
  const id = req.query["data.id"];
  const requestId = req.get("x-request-id");
  const signature = req.get("x-signature") || "";
  const parts = Object.fromEntries(
    signature.split(",").map((part) => part.trim().split("=")),
  );
  if (
    !secret ||
    typeof id !== "string" ||
    !/^\d+$/.test(id) ||
    !requestId ||
    !/^\d+$/.test(parts.ts || "") ||
    !/^[a-f0-9]{64}$/i.test(parts.v1 || "")
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`id:${id};request-id:${requestId};ts:${parts.ts};`)
    .digest();
  return timingSafeEqual(expected, Buffer.from(parts.v1, "hex"));
}

export function preferenceBody(order, config, installments, lines = []) {
  const back = `${config.base}/api/mercado-pago/return/${order.id}`;
  const customer = JSON.parse(order.customer_json);
  const delivery = JSON.parse(order.fulfillment_json || "{}");
  const names = String(customer.name || "")
    .trim()
    .split(/\s+/);
  const phone = String(customer.phone || "")
    .replace(/\D/g, "")
    .replace(/^55(?=\d{10,11}$)/, "");
  const payer = {
    email: customer.email,
    ...(names[0] ? { name: names[0] } : {}),
    ...(names.length > 1 ? { surname: names.slice(1).join(" ") } : {}),
    ...(/^\d{10,11}$/.test(phone)
      ? { phone: { area_code: phone.slice(0, 2), number: phone.slice(2) } }
      : {}),
  };
  const items = lines.map((line) => {
    const detail =
      typeof line.details_json === "string"
        ? JSON.parse(line.details_json)
        : line.details || {};
    return {
      id: String(line.product_id),
      title: line.name.slice(0, 256),
      description: String(detail.description || line.name).slice(0, 1000),
      quantity: line.quantity,
      currency_id: "BRL",
      unit_price: line.unit_price_cents / 100,
      type: "physical",
      ...(detail.has_image
        ? {
            picture_url: `${config.base}/api/products/${line.product_id}/image`,
          }
        : {}),
      ...(config.category ? { category_id: config.category } : {}),
    };
  });
  // Legacy stored orders may lack line snapshots in integrations using this helper.
  if (!items.length)
    items.push({
      id: order.number,
      title: `Pedido ${order.number}`,
      quantity: 1,
      currency_id: "BRL",
      unit_price: order.subtotal_cents / 100,
    });
  const itemTotal = Math.round(
    items.reduce((n, i) => n + i.quantity * i.unit_price, 0) * 100,
  );
  if (itemTotal + order.shipping_cents !== order.total_cents)
    throw inputError(
      "Os itens e o frete não correspondem ao total do pedido",
      409,
    );
  const address =
    delivery.type === "delivery"
      ? {
          zip_code: delivery.cep,
          street_name: delivery.street,
          ...(/^\d{1,9}$/.test(delivery.number)
            ? { street_number: Number(delivery.number) }
            : {}),
        }
      : undefined;
  return {
    external_reference: order.number,
    items,
    payer: { ...payer, ...(address ? { address } : {}) },
    shipments: {
      cost: order.shipping_cents / 100,
      mode: "not_specified",
      local_pickup: delivery.type === "pickup",
      ...(address
        ? {
            receiver_address: {
              ...address,
              city_name: delivery.city,
              state_name: delivery.state,
            },
          }
        : {}),
    },
    statement_descriptor: config.descriptor,
    metadata: { order_id: order.id, order_number: order.number },
    back_urls: {
      success: `${back}/success`,
      pending: `${back}/pending`,
      failure: `${back}/failure`,
    },
    auto_return: "approved",
    notification_url: `${config.base}/api/mercado-pago/webhook`,
    expires: true,
    expiration_date_to: order.expires_at,
    payment_methods: {
      installments,
      // Offline payments may settle after the 24-hour inventory reservation.
      excluded_payment_types: [{ id: "ticket" }, { id: "atm" }],
    },
  };
}

export function checkoutUrl(preference, sandbox) {
  const raw = sandbox ? preference.sandbox_init_point : preference.init_point;
  try {
    const url = new URL(raw);
    if (
      url.protocol === "https:" &&
      ["www.mercadopago.com.br", "sandbox.mercadopago.com.br"].includes(
        url.hostname,
      ) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {}
  throw inputError(
    "Endereço de pagamento inválido retornado pelo Mercado Pago",
    502,
  );
}

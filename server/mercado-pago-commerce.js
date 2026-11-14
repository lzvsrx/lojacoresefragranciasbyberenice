import { createHash, timingSafeEqual } from "node:crypto";
import { expirationStatus } from "../src/expiration.js";
import {
  mercadoPagoConfig,
  mercadoPagoRequest,
  preferenceBody,
  checkoutUrl,
  validWebhook,
  mercadoPagoBudget,
} from "./mercado-pago.js";
import { inputError, numberValue, text } from "./validation.js";

const numericId = (value) => {
  const id = String(value ?? "");
  if (!/^\d{1,24}$/.test(id))
    throw inputError("Identificador de pagamento inválido");
  return id;
};
const moneyCents = (value) => {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw inputError("Valor de pagamento inválido");
  return cents;
};
const keyFor = (value) => createHash("sha256").update(value).digest("hex");
const nowIso = () => new Date().toISOString();
const topics = new Set([
  "payment",
  "merchant_order",
  "topic_chargebacks_wh",
  "chargebacks",
  "stop_delivery_op_wh",
]);

export async function installMercadoPago(
  app,
  { db, auth, readOrder, event, expire, release, recordPaidItems },
) {
  app.use(
    ["/api/customer/orders", "/api/online-orders", "/api/mercado-pago"],
    mercadoPagoBudget,
  );
  const columns = new Set(
    (await db.prepare("PRAGMA table_info(mercado_pago_payments)").all()).map(
      (c) => c.name,
    ),
  );
  for (const [name, type] of [
    ["amount_cents", "INTEGER NOT NULL DEFAULT 0"],
    ["refunded_cents", "INTEGER NOT NULL DEFAULT 0"],
    ["review_required", "INTEGER NOT NULL DEFAULT 0"],
    ["status_detail", "TEXT NOT NULL DEFAULT ''"],
    ["provider_updated_at", "INTEGER NOT NULL DEFAULT 0"],
  ])
    if (!columns.has(name))
      await db.exec(
        `ALTER TABLE mercado_pago_payments ADD COLUMN ${name} ${type}`,
      );
  await db.exec(`
    CREATE TABLE IF NOT EXISTS mercado_pago_operations(id TEXT PRIMARY KEY,payload TEXT NOT NULL,result TEXT,lease_until INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mercado_pago_inbox(id TEXT PRIMARY KEY,topic TEXT NOT NULL,resource_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,processed_revision INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,received_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS mercado_pago_inbox_pending ON mercado_pago_inbox(processed_revision,revision,lease_until);
  `);
  const getOrder = async (id, user, admin = false) => {
    const o = await db
      .prepare("SELECT * FROM web_orders WHERE id=?")
      .get(numberValue(id, "Pedido", { integer: true, min: 1 }));
    if (!o || (!admin && o.customer_id !== user.id))
      throw inputError("Pedido não encontrado", 404);
    if (JSON.parse(o.payment_json).provider !== "mercado_pago")
      throw inputError("Pedido não usa Mercado Pago", 409);
    return o;
  };
  const operation = async (id, payload, execute) => {
    const canonical = JSON.stringify(payload);
    const existing = await db.transaction(async () => {
      const row = await db
        .prepare("SELECT * FROM mercado_pago_operations WHERE id=?")
        .get(id);
      if (row && row.payload !== canonical)
        throw inputError("Operação já usada com outros dados", 409);
      if (row?.result) return JSON.parse(row.result);
      if (row?.lease_until > Date.now())
        throw inputError(
          "Pagamento em processamento. Aguarde alguns instantes e consulte o pedido.",
          409,
        );
      await db
        .prepare(
          "INSERT INTO mercado_pago_operations(id,payload,lease_until,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until",
        )
        .run(id, canonical, Date.now() + 45000, nowIso());
      return null;
    })();
    if (existing) return existing;
    try {
      const result = await execute(id);
      await db
        .prepare(
          "UPDATE mercado_pago_operations SET result=?,lease_until=0 WHERE id=?",
        )
        .run(JSON.stringify(result), id);
      return result;
    } catch (error) {
      await db
        .prepare("UPDATE mercado_pago_operations SET lease_until=0 WHERE id=?")
        .run(id);
      throw error;
    }
  };
  const reconcile = async (payment, { flagReview = false } = {}) => {
    const paymentId = numericId(payment.id);
    const o = await db
      .prepare("SELECT * FROM web_orders WHERE number=?")
      .get(String(payment.external_reference || ""));
    if (!o || JSON.parse(o.payment_json).provider !== "mercado_pago")
      return null;
    const checkout = await db
      .prepare("SELECT * FROM mercado_pago_checkouts WHERE order_id=?")
      .get(o.id);
    const config = mercadoPagoConfig();
    const amount = moneyCents(payment.transaction_amount),
      refunded = moneyCents(payment.transaction_amount_refunded || 0);
    if (
      !checkout ||
      String(payment.collector_id) !== checkout.collector_id ||
      payment.currency_id !== "BRL" ||
      amount < 1 ||
      amount > o.total_cents ||
      refunded > amount ||
      payment.live_mode !== !config.sandbox
    )
      throw inputError("Pagamento não corresponde à cobrança", 400);
    if (amount !== o.total_cents) {
      const merchant = await mercadoPagoRequest(
        `/merchant_orders/${numericId(payment.order?.id)}`,
      );
      if (
        String(merchant.preference_id) !== checkout.preference_id ||
        merchant.external_reference !== o.number ||
        String(merchant.collector?.id) !== checkout.collector_id
      )
        throw inputError("Pagamento dividido não pertence ao pedido", 400);
    }
    return db.transaction(async () => {
      await expire();
      const current = await db
        .prepare("SELECT * FROM web_orders WHERE id=?")
        .get(o.id);
      const previous = await db
        .prepare("SELECT * FROM mercado_pago_payments WHERE payment_id=?")
        .get(paymentId);
      const updated = Number.isFinite(Date.parse(payment.date_last_updated))
        ? Date.parse(payment.date_last_updated)
        : Date.now();
      if (previous && previous.provider_updated_at > updated) return current.id;
      const chargedBack = payment.status === "charged_back";
      const fullRefund = payment.status === "refunded";
      const refundedValue = fullRefund ? amount : refunded;
      const fraudPending = await db
        .prepare(
          "SELECT 1 FROM mercado_pago_inbox WHERE topic='stop_delivery_op_wh' AND resource_id=? AND processed_revision<revision LIMIT 1",
        )
        .get(paymentId);
      const review =
        flagReview ||
        chargedBack ||
        Boolean(previous?.review_required) ||
        Boolean(fraudPending);
      const unchanged =
        previous?.status === payment.status &&
        previous?.refunded_cents === refundedValue &&
        previous?.amount_cents === amount &&
        previous?.review_required === Number(review);
      await db
        .prepare(
          "INSERT INTO mercado_pago_payments(payment_id,order_id,status,updated_at,amount_cents,refunded_cents,review_required,status_detail,provider_updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(payment_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,amount_cents=excluded.amount_cents,refunded_cents=excluded.refunded_cents,review_required=excluded.review_required,status_detail=excluded.status_detail,provider_updated_at=excluded.provider_updated_at",
        )
        .run(
          paymentId,
          o.id,
          String(payment.status),
          nowIso(),
          amount,
          refundedValue,
          Number(review),
          text(payment.status_detail, 100),
          updated,
        );
      const rows = await db
        .prepare("SELECT * FROM mercado_pago_payments WHERE order_id=?")
        .all(o.id);
      const captured = rows.filter((p) =>
        ["approved", "refunded", "charged_back"].includes(p.status),
      );
      const gross = captured.reduce((n, p) => n + p.amount_cents, 0);
      const net = captured.reduce(
        (n, p) =>
          n +
          (p.status === "charged_back" ? 0 : p.amount_cents - p.refunded_cents),
        0,
      );
      const problem = rows.some((p) => p.review_required);
      if (
        unchanged &&
        !(
          current.status === "Aguardando pagamento" &&
          net === o.total_cents &&
          !problem
        )
      )
        return current.id;
      if (
        current.status === "Aguardando pagamento" &&
        net === o.total_cents &&
        !problem
      ) {
        const goods = await db
          .prepare(
            "SELECT p.expiration_date FROM web_order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=?",
          )
          .all(o.id);
        if (
          goods.some(
            (p) => expirationStatus(p.expiration_date)?.status === "expired",
          )
        ) {
          await release(current, null, "Cancelado");
          await db
            .prepare(
              "UPDATE mercado_pago_payments SET review_required=1 WHERE order_id=?",
            )
            .run(o.id);
          await event(
            o.id,
            "Cancelado",
            "Pagamento recebido para produto que venceu durante a reserva. A administração deve providenciar o reembolso.",
            null,
          );
          return o.id;
        }
        await recordPaidItems(
          current,
          captured
            .map((p) => p.payment_id)
            .join(",")
            .slice(0, 100),
          null,
          numberValue(payment.installments || 1, "Parcelas", {
            integer: true,
            min: 1,
            max: 36,
          }),
        );
        await db
          .prepare(
            "UPDATE web_orders SET status='Pago',payment_reference=?,updated_at=? WHERE id=?",
          )
          .run(captured[0].payment_id, nowIso(), o.id);
        await event(
          o.id,
          "Pago",
          "Pagamento confirmado automaticamente pelo Mercado Pago.",
          null,
        );
      } else if (
        payment.status === "approved" &&
        (net > o.total_cents ||
          ["Cancelado", "Expirado"].includes(current.status))
      ) {
        await db
          .prepare(
            "UPDATE mercado_pago_payments SET review_required=1 WHERE payment_id=?",
          )
          .run(paymentId);
        await event(
          o.id,
          current.status,
          "Pagamento recebido fora da reserva ou em duplicidade. A equipe deve conferir e providenciar o reembolso no Mercado Pago.",
          null,
        );
      } else if (
        gross &&
        net === 0 &&
        captured.every((p) => p.status === "refunded")
      ) {
        await db
          .prepare(
            "UPDATE sales SET order_status='Cancelado' WHERE id IN (SELECT sale_id FROM web_order_items WHERE order_id=?)",
          )
          .run(o.id);
        if (current.status === "Aguardando pagamento")
          await release(current, null, "Cancelado");
        else if (
          !["Cancelado", "Expirado", "Reembolsado"].includes(current.status)
        )
          await db
            .prepare(
              "UPDATE web_orders SET status='Reembolsado',updated_at=? WHERE id=?",
            )
            .run(nowIso(), o.id);
        await event(
          o.id,
          current.status === "Aguardando pagamento"
            ? "Cancelado"
            : ["Cancelado", "Expirado"].includes(current.status)
              ? current.status
              : "Reembolsado",
          "Reembolso integral confirmado no Mercado Pago. Produtos devolvidos exigem inspeção antes de repor estoque.",
          null,
        );
      } else {
        if (
          net <= o.total_cents &&
          captured.length &&
          ![
            "Aguardando pagamento",
            "Cancelado",
            "Expirado",
            "Reembolsado",
          ].includes(current.status)
        ) {
          // Keep financial reports consistent without changing accepted order snapshots.
          const lines = await db
            .prepare(
              "SELECT * FROM web_order_items WHERE order_id=? AND sale_id IS NOT NULL ORDER BY id",
            )
            .all(o.id);
          let remaining = Math.round((o.subtotal_cents * net) / o.total_cents);
          for (const [i, line] of lines.entries()) {
            const value =
              i === lines.length - 1
                ? remaining
                : Math.min(
                    remaining,
                    Math.round((line.total_cents * net) / o.total_cents),
                  );
            remaining -= value;
            await db
              .prepare(
                "UPDATE sales SET total_value=?,order_status=CASE WHEN ?=0 THEN 'Cancelado' ELSE 'Pago' END WHERE id=?",
              )
              .run(value / 100, net, line.sale_id);
          }
        }
        const message = problem
          ? "Alerta do Mercado Pago: entrega bloqueada para análise da equipe."
          : refundedValue
            ? "Reembolso parcial confirmado pelo Mercado Pago; valores financeiros atualizados proporcionalmente."
            : {
                pending: "Pagamento pendente no Mercado Pago.",
                in_process: "Pagamento em análise no Mercado Pago.",
                rejected:
                  "Pagamento recusado. O cliente pode escolher outra opção no Mercado Pago.",
                cancelled: "Pagamento cancelado no Mercado Pago.",
                approved:
                  "Parte do pagamento recebida; aguardando o valor restante.",
              }[payment.status] ||
              "Situação do pagamento atualizada pelo Mercado Pago.";
        await event(o.id, current.status, message, null);
      }
      return o.id;
    })();
  };
  const syncOrder = async (o) => {
    const query = new URLSearchParams({
      external_reference: o.number,
      sort: "date_created",
      criteria: "desc",
      limit: "50",
    });
    const result = await mercadoPagoRequest(`/v1/payments/search?${query}`);
    if (!Array.isArray(result.results))
      throw inputError("Consulta de pagamentos incompleta", 502);
    const tracked = await db
      .prepare(
        "SELECT payment_id FROM mercado_pago_payments WHERE order_id=? AND status NOT IN ('rejected','cancelled') ORDER BY updated_at DESC LIMIT 100",
      )
      .all(o.id);
    const ids = new Set([
      ...result.results
        .filter((p) => p.external_reference === o.number)
        .map((p) => numericId(p.id)),
      ...tracked.map((p) => numericId(p.payment_id)),
    ]);
    for (const id of ids) {
      await reconcile(await mercadoPagoRequest(`/v1/payments/${id}`));
    }
  };
  const processResource = async (topic, id) => {
    if (topic === "stop_delivery_op_wh") {
      const payment = await mercadoPagoRequest(`/v1/payments/${numericId(id)}`);
      const orderId = await reconcile(payment, { flagReview: true });
      if (!orderId || !mercadoPagoConfig().autoRefundFraud) return;
      const o = await db
        .prepare("SELECT * FROM web_orders WHERE id=?")
        .get(orderId);
      await syncOrder(o);
      for (const row of await db
        .prepare(
          "SELECT * FROM mercado_pago_payments WHERE order_id=? AND status='approved' AND amount_cents>refunded_cents",
        )
        .all(orderId)) {
        const key = keyFor(`full:${o.number}:${row.payment_id}`);
        await operation(
          key,
          { order: o.id, payment: row.payment_id, amount: null },
          async () => {
            const result = await mercadoPagoRequest(
              `/v1/payments/${row.payment_id}/refunds`,
              { body: {}, idempotencyKey: key },
            );
            if (
              !result.id ||
              (result.status &&
                !["approved", "pending", "in_process"].includes(result.status))
            )
              throw inputError(
                "Reembolso antifraude não confirmado pelo provedor",
                502,
              );
            await event(
              o.id,
              o.status,
              "Alerta de fraude autenticado: devolução integral solicitada automaticamente ao Mercado Pago. Não entregue o pedido.",
              null,
            );
            return { id: String(result.id), status: result.status };
          },
        );
        await reconcile(
          await mercadoPagoRequest(`/v1/payments/${row.payment_id}`),
          { flagReview: true },
        );
      }
      return;
    }
    if (topic === "payment")
      return reconcile(
        await mercadoPagoRequest(`/v1/payments/${numericId(id)}`),
      );
    if (topic === "merchant_order") {
      const merchant = await mercadoPagoRequest(
        `/merchant_orders/${numericId(id)}`,
      );
      for (const p of (merchant.payments || []).slice(0, 10))
        await reconcile(
          await mercadoPagoRequest(`/v1/payments/${numericId(p.id)}`),
        );
      return;
    }
    const account = await mercadoPagoRequest("/users/me");
    const dispute = await mercadoPagoRequest(
      `/v1/chargebacks/${numericId(id)}`,
      { headers: { "X-Caller-Id": numericId(account.id) } },
    );
    for (const p of (dispute.payments || []).slice(0, 10))
      await reconcile(
        await mercadoPagoRequest(
          `/v1/payments/${numericId(typeof p === "object" ? p.id : p)}`,
        ),
        { flagReview: true },
      );
  };
  const processInbox = async (id) => {
    const row = await db.transaction(async () => {
      const item = await db
        .prepare("SELECT * FROM mercado_pago_inbox WHERE id=?")
        .get(id);
      if (!item || item.processed_revision >= item.revision) return null;
      if (item.lease_until > Date.now()) return { busy: true };
      await db
        .prepare(
          "UPDATE mercado_pago_inbox SET lease_until=?,attempts=attempts+1 WHERE id=?",
        )
        .run(Date.now() + 60000, id);
      return item;
    })();
    if (!row) return 200;
    if (row.busy) return 503;
    try {
      await processResource(row.topic, row.resource_id);
      await db
        .prepare(
          "UPDATE mercado_pago_inbox SET processed_revision=MAX(processed_revision,?),lease_until=0,last_error=NULL WHERE id=?",
        )
        .run(row.revision, id);
      return 200;
    } catch (error) {
      await db
        .prepare(
          "UPDATE mercado_pago_inbox SET lease_until=0,last_error=? WHERE id=?",
        )
        .run(
          error.status === 400 ? "PAYMENT_MISMATCH" : "PROVIDER_UNAVAILABLE",
          id,
        );
      console.error(
        JSON.stringify({
          event: "mercado_pago.notification_pending",
          resource: row.resource_id,
          code: error.status || 500,
        }),
      );
      return error.status === 400 ? 400 : 503;
    }
  };
  app.get("/api/shop/mercado-pago", async (_req, res) => {
    const c = mercadoPagoConfig();
    const active = await db
      .prepare("SELECT active FROM payment_methods WHERE code='MP'")
      .get();
    res.json({
      enabled: Boolean(c.configured && active?.active),
      public_key: c.configured && active?.active ? c.publicKey : null,
      sandbox: c.sandbox,
    });
  });
  app.get("/api/mercado-pago/status", auth(["admin"]), async (_req, res) => {
    const c = mercadoPagoConfig();
    const pending = await db
      .prepare(
        "SELECT count(*) n FROM mercado_pago_inbox WHERE processed_revision<revision",
      )
      .get();
    res.json({
      configured: c.configured,
      sandbox: c.sandbox,
      auto_refund_fraud: c.autoRefundFraud,
      webhook_url: c.base ? `${c.base}/api/mercado-pago/webhook` : null,
      missing: [
        ["MERCADO_PAGO_ACCESS_TOKEN", c.token],
        ["MERCADO_PAGO_PUBLIC_KEY", c.publicKey],
        ["MERCADO_PAGO_WEBHOOK_SECRET", c.secret],
        ["PUBLIC_BASE_URL", c.base],
      ]
        .filter(([, v]) => !v)
        .map(([k]) => k),
      pending_notifications: pending.n,
    });
  });
  app.post("/api/mercado-pago/verify", auth(["admin"]), async (_req, res) => {
    const account = await mercadoPagoRequest("/users/me");
    if (account.site_id !== "MLB")
      throw inputError("Use uma conta Mercado Pago do Brasil", 400);
    res.json({
      connected: true,
      account_id: String(account.id),
      sandbox: mercadoPagoConfig().sandbox,
    });
  });
  app.get("/api/mercado-pago/return/:id/:result", (req, res) => {
    const c = mercadoPagoConfig();
    const id = numericId(req.params.id);
    if (
      !c.base ||
      !["success", "pending", "failure"].includes(req.params.result)
    )
      throw inputError("Retorno de pagamento inválido");
    res.redirect(
      303,
      `${c.base}/#/pedidos/${id}?mp_result=${req.params.result}`,
    );
  });
  app.post(
    "/api/customer/orders/:id/payment",
    auth(["cliente"]),
    async (req, res) => {
      await db.transaction(expire)();
      const o = await getOrder(req.params.id, req.user);
      const config = mercadoPagoConfig();
      if (!config.configured)
        throw inputError("Mercado Pago indisponível", 503);
      if (o.status !== "Aguardando pagamento")
        throw inputError("Este pedido não está disponível para pagamento", 409);
      const device = req.body?.device_id;
      if (
        device !== undefined &&
        (typeof device !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(device))
      )
        throw inputError("Identificador de dispositivo inválido");
      const previous = await db
        .prepare("SELECT * FROM mercado_pago_checkouts WHERE order_id=?")
        .get(o.id);
      const result =
        previous ||
        (await operation(
          keyFor(`preference:${o.number}`),
          { order: o.id },
          async (key) => {
            const current = await db
              .prepare("SELECT status,expires_at FROM web_orders WHERE id=?")
              .get(o.id);
            if (
              current.status !== "Aguardando pagamento" ||
              Date.parse(current.expires_at) <= Date.now()
            )
              throw inputError("Pedido indisponível para pagamento", 409);
            const lines = await db
              .prepare(
                "SELECT * FROM web_order_items WHERE order_id=? ORDER BY id",
              )
              .all(o.id);
            const preference = await mercadoPagoRequest(
              "/checkout/preferences",
              {
                config,
                body: preferenceBody(
                  o,
                  config,
                  JSON.parse(o.payment_json).max_installments || 1,
                  lines,
                ),
                idempotencyKey: key,
                deviceId: device,
              },
            );
            const url = checkoutUrl(preference, config.sandbox);
            if (!preference.id || !preference.collector_id)
              throw inputError("Resposta de pagamento incompleta", 502);
            await db
              .prepare(
                "INSERT INTO mercado_pago_checkouts(order_id,preference_id,checkout_url,collector_id) VALUES(?,?,?,?) ON CONFLICT(order_id) DO NOTHING",
              )
              .run(
                o.id,
                String(preference.id),
                url,
                String(preference.collector_id),
              );
            return { preference_id: String(preference.id), checkout_url: url };
          },
        ));
      res.json({
        checkout_url: result.checkout_url,
        preference_id: result.preference_id,
        public_key: config.publicKey,
      });
    },
  );
  for (const [path, admin] of [
    ["/api/customer/orders/:id/payment-status", false],
    ["/api/online-orders/:id/payment-status", true],
  ])
    app.post(
      path,
      auth(admin ? ["admin", "funcionario"] : ["cliente"]),
      async (req, res) => {
        const o = await getOrder(req.params.id, req.user, admin);
        await syncOrder(o);
        res.json(await readOrder(o.id));
      },
    );
  app.post("/api/mercado-pago/webhook", async (req, res) => {
    const config = mercadoPagoConfig();
    if (!config.configured) throw inputError("Integração indisponível", 503);
    if (!validWebhook(req, config.secret))
      throw inputError("Assinatura inválida", 401);
    const normalizeTopic = (topic) =>
      ({ payments: "payment", merchant_orders: "merchant_order" })[topic] ||
      topic;
    const topic = normalizeTopic(req.query.type || req.body?.type);
    if (
      req.query.type &&
      req.body?.type &&
      normalizeTopic(req.query.type) !== normalizeTopic(req.body.type)
    )
      throw inputError("Tópico inconsistente");
    if (!topics.has(topic)) return res.sendStatus(200);
    if (
      topic === "stop_delivery_op_wh" &&
      req.body?.data?.payment_id !== undefined &&
      String(req.body.data.payment_id) !== req.query["data.id"]
    )
      throw inputError(
        "Identificador do alerta não corresponde à assinatura",
        400,
      );
    const id = `${topic}:${numericId(req.query["data.id"])}`;
    await db.transaction(async () => {
      await db
        .prepare(
          "INSERT INTO mercado_pago_inbox(id,topic,resource_id,received_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=revision+1,received_at=excluded.received_at",
        )
        .run(id, topic, req.query["data.id"], nowIso());
      if (topic === "stop_delivery_op_wh")
        await db
          .prepare(
            "UPDATE mercado_pago_payments SET review_required=1 WHERE payment_id=?",
          )
          .run(req.query["data.id"]);
    })();
    // Work is bounded to 20s, below the provider's 22s acknowledgement window.
    // Returning 503 after durable receipt keeps Mercado Pago's own retries active.
    const result = await processInbox(id);
    res.sendStatus(topic === "stop_delivery_op_wh" ? 200 : result);
  });
  const jobs = async () => {
    const rows = await db
      .prepare(
        "SELECT id FROM mercado_pago_inbox WHERE processed_revision<revision AND lease_until<=? ORDER BY received_at LIMIT 5",
      )
      .all(Date.now());
    for (const row of rows) await processInbox(row.id);
    return rows.length;
  };
  app.post(
    "/api/mercado-pago/retry-notifications",
    auth(["admin"]),
    async (_req, res) => res.json({ processed: await jobs() }),
  );
  app.get("/api/mercado-pago/jobs", async (req, res) => {
    const secret = process.env.CRON_SECRET,
      authHeader = req.get("authorization") || "";
    const expected = secret ? `Bearer ${secret}` : "";
    if (
      !secret ||
      Buffer.byteLength(authHeader) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
    )
      throw inputError("Acesso não autorizado", 401);
    res.json({ processed: await jobs() });
  });
  app.post(
    "/api/online-orders/:id/refund",
    auth(["admin"]),
    async (req, res) => {
      const o = await getOrder(req.params.id, req.user, true);
      if (req.body?.confirmed !== true)
        throw inputError("Confirme a devolução de dinheiro ao cliente");
      await syncOrder(o);
      const rows = await db
        .prepare(
          "SELECT * FROM mercado_pago_payments WHERE order_id=? AND status IN ('approved','refunded')",
        )
        .all(o.id);
      const partial = req.body.amount_cents !== undefined;
      if (partial && !/^[a-zA-Z0-9-]{20,80}$/.test(req.body.request_id || ""))
        throw inputError(
          "Informe um identificador único para o reembolso parcial",
        );
      const requested = partial
        ? numberValue(req.body.amount_cents, "Valor", {
            integer: true,
            min: 1,
            max: o.total_cents,
          })
        : null;
      let selected = req.body.payment_id
        ? rows.filter((p) => p.payment_id === String(req.body.payment_id))
        : rows;
      if (!partial)
        selected = selected.filter((p) => p.refunded_cents < p.amount_cents);
      if (partial && selected.length !== 1)
        throw inputError("Selecione um pagamento para o reembolso parcial");
      if (
        !selected.length &&
        rows.length &&
        rows.every((p) => p.refunded_cents === p.amount_cents)
      )
        return res.json(await readOrder(o.id));
      if (!selected.length)
        throw inputError(
          "Nenhum valor disponível para reembolso. Consulte o pagamento.",
          409,
        );
      const outstanding = rows.filter((p) => p.refunded_cents < p.amount_cents);
      const fullOrderRefund = !partial
        ? outstanding.every((p) =>
            selected.some((s) => s.payment_id === p.payment_id),
          )
        : outstanding.length === 1 &&
          requested ===
            outstanding[0].amount_cents - outstanding[0].refunded_cents;
      for (const row of selected) {
        const remaining = row.amount_cents - row.refunded_cents;
        const key = keyFor(
          `${partial ? req.body.request_id : "full"}:${o.number}:${row.payment_id}`,
        );
        await operation(
          key,
          { order: o.id, payment: row.payment_id, amount: requested },
          async () => {
            if ((requested && requested > remaining) || remaining < 1)
              throw inputError(
                "Valor maior que o saldo disponível para reembolso",
              );
            const result = await mercadoPagoRequest(
              `/v1/payments/${row.payment_id}/refunds`,
              {
                body: partial ? { amount: requested / 100 } : {},
                idempotencyKey: key,
              },
            );
            if (
              !result.id ||
              (result.status &&
                !["approved", "pending", "in_process"].includes(result.status))
            )
              throw inputError(
                "Reembolso não confirmado pelo Mercado Pago",
                502,
              );
            return { id: String(result.id), status: result.status };
          },
        );
        if (fullOrderRefund)
          await db.transaction(async () => {
            const current = await db
              .prepare("SELECT status FROM web_orders WHERE id=?")
              .get(o.id);
            if (
              ![
                "Aguardando pagamento",
                "Cancelado",
                "Expirado",
                "Reembolsado",
                "Reembolso solicitado",
              ].includes(current.status)
            ) {
              await db
                .prepare(
                  "UPDATE web_orders SET status='Reembolso solicitado',updated_at=? WHERE id=?",
                )
                .run(nowIso(), o.id);
              await event(
                o.id,
                "Reembolso solicitado",
                "Devolução integral solicitada ao Mercado Pago. Aguarde a confirmação do provedor antes de concluir o atendimento.",
                req.user.id,
              );
            }
          })();
        await reconcile(
          await mercadoPagoRequest(`/v1/payments/${row.payment_id}`),
        );
      }
      res.json(await readOrder(o.id));
    },
  );
  const cancelOrder = async (o, user) => {
    if (o.status === "Cancelado") return readOrder(o.id);
    if (o.status !== "Aguardando pagamento")
      throw inputError("Use o reembolso para um pedido já pago", 409);
    const checkout = await db
      .prepare("SELECT * FROM mercado_pago_checkouts WHERE order_id=?")
      .get(o.id);
    if (checkout) {
      await operation(
        keyFor(`cancel-preference:${o.number}`),
        { order: o.id },
        async (key) => {
          const expired = await mercadoPagoRequest(
            `/checkout/preferences/${checkout.preference_id}`,
            {
              method: "PUT",
              body: { expires: true, expiration_date_to: nowIso() },
              idempotencyKey: key,
            },
          );
          if (!expired.id)
            throw inputError("Não foi possível encerrar a cobrança", 502);
          return { id: String(expired.id) };
        },
      );
      await syncOrder(o);
      const current = await db
        .prepare("SELECT * FROM web_orders WHERE id=?")
        .get(o.id);
      if (current.status !== "Aguardando pagamento")
        throw inputError(
          "O pagamento foi recebido. Solicite o reembolso.",
          409,
        );
      const payments = await db
        .prepare("SELECT * FROM mercado_pago_payments WHERE order_id=?")
        .all(o.id);
      for (const p of payments.filter((p) =>
        ["pending", "in_process", "authorized"].includes(p.status),
      )) {
        const cancelled = await mercadoPagoRequest(
          `/v1/payments/${p.payment_id}`,
          {
            method: "PUT",
            body: { status: "cancelled" },
            idempotencyKey: keyFor(`cancel:${o.number}:${p.payment_id}`),
          },
        );
        await reconcile(cancelled);
        if (cancelled.status !== "cancelled")
          throw inputError(
            "O pagamento não pôde ser cancelado. Consulte a loja.",
            409,
          );
      }
      if (
        payments.some(
          (p) => p.status === "approved" && p.refunded_cents < p.amount_cents,
        )
      )
        throw inputError(
          "Há valor recebido. Reembolse antes de cancelar.",
          409,
        );
    }
    await db.transaction(async () => {
      const current = await db
        .prepare("SELECT * FROM web_orders WHERE id=?")
        .get(o.id);
      if (current.status === "Cancelado") return;
      if (current.status !== "Aguardando pagamento")
        throw inputError("Pedido atualizado durante o cancelamento", 409);
      const preparing = await db
        .prepare(
          "SELECT lease_until,result FROM mercado_pago_operations WHERE id=?",
        )
        .get(keyFor(`preference:${o.number}`));
      if (preparing?.lease_until > Date.now() && !preparing.result)
        throw inputError(
          "A cobrança está sendo preparada. Aguarde e tente cancelar novamente.",
          409,
        );
      if (
        await db
          .prepare(
            "SELECT 1 FROM mercado_pago_payments WHERE order_id=? AND status='approved' AND amount_cents>refunded_cents LIMIT 1",
          )
          .get(o.id)
      )
        throw inputError(
          "Há valor recebido. Consulte a loja para reembolso.",
          409,
        );
      await release(current, user.id, "Cancelado");
    })();
    return readOrder(o.id);
  };
  app.post(
    "/api/online-orders/:id/payment-review",
    auth(["admin"]),
    async (req, res) => {
      const o = await getOrder(req.params.id, req.user, true);
      if (
        req.body?.confirmed !== true ||
        text(req.body?.note, 1000).length < 10
      )
        throw inputError(
          "Confirme a análise no Mercado Pago e descreva o resultado",
        );
      await syncOrder(o);
      await db.transaction(async () => {
        if (
          await db
            .prepare(
              "SELECT 1 FROM mercado_pago_inbox n JOIN mercado_pago_payments p ON p.payment_id=n.resource_id WHERE n.topic='stop_delivery_op_wh' AND p.order_id=? LIMIT 1",
            )
            .get(o.id)
        )
          throw inputError(
            "Este pedido recebeu alerta de fraude. Providencie o reembolso e não entregue os produtos.",
            409,
          );
        const payments = await db
          .prepare("SELECT * FROM mercado_pago_payments WHERE order_id=?")
          .all(o.id);
        const net = payments
          .filter((p) => ["approved", "refunded"].includes(p.status))
          .reduce((n, p) => n + p.amount_cents - p.refunded_cents, 0);
        if (
          net < 1 ||
          net > o.total_cents ||
          payments.some((p) => p.status === "charged_back")
        )
          throw inputError(
            "Resolva as diferenças financeiras antes de liberar a entrega",
            409,
          );
        await db
          .prepare(
            "UPDATE mercado_pago_payments SET review_required=0 WHERE order_id=?",
          )
          .run(o.id);
        await event(
          o.id,
          o.status,
          `Análise confirmada pela administração: ${text(req.body.note, 1000)}`,
          req.user.id,
        );
      })();
      await syncOrder(o);
      res.json(await readOrder(o.id));
    },
  );
  return { reconcile, syncOrder, cancelOrder };
}

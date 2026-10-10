import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { inputError, numberValue, text } from "./validation.js";
import { expirationStatus } from "../src/expiration.js";

export const POLICY_VERSION = "2026-10-10";
export const commerceDefaults = {
  trade_name: "Cores & Fragrâncias by Berenice",
  legal_name: "",
  document: "",
  address: "Praça Pres. João Pessoa, 66 - Centro, Varginha - MG, 37014-200",
  email: "",
  phone: "553598213049",
  hours: "",
  pickup_days: 2,
  delivery_enabled: false,
  delivery_fee_cents: 0,
  delivery_days: 5,
  delivery_region: "",
  cep_start: "",
  cep_end: "",
  checkout_enabled: false,
};
const fields = [
  "description",
  "composition",
  "precautions",
  "volume",
  "manufacturer",
  "anvisa_reference",
];
const positiveId = (value) =>
  numberValue(value, "Identificador", { integer: true, min: 1 });
const cents = (value) =>
  Math.round(numberValue(value, "Preço", { max: 1e7 }) * 100);
const iso = () => new Date().toISOString();
const publicPayment = (method) => ({
  id: method.id,
  name: method.name,
  instructions:
    {
      "01": "Pagamento em dinheiro, conforme orientação da loja. Combine a necessidade de troco no atendimento.",
      "03": "A loja orientará o pagamento por canal seguro ou maquininha. Não informe número do cartão ou CVV neste site.",
      "04": "Pagamento por canal seguro ou maquininha indicado pela loja. Não envie dados do cartão pelo atendimento.",
      15: "Solicite o boleto emitido pela loja e confira o beneficiário antes de pagar. Aguarde a confirmação do recebimento.",
      17: "Solicite a cobrança Pix no canal oficial da loja e confira o beneficiário. O pagamento será conferido pela equipe.",
      18: "Solicite os dados oficiais da loja para transferência e confira o beneficiário antes de pagar.",
      99: "Combine o pagamento diretamente no atendimento oficial da loja.",
      20: "Solicite a chave Pix oficial da loja e confira o beneficiário. A equipe confirmará o recebimento.",
    }[method.code] ||
    "Solicite as orientações de pagamento no canal oficial da loja. Não envie dados de cartão ou senhas.",
});
export const documentValid = (value) => {
  const digits = String(value)
    .toUpperCase()
    .replace(/[.\/\-\s]/g, "");
  if (
    !/^(?:\d{11}|[A-Z0-9]{12}\d{2})$/.test(digits) ||
    /^(\d)\1+$/.test(digits)
  )
    return false;
  const calculate = (base) => {
    let sum = 0,
      weight = base.length - 7;
    if (digits.length === 11) {
      for (let i = 0; i < base.length; i++)
        sum += Number(base[i]) * (base.length + 1 - i);
      return ((sum * 10) % 11) % 10;
    }
    for (let i = 0; i < base.length; i++) {
      sum += (base.charCodeAt(i) - 48) * weight--;
      if (weight < 2) weight = 9;
    }
    return sum % 11 < 2 ? 0 : 11 - (sum % 11);
  };
  return (
    calculate(digits.slice(0, -2)) === Number(digits.at(-2)) &&
    calculate(digits.slice(0, -1)) === Number(digits.at(-1))
  );
};
export async function installCommerce(app, { db, auth, safeUser }) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS commerce_settings(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS product_details(product_id INTEGER PRIMARY KEY REFERENCES products(id),description TEXT,composition TEXT,precautions TEXT,volume TEXT,manufacturer TEXT,anvisa_reference TEXT);
    CREATE TABLE IF NOT EXISTS web_orders(
      id INTEGER PRIMARY KEY AUTOINCREMENT,number TEXT NOT NULL UNIQUE,customer_id INTEGER NOT NULL REFERENCES users(id),
      idempotency_key TEXT NOT NULL UNIQUE,request_json TEXT NOT NULL,status TEXT NOT NULL,
      customer_json TEXT NOT NULL,seller_json TEXT NOT NULL,fulfillment_json TEXT NOT NULL,payment_json TEXT NOT NULL,
      subtotal_cents INTEGER NOT NULL,shipping_cents INTEGER NOT NULL,total_cents INTEGER NOT NULL,
      policy_version TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      tracking TEXT NOT NULL DEFAULT '',fiscal_key TEXT NOT NULL DEFAULT '',payment_reference TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS web_order_items(
      id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL REFERENCES web_orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id),name TEXT NOT NULL,quantity INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL,total_cents INTEGER NOT NULL,details_json TEXT NOT NULL,
      sale_id INTEGER REFERENCES sales(id),movement_id INTEGER REFERENCES stock_movements(id)
    );
    CREATE TABLE IF NOT EXISTS web_order_events(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL REFERENCES web_orders(id),status TEXT NOT NULL,note TEXT NOT NULL,user_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS service_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,protocol TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES users(id),order_id INTEGER REFERENCES web_orders(id),kind TEXT NOT NULL,
      message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Aberto',response TEXT NOT NULL DEFAULT '',response_history TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,due_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS web_orders_customer ON web_orders(customer_id,id);
    CREATE INDEX IF NOT EXISTS web_order_items_order ON web_order_items(order_id);
    CREATE INDEX IF NOT EXISTS service_requests_customer ON service_requests(customer_id,id);
  `);
  if (
    !(await db.prepare("PRAGMA table_info(service_requests)").all()).some(
      (c) => c.name === "response_history",
    )
  )
    await db.exec(
      "ALTER TABLE service_requests ADD COLUMN response_history TEXT NOT NULL DEFAULT '[]'",
    );
  const settings = async () => ({
    ...commerceDefaults,
    ...JSON.parse(
      (await db.prepare("SELECT data FROM commerce_settings WHERE id=1").get())
        ?.data || "{}",
    ),
  });
  const readiness = (s) =>
    [
      !s.legal_name && "Razão social",
      !documentValid(s.document) && "CPF/CNPJ válido",
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email) && "E-mail de atendimento",
      !s.address && "Endereço",
      !s.hours && "Horário de atendimento",
    ].filter(Boolean);
  const publicSettings = async () => {
    const s = await settings();
    return {
      ...s,
      policy_version: POLICY_VERSION,
      ready: !readiness(s).length,
      missing: readiness(s),
    };
  };
  app.get("/api/shop", async (_req, res) => res.json(await publicSettings()));
  app.put("/api/shop", auth(["admin"]), async (req, res) => {
    const b = req.body || {},
      s = { ...commerceDefaults };
    for (const key of [
      "trade_name",
      "legal_name",
      "document",
      "address",
      "email",
      "phone",
      "hours",
      "delivery_region",
      "cep_start",
      "cep_end",
    ])
      s[key] = text(b[key], key === "address" ? 400 : 200);
    if (!s.trade_name) throw inputError("Informe o nome da loja");
    if (s.document && !documentValid(s.document))
      throw inputError("CPF/CNPJ do fornecedor inválido");
    if (s.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email))
      throw inputError("E-mail inválido");
    if (!/^55\d{10,11}$/.test(s.phone))
      throw inputError("WhatsApp: informe 55, DDD e telefone, somente números");
    s.checkout_enabled = b.checkout_enabled === true;
    s.delivery_enabled = b.delivery_enabled === true;
    for (const key of ["pickup_days", "delivery_days"])
      s[key] = numberValue(b[key], "Prazo", { integer: true, min: 1, max: 90 });
    s.delivery_fee_cents = numberValue(
      b.delivery_fee_cents,
      "Frete em centavos",
      { integer: true, max: 1000000 },
    );
    if (
      s.delivery_enabled &&
      (!s.delivery_region ||
        !/^\d{8}$/.test(s.cep_start) ||
        !/^\d{8}$/.test(s.cep_end) ||
        s.cep_start > s.cep_end)
    )
      throw inputError(
        "Informe a região e o intervalo de CEPs atendidos (8 dígitos)",
      );
    if (s.checkout_enabled && readiness(s).length)
      throw inputError(`Complete: ${readiness(s).join(", ")}`);
    if (s.checkout_enabled) {
      const demo = await db
        .prepare("SELECT password FROM users WHERE username='admin'")
        .get();
      if (demo && (await bcrypt.compare("admin123", demo.password)))
        throw inputError(
          "Troque a senha de exemplo do administrador antes de habilitar vendas",
        );
    }
    await db
      .prepare(
        "INSERT INTO commerce_settings(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(JSON.stringify(s));
    res.json(await publicSettings());
  });
  app.get("/api/catalog/:id/details", async (req, res) => {
    const p = await db
      .prepare(
        "SELECT id,name,brand,type,style,price,quantity,expiration_date FROM products WHERE id=?",
      )
      .get(positiveId(req.params.id));
    if (!p || expirationStatus(p.expiration_date)?.status === "expired")
      throw inputError("Produto indisponível", 404);
    res.json({
      ...p,
      ...(await db
        .prepare("SELECT * FROM product_details WHERE product_id=?")
        .get(p.id)),
    });
  });
  app.put(
    "/api/product-details/:id",
    auth(["admin", "funcionario"]),
    async (req, res) => {
      const id = positiveId(req.params.id);
      if (!(await db.prepare("SELECT 1 FROM products WHERE id=?").get(id)))
        throw inputError("Produto não encontrado", 404);
      const data = fields.map((key) => text(req.body?.[key], 4000));
      await db
        .prepare(
          `INSERT INTO product_details(product_id,${fields.join(",")}) VALUES(?,?,?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET ${fields.map((key) => `${key}=excluded.${key}`).join(",")}`,
        )
        .run(id, ...data);
      res.json({ ok: true });
    },
  );
  app.get(
    "/api/product-details/:id",
    auth(["admin", "funcionario"]),
    async (req, res) =>
      res.json(
        (await db
          .prepare("SELECT * FROM product_details WHERE product_id=?")
          .get(positiveId(req.params.id))) || {},
      ),
  );
  const readOrder = async (id) => {
    const o = await db.prepare("SELECT * FROM web_orders WHERE id=?").get(id);
    if (!o) throw inputError("Pedido não encontrado", 404);
    return {
      ...o,
      idempotency_key: undefined,
      request_json: undefined,
      payment_reference: undefined,
      customer: JSON.parse(o.customer_json),
      seller: JSON.parse(o.seller_json),
      fulfillment: JSON.parse(o.fulfillment_json),
      payment: JSON.parse(o.payment_json),
      customer_json: undefined,
      seller_json: undefined,
      fulfillment_json: undefined,
      payment_json: undefined,
      items: (
        await db
          .prepare("SELECT * FROM web_order_items WHERE order_id=? ORDER BY id")
          .all(id)
      ).map((i) => ({
        ...i,
        details: JSON.parse(i.details_json),
        details_json: undefined,
      })),
      events: await db
        .prepare(
          "SELECT status,note,created_at FROM web_order_events WHERE order_id=? ORDER BY id",
        )
        .all(id),
    };
  };
  const event = async (id, status, note, userId) =>
    db
      .prepare(
        "INSERT INTO web_order_events(order_id,status,note,user_id,created_at) VALUES(?,?,?,?,?)",
      )
      .run(id, status, text(note, 1000), userId, iso());
  const release = async (order, userId, status) => {
    for (const i of await db
      .prepare("SELECT * FROM web_order_items WHERE order_id=?")
      .all(order.id)) {
      const p = await db
        .prepare("SELECT quantity FROM products WHERE id=?")
        .get(i.product_id);
      await db
        .prepare("UPDATE products SET quantity=quantity+? WHERE id=?")
        .run(i.quantity, i.product_id);
      await db
        .prepare(
          "INSERT INTO stock_movements(product_id,movement_type,quantity,previous_quantity,new_quantity,reason,user_id) VALUES(?,'CANCELAMENTO',?,?,?,?,?)",
        )
        .run(
          i.product_id,
          i.quantity,
          p.quantity,
          p.quantity + i.quantity,
          `Liberação da reserva ${order.number}`,
          userId,
        );
    }
    await db
      .prepare("UPDATE web_orders SET status=?,updated_at=? WHERE id=?")
      .run(status, iso(), order.id);
    await event(
      order.id,
      status,
      "Reserva liberada; nenhum pagamento foi registrado.",
      userId,
    );
  };
  const expire = async () => {
    for (const o of await db
      .prepare(
        "SELECT * FROM web_orders WHERE status='Aguardando pagamento' AND expires_at<=?",
      )
      .all(iso()))
      await release(o, null, "Expirado");
  };
  app.post(
    "/api/orders/expire",
    auth(["admin", "funcionario"]),
    async (_req, res) => {
      await db.transaction(expire)();
      res.json({ ok: true });
    },
  );
  app.post("/api/customer/orders", auth(["cliente"]), async (req, res) => {
    const b = req.body || {},
      key = text(b.idempotency_key, 80);
    if (!/^[a-zA-Z0-9-]{20,80}$/.test(key))
      throw inputError("Identificador da compra inválido");
    if (b.policy_version !== POLICY_VERSION || b.accepted !== true)
      throw inputError("Leia e aceite as condições atuais da compra");
    const canonical = JSON.stringify({
      items: b.items,
      fulfillment: b.fulfillment,
      payment_method_id: b.payment_method_id,
      expected_total_cents: b.expected_total_cents,
    });
    const id = await db.transaction(async () => {
      await expire();
      const existing = await db
        .prepare("SELECT * FROM web_orders WHERE idempotency_key=?")
        .get(key);
      if (existing) {
        if (
          existing.customer_id !== req.user.id ||
          existing.request_json !== canonical
        )
          throw inputError("Identificador já utilizado em outra compra", 409);
        return existing.id;
      }
      const s = await settings();
      if (!s.checkout_enabled || readiness(s).length)
        throw inputError(
          "Finalização de compras indisponível. Fale com a loja.",
          503,
        );
      if (!Array.isArray(b.items) || !b.items.length || b.items.length > 40)
        throw inputError("Selecione de 1 a 40 produtos");
      const ids = b.items.map((i) => positiveId(i?.id));
      if (new Set(ids).size !== ids.length)
        throw inputError("Produto repetido");
      const active = await db
        .prepare(
          "SELECT COUNT(*) count FROM web_orders WHERE customer_id=? AND status='Aguardando pagamento'",
        )
        .get(req.user.id);
      if (active.count >= 3)
        throw inputError(
          "Você já tem três pedidos aguardando pagamento; acompanhe ou cancele antes de criar outro",
          409,
        );
      const items = [];
      for (const item of b.items) {
        const p = await db
          .prepare(
            "SELECT id,name,price,quantity,expiration_date FROM products WHERE id=?",
          )
          .get(item.id);
        const qty = numberValue(item.quantity, "Quantidade", {
          integer: true,
          min: 1,
          max: 999,
        });
        if (
          !p ||
          p.quantity < qty ||
          expirationStatus(p.expiration_date)?.status === "expired"
        )
          throw inputError("Produto indisponível. Revise sua sacola.", 409);
        const detail = await db
          .prepare("SELECT * FROM product_details WHERE product_id=?")
          .get(p.id);
        if (
          !detail?.description ||
          !detail.volume ||
          !detail.composition ||
          !detail.precautions ||
          !detail.manufacturer
        )
          throw inputError(
            `A loja precisa completar as informações de ${p.name} antes da venda online`,
            409,
          );
        items.push({
          ...p,
          quantity: qty,
          previous_quantity: p.quantity,
          unit_price_cents: cents(p.price),
          details: detail,
        });
      }
      const method = await db
        .prepare(
          "SELECT id,name,code FROM payment_methods WHERE id=? AND active=1",
        )
        .get(positiveId(b.payment_method_id));
      if (!method) throw inputError("Forma de pagamento indisponível");
      const f = b.fulfillment || {},
        fulfillment = { type: f.type };
      let shipping = 0;
      if (f.type === "pickup")
        Object.assign(fulfillment, { address: s.address, days: s.pickup_days });
      else if (f.type === "delivery" && s.delivery_enabled) {
        const cep = text(f.cep, 9).replace(/\D/g, "");
        if (!/^\d{8}$/.test(cep) || cep < s.cep_start || cep > s.cep_end)
          throw inputError("CEP fora da região de entrega");
        for (const field of ["street", "number", "district", "city", "state"]) {
          fulfillment[field] = text(f[field], 200);
          if (!fulfillment[field])
            throw inputError("Complete o endereço de entrega");
        }
        if (!/^[A-Za-z]{2}$/.test(fulfillment.state))
          throw inputError("UF inválida");
        Object.assign(fulfillment, {
          cep,
          complement: text(f.complement, 200),
          days: s.delivery_days,
          region: s.delivery_region,
        });
        shipping = s.delivery_fee_cents;
      } else throw inputError("Modalidade de entrega inválida");
      const subtotal = items.reduce(
          (sum, i) => sum + i.unit_price_cents * i.quantity,
          0,
        ),
        total = subtotal + shipping;
      if (
        numberValue(b.expected_total_cents, "Total", {
          integer: true,
          max: 1e13,
        }) !== total
      )
        throw inputError(
          "O valor mudou. Confira os valores novamente antes de concluir.",
          409,
        );
      const customer = await db
        .prepare("SELECT name,email,phone,username FROM users WHERE id=?")
        .get(req.user.id);
      if (!customer.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))
        throw inputError(
          "Atualize seu e-mail no atendimento antes de finalizar",
        );
      const now = iso(),
        expires = new Date(Date.now() + 86400000).toISOString(),
        number = `WEB-${randomUUID()}`;
      const r = await db
        .prepare(
          `INSERT INTO web_orders(number,customer_id,idempotency_key,request_json,status,customer_json,seller_json,fulfillment_json,payment_json,subtotal_cents,shipping_cents,total_cents,policy_version,created_at,expires_at,updated_at) VALUES(?,?,?,?,'Aguardando pagamento',?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          number,
          req.user.id,
          key,
          canonical,
          JSON.stringify(customer),
          JSON.stringify(s),
          JSON.stringify(fulfillment),
          JSON.stringify(publicPayment(method)),
          subtotal,
          shipping,
          total,
          POLICY_VERSION,
          now,
          expires,
          now,
        );
      const orderId = Number(r.lastInsertRowid);
      for (const i of items) {
        await db
          .prepare("UPDATE products SET quantity=quantity-? WHERE id=?")
          .run(i.quantity, i.id);
        const move = await db
          .prepare(
            "INSERT INTO stock_movements(product_id,movement_type,quantity,previous_quantity,new_quantity,reason,user_id) VALUES(?,'SAIDA',?,?,?,?,?)",
          )
          .run(
            i.id,
            -i.quantity,
            i.previous_quantity,
            i.previous_quantity - i.quantity,
            `Reserva ${number}`,
            req.user.id,
          );
        await db
          .prepare(
            "INSERT INTO web_order_items(order_id,product_id,name,quantity,unit_price_cents,total_cents,details_json,movement_id) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            orderId,
            i.id,
            i.name,
            i.quantity,
            i.unit_price_cents,
            i.unit_price_cents * i.quantity,
            JSON.stringify(i.details),
            Number(move.lastInsertRowid),
          );
      }
      await event(
        orderId,
        "Aguardando pagamento",
        "Pedido recebido. Aguarde a orientação da loja; a reserva dura 24 horas. Pagamento sujeito à conferência manual.",
        req.user.id,
      );
      return orderId;
    })();
    res.status(201).json(await readOrder(id));
  });
  app.get("/api/shop/payment-methods", async (_req, res) =>
    res.json(
      (
        await db
          .prepare(
            "SELECT id,name,code FROM payment_methods WHERE active=1 ORDER BY id",
          )
          .all()
      ).map(publicPayment),
    ),
  );
  app.get("/api/customer/orders", auth(["cliente"]), async (req, res) =>
    res.json(
      await db
        .prepare(
          "SELECT id,number,status,total_cents,created_at,expires_at FROM web_orders WHERE customer_id=? ORDER BY id DESC LIMIT 200",
        )
        .all(req.user.id),
    ),
  );
  app.get("/api/customer/orders/:id", auth(["cliente"]), async (req, res) => {
    const o = await readOrder(positiveId(req.params.id));
    if (o.customer_id !== req.user.id)
      throw inputError("Pedido não encontrado", 404);
    res.json(o);
  });
  app.post(
    "/api/customer/orders/:id/cancel",
    auth(["cliente"]),
    async (req, res) => {
      await db.transaction(async () => {
        const o = await db
          .prepare("SELECT * FROM web_orders WHERE id=? AND customer_id=?")
          .get(positiveId(req.params.id), req.user.id);
        if (!o) throw inputError("Pedido não encontrado", 404);
        if (o.status === "Cancelado") return;
        if (o.status !== "Aguardando pagamento")
          throw inputError(
            "Use o atendimento para solicitar cancelamento ou devolução deste pedido",
            409,
          );
        await release(o, req.user.id, "Cancelado");
      })();
      res.json(await readOrder(Number(req.params.id)));
    },
  );
  app.get(
    "/api/online-orders",
    auth(["admin", "funcionario"]),
    async (_req, res) =>
      res.json(
        await db
          .prepare(
            "SELECT id,number,status,total_cents,created_at,expires_at FROM web_orders ORDER BY id DESC LIMIT 200",
          )
          .all(),
      ),
  );
  app.get(
    "/api/online-orders/:id",
    auth(["admin", "funcionario"]),
    async (req, res) => res.json(await readOrder(positiveId(req.params.id))),
  );
  app.post(
    "/api/online-orders/:id/status",
    auth(["admin", "funcionario"]),
    async (req, res) => {
      const id = positiveId(req.params.id),
        b = req.body || {};
      await db.transaction(async () => {
        await expire();
        const o = await db
          .prepare("SELECT * FROM web_orders WHERE id=?")
          .get(id);
        if (!o) throw inputError("Pedido não encontrado", 404);
        const transitions = {
          "Aguardando pagamento": ["Pago", "Cancelado"],
          Pago: ["Em separação", "Reembolso solicitado"],
          "Em separação": [
            "Enviado",
            "Pronto para retirada",
            "Reembolso solicitado",
          ],
          Enviado: ["Entregue", "Reembolso solicitado"],
          "Pronto para retirada": ["Entregue", "Reembolso solicitado"],
          Entregue: ["Reembolso solicitado"],
          "Reembolso solicitado": ["Reembolsado"],
        };
        if (!transitions[o.status]?.includes(b.status))
          throw inputError("Transição inválida ou pedido já atualizado", 409);
        const reference = text(b.reference, 100);
        if (b.status === "Cancelado") {
          await release(o, req.user.id, "Cancelado");
          return;
        }
        if (
          ["Pago", "Reembolsado"].includes(b.status) &&
          (!reference || b.confirmed !== true)
        )
          throw inputError(
            "Confirme a operação no banco e informe a referência, sem dados de cartão",
          );
        if (b.status === "Reembolsado" && req.user.role !== "admin")
          throw inputError("Reembolso exige administrador", 403);
        const fulfillment = JSON.parse(o.fulfillment_json);
        if (
          (b.status === "Enviado" && fulfillment.type !== "delivery") ||
          (b.status === "Pronto para retirada" && fulfillment.type !== "pickup")
        )
          throw inputError("Situação incompatível com a entrega escolhida");
        if (b.status === "Pago") {
          for (const i of await db
            .prepare("SELECT * FROM web_order_items WHERE order_id=?")
            .all(id)) {
            const p = await db
              .prepare("SELECT expiration_date FROM products WHERE id=?")
              .get(i.product_id);
            if (expirationStatus(p.expiration_date)?.status === "expired")
              throw inputError(
                "Produto reservado venceu. Cancele o pedido e providencie a devolução de eventual pagamento.",
                409,
              );
            const payment = JSON.parse(o.payment_json);
            const sale = await db
              .prepare(
                "INSERT INTO sales(product_id,quantity,total_value,user_id,customer_id,payment_method,order_number,order_status,transaction_reference,installments,amount_received,change_amount) VALUES(?,?,?,?,?,?,?,'Pago',?,1,?,0)",
              )
              .run(
                i.product_id,
                i.quantity,
                i.total_cents / 100,
                req.user.id,
                o.customer_id,
                payment.name,
                o.number,
                reference,
                i.total_cents / 100,
              );
            await db
              .prepare("UPDATE web_order_items SET sale_id=? WHERE id=?")
              .run(Number(sale.lastInsertRowid), i.id);
            await db
              .prepare(
                "UPDATE stock_movements SET movement_type='VENDA',sale_id=?,reason=? WHERE id=?",
              )
              .run(
                Number(sale.lastInsertRowid),
                `Venda ${o.number}`,
                i.movement_id,
              );
          }
        }
        if (b.status === "Reembolsado")
          await db
            .prepare(
              "UPDATE sales SET order_status='Cancelado' WHERE id IN (SELECT sale_id FROM web_order_items WHERE order_id=?)",
            )
            .run(id);
        const tracking = text(b.tracking, 300),
          fiscal = text(b.fiscal_key, 44);
        if (fiscal && !/^[A-Z0-9]{44}$/i.test(fiscal))
          throw inputError("Chave fiscal deve ter 44 caracteres alfanuméricos");
        await db
          .prepare(
            "UPDATE web_orders SET status=?,updated_at=?,tracking=CASE WHEN ?<>'' THEN ? ELSE tracking END,fiscal_key=CASE WHEN ?<>'' THEN ? ELSE fiscal_key END,payment_reference=CASE WHEN ?<>'' THEN ? ELSE payment_reference END WHERE id=?",
          )
          .run(
            b.status,
            iso(),
            tracking,
            tracking,
            fiscal,
            fiscal,
            reference,
            reference,
            id,
          );
        await event(
          id,
          b.status,
          b.status === "Reembolsado"
            ? "Reembolso confirmado pela equipe. Produtos devolvidos devem ser inspecionados antes de qualquer reposição de estoque."
            : text(b.note, 1000) || "Situação atualizada pela equipe.",
          req.user.id,
        );
      })();
      res.json(await readOrder(id));
    },
  );
  app.get("/api/customer/requests", auth(["cliente"]), async (req, res) =>
    res.json(
      await db
        .prepare(
          "SELECT * FROM service_requests WHERE customer_id=? ORDER BY id DESC LIMIT 200",
        )
        .all(req.user.id),
    ),
  );
  app.post("/api/customer/requests", auth(["cliente"]), async (req, res) => {
    const b = req.body || {},
      message = text(b.message, 4000),
      kind = text(b.kind, 40),
      orderId = b.order_id ? positiveId(b.order_id) : null;
    if (
      ![
        "Atendimento",
        "Arrependimento",
        "Troca ou defeito",
        "Cancelamento",
        "Privacidade",
        "Correção de dados",
        "Exclusão de dados",
      ].includes(kind) ||
      message.length < 10
    )
      throw inputError(
        "Selecione o assunto e descreva sua solicitação (mínimo 10 caracteres)",
      );
    const result = await db.transaction(async () => {
      if (
        orderId &&
        !(await db
          .prepare("SELECT 1 FROM web_orders WHERE id=? AND customer_id=?")
          .get(orderId, req.user.id))
      )
        throw inputError("Pedido não encontrado", 404);
      const n = await db
        .prepare(
          "SELECT COUNT(*) count FROM service_requests WHERE customer_id=? AND created_at>?",
        )
        .get(req.user.id, new Date(Date.now() - 86400000).toISOString());
      if (n.count >= 20)
        throw inputError(
          "Limite de protocolos atingido hoje. Use o e-mail ou WhatsApp da loja para atendimento.",
          429,
        );
      const protocol = `SAC-${randomUUID()}`,
        now = iso();
      await db
        .prepare(
          "INSERT INTO service_requests(protocol,customer_id,order_id,kind,message,created_at,updated_at,due_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          protocol,
          req.user.id,
          orderId,
          kind,
          message,
          now,
          now,
          new Date(Date.now() + 5 * 86400000).toISOString(),
        );
      return await db
        .prepare("SELECT * FROM service_requests WHERE protocol=?")
        .get(protocol);
    })();
    res.status(201).json(result);
  });
  app.get(
    "/api/service-requests",
    auth(["admin", "funcionario"]),
    async (_req, res) =>
      res.json(
        await db
          .prepare(
            "SELECT r.*,u.name customer_name,u.email FROM service_requests r JOIN users u ON u.id=r.customer_id ORDER BY r.id DESC LIMIT 200",
          )
          .all(),
      ),
  );
  app.put(
    "/api/service-requests/:id",
    auth(["admin", "funcionario"]),
    async (req, res) => {
      const response = text(req.body?.response, 4000),
        status = text(req.body?.status, 30);
      if (
        response.length < 5 ||
        !["Em atendimento", "Respondido", "Resolvido"].includes(status)
      )
        throw inputError("Informe a resposta e a situação");
      await db.transaction(async () => {
        const id = positiveId(req.params.id),
          r = await db
            .prepare("SELECT response_history FROM service_requests WHERE id=?")
            .get(id);
        if (!r) throw inputError("Protocolo não encontrado", 404);
        const history = JSON.parse(r.response_history);
        history.push({ response, status, created_at: iso() });
        await db
          .prepare(
            "UPDATE service_requests SET response=?,status=?,updated_at=?,response_history=? WHERE id=?",
          )
          .run(response, status, iso(), JSON.stringify(history), id);
      })();
      res.json({ ok: true });
    },
  );
  app.get("/api/customer/data", auth(["cliente"]), async (req, res) => {
    const u = await db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(req.user.id);
    const orders = [];
    for (const o of await db
      .prepare("SELECT id FROM web_orders WHERE customer_id=? ORDER BY id")
      .all(u.id))
      orders.push(await readOrder(o.id));
    res
      .set("Content-Disposition", 'attachment; filename="meus-dados.json"')
      .json({
        exported_at: iso(),
        profile: safeUser(u),
        orders,
        requests: await db
          .prepare(
            "SELECT * FROM service_requests WHERE customer_id=? ORDER BY id",
          )
          .all(u.id),
        sales: await db
          .prepare(
            "SELECT order_number,quantity,total_value,sale_date,order_status FROM sales WHERE customer_id=?",
          )
          .all(u.id),
      });
  });
  app.put("/api/customer/profile", auth(["cliente"]), async (req, res) => {
    const name = text(req.body?.name, 120),
      email = text(req.body?.email, 150),
      phone = text(req.body?.phone, 25);
    if (name.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw inputError("Informe nome completo e e-mail válido");
    await db
      .prepare("UPDATE users SET name=?,email=?,phone=? WHERE id=?")
      .run(name, email, phone, req.user.id);
    res.json(
      safeUser(
        await db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id),
      ),
    );
  });
}

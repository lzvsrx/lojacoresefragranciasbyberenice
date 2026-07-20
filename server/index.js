import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import Papa from "papaparse";
import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import { copyFileSync, existsSync } from "fs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const databasePath = path.join(root, "server/data/store.db");
const seedPath = path.join(root, "server/data/store.seed.db");
if (!existsSync(databasePath)) {
  if (!existsSync(seedPath))
    throw new Error("Banco inicial server/data/store.seed.db não encontrado");
  copyFileSync(seedPath, databasePath);
}
const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
const saleColumns = new Set(
  db
    .prepare("PRAGMA table_info(sales)")
    .all()
    .map((column) => column.name),
);
for (const [name, type] of [
  ["customer_id", "INTEGER"],
  ["payment_method", "TEXT"],
  ["order_number", "TEXT"],
  ["order_status", "TEXT DEFAULT 'Concluído'"],
  ["payment_code", "TEXT"],
  ["transaction_reference", "TEXT"],
  ["installments", "INTEGER DEFAULT 1"],
  ["amount_received", "REAL"],
  ["change_amount", "REAL DEFAULT 0"],
  ["fiscal_document", "TEXT"],
  ["fiscal_key", "TEXT"],
]) {
  if (!saleColumns.has(name))
    db.exec(`ALTER TABLE sales ADD COLUMN ${name} ${type}`);
}
db.exec(
  `CREATE TABLE IF NOT EXISTS payment_methods(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,requires_reference INTEGER NOT NULL DEFAULT 0,max_installments INTEGER NOT NULL DEFAULT 1,instructions TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
);
const seedPayment = db.prepare(
  "INSERT OR IGNORE INTO payment_methods(code,name,active,requires_reference,max_installments,instructions) VALUES(?,?,?,?,?,?)",
);
for (const method of [
  [
    "01",
    "Dinheiro",
    1,
    0,
    1,
    "Informe o valor recebido para calcular o troco.",
  ],
  [
    "03",
    "Cartão de crédito",
    1,
    1,
    12,
    "Registre somente NSU ou código de autorização. Nunca armazene o número completo do cartão ou CVV.",
  ],
  [
    "04",
    "Cartão de débito",
    1,
    1,
    1,
    "Registre somente NSU ou código de autorização.",
  ],
  [
    "15",
    "Boleto bancário",
    0,
    1,
    1,
    "Registre a identificação segura do boleto.",
  ],
  [
    "17",
    "Pix dinâmico",
    1,
    1,
    1,
    "Registre TxID ou EndToEndId retornado pela instituição financeira.",
  ],
  [
    "18",
    "Transferência bancária / carteira digital",
    1,
    1,
    1,
    "Registre a referência fornecida pela instituição.",
  ],
  [
    "20",
    "Pix estático",
    1,
    1,
    1,
    "Registre EndToEndId ou referência de conciliação.",
  ],
  ["99", "Outros", 0, 1, 1, "Descreva e registre a referência do pagamento."],
])
  seedPayment.run(...method);
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 20 },
  fileFilter: (_req, file, callback) => {
    const allowed = [
      "image/png",
      "image/jpeg",
      "text/csv",
      "application/vnd.ms-excel",
    ];
    allowed.includes(file.mimetype)
      ? callback(null, true)
      : callback(new Error("Tipo de arquivo não permitido"));
  },
});
const secret = process.env.JWT_SECRET || randomBytes(48).toString("hex");
if (!process.env.JWT_SECRET)
  console.warn(
    "JWT_SECRET não definido: usando chave temporária segura; sessões serão encerradas ao reiniciar.",
  );
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-origin" },
  }),
);
app.use(
  cors({
    origin: (origin, callback) =>
      !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
        ? callback(null, true)
        : callback(new Error("Origem não autorizada")),
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);
app.use(express.json({ limit: "1mb", type: "application/json" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 500,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Limite temporário de requisições excedido" },
  }),
);
app.use("/assets", express.static(path.join(root, "client/public/assets")));

const safeUser = (u) =>
  u && {
    id: u.id,
    username: u.username,
    role: u.role,
    name: clean(u.name, 120) || u.username,
    birth_date: u.birth_date,
    email: u.email,
    phone: u.phone,
    cpf: u.cpf,
    preferred_type: u.preferred_type,
    preferred_brand: u.preferred_brand,
    preferred_style: u.preferred_style,
    has_image: !!u.profile_image,
  };
const auth =
  (roles = []) =>
  (req, res, next) => {
    try {
      const header = req.headers.authorization || "";
      if (!header.startsWith("Bearer ")) throw new Error();
      const tokenUser = jwt.verify(header.slice(7), secret, {
          algorithms: ["HS256"],
          issuer: "cores-fragrancias-api",
          audience: "cores-fragrancias-web",
        }),
        current = db
          .prepare("SELECT id,username,role,name FROM users WHERE id=?")
          .get(tokenUser.id);
      if (!current) throw new Error();
      req.user = safeUser(current);
      if (roles.length && !roles.includes(current.role))
        return res
          .status(403)
          .json({ error: "Seu perfil não possui permissão para esta ação" });
      next();
    } catch {
      res.status(401).json({ error: "Sessão inválida ou expirada" });
    }
  };
const productJson = (p) => ({
  ...p,
  image: undefined,
  image_url: p.image ? `/api/products/${p.id}/image` : null,
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Muitas tentativas de acesso. Aguarde 15 minutos." },
});
const clean = (value, max = 150) =>
  String(value ?? "")
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .slice(0, max);
const validEmail = (value) =>
  !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPassword = (value) =>
  typeof value === "string" &&
  value.length >= 8 &&
  value.length <= 72 &&
  /[a-z]/.test(value) &&
  /[A-Z]/.test(value) &&
  /\d/.test(value);
const normalizeUser = (body) => ({
  username: clean(body.username, 40).toLowerCase(),
  password: body.password || "",
  role: clean(body.role, 20),
  name: clean(body.name, 120),
  birth_date: clean(body.birth_date, 10) || null,
  email: clean(body.email, 150).toLowerCase() || null,
  phone: clean(body.phone, 25) || null,
  cpf: clean(body.cpf, 18) || null,
  preferred_type: clean(body.preferred_type, 300) || null,
  preferred_brand: clean(body.preferred_brand, 300) || null,
  preferred_style: clean(body.preferred_style, 300) || null,
});
const validateUser = (u, isEdit = false) => {
  if (!/^[a-z0-9._-]{3,40}$/.test(u.username))
    return "Usuário deve ter de 3 a 40 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado";
  if (!["admin", "funcionario", "cliente"].includes(u.role))
    return "Perfil inválido";
  if (u.name.length < 3) return "Informe o nome completo";
  if (!validEmail(u.email)) return "E-mail inválido";
  if (!isEdit || u.password) {
    if (!validPassword(u.password))
      return "A senha deve ter entre 8 e 72 caracteres, com letra maiúscula, minúscula e número";
  }
  return null;
};

app.post("/api/login", loginLimiter, (req, res) => {
  const username = clean(req.body?.username, 40).toLowerCase(),
    password = String(req.body?.password || "").slice(0, 72);
  const u = db.prepare("SELECT * FROM users WHERE username=?").get(username);
  const hash =
    u?.password ||
    "$2b$10$C6UzMDM.H6dfI/f/IKxGhu8djhL4qSP2jB5N1.klM2.V5iQn.7gNi";
  if (!bcrypt.compareSync(password, hash) || !u)
    return res.status(401).json({ error: "Usuário ou senha incorretos" });
  const user = safeUser(u);
  res
    .set("Cache-Control", "no-store")
    .json({
      user,
      token: jwt.sign(user, secret, {
        algorithm: "HS256",
        expiresIn: "8h",
        issuer: "cores-fragrancias-api",
        audience: "cores-fragrancias-web",
        subject: String(user.id),
      }),
    });
});
app.get("/api/me", auth(), (req, res) =>
  res.json(
    safeUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id)),
  ),
);
app.get("/api/users/:id/image", (req, res) => {
  const x = db
    .prepare("SELECT profile_image FROM users WHERE id=?")
    .get(req.params.id);
  if (!x?.profile_image) return res.sendStatus(404);
  res.type("image/jpeg").send(x.profile_image);
});
app.put("/api/me/image", auth(), upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Selecione uma imagem" });
  db.prepare("UPDATE users SET profile_image=? WHERE id=?").run(
    req.file.buffer,
    req.user.id,
  );
  res.json(
    safeUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id)),
  );
});
app.put(
  "/api/users/:id/image",
  auth(["admin"]),
  upload.single("image"),
  (req, res) => {
    if (!req.file || !["image/png", "image/jpeg"].includes(req.file.mimetype))
      return res.status(400).json({ error: "Envie uma imagem PNG ou JPEG" });
    const id = Number(req.params.id);
    const result = db
      .prepare("UPDATE users SET profile_image=? WHERE id=?")
      .run(req.file.buffer, id);
    if (!result.changes)
      return res.status(404).json({ error: "Usuário não encontrado" });
    res.json({ ok: true });
  },
);

app.get("/api/products", auth(), (req, res) => {
  let rows = db.prepare("SELECT * FROM products ORDER BY name").all();
  const q = (req.query.q || "").toLowerCase();
  if (q)
    rows = rows.filter((p) =>
      [p.id, p.name, p.brand, p.style, p.type].some((v) =>
        String(v || "")
          .toLowerCase()
          .includes(q),
      ),
    );
  res.json(rows.map(productJson));
});
app.get("/api/products/:id/image", (req, res) => {
  const x = db
    .prepare("SELECT image FROM products WHERE id=?")
    .get(req.params.id);
  if (!x?.image) return res.sendStatus(404);
  res.type("image/jpeg").send(x.image);
});
app.post(
  "/api/products",
  auth(["admin", "funcionario"]),
  upload.single("image"),
  (req, res) => {
    const b = req.body;
    const result = db
      .prepare(
        "INSERT INTO products(name,brand,style,type,price,quantity,expiration_date,image) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        b.name,
        b.brand,
        b.style,
        b.type,
        +b.price,
        +b.quantity,
        b.expiration_date,
        req.file?.buffer || null,
      );
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  },
);
app.put(
  "/api/products/:id",
  auth(["admin", "funcionario"]),
  upload.single("image"),
  (req, res) => {
    const b = req.body;
    if (req.file)
      db.prepare(
        "UPDATE products SET name=?,brand=?,style=?,type=?,price=?,quantity=?,expiration_date=?,image=? WHERE id=?",
      ).run(
        b.name,
        b.brand,
        b.style,
        b.type,
        +b.price,
        +b.quantity,
        b.expiration_date,
        req.file.buffer,
        req.params.id,
      );
    else
      db.prepare(
        "UPDATE products SET name=?,brand=?,style=?,type=?,price=?,quantity=?,expiration_date=? WHERE id=?",
      ).run(
        b.name,
        b.brand,
        b.style,
        b.type,
        +b.price,
        +b.quantity,
        b.expiration_date,
        req.params.id,
      );
    res.json({ ok: true });
  },
);
app.delete("/api/products/:id", auth(["admin"]), (req, res) => {
  const used = db
    .prepare("SELECT 1 FROM sales WHERE product_id=? LIMIT 1")
    .get(req.params.id);
  if (used)
    return res
      .status(409)
      .json({ error: "Produto possui vendas e não pode ser excluído" });
  db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
const sell = db.transaction((data, userId) => {
  const p = db.prepare("SELECT * FROM products WHERE id=?").get(data.productId),
    method = db
      .prepare("SELECT * FROM payment_methods WHERE id=? AND active=1")
      .get(data.paymentMethodId);
  if (!p) throw new Error("Produto não encontrado");
  if (!method) throw new Error("Forma de pagamento inválida ou desativada");
  if (data.quantity < 1 || p.quantity < data.quantity)
    throw new Error("Estoque insuficiente");
  if (method.requires_reference && !data.reference)
    throw new Error("Informe TxID, NSU ou código de autorização");
  if (data.installments < 1 || data.installments > method.max_installments)
    throw new Error("Quantidade de parcelas inválida");
  const total = Number((p.price * data.quantity).toFixed(2)),
    received =
      data.amountReceived == null ? total : Number(data.amountReceived);
  if (method.code === "01" && received < total)
    throw new Error("Valor recebido é menor que o total");
  const change =
      method.code === "01" ? Number((received - total).toFixed(2)) : 0,
    orderNumber = `PED-${Date.now().toString().slice(-8)}`;
  db.prepare("UPDATE products SET quantity=quantity-? WHERE id=?").run(
    data.quantity,
    data.productId,
  );
  const r = db
    .prepare(
      "INSERT INTO sales(product_id,quantity,total_value,user_id,customer_id,payment_method,order_number,order_status,payment_code,transaction_reference,installments,amount_received,change_amount,fiscal_document,fiscal_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      data.productId,
      data.quantity,
      total,
      userId,
      data.customerId || null,
      method.name,
      orderNumber,
      data.status || "Concluído",
      method.code,
      data.reference || null,
      data.installments,
      received,
      change,
      data.fiscalDocument || null,
      data.fiscalKey || null,
    );
  return {
    id: Number(r.lastInsertRowid),
    total,
    change,
    order_number: orderNumber,
  };
});
app.post("/api/sales", auth(["admin", "funcionario"]), (req, res) => {
  try {
    const b = req.body || {},
      data = {
        productId: Number(b.product_id),
        customerId: Number(b.customer_id) || null,
        quantity: Number(b.quantity),
        paymentMethodId: Number(b.payment_method_id),
        reference: clean(b.transaction_reference, 100),
        installments: Number(b.installments || 1),
        amountReceived:
          b.amount_received === "" || b.amount_received == null
            ? null
            : Number(b.amount_received),
        status: clean(b.order_status, 30),
        fiscalDocument: clean(b.fiscal_document, 20),
        fiscalKey: clean(b.fiscal_key, 60),
      };
    if (!Number.isInteger(data.productId) || !Number.isInteger(data.quantity))
      throw new Error("Dados da venda inválidos");
    res.status(201).json(sell(data, req.user.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.get("/api/sales", auth(["admin", "funcionario"]), (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT s.*,p.name product_name,u.name user_name,c.name customer_name FROM sales s LEFT JOIN products p ON p.id=s.product_id LEFT JOIN users u ON u.id=s.user_id LEFT JOIN users c ON c.id=s.customer_id ORDER BY sale_date DESC",
      )
      .all(),
  ),
);
app.get("/api/payment-methods", auth(["admin", "funcionario"]), (_req, res) =>
  res.json(
    db.prepare("SELECT * FROM payment_methods ORDER BY active DESC,code").all(),
  ),
);
app.put("/api/payment-methods/:id", auth(["admin"]), (req, res) => {
  const id = Number(req.params.id),
    b = req.body || {},
    method = db.prepare("SELECT * FROM payment_methods WHERE id=?").get(id);
  if (!method)
    return res.status(404).json({ error: "Forma de pagamento não encontrada" });
  const name = clean(b.name, 80),
    maxInstallments = Math.max(
      1,
      Math.min(24, Number(b.max_installments) || 1),
    ),
    instructions = clean(b.instructions, 500);
  if (name.length < 2) return res.status(400).json({ error: "Nome inválido" });
  db.prepare(
    "UPDATE payment_methods SET name=?,active=?,requires_reference=?,max_installments=?,instructions=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
  ).run(
    name,
    b.active ? 1 : 0,
    b.requires_reference ? 1 : 0,
    maxInstallments,
    instructions,
    id,
  );
  res.json({ ok: true });
});
app.get("/api/dashboard", auth(["admin", "funcionario"]), (req, res) => {
  const summary = db
    .prepare(
      "SELECT COUNT(*) products,COALESCE(SUM(quantity),0) stock,COALESCE(SUM(price*quantity),0) stock_value FROM products",
    )
    .get();
  const sales = db
    .prepare(
      "SELECT COUNT(*) sales_count,COALESCE(SUM(total_value),0) revenue FROM sales",
    )
    .get();
  const low = db
    .prepare(
      "SELECT id,name,quantity FROM products WHERE quantity<=5 ORDER BY quantity,name LIMIT 20",
    )
    .all();
  const chart = db
    .prepare(
      "SELECT substr(sale_date,1,10) date,SUM(total_value) value FROM sales GROUP BY substr(sale_date,1,10) ORDER BY date DESC LIMIT 14",
    )
    .all()
    .reverse();
  const birthdays = db
    .prepare(
      "SELECT id,name,phone,email,birth_date FROM users WHERE role='cliente' AND birth_date IS NOT NULL",
    )
    .all()
    .filter(
      (x) => x.birth_date?.slice(5) === new Date().toISOString().slice(5, 10),
    );
  res.json({ ...summary, ...sales, low, chart, birthdays });
});

app.get("/api/users", auth(["admin", "funcionario"]), (_req, res) =>
  res.json(db.prepare("SELECT * FROM users ORDER BY name").all().map(safeUser)),
);
app.post("/api/users", auth(["admin"]), async (req, res) => {
  try {
    const b = normalizeUser(req.body),
      error = validateUser(b);
    if (error) return res.status(400).json({ error });
    const hash = await bcrypt.hash(b.password, 12);
    const r = db
      .prepare(
        "INSERT INTO users(username,password,role,name,birth_date,email,phone,cpf,preferred_type,preferred_brand,preferred_style) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        b.username,
        hash,
        b.role,
        b.name,
        b.birth_date,
        b.email,
        b.phone,
        b.cpf,
        b.preferred_type,
        b.preferred_brand,
        b.preferred_style,
      );
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) {
    res
      .status(400)
      .json({
        error:
          e.code === "SQLITE_CONSTRAINT_UNIQUE"
            ? "Este nome de usuário já está cadastrado"
            : "Não foi possível criar o usuário",
      });
  }
});
app.put("/api/users/:id", auth(["admin"]), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id))
      return res.status(400).json({ error: "Identificador inválido" });
    const existing = db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if (!existing)
      return res.status(404).json({ error: "Usuário não encontrado" });
    const b = normalizeUser(req.body),
      error = validateUser(b, true);
    if (error) return res.status(400).json({ error });
    if (
      existing.role === "admin" &&
      b.role !== "admin" &&
      db.prepare("SELECT COUNT(*) count FROM users WHERE role='admin'").get()
        .count <= 1
    )
      return res
        .status(400)
        .json({
          error: "O sistema precisa manter pelo menos um administrador",
        });
    const values = [
      b.username,
      b.role,
      b.name,
      b.birth_date,
      b.email,
      b.phone,
      b.cpf,
      b.preferred_type,
      b.preferred_brand,
      b.preferred_style,
    ];
    if (b.password) {
      values.push(await bcrypt.hash(b.password, 12), id);
      db.prepare(
        "UPDATE users SET username=?,role=?,name=?,birth_date=?,email=?,phone=?,cpf=?,preferred_type=?,preferred_brand=?,preferred_style=?,password=? WHERE id=?",
      ).run(...values);
    } else {
      values.push(id);
      db.prepare(
        "UPDATE users SET username=?,role=?,name=?,birth_date=?,email=?,phone=?,cpf=?,preferred_type=?,preferred_brand=?,preferred_style=? WHERE id=?",
      ).run(...values);
    }
    res.json({ ok: true });
  } catch (e) {
    res
      .status(400)
      .json({
        error:
          e.code === "SQLITE_CONSTRAINT_UNIQUE"
            ? "Este nome de usuário já está cadastrado"
            : "Não foi possível atualizar o usuário",
      });
  }
});
app.delete("/api/users/:id", auth(["admin"]), (req, res) => {
  const id = Number(req.params.id),
    target = db.prepare("SELECT role FROM users WHERE id=?").get(id);
  if (id === req.user.id)
    return res
      .status(400)
      .json({ error: "Você não pode excluir seu próprio usuário" });
  if (!target) return res.status(404).json({ error: "Usuário não encontrado" });
  if (
    target.role === "admin" &&
    db.prepare("SELECT COUNT(*) count FROM users WHERE role='admin'").get()
      .count <= 1
  )
    return res
      .status(400)
      .json({ error: "O sistema precisa manter pelo menos um administrador" });
  try {
    db.prepare("DELETE FROM users WHERE id=?").run(id);
    res.json({ ok: true });
  } catch {
    return res
      .status(409)
      .json({
        error: "Este usuário possui vendas vinculadas e não pode ser excluído",
      });
  }
});
app.get(
  "/api/export/products.csv",
  auth(["admin", "funcionario"]),
  (_req, res) => {
    const rows = db
      .prepare(
        "SELECT id,name nome,brand marca,style estilo,type tipo,price preco,quantity quantidade,expiration_date data_validade FROM products",
      )
      .all();
    res.attachment("produtos.csv").send("\ufeff" + Papa.unparse(rows));
  },
);
app.get(
  "/api/export/products.pdf",
  auth(["admin", "funcionario"]),
  (_req, res) => {
    const products = db
      .prepare(
        `SELECT p.id,p.name,p.brand,p.style,p.type,p.price,p.quantity,p.expiration_date,COALESCE(SUM(s.quantity),0) sold_quantity FROM products p LEFT JOIN sales s ON s.product_id=p.id GROUP BY p.id ORDER BY COALESCE(p.type,'Sem tipo'),p.brand,p.name`,
      )
      .all();
    const doc = new PDFDocument({
      size: "A4",
      margin: 38,
      bufferPages: true,
      info: {
        Title: "Relatório Completo de Produtos",
        Author: "Cores & Fragrâncias by Berenice",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => {
      const pdf = Buffer.concat(chunks);
      res
        .set({
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="produtos.pdf"',
          "Content-Length": pdf.length,
        })
        .send(pdf);
    });
    const brl = (value) =>
      Number(value || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      });
    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor("#382c25")
      .text("Cores & Fragrâncias by Berenice", { align: "center" });
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .text("Relatório Completo de Produtos", { align: "center" });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#6f625a")
      .text(
        `Estoque e vendas • Emitido em ${new Date().toLocaleString("pt-BR")}`,
        { align: "center" },
      )
      .moveDown(1.4);
    let currentType = null;
    for (const product of products) {
      const type = product.type || "Sem tipo";
      if (type !== currentType) {
        currentType = type;
        if (doc.y > 720) doc.addPage();
        doc
          .moveDown(0.4)
          .font("Helvetica-Bold")
          .fontSize(12)
          .fillColor("#99623d")
          .text(`Tipo: ${type}`)
          .moveDown(0.35);
      }
      if (doc.y > 735) doc.addPage();
      doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor("#29231f")
        .text(`#${product.id}  ${product.name}`, { continued: false });
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor("#5f544d")
        .text(
          `Marca: ${product.brand || "—"}  |  Estilo: ${product.style || "—"}  |  Preço: ${brl(product.price)}`,
        );
      doc.text(
        `Estoque: ${product.quantity || 0} un.  |  Validade: ${product.expiration_date || "—"}  |  Vendido: ${product.sold_quantity > 0 ? "Sim" : "Não"}  |  Qtd. vendida: ${product.sold_quantity || 0}`,
      );
      doc
        .moveDown(0.35)
        .strokeColor("#e5ddd7")
        .moveTo(38, doc.y)
        .lineTo(557, doc.y)
        .stroke()
        .moveDown(0.45);
    }
    if (!products.length)
      doc
        .font("Helvetica")
        .fillColor("#29231f")
        .text("Nenhum produto cadastrado.");
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor("#8a7e75")
        .text(
          `Praça Pres. João Pessoa, 66 - Centro, Varginha - MG • WhatsApp +55 35 9821-3049 • Página ${i + 1} de ${range.count}`,
          38,
          805,
          { width: 519, align: "center", lineBreak: false },
        );
    }
    doc.end();
  },
);
app.post(
  "/api/import/products",
  auth(["admin", "funcionario"]),
  upload.single("file"),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Envie um CSV" });
    const parsed = Papa.parse(req.file.buffer.toString("utf8"), {
      header: true,
      skipEmptyLines: true,
    });
    const upsert = db.prepare(
      "INSERT INTO products(id,name,brand,style,type,price,quantity,expiration_date) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,brand=excluded.brand,style=excluded.style,type=excluded.type,price=excluded.price,quantity=excluded.quantity,expiration_date=excluded.expiration_date",
    );
    const insert = db.prepare(
      "INSERT INTO products(name,brand,style,type,price,quantity,expiration_date) VALUES(?,?,?,?,?,?,?)",
    );
    let count = 0;
    db.transaction(() =>
      parsed.data.forEach((x) => {
        if (!x.nome) return;
        const vals = [
          x.nome,
          x.marca || "Outra",
          x.estilo || "Outro",
          x.tipo || "Outro",
          +x.preco || 0,
          +x.quantidade || 0,
          x.data_validade || null,
        ];
        x.id ? upsert.run(+x.id, ...vals) : insert.run(...vals);
        count++;
      }),
    )();
    res.json({ count, errors: parsed.errors });
  },
);

app.use(express.static(path.join(root, "dist")));
app.get("/{*splat}", (req, res, next) =>
  req.path.startsWith("/api")
    ? next()
    : res.sendFile(path.join(root, "dist/index.html")),
);
app.use((err, _req, res, _next) =>
  res.status(500).json({ error: err.message || "Erro interno" }),
);
app.listen(process.env.PORT || 3001, () =>
  console.log("API em http://localhost:3001"),
);

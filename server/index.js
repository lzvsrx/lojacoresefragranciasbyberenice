import express from "express";
import { installCommerce } from "./commerce.js";
import cors from "cors";
import helmet from "helmet";
import {
  createApiLimiter,
  createLoginLimiter,
  createRegistrationLimiter,
} from "./rate-limits.js";
import { createDatabase } from "./database.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import Papa from "papaparse";
import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import { randomBytes, randomUUID } from "crypto";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { loadEnvFile } from "node:process";
import {
  inputError,
  productInput,
  numberValue,
  dateValue,
} from "./validation.js";
import { storeToday, expirationStatus } from "../src/expiration.js";
import { normalizeSearch, matchesProduct } from "../src/search.js";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (process.env.NODE_ENV !== "test" && existsSync(path.join(root, ".env")))
  loadEnvFile(path.join(root, ".env"));
const isVercel = Boolean(process.env.VERCEL);
const databasePath =
  process.env.DATABASE_PATH ||
  (isVercel
    ? path.join(process.env.TMPDIR || "/tmp", "store.db")
    : path.join(root, "server/data/store.db"));
const remoteUrl = process.env.TURSO_DATABASE_URL;
if (
  remoteUrl &&
  !process.env.TURSO_AUTH_TOKEN &&
  !remoteUrl.startsWith("file:")
)
  throw new Error(
    "Configure TURSO_AUTH_TOKEN para conectar o banco persistente.",
  );
const seedPath = path.join(root, "server/data/store.seed.db");
if (!remoteUrl) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
}
if (!remoteUrl && !existsSync(databasePath)) {
  if (!existsSync(seedPath))
    throw new Error("Banco inicial server/data/store.seed.db não encontrado");
  copyFileSync(seedPath, databasePath);
}
const db = await createDatabase({
  filename: databasePath,
  url: remoteUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
await db.pragma("journal_mode = WAL");
await db.pragma("foreign_keys = ON");
await db.pragma("busy_timeout = 5000");
await db.transaction(async () => {
  const productColumns = await db.prepare("PRAGMA table_info(products)").all();
  if (!productColumns.some((column) => column.name === "purchase_price"))
    await db.exec(
      "ALTER TABLE products ADD COLUMN purchase_price REAL NOT NULL DEFAULT 0 CHECK(purchase_price >= 0)",
    );
  if (
    !(await db.prepare("PRAGMA table_info(users)").all()).some(
      (column) => column.name === "session_version",
    )
  )
    await db.exec(
      "ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0",
    );
  const saleColumns = new Set(
    (await db.prepare("PRAGMA table_info(sales)").all()).map(
      (column) => column.name,
    ),
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
      await db.exec(`ALTER TABLE sales ADD COLUMN ${name} ${type}`);
  }
  await db.exec(
    `CREATE TABLE IF NOT EXISTS payment_methods(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,requires_reference INTEGER NOT NULL DEFAULT 0,max_installments INTEGER NOT NULL DEFAULT 1,instructions TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  );
  await db.exec(`CREATE TABLE IF NOT EXISTS stock_movements(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    movement_type TEXT NOT NULL CHECK(movement_type IN ('ENTRADA','SAIDA','AJUSTE','VENDA','CANCELAMENTO')),
    quantity INTEGER NOT NULL,
    previous_quantity INTEGER NOT NULL,
    new_quantity INTEGER NOT NULL,
    reason TEXT NOT NULL,
    user_id INTEGER,
    sale_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(sale_id) REFERENCES sales(id)
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS expiration_losses(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    expiration_date TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    total_cents INTEGER NOT NULL,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  const seedPayment = db.prepare(
    "INSERT OR IGNORE INTO payment_methods(code,name,active,requires_reference,max_installments,instructions) VALUES(?,?,?,?,?,?)",
  );
  // Older versions allowed deleting products that still had historical sales.
  // Recover only their reference, with zero stock; never invent available inventory.
  await db.exec(`INSERT OR IGNORE INTO products(id,name,brand,style,type,price,quantity)
  SELECT missing.product_id,'Produto histórico #' || missing.product_id,'','','Histórico',0,0
  FROM (SELECT product_id FROM sales UNION SELECT product_id FROM stock_movements) missing
  WHERE missing.product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM products p WHERE p.id=missing.product_id)`);
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
    await seedPayment.run(...method);
})();
const app = express();
if (isVercel) app.set("trust proxy", 1);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024,
    files: 1,
    fields: 20,
  },
  fileFilter: (_req, file, callback) => {
    const allowed = [
      "image/png",
      "image/jpeg",
      "text/csv",
      "application/vnd.ms-excel",
    ];
    allowed.includes(file.mimetype)
      ? callback(null, true)
      : callback(
          inputError("Tipo de arquivo não permitido. Use PNG, JPEG ou CSV"),
        );
  },
});
let secret = process.env.JWT_SECRET;
if (!secret && !isVercel) {
  const secretPath = path.join(path.dirname(databasePath), ".jwt-secret");
  if (!existsSync(secretPath))
    writeFileSync(secretPath, randomBytes(48).toString("hex"), {
      flag: "wx",
      mode: 0o600,
    });
  secret = readFileSync(secretPath, "utf8").trim();
}
if (!secret) {
  secret = randomBytes(48).toString("hex");
  console.warn(
    "Configure JWT_SECRET na hospedagem para manter as sessões entre instâncias.",
  );
}
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
        upgradeInsecureRequests: isVercel ? [] : null,
      },
    },
    crossOriginResourcePolicy: {
      policy: "same-origin",
    },
  }),
);
app.use(
  cors({
    origin: (origin, callback) =>
      !origin ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
      origin === "https://lojacoresefragranciasbyberenice.vercel.app"
        ? callback(null, true)
        : callback(null, false),
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);
app.use(
  express.json({
    limit: "1mb",
    type: "application/json",
  }),
);
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.get("/api/storage-status", (_req, res) =>
  res.json({
    persistent: db.remote || !isVercel,
    writable: true,
  }),
);
app.use("/api", createApiLimiter());
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
  async (req, res, next) => {
    try {
      const header = req.headers.authorization || "";
      if (!header.startsWith("Bearer ")) throw new Error();
      const tokenUser = jwt.verify(header.slice(7), secret, {
          algorithms: ["HS256"],
          issuer: "cores-fragrancias-api",
          audience: "cores-fragrancias-web",
        }),
        current = await db
          .prepare(
            "SELECT id,username,role,name,session_version FROM users WHERE id=?",
          )
          .get(tokenUser.id);
      if (!current || tokenUser.session_version !== current.session_version)
        throw new Error();
      req.user = safeUser(current);
      if (roles.length && !roles.includes(current.role))
        return res.status(403).json({
          error: "Seu perfil não possui permissão para esta ação",
        });
      next();
    } catch (error) {
      if (
        error.message &&
        !["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(
          error.name,
        )
      )
        return next(error);
      res.status(401).json({
        error: "Sessão inválida ou expirada",
      });
    }
  };
const productJson = (p) => ({
  ...p,
  image: undefined,
  image_url: p.image ? `/api/products/${p.id}/image` : null,
});
const loginLimiter = createLoginLimiter();
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
  Buffer.byteLength(value, "utf8") <= 72 &&
  /[a-z]/.test(value) &&
  /[A-Z]/.test(value) &&
  /\d/.test(value);
const normalizeUser = (body) => ({
  username: clean(body.username, 40).toLowerCase(),
  password: body.password || "",
  role: clean(body.role, 20),
  name: clean(body.name, 120),
  birth_date: dateValue(body.birth_date),
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
  if (u.birth_date && u.birth_date > storeToday())
    return "Nascimento não pode estar no futuro";
  if (!validEmail(u.email)) return "E-mail inválido";
  if (!isEdit || u.password) {
    if (!validPassword(u.password))
      return "A senha deve ter entre 8 e 72 caracteres, com letra maiúscula, minúscula e número";
  }
  return null;
};
const sessionResponse = (u) => ({
  user: safeUser(u),
  token: jwt.sign({ id: u.id, session_version: u.session_version }, secret, {
    algorithm: "HS256",
    expiresIn: "8h",
    issuer: "cores-fragrancias-api",
    audience: "cores-fragrancias-web",
    subject: String(u.id),
  }),
});
const login = async (req, res) => {
  const username = clean(req.body?.username, 40).toLowerCase(),
    password = String(req.body?.password || "");
  if (Buffer.byteLength(password, "utf8") > 72)
    return res.status(401).json({
      error: "Usuário ou senha incorretos",
    });
  const u = await db
    .prepare("SELECT * FROM users WHERE username=?")
    .get(username);
  const hash =
    u?.password ||
    "$2b$10$C6UzMDM.H6dfI/f/IKxGhu8djhL4qSP2jB5N1.klM2.V5iQn.7gNi";
  if (
    !(await bcrypt.compare(password, hash)) ||
    !u ||
    (req.path === "/api/customer/login" && u.role !== "cliente") ||
    (req.body?.portal === "admin" && !["admin", "funcionario"].includes(u.role))
  )
    return res.status(401).json({
      error: "Usuário ou senha incorretos",
    });
  res.set("Cache-Control", "no-store").json(sessionResponse(u));
};
app.post("/api/login", loginLimiter, login);
app.post("/api/customer/login", loginLimiter, login);
app.post(
  "/api/customer/register",
  createRegistrationLimiter(),
  async (req, res) => {
    const b = normalizeUser({
      name: req.body?.name,
      username: req.body?.username,
      password: req.body?.password,
      email: req.body?.email,
      phone: req.body?.phone,
      role: "cliente",
    });
    const error = validateUser(b);
    if (error || !b.email) throw inputError(error || "Informe seu e-mail");
    const password = await bcrypt.hash(b.password, 12);
    const user = await db.transaction(async () => {
      if (
        await db
          .prepare("SELECT 1 FROM users WHERE lower(username)=?")
          .get(b.username)
      )
        throw inputError(
          "Esse nome de usuário já está em uso. Escolha outro.",
          409,
        );
      const created = await db
        .prepare(
          "INSERT INTO users(username,password,role,name,email,phone) VALUES(?,?,'cliente',?,?,?)",
        )
        .run(b.username, password, b.name, b.email, b.phone);
      return db
        .prepare("SELECT * FROM users WHERE id=?")
        .get(Number(created.lastInsertRowid));
    })();
    res.status(201).json(sessionResponse(user));
  },
);
app.get("/api/me", auth(), async (req, res) =>
  res.json(
    safeUser(
      await db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id),
    ),
  ),
);
app.get("/api/users/:id/image", auth(), async (req, res) => {
  if (req.user.role === "cliente" && req.user.id !== Number(req.params.id))
    throw inputError("Sem permissão para consultar esta foto", 403);
  const x = await db
    .prepare("SELECT profile_image FROM users WHERE id=?")
    .get(req.params.id);
  if (!x?.profile_image) return res.sendStatus(404);
  res
    .type(x.profile_image[0] === 0x89 ? "image/png" : "image/jpeg")
    .send(x.profile_image);
});
app.put("/api/me/image", auth(), upload.single("image"), async (req, res) => {
  if (!req.file || !["image/png", "image/jpeg"].includes(req.file.mimetype))
    return res.status(400).json({
      error: "Envie uma imagem PNG ou JPEG",
    });
  await db
    .prepare("UPDATE users SET profile_image=? WHERE id=?")
    .run(req.file.buffer, req.user.id);
  res.json(
    safeUser(
      await db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id),
    ),
  );
});
app.put(
  "/api/users/:id/image",
  auth(["admin"]),
  upload.single("image"),
  async (req, res) => {
    if (!req.file || !["image/png", "image/jpeg"].includes(req.file.mimetype))
      return res.status(400).json({
        error: "Envie uma imagem PNG ou JPEG",
      });
    const id = Number(req.params.id);
    const result = await db
      .prepare("UPDATE users SET profile_image=? WHERE id=?")
      .run(req.file.buffer, id);
    if (!result.changes)
      return res.status(404).json({
        error: "Usuário não encontrado",
      });
    res.json({
      ok: true,
    });
  },
);
let catalogSnapshot = null;
let catalogVersion = 0;
app.use("/api", (req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
    res.on("finish", () => {
      if (res.statusCode < 400) {
        catalogSnapshot = null;
        catalogVersion++;
      }
    });
  next();
});
const catalogProducts = async () => {
  if (catalogSnapshot && Date.now() - catalogSnapshot.time < 15000)
    return catalogSnapshot.items;
  const version = catalogVersion;
  const rows = await db
    .prepare(
      `SELECT id,name,brand,style,type,price,quantity,expiration_date,
    CASE WHEN length(image)>0 THEN 1 ELSE 0 END image FROM products ORDER BY id DESC`,
    )
    .all();
  const items = rows.map((p) => ({
    ...productJson(p),
    search: normalizeSearch([p.id, p.name, p.brand, p.type, p.style].join(" ")),
  }));
  if (version === catalogVersion) catalogSnapshot = { time: Date.now(), items };
  return items;
};
app.get("/api/catalog", async (req, res) => {
  const today = storeToday();
  const products = (await catalogProducts()).filter(
    (p) =>
      Number.isFinite(p.price) &&
      p.price >= 0 &&
      expirationStatus(p.expiration_date, today)?.status !== "expired",
  );
  const words = normalizeSearch(clean(req.query.q, 160))
    .split(/\s+/)
    .filter(Boolean);
  const category = clean(req.query.category, 100),
    brand = clean(req.query.brand, 100);
  const min =
    req.query.min === undefined || req.query.min === ""
      ? 0
      : numberValue(req.query.min, "Preço mínimo");
  const max =
    req.query.max === undefined || req.query.max === ""
      ? 1e9
      : numberValue(req.query.max, "Preço máximo");
  if (min > max) throw inputError("Preço mínimo maior que o máximo");
  const limit =
    req.query.limit === undefined
      ? 24
      : numberValue(req.query.limit, "Itens por página", {
          integer: true,
          min: 1,
          max: 48,
        });
  const requestedPage =
    req.query.page === undefined
      ? 1
      : numberValue(req.query.page, "Página", {
          integer: true,
          min: 1,
          max: 1e6,
        });
  let filtered = products.filter(
    (p) =>
      words.every((word) => p.search.includes(word)) &&
      (!category || p.type === category) &&
      (!brand || p.brand === brand) &&
      (req.query.stock === "all" || p.quantity > 0) &&
      p.price >= min &&
      p.price <= max,
  );
  const comparators = {
    "price-asc": (a, b) => a.price - b.price || b.id - a.id,
    "price-desc": (a, b) => b.price - a.price || b.id - a.id,
    name: (a, b) => a.name.localeCompare(b.name, "pt-BR") || b.id - a.id,
  };
  if (comparators[req.query.sort]) filtered.sort(comparators[req.query.sort]);
  const total = filtered.length,
    pages = Math.max(1, Math.ceil(total / limit)),
    page = Math.min(requestedPage, pages);
  res.json({
    items: filtered
      .slice((page - 1) * limit, page * limit)
      .map(({ search, ...p }) => p),
    total,
    page,
    pages,
    categories: [...new Set(products.map((p) => p.type).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, "pt-BR"),
    ),
    brands: [...new Set(products.map((p) => p.brand).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, "pt-BR"),
    ),
  });
});
app.get("/api/catalog/quote", auth(["cliente"]), async (req, res) => {
  let items;
  try {
    items = JSON.parse(req.query.items);
  } catch {
    throw inputError("Sacola inválida");
  }
  if (!Array.isArray(items) || !items.length || items.length > 40)
    throw inputError("Selecione de 1 a 40 produtos");
  const ids = items.map((item) =>
    numberValue(item?.id, "Produto", { integer: true, min: 1 }),
  );
  if (new Set(ids).size !== ids.length)
    throw inputError("Produto repetido na sacola");
  const products = await db
    .prepare(
      `SELECT id,name,price,quantity,expiration_date FROM products WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids);
  const today = storeToday();
  const quoted = items.map((item) => {
    const p = products.find((p) => p.id === Number(item.id));
    const quantity = numberValue(item.quantity, "Quantidade", {
      integer: true,
      min: 1,
      max: 999,
    });
    if (
      !p ||
      p.quantity < quantity ||
      expirationStatus(p.expiration_date, today)?.status === "expired"
    )
      throw inputError(
        `${p?.name || "Produto"} indisponível na quantidade solicitada. Atualize a sacola.`,
        409,
      );
    const cents = Math.round(numberValue(p.price, "Preço") * 100);
    return {
      id: p.id,
      name: p.name,
      quantity,
      unit_price_cents: cents,
      total_cents: cents * quantity,
    };
  });
  res.json({
    items: quoted,
    total_cents: quoted.reduce((sum, p) => sum + p.total_cents, 0),
  });
});
app.get("/api/products", auth(["admin", "funcionario"]), async (req, res) => {
  let rows = await db
    .prepare(
      `SELECT p.id,p.name,p.brand,p.style,p.type,p.price,p.purchase_price,p.quantity,p.expiration_date,
        CASE WHEN length(p.image)>0 THEN 1 ELSE 0 END image,
        COALESCE(s.sold_quantity,0) sold_quantity,COALESCE(s.sold_value,0) sold_value
        FROM products p LEFT JOIN (
          SELECT product_id,SUM(quantity) sold_quantity,SUM(total_value) sold_value
          FROM sales WHERE COALESCE(order_status,'')<>'Cancelado' GROUP BY product_id
        ) s ON s.product_id=p.id ORDER BY p.id DESC`,
    )
    .all();
  const q = clean(req.query.q, 200).toLowerCase();
  if (q) rows = rows.filter((p) => matchesProduct(p, q));
  res.json(rows.map(productJson));
});
app.get("/api/products/:id/image", async (req, res) => {
  const x = await db
    .prepare("SELECT image FROM products WHERE id=?")
    .get(req.params.id);
  if (!x?.image) return res.sendStatus(404);
  res.type(x.image[0] === 0x89 ? "image/png" : "image/jpeg").send(x.image);
});
app.post(
  "/api/products",
  auth(["admin", "funcionario"]),
  upload.single("image"),
  async (req, res) => {
    const b = productInput(req.body);
    if (req.file && !["image/png", "image/jpeg"].includes(req.file.mimetype))
      throw inputError("Envie uma imagem PNG ou JPEG");
    const result = await db
      .prepare(
        "INSERT INTO products(name,brand,style,type,price,purchase_price,quantity,expiration_date,image) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        b.name,
        b.brand,
        b.style,
        b.type,
        +b.price,
        b.purchase_price ?? 0,
        +b.quantity,
        b.expiration_date,
        req.file?.buffer || null,
      );
    res.status(201).json({
      id: Number(result.lastInsertRowid),
    });
  },
);
app.put(
  "/api/products/:id",
  auth(["admin", "funcionario"]),
  upload.single("image"),
  async (req, res) => {
    const b = productInput(req.body);
    if (req.file && !["image/png", "image/jpeg"].includes(req.file.mimetype))
      throw inputError("Envie uma imagem PNG ou JPEG");
    await db.transaction(async () => {
      const existing = await db
        .prepare("SELECT quantity,purchase_price FROM products WHERE id=?")
        .get(req.params.id);
      if (!existing) throw inputError("Produto não encontrado", 404);
      if (
        req.body.original_quantity != null &&
        Number(req.body.original_quantity) !== existing.quantity
      )
        throw inputError(
          "O estoque deste produto mudou. Feche a edição e atualize a lista antes de salvar.",
          409,
        );
      if (req.file)
        await db
          .prepare(
            "UPDATE products SET name=?,brand=?,style=?,type=?,price=?,purchase_price=?,quantity=?,expiration_date=?,image=? WHERE id=?",
          )
          .run(
            b.name,
            b.brand,
            b.style,
            b.type,
            +b.price,
            b.purchase_price ?? existing.purchase_price,
            +b.quantity,
            b.expiration_date,
            req.file.buffer,
            req.params.id,
          );
      else
        await db
          .prepare(
            "UPDATE products SET name=?,brand=?,style=?,type=?,price=?,purchase_price=?,quantity=?,expiration_date=? WHERE id=?",
          )
          .run(
            b.name,
            b.brand,
            b.style,
            b.type,
            +b.price,
            b.purchase_price ?? existing.purchase_price,
            +b.quantity,
            b.expiration_date,
            req.params.id,
          );
      if (b.quantity !== existing.quantity)
        await db
          .prepare(
            "INSERT INTO stock_movements(product_id,movement_type,quantity,previous_quantity,new_quantity,reason,user_id) VALUES(?,'AJUSTE',?,?,?,'Ajuste na edição do produto',?)",
          )
          .run(
            req.params.id,
            b.quantity - existing.quantity,
            existing.quantity,
            b.quantity,
            req.user.id,
          );
    })();
    res.json({
      ok: true,
    });
  },
);
app.delete("/api/products/:id", auth(["admin"]), async (req, res) => {
  const used = await db
    .prepare(
      "SELECT 1 FROM sales WHERE product_id=? UNION ALL SELECT 1 FROM stock_movements WHERE product_id=? LIMIT 1",
    )
    .get(req.params.id, req.params.id);
  if (used)
    return res.status(409).json({
      error: "Produto possui vendas ou movimentações e não pode ser excluído",
    });
  const result = await db.transaction(async () => {
    await db
      .prepare("DELETE FROM product_details WHERE product_id=?")
      .run(req.params.id);
    return db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);
  })();
  if (!result.changes)
    return res.status(404).json({
      error: "Produto não encontrado",
    });
  res.json({
    ok: true,
  });
});
const sell = db.transaction(async (data, userId) => {
  const p = await db
      .prepare("SELECT * FROM products WHERE id=?")
      .get(data.productId),
    method = await db
      .prepare("SELECT * FROM payment_methods WHERE id=? AND active=1")
      .get(data.paymentMethodId);
  if (!p) throw new Error("Produto não encontrado");
  if (expirationStatus(p.expiration_date)?.status === "expired")
    throw inputError("Produto vencido. Retire-o do estoque antes de vender.");
  if (!method) throw new Error("Forma de pagamento inválida ou desativada");
  if (
    data.customerId &&
    !(await db
      .prepare("SELECT 1 FROM users WHERE id=? AND role='cliente'")
      .get(data.customerId))
  )
    throw inputError("Cliente inválido");
  if (!Number.isFinite(p.price) || p.price < 0)
    throw inputError("Corrija o preço do produto antes de vender");
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
    orderNumber = `PED-${randomUUID()}`;
  const previousQuantity = p.quantity;
  await db
    .prepare("UPDATE products SET quantity=quantity-? WHERE id=?")
    .run(data.quantity, data.productId);
  const r = await db
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
  await db
    .prepare(
      "INSERT INTO stock_movements(product_id,movement_type,quantity,previous_quantity,new_quantity,reason,user_id,sale_id) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      p.id,
      "VENDA",
      -data.quantity,
      previousQuantity,
      previousQuantity - data.quantity,
      `Venda ${orderNumber}`,
      userId,
      Number(r.lastInsertRowid),
    );
  return {
    id: Number(r.lastInsertRowid),
    total,
    change,
    order_number: orderNumber,
  };
});
app.post("/api/sales", auth(["admin", "funcionario"]), async (req, res) => {
  try {
    const b = req.body || {},
      data = {
        productId: Number(b.product_id),
        customerId:
          b.customer_id == null || b.customer_id === ""
            ? null
            : numberValue(b.customer_id, "Cliente", {
                integer: true,
                min: 1,
              }),
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
    numberValue(data.installments, "Parcelas", {
      integer: true,
      min: 1,
      max: 24,
    });
    if (data.amountReceived !== null)
      numberValue(data.amountReceived, "Valor recebido", {
        max: 1e15,
      });
    if (
      data.status &&
      !["Concluído", "Pago", "Pendente", "Em separação"].includes(data.status)
    )
      throw inputError("Situação do pedido inválida");
    res.status(201).json(await sell(data, req.user.id));
  } catch (e) {
    res.status(400).json({
      error: e.message,
    });
  }
});
app.get("/api/sales", auth(["admin", "funcionario"]), async (req, res) =>
  res.json(
    await db
      .prepare(
        "SELECT s.*,p.name product_name,u.name user_name,c.name customer_name FROM sales s LEFT JOIN products p ON p.id=s.product_id LEFT JOIN users u ON u.id=s.user_id LEFT JOIN users c ON c.id=s.customer_id ORDER BY sale_date DESC",
      )
      .all(),
  ),
);
app.post("/api/sales/:id/cancel", auth(["admin"]), async (req, res) => {
  if (
    await db
      .prepare("SELECT 1 FROM web_order_items WHERE sale_id=?")
      .get(req.params.id)
  )
    throw inputError(
      "Esta venda pertence a um pedido online. Solicite o reembolso na tela Pedidos online.",
      409,
    );
  try {
    const result = await db.transaction(async () => {
      const sale = await db
        .prepare("SELECT * FROM sales WHERE id=?")
        .get(req.params.id);
      if (!sale) throw new Error("Venda não encontrada");
      if (sale.order_status === "Cancelado")
        throw new Error("Venda já cancelada");
      const product = await db
        .prepare("SELECT id,quantity FROM products WHERE id=?")
        .get(sale.product_id);
      if (!product) throw new Error("Produto da venda não encontrado");
      const nextQuantity = product.quantity + sale.quantity;
      await db
        .prepare("UPDATE products SET quantity=? WHERE id=?")
        .run(nextQuantity, product.id);
      await db
        .prepare("UPDATE sales SET order_status='Cancelado' WHERE id=?")
        .run(sale.id);
      await db
        .prepare(
          "INSERT INTO stock_movements(product_id,movement_type,quantity,previous_quantity,new_quantity,reason,user_id,sale_id) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          product.id,
          "CANCELAMENTO",
          sale.quantity,
          product.quantity,
          nextQuantity,
          clean(req.body?.reason, 200) ||
            `Cancelamento da venda ${sale.order_number || sale.id}`,
          req.user.id,
          sale.id,
        );
      return {
        ok: true,
        stock: nextQuantity,
      };
    })();
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});
app.get(
  "/api/expiration-losses",
  auth(["admin", "funcionario"]),
  async (_req, res) => {
    const items = await db
      .prepare(
        `SELECT l.*,u.name user_name FROM expiration_losses l
    LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC`,
      )
      .all();
    res.json({
      items,
      total_cents: items.reduce((sum, item) => sum + item.total_cents, 0),
    });
  },
);
app.post(
  "/api/expiration-losses",
  auth(["admin", "funcionario"]),
  async (req, res) => {
    const ids = req.body?.product_ids;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 5000 ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 1) ||
      new Set(ids).size !== ids.length
    )
      throw inputError("Selecione produtos vencidos válidos");
    const result = await db.transaction(async () => {
      const today = storeToday();
      let total = 0;
      for (const id of ids) {
        const product = await db
          .prepare("SELECT * FROM products WHERE id=?")
          .get(id);
        if (
          !product ||
          product.quantity <= 0 ||
          expirationStatus(product.expiration_date, today)?.status !== "expired"
        )
          throw inputError(
            "A lista mudou. Atualize e selecione apenas produtos vencidos com estoque.",
            409,
          );
        const cents = Math.round(numberValue(product.price, "Preço") * 100);
        const quantity = numberValue(product.quantity, "Quantidade", {
          integer: true,
          min: 1,
        });
        const loss = cents * quantity;
        if (!Number.isSafeInteger(loss) || !Number.isSafeInteger(total + loss))
          throw inputError("Valor total acima do limite permitido");
        await db
          .prepare(
            `INSERT INTO expiration_losses(product_id,product_name,expiration_date,quantity,unit_price_cents,total_cents,user_id)
        VALUES(?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            product.name,
            product.expiration_date,
            quantity,
            cents,
            loss,
            req.user.id,
          );
        await db
          .prepare(
            `INSERT INTO stock_movements(product_id,movement_type,quantity,previous_quantity,new_quantity,reason,user_id)
        VALUES(?,'SAIDA',?,?,0,'Retirada por vencimento',?)`,
          )
          .run(id, -quantity, quantity, req.user.id);
        await db.prepare("UPDATE products SET quantity=0 WHERE id=?").run(id);
        total += loss;
      }
      return { count: ids.length, total_cents: total };
    })();
    res.status(201).json(result);
  },
);
app.get(
  "/api/stock-movements",
  auth(["admin", "funcionario"]),
  async (_req, res) =>
    res.json(
      await db
        .prepare(
          `SELECT m.*,p.name product_name,u.name user_name
           FROM stock_movements m
           JOIN products p ON p.id=m.product_id
           LEFT JOIN users u ON u.id=m.user_id
           ORDER BY m.id DESC LIMIT 200`,
        )
        .all(),
    ),
);
app.post(
  "/api/stock-movements",
  auth(["admin", "funcionario"]),
  async (req, res) => {
    try {
      const productId = Number(req.body?.product_id),
        amount = Number(req.body?.quantity),
        type = String(req.body?.movement_type || "").toUpperCase(),
        reason = clean(req.body?.reason, 200);
      if (!Number.isInteger(amount) || amount < 1)
        throw new Error("Informe uma quantidade inteira maior que zero");
      if (!["ENTRADA", "SAIDA", "AJUSTE"].includes(type))
        throw new Error("Tipo de movimentação inválido");
      if (reason.length < 3)
        throw new Error("Informe o motivo da movimentação");
      const result = await db.transaction(async () => {
        const product = await db
          .prepare("SELECT id,quantity FROM products WHERE id=?")
          .get(productId);
        if (!product) throw new Error("Produto não encontrado");
        const delta = type === "SAIDA" ? -amount : amount,
          nextQuantity = product.quantity + delta;
        if (nextQuantity < 0)
          throw new Error("Estoque insuficiente para esta saída");
        numberValue(nextQuantity, "Saldo de estoque", {
          integer: true,
        });
        await db
          .prepare("UPDATE products SET quantity=? WHERE id=?")
          .run(nextQuantity, product.id);
        const movement = await db
          .prepare(
            "INSERT INTO stock_movements(product_id,movement_type,quantity,previous_quantity,new_quantity,reason,user_id) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            product.id,
            type,
            delta,
            product.quantity,
            nextQuantity,
            reason,
            req.user.id,
          );
        return {
          id: Number(movement.lastInsertRowid),
          stock: nextQuantity,
        };
      })();
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({
        error: error.message,
      });
    }
  },
);
app.get(
  "/api/payment-methods",
  auth(["admin", "funcionario"]),
  async (_req, res) =>
    res.json(
      await db
        .prepare("SELECT * FROM payment_methods ORDER BY active DESC,code")
        .all(),
    ),
);
app.put("/api/payment-methods/:id", auth(["admin"]), async (req, res) => {
  const id = Number(req.params.id),
    b = req.body || {},
    method = await db
      .prepare("SELECT * FROM payment_methods WHERE id=?")
      .get(id);
  if (!method)
    return res.status(404).json({
      error: "Forma de pagamento não encontrada",
    });
  const name = clean(b.name, 80),
    maxInstallments = numberValue(b.max_installments, "Parcelas", {
      integer: true,
      min: 1,
      max: 24,
    }),
    instructions = clean(b.instructions, 500);
  if (name.length < 2)
    return res.status(400).json({
      error: "Nome inválido",
    });
  await db
    .prepare(
      "UPDATE payment_methods SET name=?,active=?,requires_reference=?,max_installments=?,instructions=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .run(
      name,
      b.active ? 1 : 0,
      b.requires_reference ? 1 : 0,
      maxInstallments,
      instructions,
      id,
    );
  res.json({
    ok: true,
  });
});
app.get("/api/dashboard", auth(["admin", "funcionario"]), async (req, res) => {
  const expirationLosses = await db
    .prepare(
      `SELECT COALESCE(SUM(total_cents),0) total_cents,
      COALESCE(SUM(quantity),0) quantity,COUNT(DISTINCT product_id) products
      FROM expiration_losses`,
    )
    .get();
  const summary = await db
    .prepare(
      "SELECT COUNT(*) products,COALESCE(SUM(quantity),0) stock,COALESCE(SUM(price*quantity),0) stock_value FROM products",
    )
    .get();
  const sales = await db
    .prepare(
      "SELECT COUNT(*) sales_count,COALESCE(SUM(quantity),0) sold_quantity,COALESCE(SUM(total_value),0) revenue FROM sales WHERE COALESCE(order_status,'')<>'Cancelado'",
    )
    .get();
  const low = await db
    .prepare(
      "SELECT id,name,quantity FROM products WHERE quantity<=5 ORDER BY quantity,name LIMIT 20",
    )
    .all();
  const chart = (
    await db
      .prepare(
        "SELECT substr(sale_date,1,10) date,SUM(total_value) value FROM sales WHERE COALESCE(order_status,'')<>'Cancelado' GROUP BY substr(sale_date,1,10) ORDER BY date DESC LIMIT 14",
      )
      .all()
  ).reverse();
  const birthdays = (
    await db
      .prepare(
        "SELECT id,name,phone,email,birth_date FROM users WHERE role='cliente' AND birth_date IS NOT NULL",
      )
      .all()
  ).filter((x) => x.birth_date?.slice(5) === storeToday().slice(5));
  const expirationProducts = await db
    .prepare(
      "SELECT id,name,quantity,expiration_date FROM products WHERE quantity>0 AND expiration_date IS NOT NULL AND expiration_date<>'' ORDER BY expiration_date,id DESC",
    )
    .all();
  res.json({
    ...summary,
    ...sales,
    expirationLosses,
    low,
    chart,
    birthdays,
    expirationProducts,
  });
});
app.get("/api/users", auth(["admin", "funcionario"]), async (_req, res) =>
  res.json(
    (await db.prepare("SELECT * FROM users ORDER BY name").all()).map(safeUser),
  ),
);
app.post("/api/users", auth(["admin"]), async (req, res) => {
  try {
    const b = normalizeUser(req.body),
      error = validateUser(b);
    if (error)
      return res.status(400).json({
        error,
      });
    const hash = await bcrypt.hash(b.password, 12);
    const r = await db
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
    res.status(201).json({
      id: Number(r.lastInsertRowid),
    });
  } catch (e) {
    res.status(400).json({
      error:
        e.code === "SQLITE_CONSTRAINT_UNIQUE"
          ? "Este nome de usuário já está cadastrado"
          : e.status
            ? e.message
            : "Não foi possível criar o usuário",
    });
  }
});
app.put("/api/users/:id", auth(["admin"]), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id))
      return res.status(400).json({
        error: "Identificador inválido",
      });
    const existing = await db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if (!existing)
      return res.status(404).json({
        error: "Usuário não encontrado",
      });
    const b = normalizeUser(req.body),
      error = validateUser(b, true);
    if (error)
      return res.status(400).json({
        error,
      });
    if (
      existing.role === "admin" &&
      b.role !== "admin" &&
      (
        await db
          .prepare("SELECT COUNT(*) count FROM users WHERE role='admin'")
          .get()
      ).count <= 1
    )
      return res.status(400).json({
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
      await db
        .prepare(
          "UPDATE users SET username=?,role=?,name=?,birth_date=?,email=?,phone=?,cpf=?,preferred_type=?,preferred_brand=?,preferred_style=?,password=?,session_version=session_version+1 WHERE id=?",
        )
        .run(...values);
    } else {
      values.push(id);
      await db
        .prepare(
          "UPDATE users SET username=?,role=?,name=?,birth_date=?,email=?,phone=?,cpf=?,preferred_type=?,preferred_brand=?,preferred_style=? WHERE id=?",
        )
        .run(...values);
    }
    res.json({
      ok: true,
    });
  } catch (e) {
    res.status(400).json({
      error:
        e.code === "SQLITE_CONSTRAINT_UNIQUE"
          ? "Este nome de usuário já está cadastrado"
          : e.status
            ? e.message
            : "Não foi possível atualizar o usuário",
    });
  }
});
app.delete("/api/users/:id", auth(["admin"]), async (req, res) => {
  const id = Number(req.params.id),
    target = await db.prepare("SELECT role FROM users WHERE id=?").get(id);
  if (id === req.user.id)
    return res.status(400).json({
      error: "Você não pode excluir seu próprio usuário",
    });
  if (!target)
    return res.status(404).json({
      error: "Usuário não encontrado",
    });
  if (
    await db
      .prepare(
        "SELECT 1 FROM sales WHERE user_id=? OR customer_id=? UNION ALL SELECT 1 FROM stock_movements WHERE user_id=? LIMIT 1",
      )
      .get(id, id, id)
  )
    return res.status(409).json({
      error:
        "Este usuário possui vendas ou movimentações vinculadas e não pode ser excluído",
    });
  if (
    target.role === "admin" &&
    (
      await db
        .prepare("SELECT COUNT(*) count FROM users WHERE role='admin'")
        .get()
    ).count <= 1
  )
    return res.status(400).json({
      error: "O sistema precisa manter pelo menos um administrador",
    });
  try {
    await db.prepare("DELETE FROM users WHERE id=?").run(id);
    res.json({
      ok: true,
    });
  } catch {
    return res.status(409).json({
      error: "Este usuário possui vendas vinculadas e não pode ser excluído",
    });
  }
});
app.get(
  "/api/export/products.csv",
  auth(["admin", "funcionario"]),
  async (_req, res) => {
    const rows = await db
      .prepare(
        "SELECT id,name nome,brand marca,style estilo,type tipo,price preco,quantity quantidade,expiration_date data_validade FROM products",
      )
      .all();
    res
      .attachment("produtos.csv")
      .send("\ufeff" + Papa.unparse(rows, { escapeFormulae: true }));
  },
);
app.get(
  "/api/export/sales.csv",
  auth(["admin", "funcionario"]),
  async (_req, res) => {
    const rows = await db
      .prepare(
        `SELECT s.id,s.order_number pedido,s.sale_date data,p.name produto,
          s.quantity quantidade,s.total_value total,s.payment_method pagamento,
          s.order_status situacao,u.name atendente,c.name cliente
         FROM sales s
         LEFT JOIN products p ON p.id=s.product_id
         LEFT JOIN users u ON u.id=s.user_id
         LEFT JOIN users c ON c.id=s.customer_id
         ORDER BY s.sale_date DESC`,
      )
      .all();
    res
      .attachment("vendas.csv")
      .send("\ufeff" + Papa.unparse(rows, { escapeFormulae: true }));
  },
);
app.get(
  "/api/export/products.pdf",
  auth(["admin", "funcionario"]),
  async (_req, res) => {
    const losses = await db
      .prepare("SELECT * FROM expiration_losses ORDER BY id DESC")
      .all();
    const products = await db
      .prepare(
        `SELECT p.id,p.name,p.brand,p.style,p.type,p.price,p.purchase_price,p.quantity,p.expiration_date,COALESCE(SUM(CASE WHEN s.order_status='Cancelado' THEN 0 ELSE s.quantity END),0) sold_quantity FROM products p LEFT JOIN sales s ON s.product_id=p.id GROUP BY p.id ORDER BY COALESCE(p.type,'Sem tipo'),p.brand,p.name`,
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
    const logoPath = path.join(root, "client/public/assets/logo1.jpeg");
    const issuedAt = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    const header = () => {
      doc.save();
      doc.rect(0, 0, doc.page.width, 119).fill("#fbf6e7");
      doc.image(logoPath, 38, 20, {
        fit: [82, 82],
        align: "center",
        valign: "center",
      });
      doc
        .font("Helvetica-Bold")
        .fontSize(17)
        .fillColor("#382c25")
        .text("Cores & Fragrâncias", 138, 29, { width: 419 });
      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor("#99623d")
        .text("by Berenice", 138, 51, { width: 419 });
      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor("#382c25")
        .text("Relatório de produtos, vendas e perdas", 138, 73, {
          width: 419,
        });
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#6f625a")
        .text(`Emitido em ${issuedAt} | Horário de Brasília`, 138, 93, {
          width: 419,
        });
      doc.moveTo(38, 119).lineTo(557, 119).strokeColor("#c5a76c").stroke();
      doc.restore();
      doc.x = 38;
      doc.y = 140;
    };
    doc.on("pageAdded", header);
    header();
    const stockUnits = products.reduce((sum, p) => sum + p.quantity, 0);
    const soldUnits = products.reduce((sum, p) => sum + p.sold_quantity, 0);
    const totalLoss = losses.reduce((sum, row) => sum + row.total_cents, 0);
    const summary = [
      ["PRODUTOS", String(products.length)],
      ["EM ESTOQUE", `${stockUnits} un.`],
      ["VENDIDOS", `${soldUnits} un.`],
      ["PERDAS REGISTRADAS", brl(totalLoss / 100)],
    ];
    summary.forEach(([label, value], index) => {
      const x = 38 + index * 132;
      doc.roundedRect(x, 140, 123, 53, 5).fill("#f7f3ed");
      doc
        .font("Helvetica-Bold")
        .fontSize(7)
        .fillColor("#6f625a")
        .text(label, x + 10, 151, { width: 103 });
      doc
        .fontSize(12)
        .fillColor("#382c25")
        .text(value, x + 10, 168, { width: 103 });
    });
    doc.x = 38;
    doc.y = 210;
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
      doc.font("Helvetica-Bold").fontSize(9.5);
      const productHeight =
        doc.heightOfString(`#${product.id}  ${product.name}`, { width: 519 }) +
        doc
          .font("Helvetica")
          .fontSize(8.5)
          .heightOfString(
            `Marca: ${product.brand || "—"}  |  Estilo: ${product.style || "—"}`,
            { width: 519 },
          ) +
        55;
      if (doc.y + productHeight > 765) doc.addPage();
      doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor("#29231f")
        .text(`#${product.id}  ${product.name}`, {
          continued: false,
        });
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor("#5f544d")
        .text(
          `Marca: ${product.brand || "—"}  |  Estilo: ${product.style || "—"} `,
        );
      doc.text(
        `Compra: ${brl(product.purchase_price)}  |  Venda: ${brl(product.price)}`,
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
    const today = storeToday();
    const expiredStock = products.filter(
      (product) =>
        product.quantity > 0 &&
        expirationStatus(product.expiration_date, today)?.status === "expired",
    );
    const lossSection = (title, description, rows) => {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#382c25").text(title);
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#5f544d")
        .text(description)
        .moveDown();
      let units = 0,
        totalCents = 0;
      for (const row of rows) {
        const name = `#${row.product_id}  ${row.product_name}`;
        const detail = `Quantidade: ${row.quantity} un. | Valor unitário: ${brl(row.unit_price_cents / 100)} | Valor total: ${brl(row.total_cents / 100)}`;
        const dates = `Validade: ${row.expiration_date}${row.created_at ? ` | Retirada: ${row.created_at}` : ""}`;
        doc.font("Helvetica-Bold").fontSize(10);
        const height =
          doc.heightOfString(name, { width: 519 }) +
          doc.heightOfString(detail, { width: 519 }) +
          doc.heightOfString(dates, { width: 519 }) +
          28;
        if (doc.y + height > 770) {
          doc.addPage();
          doc
            .font("Helvetica-Bold")
            .fontSize(12)
            .text(`${title} (continuação)`)
            .moveDown();
        }
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#29231f").text(name);
        doc.font("Helvetica").fontSize(9).text(detail).text(dates).moveDown();
        units += row.quantity;
        totalCents += row.total_cents;
      }
      if (!rows.length)
        doc.font("Helvetica").fontSize(10).text("Nenhum registro.").moveDown();
      if (doc.y > 730) doc.addPage();
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#382c25")
        .text(`Total: ${units} unidades | ${brl(totalCents / 100)}`);
    };
    lossSection(
      "Perdas por vencimento — retiradas registradas",
      "Histórico acumulado. Valores pelo preço de venda no momento da baixa, não pelo custo de compra.",
      losses,
    );
    lossSection(
      "Produtos vencidos ainda em estoque",
      `Aguardam retirada em ${today}. Valores estimados pelo preço de venda atual; não somados às perdas já registradas.`,
      expiredStock.map((product) => {
        const cents = Math.round(product.price * 100);
        return {
          product_id: product.id,
          product_name: product.name,
          quantity: product.quantity,
          expiration_date: product.expiration_date,
          unit_price_cents: cents,
          total_cents: cents * product.quantity,
        };
      }),
    );
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
          785,
          {
            width: 519,
            align: "center",
            lineBreak: false,
          },
        );
    }
    doc.end();
  },
);
app.post(
  "/api/import/products",
  auth(["admin", "funcionario"]),
  upload.single("file"),
  async (req, res) => {
    if (!req.file)
      return res.status(400).json({
        error: "Envie um CSV",
      });
    const parsed = Papa.parse(req.file.buffer.toString("utf8"), {
      header: true,
      skipEmptyLines: true,
    });
    if (parsed.errors.length)
      throw inputError(
        "CSV inválido: confira as colunas e as aspas do arquivo",
      );
    if (!parsed.meta.fields?.includes("nome"))
      throw inputError(
        "O CSV precisa da coluna nome. Use o arquivo exportado como modelo",
      );
    const upsert = db.prepare(
      "INSERT INTO products(id,name,brand,style,type,price,quantity,expiration_date) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,brand=excluded.brand,style=excluded.style,type=excluded.type,price=excluded.price,quantity=excluded.quantity,expiration_date=excluded.expiration_date",
    );
    const insert = db.prepare(
      "INSERT INTO products(name,brand,style,type,price,quantity,expiration_date) VALUES(?,?,?,?,?,?,?)",
    );
    let count = 0;
    await db.transaction(async () => {
      for (const [index, x] of parsed.data.entries()) {
        let product;
        try {
          product = productInput({
            name: x.nome,
            brand: x.marca || "Outra",
            style: x.estilo || "Outro",
            type: x.tipo || "Outro",
            price: String(x.preco ?? "").replace(",", "."),
            quantity: x.quantidade,
            expiration_date: x.data_validade,
          });
        } catch (error) {
          throw inputError(`Linha ${index + 2}: ${error.message}`);
        }
        const vals = [
          product.name,
          product.brand,
          product.style,
          product.type,
          product.price,
          product.quantity,
          product.expiration_date,
        ];
        const id = x.id
          ? numberValue(x.id, "Código do produto", {
              integer: true,
              min: 1,
            })
          : null;
        const previous = id
          ? await db.prepare("SELECT quantity FROM products WHERE id=?").get(id)
          : null;
        id ? await upsert.run(id, ...vals) : await insert.run(...vals);
        if (previous && previous.quantity !== product.quantity)
          await db
            .prepare(
              "INSERT INTO stock_movements(product_id,movement_type,quantity,previous_quantity,new_quantity,reason,user_id) VALUES(?,'AJUSTE',?,?,?,'Ajuste na importação CSV',?)",
            )
            .run(
              id,
              product.quantity - previous.quantity,
              previous.quantity,
              product.quantity,
              req.user.id,
            );
        count++;
      }
    })();
    res.json({
      count,
      errors: parsed.errors,
    });
  },
);
app.put(
  "/api/customer/password",
  auth(["cliente"]),
  createRegistrationLimiter(),
  async (req, res) => {
    const b = req.body || {};
    if (!validPassword(b.password))
      throw inputError(
        "Nova senha: 8 a 72 caracteres, com maiúscula, minúscula e número",
      );
    const current = await db
      .prepare("SELECT password FROM users WHERE id=?")
      .get(req.user.id);
    if (
      typeof b.current_password !== "string" ||
      b.current_password.length > 72 ||
      !(await bcrypt.compare(b.current_password, current.password))
    )
      throw inputError("Senha atual incorreta", 403);
    const hash = await bcrypt.hash(b.password, 12);
    const r = await db
      .prepare(
        "UPDATE users SET password=?,session_version=session_version+1 WHERE id=? AND password=?",
      )
      .run(hash, req.user.id, current.password);
    if (!r.changes)
      throw inputError(
        "A senha foi alterada em outra sessão. Entre novamente.",
        409,
      );
    res.json({ ok: true });
  },
);
await installCommerce(app, { db, auth, safeUser });
app.use(express.static(path.join(root, "dist")));
app.get("/{*splat}", (req, res, next) =>
  req.path.startsWith("/api")
    ? next()
    : res.sendFile(path.join(root, "dist/index.html")),
);
app.use("/api", (_req, res) =>
  res.status(404).json({
    error: "Rota não encontrada",
  }),
);
app.use((err, _req, res, _next) => {
  if (res.headersSent) return res.end();
  const status =
    err instanceof multer.MulterError
      ? err.code === "LIMIT_FILE_SIZE"
        ? 413
        : 400
      : err.status || 500;
  res.status(status).json({
    error:
      err.code === "LIMIT_FILE_SIZE"
        ? "Arquivo excede o limite de 4 MB"
        : status < 500
          ? err.message
          : "Não foi possível concluir a operação",
  });
});
if (
  (!isVercel || process.env.FORCE_LISTEN === "1") &&
  process.env.NODE_ENV !== "test"
)
  app.listen(process.env.PORT || 3001, () =>
    console.log(`Aplicação em http://localhost:${process.env.PORT || 3001}`),
  );
export default app;
export const testDatabase = db.native;
export { db as database };

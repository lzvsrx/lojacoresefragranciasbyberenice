import { randomBytes, createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { inputError } from "./validation.js";

export const productionMode = (env = process.env) =>
  env.NODE_ENV !== "test" &&
  (env.NODE_ENV === "production" || Boolean(env.VERCEL));

export function securityConfig(env = process.env) {
  const production = productionMode(env);
  const origins = new Set();
  for (const raw of [
    env.PUBLIC_BASE_URL,
    ...(env.CORS_ORIGINS || "").split(","),
  ].filter(Boolean)) {
    let url;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new Error("Origem pública inválida na configuração");
    }
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !["http:", "https:"].includes(url.protocol) ||
      (production && url.protocol !== "https:")
    )
      throw new Error(
        "As origens devem conter somente protocolo e domínio; produção exige HTTPS",
      );
    origins.add(url.origin);
  }
  if (production && !env.PUBLIC_BASE_URL)
    throw new Error("PUBLIC_BASE_URL HTTPS é obrigatória em produção");
  const trustProxy =
    env.TRUST_PROXY_HOPS === undefined
      ? env.VERCEL
        ? 1
        : false
      : Number(env.TRUST_PROXY_HOPS);
  if (
    trustProxy !== false &&
    (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 5)
  )
    throw new Error("TRUST_PROXY_HOPS deve ser um inteiro de 0 a 5");
  return {
    production,
    trustProxy,
    allowedOrigin: (origin) =>
      typeof origin === "string" &&
      (origins.has(origin) ||
        (!production &&
          /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))),
  };
}

export function signingSecret(env, folder, production) {
  let secret = env.JWT_SECRET;
  if (
    secret &&
    (Buffer.byteLength(secret) < 48 ||
      new Set(secret).size < 16 ||
      /substitua|example|change.?me|isolated-regression|test-commerce/i.test(
        secret,
      ))
  ) {
    if (env.NODE_ENV !== "test")
      throw new Error(
        "JWT_SECRET deve ser aleatória, com pelo menos 48 bytes e sem valores de exemplo",
      );
  }
  if (!secret && production)
    throw new Error("JWT_SECRET é obrigatória em produção");
  if (!secret) {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const file = path.join(folder, ".jwt-secret");
    if (!existsSync(file))
      writeFileSync(file, randomBytes(48).toString("hex"), {
        flag: "wx",
        mode: 0o600,
      });
    secret = readFileSync(file, "utf8").trim();
    if (Buffer.byteLength(secret) < 48)
      throw new Error("Chave local inválida; gere uma nova chave de sessão");
  }
  return secret;
}

export function requestProtection(config) {
  return (req, res, next) => {
    req.requestId = randomUUID();
    res.set("X-Request-Id", req.requestId);
    if (config.production && !req.secure)
      return res
        .status(426)
        .json({ error: "Use HTTPS para acessar a aplicação" });
    if (req.path.startsWith("/api")) {
      res.set("Cache-Control", "no-store");
      const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      const signedWebhook =
        req.method === "POST" && req.path === "/api/mercado-pago/webhook";
      const origin = req.get("origin");
      if (
        unsafe &&
        !signedWebhook &&
        ((origin && !config.allowedOrigin(origin)) ||
          req.get("sec-fetch-site") === "cross-site")
      )
        return res
          .status(403)
          .json({ error: "Origem da requisição não autorizada" });
      const type = req.get("content-type") || "";
      if (
        unsafe &&
        (req.headers["transfer-encoding"] ||
          Number(req.headers["content-length"]) > 0) &&
        !/^(application\/json|multipart\/form-data)(;|$)/i.test(type)
      )
        return res
          .status(415)
          .json({ error: "Envie JSON ou formulário multipart" });
    }
    next();
  };
}

export async function installSecurityTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions(id_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),portal TEXT NOT NULL,expires_at INTEGER NOT NULL,last_seen INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS security_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,request_id TEXT,user_id INTEGER,action TEXT NOT NULL,target TEXT,ip_hash TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS security_audit_created ON security_audit(created_at);
    CREATE TABLE IF NOT EXISTS security_rate_limits(key TEXT PRIMARY KEY,total INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS security_rate_limits_expiry ON security_rate_limits(expires_at);
  `);
}

export const digest = (value, secret) =>
  createHmac("sha256", secret).update(String(value)).digest("hex");

export function auditWriter(db, secret) {
  return async (
    req,
    action,
    userId = req.user?.id,
    target = req.route?.path || req.path,
  ) => {
    await db
      .prepare(
        "INSERT INTO security_audit(created_at,request_id,user_id,action,target,ip_hash) VALUES(?,?,?,?,?,?)",
      )
      .run(
        new Date().toISOString(),
        req.requestId || null,
        userId || null,
        action,
        target?.slice(0, 200) || null,
        digest(req.ip || "unknown", secret),
      );
  };
}

export function requireCookieOrigin(req, config) {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    (!config.allowedOrigin(req.get("origin")) ||
      !["admin", "customer"].includes(req.get("x-session-portal")))
  )
    throw inputError("Confirme a origem e o portal da requisição", 403);
}

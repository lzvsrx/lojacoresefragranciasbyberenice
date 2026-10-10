import { rateLimit, ipKeyGenerator } from "express-rate-limit";

const loginKey = (req) =>
  JSON.stringify([
    ipKeyGenerator(req.ip),
    String(req.body?.username ?? "")
      .trim()
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .slice(0, 40)
      .toLowerCase(),
  ]);

export const createLoginLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: loginKey,
    handler: (req, res) => {
      const seconds = Math.max(
        1,
        Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000),
      );
      res.status(429).json({
        error: `Muitas tentativas incorretas para este usuário. Tente novamente em ${Math.ceil(seconds / 60)} minuto(s).`,
        retryAfter: seconds,
      });
    },
  });

export const createApiLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 500,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Login has its own limit; catalog images must not exhaust the API quota.
    skip: (req) =>
      (req.method === "POST" &&
        ["/login", "/customer/login"].includes(req.path)) ||
      ((req.method === "GET" || req.method === "HEAD") &&
        /^\/(products|users)\/\d+\/image\/?$/.test(req.path)),
    message: { error: "Limite temporário de requisições excedido" },
  });

export const createRegistrationLimiter = () =>
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error:
        "Muitas tentativas de cadastro. Aguarde antes de tentar novamente.",
    },
  });

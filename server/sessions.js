import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { digest, requireCookieOrigin } from "./security.js";
import { inputError } from "./validation.js";

export function sessionService({ db, secret, config, safeUser, audit }) {
  const name = (portal) => `${config.production ? "__Host-" : ""}cf_${portal}`;
  const cookieOptions = {
    httpOnly: true,
    secure: config.production,
    sameSite: "lax",
    path: "/",
  };
  const portalFor = (req) =>
    req.get("x-session-portal") === "customer" ||
    req.path.startsWith("/api/customer/")
      ? "customer"
      : "admin";
  const issue = async (u, req, res) => {
    const portal = u.role === "cliente" ? "customer" : "admin";
    const lifetime = portal === "admin" ? 60 * 60 : 8 * 60 * 60;
    const now = Date.now();
    const token = jwt.sign(
      { id: u.id, session_version: u.session_version, portal },
      secret,
      {
        algorithm: "HS256",
        expiresIn: lifetime,
        issuer: "cores-fragrancias-api",
        audience: "cores-fragrancias-web",
        subject: String(u.id),
        jwtid: randomUUID(),
      },
    );
    await db.transaction(async () => {
      await db
        .prepare("DELETE FROM auth_sessions WHERE expires_at<=?")
        .run(now);
      await db
        .prepare(
          "DELETE FROM auth_sessions WHERE user_id=? AND id_hash NOT IN (SELECT id_hash FROM auth_sessions WHERE user_id=? ORDER BY last_seen DESC LIMIT 4)",
        )
        .run(u.id, u.id);
      await db
        .prepare(
          "INSERT INTO auth_sessions(id_hash,user_id,portal,expires_at,last_seen) VALUES(?,?,?,?,?)",
        )
        .run(digest(token, secret), u.id, portal, now + lifetime * 1000, now);
      await db
        .prepare("DELETE FROM security_audit WHERE created_at<?")
        .run(new Date(now - 90 * 86400000).toISOString());
      await audit(req, "session.created", u.id, portal);
    })();
    res.cookie(name(portal), token, {
      ...cookieOptions,
      maxAge: lifetime * 1000,
    });
    // Browser clients receive only an HttpOnly cookie. Bearer tokens remain available
    // for explicitly non-browser API clients and the existing integration tests.
    return {
      user: safeUser(u),
      ...(!req.get("x-session-portal") &&
      !req.get("origin") &&
      !req.get("sec-fetch-site")
        ? { token }
        : {}),
    };
  };
  const authenticate =
    (roles = []) =>
    async (req, _res, next) => {
      try {
        const authorization = req.get("authorization");
        const portal = portalFor(req);
        let token;
        if (authorization !== undefined) {
          if (
            !/^Bearer [A-Za-z0-9._-]+$/.test(authorization) ||
            authorization.length > 2048
          )
            throw inputError("Sessão inválida ou expirada", 401);
          token = authorization.slice(7);
        } else {
          const cookies = (req.headers.cookie || "")
            .split(";")
            .map((part) => part.trim().split("="));
          const values = cookies.filter(([key]) => key === name(portal));
          if (values.length !== 1 || values[0][1]?.length > 2048)
            throw inputError("Sessão inválida ou expirada", 401);
          token = values[0][1];
          requireCookieOrigin(req, config);
        }
        let claims;
        try {
          claims = jwt.verify(token, secret, {
            algorithms: ["HS256"],
            issuer: "cores-fragrancias-api",
            audience: "cores-fragrancias-web",
            maxAge: "8h",
          });
        } catch {
          throw inputError("Sessão inválida ou expirada", 401);
        }
        if (
          !Number.isSafeInteger(claims.id) ||
          claims.id < 1 ||
          claims.sub !== String(claims.id) ||
          !claims.jti
        )
          throw inputError("Sessão inválida ou expirada", 401);
        const idHash = digest(token, secret);
        const current = await db
          .prepare(
            "SELECT u.id,u.username,u.role,u.name,u.session_version,s.portal,s.expires_at,s.last_seen FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE u.id=? AND s.id_hash=?",
          )
          .get(claims.id, idHash);
        const now = Date.now();
        const idle =
          current?.portal === "admin" ? 15 * 60 * 1000 : 30 * 60 * 1000;
        if (
          !current ||
          claims.session_version !== current.session_version ||
          current.expires_at <= now ||
          current.last_seen + idle <= now ||
          (!authorization &&
            (current.portal !== portal || claims.portal !== portal))
        )
          throw inputError("Sessão inválida ou expirada", 401);
        if (current.last_seen + 60000 < now)
          await db
            .prepare(
              "UPDATE auth_sessions SET last_seen=? WHERE id_hash=? AND expires_at>?",
            )
            .run(now, idHash, now);
        req.user = safeUser(current);
        req.authSessionHash = idHash;
        req.authPortal = current.portal;
        if (roles.length && !roles.includes(current.role)) {
          await audit(req, "authorization.denied");
          throw inputError(
            "Seu perfil não possui permissão para esta ação",
            403,
          );
        }
        if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
          await audit(req, "mutation.attempt");
          const originalJson = _res.json;
          _res.json = function (body) {
            _res.json = originalJson;
            return audit(req, `mutation.result.${_res.statusCode}`)
              .then(
                () => originalJson.call(_res, body),
                () => {
                  // The mutation may already be committed. Preserve its result so a
                  // transient audit failure does not encourage a duplicate retry.
                  console.error(
                    JSON.stringify({
                      event: "audit.write_failed",
                      requestId: req.requestId,
                    }),
                  );
                  return originalJson.call(_res, body);
                },
              )
              .catch(next);
          };
        } else if (
          /^\/api\/(users(?:\/|$)|online-orders(?:\/|$)|export\/|customer\/data$)/.test(
            req.path,
          )
        )
          await audit(req, "sensitive.read");
        next();
      } catch (error) {
        next(error);
      }
    };
  const logout = async (req, res) => {
    await db
      .prepare("DELETE FROM auth_sessions WHERE id_hash=?")
      .run(req.authSessionHash);
    await audit(req, "session.revoked");
    res.clearCookie(name(req.authPortal), cookieOptions);
    res.json({ ok: true });
  };
  return { issue, authenticate, logout };
}

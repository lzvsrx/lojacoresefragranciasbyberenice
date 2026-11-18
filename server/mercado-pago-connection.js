import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { MercadoPagoConfig, OAuth } from "mercadopago";
import {
  mercadoPagoConfig,
  mercadoPagoBudget,
  withMercadoPagoCredentials,
} from "./mercado-pago.js";
import { inputError } from "./validation.js";
import { storeMercadoPagoApplication } from "./mercado-pago-application.js";
import { installPaymentMethodRegistry } from "./mercado-pago-methods.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const callbackPath = "/api/mercado-pago/oauth/callback";

export function credentialCipher(secret) {
  if (!/^[a-f0-9]{64}$/i.test(secret || ""))
    throw inputError("A conexão precisa ser preparada na hospedagem.", 503);
  const key = Buffer.from(secret, "hex");
  return {
    seal(value, purpose) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(purpose));
      const data = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      return [iv, cipher.getAuthTag(), data]
        .map((b) => b.toString("base64url"))
        .join(".");
    },
    open(value, purpose) {
      try {
        const [iv, tag, data] = value
          .split(".")
          .map((v) => Buffer.from(v, "base64url"));
        const cipher = createDecipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(Buffer.from(purpose));
        cipher.setAuthTag(tag);
        return JSON.parse(
          Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8"),
        );
      } catch {
        throw inputError(
          "Não foi possível abrir a conexão protegida. Confira a chave na hospedagem.",
          503,
        );
      }
    },
  };
}

export async function installMercadoPagoConnection(
  app,
  {
    db,
    auth,
    audit = async () => {},
    env = process.env,
    now = Date.now,
    fetcher = (...args) => globalThis.fetch(...args),
  },
) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS mercado_pago_connection (
      id INTEGER PRIMARY KEY CHECK(id=1), app_cipher TEXT, tokens_cipher TEXT,
      account_id TEXT, nickname TEXT, expires_at INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unlinked', version INTEGER NOT NULL DEFAULT 0,
      refresh_lease INTEGER NOT NULL DEFAULT 0, linked_at TEXT, linked_by INTEGER
    );
    INSERT OR IGNORE INTO mercado_pago_connection(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS mercado_pago_oauth_states (
      state_hash TEXT PRIMARY KEY, verifier_cipher TEXT NOT NULL, session_hash TEXT NOT NULL,
      user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER,
      app_version TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mercado_pago_oauth_expiry ON mercado_pago_oauth_states(expires_at);
  `);
  const read = () =>
    db.prepare("SELECT * FROM mercado_pago_connection WHERE id=1").get();
  const registry = await installPaymentMethodRegistry(db, { fetcher, now });
  const cipher = () => credentialCipher(env.MERCADO_PAGO_ENCRYPTION_KEY);
  const base = () => mercadoPagoConfig(env).base;
  const application = (row) =>
    row.app_cipher
      ? cipher().open(row.app_cipher, "mercadopago:application:v1")
      : {
          clientId: env.MERCADO_PAGO_CLIENT_ID || storeMercadoPagoApplication.clientId,
          clientSecret: env.MERCADO_PAGO_CLIENT_SECRET,
          webhookSecret: env.MERCADO_PAGO_WEBHOOK_SECRET,
        };
  const ready = (settings) =>
    Boolean(
      base() &&
      /^[a-f0-9]{64}$/i.test(env.MERCADO_PAGO_ENCRYPTION_KEY || "") &&
      settings.clientId &&
      settings.clientSecret &&
      settings.webhookSecret,
    );
  const appVersion = (settings) => digest(JSON.stringify(settings));
  const exchange = async (body, refresh = false) => {
    try {
      const oauth = new OAuth(
        new MercadoPagoConfig({
          accessToken: "",
          options: {
            timeout: 8000,
            maxRetries: 0,
            redirect: "error",
            cache: "no-store",
            // OAuth authenticates with client_id/client_secret in the body,
            // not with a seller bearer token that does not exist yet.
            headers: {},
          },
        }),
      );
      return await (refresh ? oauth.refresh({ body }) : oauth.create({ body }));
    } catch (error) {
      // The official SDK normalizes OAuth error bodies and may replace the
      // provider's `error` field with its message. HTTP client errors still
      // reliably mean this grant cannot be renewed without intervention.
      const invalid = [400, 401, 403].includes(error.status);
      throw inputError(
        invalid
          ? "Autorize novamente sua conta no Mercado Pago."
          : "Não foi possível concluir a autorização. Tente conectar novamente.",
        invalid ? 401 : 502,
      );
    }
  };
  const tokenData = (data, previous) => {
    const scope =
      typeof data.scope === "string" ? data.scope : previous?.scope || "";
    if (
      typeof data.access_token !== "string" ||
      !data.access_token ||
      typeof (data.public_key || previous?.publicKey) !== "string" ||
      !(data.public_key || previous?.publicKey) ||
      !/^\d{1,24}$/.test(String(data.user_id)) ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in < 60 ||
      data.expires_in > 366 * 86400 ||
      !scope.split(/\s+/).includes("write") ||
      typeof data.live_mode !== "boolean" ||
      data.live_mode === (env.MERCADO_PAGO_SANDBOX === "true")
    )
      throw inputError(
        "A autorização recebida não corresponde ao ambiente da loja.",
        400,
      );
    return {
      token: data.access_token,
      publicKey: data.public_key || previous.publicKey,
      refreshToken:
        typeof data.refresh_token === "string"
          ? data.refresh_token
          : previous?.refreshToken,
      accountId: String(data.user_id),
      sandbox: !data.live_mode,
      scope,
    };
  };
  const account = async (token) => {
    try {
      const response = await fetcher("https://api.mercadopago.com/users/me", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (data.site_id !== "MLB" || !/^\d{1,24}$/.test(String(data.id)))
        throw new Error();
      return {
        id: String(data.id),
        nickname: String(data.nickname || "Conta Mercado Pago").slice(0, 100),
      };
    } catch {
      throw inputError(
        "Não foi possível validar uma conta Mercado Pago do Brasil.",
        400,
      );
    }
  };
  const credentials = async (row, settings, renew) => {
    if (!row.tokens_cipher) return null;
    let tokens = cipher().open(row.tokens_cipher, "mercadopago:tokens:v1");
    if (row.status !== "connected")
      return { ...tokens, token: "", secret: settings.webhookSecret };
    if (renew && row.expires_at < now() + 300000) {
      if (
        !tokens.refreshToken ||
        !tokens.scope.split(/\s+/).includes("offline_access")
      ) {
        if (row.expires_at <= now())
          return { ...tokens, token: "", secret: settings.webhookSecret };
      } else {
        const lease = now() + 30000;
        const claim = await db
          .prepare(
            "UPDATE mercado_pago_connection SET refresh_lease=? WHERE id=1 AND version=? AND refresh_lease<?",
          )
          .run(lease, row.version, now());
        if (!claim.changes) {
          if (row.expires_at <= now())
            throw inputError(
              "A autorização está sendo renovada. Tente novamente em instantes.",
              503,
            );
        } else {
          try {
            const result = await exchange(
              {
                client_id: settings.clientId,
                client_secret: settings.clientSecret,
                refresh_token: tokens.refreshToken,
              },
              true,
            );
            const updated = tokenData(result, tokens);
            if (
              updated.accountId !== row.account_id ||
              updated.sandbox !== tokens.sandbox
            )
              throw inputError(
                "A conta da autorização não corresponde à loja.",
                400,
              );
            const saved = await db
              .prepare(
                "UPDATE mercado_pago_connection SET tokens_cipher=?,expires_at=?,version=version+1,refresh_lease=0 WHERE id=1 AND version=? AND refresh_lease=?",
              )
              .run(
                cipher().seal(updated, "mercadopago:tokens:v1"),
                now() + result.expires_in * 1000,
                row.version,
                lease,
              );
            if (!saved.changes)
              throw inputError(
                "A conexão foi alterada. Consulte novamente o pagamento.",
                409,
              );
            tokens = updated;
          } catch (error) {
            await db
              .prepare(
                "UPDATE mercado_pago_connection SET refresh_lease=0,status=CASE WHEN ? THEN 'reauthorize' ELSE status END WHERE id=1 AND version=? AND refresh_lease=?",
              )
              .run(error.status === 401 ? 1 : 0, row.version, lease);
            if (row.expires_at <= now() || error.status === 401) throw error;
          }
        }
      }
    }
    if (row.expires_at <= now() && !renew) tokens = { ...tokens, token: "" };
    return { ...tokens, secret: settings.webhookSecret };
  };
  // All payment code reads credentials from a request-local scope, including
  // webhooks and cron. Tokens never enter browser state or process.env.
  app.use("/api", (req, res, next) =>
    /^\/(mercado-pago|shop(?:\/|$)|customer\/orders|online-orders|payment-methods)/.test(
      req.path,
    )
      ? mercadoPagoBudget(req, res, next)
      : next(),
  );
  app.use("/api", async (req, _res, next) => {
    if (
      !/^\/(mercado-pago|shop(?:\/|$)|customer\/orders|online-orders|payment-methods)/.test(
        req.path,
      )
    )
      return next();
    try {
      const row = await read(),
        settings = application(row);
      const administrative =
        req.path === "/mercado-pago/status" ||
        req.path.startsWith("/mercado-pago/oauth/");
      const c = await credentials(row, settings, !administrative);
      if (c) withMercadoPagoCredentials(c, next);
      else if (settings.webhookSecret)
        withMercadoPagoCredentials(
          {
            token: env.MERCADO_PAGO_ACCESS_TOKEN,
            publicKey: env.MERCADO_PAGO_PUBLIC_KEY,
            secret: settings.webhookSecret,
            sandbox: env.MERCADO_PAGO_SANDBOX === "true",
          },
          next,
        );
      else next();
    } catch (error) {
      next(error);
    }
  });
  app.get(
    "/api/mercado-pago/oauth/status",
    auth(["admin"]),
    async (_req, res) => {
      let row = await read();
      const settings = application(row);
      let methods = await registry.read(row.account_id);
      if (
        row.status === "connected" &&
        methods.retry_at <= now() &&
        (methods.status !== "ready" ||
          Date.parse(methods.synced_at) < now() - 86400000)
      ) {
        try {
          const current = await credentials(row, settings, true);
          if (current?.token)
            methods = await registry.sync(row.account_id, current.token);
          row = await read();
        } catch {
          /* Keep the last saved catalog and show pending authorization. */
        }
      }
      res.json({
        ready: ready(settings),
        storage_ready: /^[a-f0-9]{64}$/i.test(
          env.MERCADO_PAGO_ENCRYPTION_KEY || "",
        ),
        application_saved: Boolean(
          settings.clientId && settings.clientSecret && settings.webhookSecret,
        ),
        client_id: settings.clientId || "",
        callback_url: base() ? base() + callbackPath : null,
        connected: row.status === "connected" && row.expires_at > now(),
        reconnect_required:
          row.status === "reauthorize" ||
          Boolean(row.tokens_cipher && row.expires_at <= now()),
        account: row.account_id
          ? { id: row.account_id, name: row.nickname }
          : null,
        expires_at: row.expires_at
          ? new Date(row.expires_at).toISOString()
          : null,
        payment_methods: methods,
        automatic_renewal: row.tokens_cipher
          ? Boolean(
              cipher().open(row.tokens_cipher, "mercadopago:tokens:v1")
                .refreshToken &&
              cipher()
                .open(row.tokens_cipher, "mercadopago:tokens:v1")
                .scope.split(/\s+/)
                .includes("offline_access"),
            )
          : false,
      });
    },
  );
  app.post(
    "/api/mercado-pago/methods/sync",
    auth(["admin"]),
    async (req, res) => {
      const row = await read(),
        current = await credentials(row, application(row), true);
      if (row.status !== "connected" || !current?.token)
        throw inputError(
          "Conecte sua conta Mercado Pago antes de sincronizar.",
          409,
        );
      const methods = await registry.sync(row.account_id, current.token, {
        force: true,
      });
      await audit(
        req,
        "mercado_pago.methods_synchronized",
        req.user.id,
        row.account_id,
      );
      res.status(methods.status === "ready" ? 200 : 202).json(methods);
    },
  );
  app.post(
    "/api/mercado-pago/oauth/application",
    auth(["admin"]),
    async (req, res) => {
      const {
        client_id: clientId,
        client_secret: clientSecret,
        webhook_secret: webhookSecret,
      } = req.body || {};
      if (
        !/^\d{5,30}$/.test(clientId || "") ||
        !/^[A-Za-z0-9_-]{16,512}$/.test(clientSecret || "") ||
        !/^[A-Za-z0-9_-]{16,512}$/.test(webhookSecret || "")
      )
        throw inputError(
          "Informe o ID da aplicação, o segredo e a assinatura do webhook fornecidos pelo Mercado Pago.",
          400,
        );
      await db.transaction(async () => {
        const row = await read();
        if (row.refresh_lease > now())
          throw inputError(
            "A autorização está sendo renovada. Aguarde para editar a aplicação.",
            409,
          );
        if (row.account_id && application(row).clientId !== clientId)
          throw inputError(
            "Mantenha a aplicação já vinculada aos pagamentos desta loja.",
            409,
          );
        await db
          .prepare(
            "UPDATE mercado_pago_connection SET app_cipher=?,version=version+1 WHERE id=1",
          )
          .run(
            cipher().seal(
              { clientId, clientSecret, webhookSecret },
              "mercadopago:application:v1",
            ),
          );
        await db.prepare("DELETE FROM mercado_pago_oauth_states").run();
      })();
      await audit(req, "mercado_pago.application_saved");
      res.json({ saved: true });
    },
  );
  app.post(
    "/api/mercado-pago/oauth/start",
    auth(["admin"]),
    async (req, res) => {
      const row = await read(),
        settings = application(row);
      if (!ready(settings))
        throw inputError(
          "Prepare a aplicação antes de conectar sua conta.",
          503,
        );
      if (!req.authSessionHash)
        throw inputError("Entre novamente para conectar sua conta.", 401);
      const state = randomBytes(32).toString("base64url"),
        verifier = randomBytes(48).toString("base64url"),
        stateHash = digest(state);
      await db.transaction(async () => {
        await db
          .prepare("DELETE FROM mercado_pago_oauth_states WHERE expires_at<?")
          .run(now());
        const attempts = await db
          .prepare(
            "SELECT count(*) n FROM mercado_pago_oauth_states WHERE user_id=?",
          )
          .get(req.user.id);
        if (attempts.n >= 6)
          throw inputError(
            "Aguarde alguns minutos antes de tentar conectar novamente.",
            429,
          );
        await db
          .prepare(
            "INSERT INTO mercado_pago_oauth_states(state_hash,verifier_cipher,session_hash,user_id,expires_at,app_version) VALUES(?,?,?,?,?,?)",
          )
          .run(
            stateHash,
            cipher().seal(verifier, `mercadopago:state:${stateHash}`),
            req.authSessionHash,
            req.user.id,
            now() + 600000,
            appVersion(settings),
          );
      })();
      const url = new URL("https://auth.mercadopago.com/authorization");
      for (const [key, value] of Object.entries({
        client_id: settings.clientId,
        response_type: "code",
        platform_id: "mp",
        state,
        redirect_uri: base() + callbackPath,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      }))
        url.searchParams.set(key, value);
      await audit(req, "mercado_pago.authorization_started");
      res.json({ authorization_url: url.href });
    },
  );
  app.get(callbackPath, auth(["admin"]), async (req, res) => {
    const redirect = (result) =>
      res.redirect(303, `${base()}/#/admin/pagamentos?mp_connection=${result}`);
    try {
      const state = req.query.state;
      if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state))
        throw inputError("Autorização inválida.", 400);
      const stateHash = digest(state),
        row = await read(),
        settings = application(row);
      const attempt = await db.transaction(async () => {
        const found = await db
          .prepare(
            "SELECT * FROM mercado_pago_oauth_states WHERE state_hash=? AND session_hash=? AND user_id=? AND used_at IS NULL AND expires_at>?",
          )
          .get(stateHash, req.authSessionHash || "", req.user.id, now());
        if (!found || found.app_version !== appVersion(settings))
          throw inputError("Autorização expirada ou inválida.", 400);
        await db
          .prepare(
            "UPDATE mercado_pago_oauth_states SET used_at=? WHERE state_hash=?",
          )
          .run(now(), stateHash);
        return found;
      })();
      if (req.query.error) return redirect("cancelled");
      if (
        typeof req.query.code !== "string" ||
        !/^[A-Za-z0-9_-]{5,2048}$/.test(req.query.code)
      )
        throw inputError("Autorização inválida.", 400);
      const result = await exchange({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        code: req.query.code,
        redirect_uri: base() + callbackPath,
        code_verifier: cipher().open(
          attempt.verifier_cipher,
          `mercadopago:state:${stateHash}`,
        ),
        test_token: env.MERCADO_PAGO_SANDBOX === "true",
      });
      const tokens = tokenData(result);
      const [seller, methods] = await Promise.all([
        account(tokens.token),
        registry.download(tokens.token).catch(() => null),
      ]);
      if (seller.id !== tokens.accountId)
        throw inputError("Conta inválida.", 400);
      if (row.account_id && row.account_id !== seller.id)
        return redirect("account_mismatch");
      if (
        !row.account_id &&
        env.MERCADO_PAGO_ACCESS_TOKEN &&
        (await account(env.MERCADO_PAGO_ACCESS_TOKEN)).id !== seller.id
      )
        return redirect("account_mismatch");
      await db.transaction(async () => {
        const saved = await db
          .prepare(
            "UPDATE mercado_pago_connection SET tokens_cipher=?,account_id=?,nickname=?,expires_at=?,status='connected',version=version+1,refresh_lease=0,linked_at=?,linked_by=? WHERE id=1 AND version=?",
          )
          .run(
            cipher().seal(tokens, "mercadopago:tokens:v1"),
            seller.id,
            seller.nickname,
            now() + result.expires_in * 1000,
            new Date(now()).toISOString(),
            req.user.id,
            row.version,
          );
        if (!saved.changes)
          throw inputError("A conexão foi alterada. Tente novamente.", 409);
        await db
          .prepare(
            "INSERT INTO payment_methods(code,name,active,requires_reference,max_installments,instructions) VALUES('MP','Mercado Pago',1,1,1,'Pagamento online pelo Checkout Pro do Mercado Pago.') ON CONFLICT(code) DO UPDATE SET active=1,updated_at=CURRENT_TIMESTAMP",
          )
          .run();
        if (methods) await registry.save(seller.id, methods);
        else await registry.pending(seller.id);
      })();
      await audit(
        req,
        "mercado_pago.account_connected",
        req.user.id,
        seller.id,
      );
      return redirect(methods ? "connected" : "connected_sync_pending");
    } catch {
      await audit(req, "mercado_pago.authorization_failed");
      return redirect("failed");
    }
  });
  const syncSavedMethods = async () => {
    const row = await read();
    if (row.status !== "connected") return null;
    const current = await registry.read(row.account_id);
    if (
      current.status === "ready" &&
      Date.parse(current.synced_at) > now() - 86400000
    )
      return current;
    const authData = await credentials(row, application(row), true);
    return authData?.token
      ? registry.sync(row.account_id, authData.token)
      : current;
  };
  return { read, credentials, application, syncSavedMethods };
}

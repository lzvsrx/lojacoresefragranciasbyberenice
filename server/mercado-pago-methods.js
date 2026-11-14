import { inputError } from "./validation.js";

export const excludedPaymentTypes = ["ticket", "atm"];

export function normalizePaymentMethods(data) {
  if (!Array.isArray(data) || data.length > 500)
    throw inputError(
      "O Mercado Pago não retornou uma lista válida de formas de pagamento.",
      502,
    );
  const seen = new Set();
  return data.map((method) => {
    if (
      !method ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(method.id || "") ||
      seen.has(method.id) ||
      typeof method.name !== "string" ||
      !method.name.trim() ||
      method.name.length > 160 ||
      !/^[a-z_]{2,50}$/.test(method.payment_type_id || "") ||
      typeof method.status !== "string" ||
      method.status.length > 40
    )
      throw inputError(
        "A lista de formas de pagamento precisa ser consultada novamente.",
        502,
      );
    seen.add(method.id);
    const amount = (value) =>
      value == null
        ? null
        : Number.isFinite(value) && value >= 0
          ? Math.round(value * 100)
          : null;
    return {
      id: method.id,
      name: method.name.trim(),
      type: method.payment_type_id,
      status: method.status,
      enabled:
        method.status === "active" &&
        !excludedPaymentTypes.includes(method.payment_type_id),
      min_cents: amount(method.min_allowed_amount),
      max_cents: amount(method.max_allowed_amount),
    };
  });
}

export async function installPaymentMethodRegistry(
  db,
  { fetcher, now = Date.now },
) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS mercado_pago_methods (
      account_id TEXT NOT NULL,provider_id TEXT NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL,
      provider_status TEXT NOT NULL,checkout_enabled INTEGER NOT NULL,
      min_cents INTEGER,max_cents INTEGER,updated_at TEXT NOT NULL,
      PRIMARY KEY(account_id,provider_id)
    );
    CREATE TABLE IF NOT EXISTS mercado_pago_method_sync (
      account_id TEXT PRIMARY KEY,synced_at TEXT,status TEXT NOT NULL DEFAULT 'pending',
      lease_until INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  const download = async (token) => {
    try {
      const response = await fetcher(
        "https://api.mercadopago.com/v1/payment_methods",
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(6000),
          redirect: "error",
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error();
      return normalizePaymentMethods(await response.json());
    } catch {
      throw inputError(
        "A conta foi autorizada, mas as formas de pagamento ainda precisam ser sincronizadas.",
        502,
      );
    }
  };
  // Called within the same transaction that saves the OAuth authorization.
  const save = async (accountId, methods) => {
    const timestamp = new Date(now()).toISOString();
    await db
      .prepare(
        "UPDATE mercado_pago_methods SET checkout_enabled=0,provider_status='removed',updated_at=? WHERE account_id=?",
      )
      .run(timestamp, accountId);
    for (let index = 0; index < methods.length; index += 50) {
      const batch = methods.slice(index, index + 50);
      await db
        .prepare(
          `
      INSERT INTO mercado_pago_methods(account_id,provider_id,name,type,provider_status,checkout_enabled,min_cents,max_cents,updated_at)
      VALUES ${batch.map(() => "(?,?,?,?,?,?,?,?,?)").join(",")} ON CONFLICT(account_id,provider_id) DO UPDATE SET
      name=excluded.name,type=excluded.type,provider_status=excluded.provider_status,checkout_enabled=excluded.checkout_enabled,
      min_cents=excluded.min_cents,max_cents=excluded.max_cents,updated_at=excluded.updated_at
    `,
        )
        .run(
          ...batch.flatMap((method) => [
            accountId,
            method.id,
            method.name,
            method.type,
            method.status,
            method.enabled ? 1 : 0,
            method.min_cents,
            method.max_cents,
            timestamp,
          ]),
        );
    }
    await db
      .prepare(
        "INSERT INTO mercado_pago_method_sync(account_id,synced_at,status) VALUES(?,?,'ready') ON CONFLICT(account_id) DO UPDATE SET synced_at=excluded.synced_at,status='ready',lease_until=0,retry_at=0",
      )
      .run(accountId, timestamp);
  };
  const pending = (accountId) =>
    db
      .prepare(
        "INSERT INTO mercado_pago_method_sync(account_id,status,retry_at) VALUES(?,'pending',?) ON CONFLICT(account_id) DO UPDATE SET status='pending',lease_until=0,retry_at=excluded.retry_at",
      )
      .run(accountId, now() + 60000);
  const read = async (accountId) => {
    if (!accountId)
      return { status: "unlinked", synced_at: null, items: [], retry_at: 0 };
    const state = await db
      .prepare("SELECT * FROM mercado_pago_method_sync WHERE account_id=?")
      .get(accountId);
    const methods = await db
      .prepare(
        "SELECT provider_id id,name,type,provider_status status,checkout_enabled enabled,min_cents,max_cents FROM mercado_pago_methods WHERE account_id=? ORDER BY checkout_enabled DESC,type,name",
      )
      .all(accountId);
    return {
      status: state?.status || "pending",
      synced_at: state?.synced_at || null,
      retry_at: state?.retry_at || 0,
      items: methods.map((m) => ({ ...m, enabled: Boolean(m.enabled) })),
    };
  };
  const sync = async (accountId, token, { force = false } = {}) => {
    const lease = now() + 20000;
    const claim = await db.transaction(async () => {
      await db
        .prepare(
          "INSERT OR IGNORE INTO mercado_pago_method_sync(account_id) VALUES(?)",
        )
        .run(accountId);
      return db
        .prepare(
          "UPDATE mercado_pago_method_sync SET lease_until=? WHERE account_id=? AND lease_until<? AND (? OR retry_at<=?)",
        )
        .run(lease, accountId, now(), force ? 1 : 0, now());
    })();
    if (!claim.changes) return read(accountId);
    try {
      const methods = await download(token);
      await db.transaction(async () => {
        const account = await db
          .prepare(
            "SELECT account_id,status FROM mercado_pago_connection WHERE id=1",
          )
          .get();
        if (account.account_id !== accountId || account.status !== "connected")
          throw inputError("Autorize sua conta antes de sincronizar.", 409);
        const reservation = await db
          .prepare(
            "SELECT lease_until FROM mercado_pago_method_sync WHERE account_id=?",
          )
          .get(accountId);
        if (reservation?.lease_until !== lease) return;
        await save(accountId, methods);
      })();
    } catch {
      await db
        .prepare(
          "UPDATE mercado_pago_method_sync SET status='pending',lease_until=0,retry_at=? WHERE account_id=? AND lease_until=?",
        )
        .run(now() + 60000, accountId, lease);
    }
    return read(accountId);
  };
  return { download, save, pending, read, sync };
}

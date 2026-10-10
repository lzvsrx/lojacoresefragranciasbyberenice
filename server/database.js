import Database from "better-sqlite3";
import { AsyncLocalStorage } from "node:async_hooks";

// One API for local SQLite and persistent Turso, with atomic writes in both modes.
export async function createDatabase({
  filename,
  url,
  authToken,
  client: suppliedClient,
} = {}) {
  const remote =
    suppliedClient ||
    (url
      ? (
          await import(
            url.startsWith("file:") ? "@libsql/client" : "@libsql/client/web"
          )
        ).createClient({ url, authToken })
      : null);
  const native = remote ? null : new Database(filename);
  const context = new AsyncLocalStorage();
  let queue = Promise.resolve();
  const exclusive = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const access = (operation) =>
    context.getStore() ? operation() : exclusive(operation);
  const execute = (sql, args, mode) =>
    access(async () => {
      if (native) return native.prepare(sql)[mode](...args);
      const executor = context.getStore()?.transaction || remote;
      const result = await executor.execute({
        sql,
        args: args.map((value) => (value === undefined ? null : value)),
      });
      const rows = result.rows.map((row) =>
        Object.fromEntries(
          result.columns.map((key) => {
            const value = row[key];
            return [
              key,
              value instanceof ArrayBuffer || ArrayBuffer.isView(value)
                ? Buffer.from(
                    value instanceof ArrayBuffer ? value : value.buffer,
                    value.byteOffset || 0,
                    value.byteLength,
                  )
                : value,
            ];
          }),
        ),
      );
      if (mode === "all") return rows;
      if (mode === "get") return rows[0];
      return {
        changes: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid,
      };
    });
  return {
    native,
    remote: Boolean(remote),
    prepare: (sql) => ({
      all: (...args) => execute(sql, args, "all"),
      get: (...args) => execute(sql, args, "get"),
      run: (...args) => execute(sql, args, "run"),
    }),
    exec: (sql) =>
      access(async () =>
        native
          ? native.exec(sql)
          : (context.getStore()?.transaction || remote).executeMultiple(sql),
      ),
    pragma: (sql) =>
      native ? access(() => native.pragma(sql)) : Promise.resolve(),
    transaction:
      (callback) =>
      (...args) =>
        exclusive(async () => {
          const transaction = remote ? await remote.transaction("write") : null;
          if (native) native.exec("BEGIN IMMEDIATE");
          try {
            const result = await context.run({ transaction }, () =>
              callback(...args),
            );
            if (native) native.exec("COMMIT");
            else await transaction.commit();
            return result;
          } catch (error) {
            if (native && native.inTransaction) native.exec("ROLLBACK");
            else if (transaction && !transaction.closed)
              await transaction.rollback();
            throw error;
          } finally {
            transaction?.close();
          }
        }),
    close: () => (native ? native.close() : remote.close()),
  };
}

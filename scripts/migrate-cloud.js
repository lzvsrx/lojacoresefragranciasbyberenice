import Database from "better-sqlite3";
import { createClient } from "@libsql/client/web";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const quote = (name) => `"${name.replaceAll('"', '""')}"`;

export async function migrateDatabase(source, client) {
  const tables = source
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY CASE name WHEN 'users' THEN 0 WHEN 'products' THEN 1 WHEN 'payment_methods' THEN 2 WHEN 'sales' THEN 3 WHEN 'stock_movements' THEN 4 WHEN 'web_orders' THEN 5 WHEN 'web_order_items' THEN 6 WHEN 'web_order_events' THEN 7 WHEN 'service_requests' THEN 8 ELSE 9 END",
    )
    .all();
  const existing = (
    await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
  ).rows;
  const marker = existing.some((row) => row.name === "app_cloud_migration");
  if (!marker && existing.length)
    throw new Error(
      "O destino precisa ser um banco vazio. Nenhum dado existente será sobrescrito",
    );
  await client.execute(
    "CREATE TABLE IF NOT EXISTS app_cloud_migration(id INTEGER PRIMARY KEY,status TEXT NOT NULL)",
  );
  const state = (
    await client.execute("SELECT status FROM app_cloud_migration WHERE id=1")
  ).rows[0];
  if (state?.status === "ready")
    throw new Error(
      "Este banco já foi migrado. Migração encerrada sem alterar os dados",
    );
  await client.execute(
    "INSERT OR IGNORE INTO app_cloud_migration(id,status) VALUES(1,'copying')",
  );
  for (const table of tables) {
    await client.execute(
      table.sql.replace(/^CREATE TABLE\s+/i, "CREATE TABLE IF NOT EXISTS "),
    );
    const columns = source
      .prepare(`PRAGMA table_info(${quote(table.name)})`)
      .all()
      .map((column) => column.name);
    const sql = `INSERT OR IGNORE INTO ${quote(table.name)}(${columns.map(quote).join(",")}) VALUES(${columns.map(() => "?").join(",")})`;
    let batch = [],
      size = 0;
    for (const row of source
      .prepare(`SELECT * FROM ${quote(table.name)}`)
      .iterate()) {
      const args = columns.map((column) => row[column]);
      const bytes = args.reduce(
        (total, value) =>
          total +
          (Buffer.isBuffer(value)
            ? value.length * 1.4
            : Buffer.byteLength(String(value ?? ""))) +
          32,
        sql.length,
      );
      if (batch.length && size + bytes > 1024 * 1024) {
        await client.batch(batch, "write");
        batch = [];
        size = 0;
      }
      batch.push({ sql, args });
      size += bytes;
    }
    if (batch.length) await client.batch(batch, "write");
    const expected = source
      .prepare(`SELECT COUNT(*) count FROM ${quote(table.name)}`)
      .get().count;
    const actual = Number(
      (await client.execute(`SELECT COUNT(*) count FROM ${quote(table.name)}`))
        .rows[0].count,
    );
    if (expected !== actual)
      throw new Error(
        `Contagem divergente em ${table.name}. Migração não ativada`,
      );
  }
  for (const index of source
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL",
    )
    .all())
    await client.execute(
      index.sql.replace(
        /^CREATE (UNIQUE )?INDEX\s+/i,
        (_match, unique = "") => `CREATE ${unique}INDEX IF NOT EXISTS `,
      ),
    );
  await client.execute(
    "UPDATE app_cloud_migration SET status='ready' WHERE id=1",
  );
}

async function main() {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  if (existsSync(path.join(root, ".env"))) loadEnvFile(path.join(root, ".env"));
  const url = process.env.TURSO_DATABASE_URL;
  if (!url || !process.env.TURSO_AUTH_TOKEN)
    throw new Error(
      "Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN no .env local",
    );
  const folder = path.join(root, "server/data/backups");
  mkdirSync(folder, { recursive: true });
  const key = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const snapshot = path.join(folder, `cloud-migration-${key}.db`);
  if (!existsSync(snapshot)) {
    const current = new Database(
      process.env.DATABASE_PATH || path.join(root, "server/data/store.db"),
      { readonly: true, fileMustExist: true },
    );
    try {
      await current.backup(snapshot);
    } finally {
      current.close();
    }
  }
  const source = new Database(snapshot, { readonly: true });
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    await migrateDatabase(source, client);
    console.log(
      "Migração concluída. Produtos, imagens, usuários, vendas e histórico foram copiados e conferidos.",
    );
  } finally {
    source.close();
    client.close();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

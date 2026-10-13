import Database from "better-sqlite3";
import { createClient } from "@libsql/client/web";
import { loadEnvFile } from "node:process";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

if (existsSync(".env")) loadEnvFile(".env");
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN)
  throw new Error("Configure o banco remoto no .env privado.");
const folder = "server/data/backups";
mkdirSync(folder, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = process.env.DATABASE_PATH || "server/data/store.db";
const snapshotPath = path.join(folder, `cloud-snapshot-${stamp}.db`);
const backupPath = path.join(folder, `before-cloud-sync-${stamp}.db`);
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const convert = (value) =>
  value instanceof ArrayBuffer
    ? Buffer.from(value)
    : ArrayBuffer.isView(value)
      ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : value;
const digestRow = (values) =>
  JSON.stringify(
    values.map((value) =>
      Buffer.isBuffer(value)
        ? { blob: value.toString("base64") }
        : typeof value === "bigint"
          ? Number(value)
          : value,
    ),
  ) + "\n";
const cloud = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const snapshot = new Database(snapshotPath);
let transaction;
try {
  transaction = await cloud.transaction("read");
  const schema = (
    await transaction.execute(
      "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END",
    )
  ).rows;
  snapshot.pragma("foreign_keys = OFF");
  snapshot.exec("BEGIN");
  for (const item of schema.filter((item) => item.type === "table"))
    snapshot.exec(item.sql);
  for (const item of schema.filter((item) => item.type === "table")) {
    const columns = (
      await transaction.execute(`PRAGMA table_info(${quote(item.name)})`)
    ).rows.map((column) => column.name);
    const order = columns.map(quote).join(",");
    const insert = snapshot.prepare(
      `INSERT INTO ${quote(item.name)} (${order}) VALUES (${columns.map(() => "?").join(",")})`,
    );
    const hash = createHash("sha256");
    let count = 0;
    for (;;) {
      const rows = (
        await transaction.execute(
          `SELECT ${order} FROM ${quote(item.name)} ORDER BY ${order} LIMIT 10 OFFSET ${count}`,
        )
      ).rows;
      for (const row of rows) {
        const values = columns.map((column) => convert(row[column]));
        insert.run(...values);
        hash.update(digestRow(values));
      }
      count += rows.length;
      if (rows.length < 10) break;
    }
    const actual = createHash("sha256");
    for (const row of snapshot
      .prepare(`SELECT ${order} FROM ${quote(item.name)} ORDER BY ${order}`)
      .iterate())
      actual.update(digestRow(columns.map((column) => row[column])));
    if (hash.digest("hex") !== actual.digest("hex"))
      throw new Error(`Conteudo divergente: ${item.name}`);
    console.log(`${item.name}: ${count} registros conferidos`);
  }
  if (
    (
      await transaction.execute(
        "SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'",
      )
    ).rows.length
  ) {
    snapshot.exec("DELETE FROM sqlite_sequence");
    const insert = snapshot.prepare(
      "INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)",
    );
    for (const row of (
      await transaction.execute("SELECT name,seq FROM sqlite_sequence")
    ).rows)
      insert.run(row.name, row.seq);
  }
  for (const item of schema.filter((item) => item.type !== "table"))
    snapshot.exec(item.sql);
  snapshot.exec("COMMIT");
  await transaction.commit();
  transaction.close();
  transaction = null;
  const columns = snapshot.prepare("PRAGMA table_info(products)").all();
  if (!columns.some((column) => column.name === "purchase_price"))
    snapshot.exec(
      "ALTER TABLE products ADD COLUMN purchase_price REAL NOT NULL DEFAULT 0 CHECK(purchase_price >= 0)",
    );
  if (snapshot.pragma("integrity_check", { simple: true }) !== "ok")
    throw new Error("Falha na integridade SQLite");
  if (snapshot.pragma("foreign_key_check").length)
    throw new Error("Chaves estrangeiras inconsistentes");
  if (existsSync(destination)) {
    const original = new Database(destination, { readonly: true });
    try {
      await original.backup(backupPath);
    } finally {
      original.close();
    }
    console.log(`Backup anterior: ${backupPath}`);
  }
  await snapshot.backup(destination);
  const verified = new Database(destination, { readonly: true });
  try {
    if (verified.pragma("integrity_check", { simple: true }) !== "ok")
      throw new Error("Falha na verificacao do destino");
    console.log(
      "SQLite local atualizado:",
      verified
        .prepare(
          "SELECT COUNT(*) AS products, COUNT(purchase_price) AS purchase_prices FROM products",
        )
        .get(),
    );
  } finally {
    verified.close();
  }
  console.log(`Copia remota conferida: ${snapshotPath}`);
} finally {
  if (transaction) {
    await transaction.rollback().catch(() => {});
    transaction.close();
  }
  snapshot.close();
  cloud.close();
}

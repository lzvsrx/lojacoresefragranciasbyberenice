import Database from "better-sqlite3";
import { createClient } from "@libsql/client/web";
import { createHash } from "node:crypto";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import path from "node:path";

if (existsSync(".env")) loadEnvFile(".env");
const url = process.env.TURSO_DATABASE_URL;
if (!url || !process.env.TURSO_AUTH_TOKEN) throw new Error("Configure o banco remoto no .env privado.");
const key = createHash("sha256").update(url).digest("hex").slice(0, 16);
const filename = process.argv[2] || path.join("server/data/backups", `cloud-migration-${key}.db`);
const source = new Database(filename, { readonly: true, fileMustExist: true });
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const normalize = (value) => {
  if (value instanceof ArrayBuffer) return { blob: Buffer.from(value).toString("base64") };
  if (ArrayBuffer.isView(value)) return { blob: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64") };
  return typeof value === "bigint" ? Number(value) : value;
};
try {
  const tables = source.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  for (const { name } of tables) {
    // A running server can advance AUTOINCREMENT through INSERT OR IGNORE
    // without changing any rows. Never require the remote counter to decrease.
    if (name === "sqlite_sequence") {
      const remote = (await client.execute("SELECT name,seq FROM sqlite_sequence")).rows;
      const local = source.prepare("SELECT name,seq FROM sqlite_sequence").all();
      if (remote.length !== local.length || local.some((row) => {
        const match = remote.find((entry) => entry.name === row.name);
        return !match || Number(match.seq) < row.seq;
      })) throw new Error("Sequencias remotas ausentes ou inferiores ao banco local");
      console.log("sqlite_sequence: contadores remotos conferidos, sem regressao de IDs");
      continue;
    }
    const columns = source.prepare(`PRAGMA table_info(${quote(name)})`).all();
    const primary = columns.find((c) => c.pk)?.name || (name === "sqlite_sequence" ? "name" : null);
    if (!primary) throw new Error(`Tabela sem chave para verificação: ${name}`);
    const select = columns.map((c) => quote(c.name)).join(",");
    const rows = source.prepare(`SELECT ${select} FROM ${quote(name)} ORDER BY ${quote(primary)}`).all();
    const count = Number((await client.execute(`SELECT COUNT(*) n FROM ${quote(name)}`)).rows[0].n);
    if (count !== rows.length) throw new Error(`Contagem divergente: ${name}`);
    const expected = createHash("sha256"), actual = createHash("sha256");
    const encode = (row) => JSON.stringify(columns.map((c) => normalize(row[c.name]))) + "\n";
    let batch = [], bytes = 0;
    const verifyBatch = async () => {
      if (!batch.length) return;
      const result = await client.execute({
        sql: `SELECT ${select} FROM ${quote(name)} WHERE ${quote(primary)} IN (${batch.map(() => "?").join(",")}) ORDER BY ${quote(primary)}`,
        args: batch.map((row) => row[primary]),
      });
      if (result.rows.length !== batch.length) throw new Error(`Registros ausentes: ${name}`);
      for (const row of batch) expected.update(encode(row));
      for (const row of result.rows) actual.update(encode(row));
      batch = []; bytes = 0;
    };
    for (const row of rows) {
      const size = Buffer.byteLength(encode(row));
      if (batch.length && (bytes + size > 1024 * 1024 || batch.length >= 100)) await verifyBatch();
      batch.push(row); bytes += size;
    }
    await verifyBatch();
    if (expected.digest("hex") !== actual.digest("hex")) throw new Error(`Conteúdo divergente: ${name}`);
    console.log(`${name}: ${count} registros idênticos, incluindo BLOBs`);
  }
  if ((await client.execute("PRAGMA foreign_key_check")).rows.length) throw new Error("Chaves estrangeiras inconsistentes");
  console.log("Verificacao concluida: registros identicos e sequencias remotas sem regressao.");
} finally {
  source.close(); client.close();
}

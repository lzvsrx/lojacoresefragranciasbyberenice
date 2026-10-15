import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (existsSync(path.join(root, ".env"))) loadEnvFile(path.join(root, ".env"));
if (process.env.TURSO_DATABASE_URL)
  console.log(
    "Este comando copia apenas o SQLite local. Para o banco remoto, use o backup na conta Turso.",
  );
const source =
  process.env.DATABASE_PATH || path.join(root, "server/data/store.db");
const folder = process.env.BACKUP_DIR || path.resolve(root, "../coresefragrancias-bancos-arquivados");
mkdirSync(folder, { recursive: true });
const target = path.join(
  folder,
  `store-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
);
const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  await db.backup(target);
  console.log(`Backup local criado: ${target}`);
} finally {
  db.close();
}

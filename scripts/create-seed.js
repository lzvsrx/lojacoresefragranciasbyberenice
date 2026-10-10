import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import path from "path";

const source = path.resolve("server/data/store.db");
const target = path.resolve("server/data/store.seed.db");

if (!existsSync(source)) throw new Error("Banco operacional não encontrado");
const sourceDb = new Database(source, { readonly: true });
await sourceDb.backup(target);
sourceDb.close();

const db = new Database(target);
const primaryAdmin = db
  .prepare("SELECT id FROM users WHERE username='admin' ORDER BY id LIMIT 1")
  .get();
if (!primaryAdmin) throw new Error("Administrador principal não encontrado");
const disabledPassword = bcrypt.hashSync(randomBytes(32).toString("hex"), 12);
const demoPassword = bcrypt.hashSync("admin123", 12);
db.pragma("foreign_keys = OFF");
db.transaction(() => {
  // Never publish customer orders, addresses, support requests or merchant CPF.
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((t) => t.name),
  );
  for (const table of [
    "service_requests",
    "web_order_events",
    "web_order_items",
    "web_orders",
    "commerce_settings",
  ])
    if (tables.has(table)) db.prepare(`DELETE FROM ${table}`).run();
  db.prepare("UPDATE users SET username='usuario_temporario_' || id").run();
  db.prepare(
    `UPDATE users SET
      username=CASE
        WHEN id=? THEN 'admin'
        WHEN role='admin' THEN 'administrador' || id
        ELSE role || id
      END,
      name=CASE
        WHEN id=? THEN 'Administrador'
        WHEN role='admin' THEN 'Administrador ' || id
        WHEN role='funcionario' THEN 'Equipe ' || id
        ELSE 'Cliente ' || id
      END,
      password=CASE WHEN id=? THEN ? ELSE ? END,
      birth_date=NULL,email=NULL,phone=NULL,cpf=NULL,profile_image=NULL,
      preferred_type=NULL,preferred_brand=NULL,preferred_style=NULL`,
  ).run(
    primaryAdmin.id,
    primaryAdmin.id,
    primaryAdmin.id,
    demoPassword,
    disabledPassword,
  );
  db.prepare(
    "UPDATE sales SET transaction_reference=NULL,fiscal_key=NULL,fiscal_document=NULL",
  ).run();
  if (tables.has("stock_movements"))
    db.prepare(
      "UPDATE stock_movements SET reason=movement_type || ' (histórico anonimizado)'",
    ).run();
  if (tables.has("payment_methods"))
    db.prepare("UPDATE payment_methods SET instructions=''").run();
})();
db.pragma("wal_checkpoint(TRUNCATE)");
db.exec("VACUUM");
const summary = db
  .prepare(
    "SELECT COUNT(*) sales_count,ROUND(COALESCE(SUM(total_value),0),2) revenue FROM sales",
  )
  .get();
db.close();
console.log(`Banco público criado em ${target}`, summary);

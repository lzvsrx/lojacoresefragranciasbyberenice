import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { copyFileSync, existsSync } from "fs";
import path from "path";

const source = path.resolve("server/data/store.db");
const target = path.resolve("server/data/store.seed.db");

if (!existsSync(source)) throw new Error("Banco operacional não encontrado");
copyFileSync(source, target);

const db = new Database(target);
const primaryAdmin = db
  .prepare("SELECT id FROM users WHERE username='admin' ORDER BY id LIMIT 1")
  .get();
if (!primaryAdmin) throw new Error("Administrador principal não encontrado");
const disabledPassword = bcrypt.hashSync(randomBytes(32).toString("hex"), 12);
db.pragma("foreign_keys = OFF");
db.transaction(() => {
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
      password=CASE WHEN id=? THEN password ELSE ? END,
      birth_date=NULL,email=NULL,phone=NULL,cpf=NULL,profile_image=NULL,
      preferred_type=NULL,preferred_brand=NULL,preferred_style=NULL`,
  ).run(primaryAdmin.id, primaryAdmin.id, primaryAdmin.id, disabledPassword);
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

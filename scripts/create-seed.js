import Database from "better-sqlite3";
import { copyFileSync, existsSync } from "fs";
import path from "path";

const source = path.resolve("server/data/store.db");
const target = path.resolve("server/data/store.seed.db");

if (!existsSync(source)) throw new Error("Banco operacional não encontrado");
copyFileSync(source, target);

const db = new Database(target);
db.pragma("foreign_keys = OFF");
db.transaction(() => {
  db.prepare("DELETE FROM sales").run();
  db.prepare("DELETE FROM users WHERE username <> 'admin'").run();
  db.prepare(`UPDATE users SET role='admin',name='Administrador',birth_date=NULL,email=NULL,phone=NULL,cpf=NULL,profile_image=NULL,preferred_type=NULL,preferred_brand=NULL,preferred_style=NULL WHERE username='admin'`).run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('sales')").run();
})();
db.pragma("wal_checkpoint(TRUNCATE)");
db.exec("VACUUM");
db.close();
console.log(`Banco público criado em ${target}`);

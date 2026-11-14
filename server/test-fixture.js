import Database from "better-sqlite3";

// Never read the operational database to run tests. Keep a minimal legacy schema
// here so application migrations are exercised against an empty isolated database.
export function testSchema() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users(
      id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,password TEXT NOT NULL,
      role TEXT NOT NULL,name TEXT,birth_date TEXT,email TEXT,phone TEXT,cpf TEXT,
      preferred_type TEXT,preferred_brand TEXT,preferred_style TEXT,profile_image BLOB,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE products(
      id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,brand TEXT,style TEXT,type TEXT,
      price REAL NOT NULL DEFAULT 0,quantity INTEGER NOT NULL DEFAULT 0,expiration_date TEXT,image BLOB,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE sales(
      id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER REFERENCES products(id),
      quantity INTEGER NOT NULL,total_value REAL NOT NULL,user_id INTEGER REFERENCES users(id),
      sale_date TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

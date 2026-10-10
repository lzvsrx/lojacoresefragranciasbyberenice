import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import Database from "better-sqlite3";
import { createDatabase } from "./database.js";
import { migrateDatabase } from "../scripts/migrate-cloud.js";

for (const mode of ["local", "libsql"]) {
  test(`${mode}: transactions commit, rollback and preserve images`, async () => {
    const client =
      mode === "libsql" ? createClient({ url: "file::memory:" }) : undefined;
    const db = await createDatabase({ filename: ":memory:", client });
    try {
      await db.exec(
        "CREATE TABLE items(id INTEGER PRIMARY KEY,quantity INTEGER,image BLOB)",
      );
      const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      await db.prepare("INSERT INTO items VALUES(1,1,?)").run(image);
      assert.deepEqual(
        (await db.prepare("SELECT image FROM items WHERE id=1").get()).image,
        image,
      );
      const sale = db.transaction(async () => {
        const row = await db
          .prepare("SELECT quantity FROM items WHERE id=1")
          .get();
        if (row.quantity < 1) throw new Error("Sem estoque");
        await db
          .prepare("UPDATE items SET quantity=quantity-1 WHERE id=1")
          .run();
      });
      const results = await Promise.allSettled([sale(), sale()]);
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      await assert.rejects(
        db.transaction(async () => {
          await db.prepare("UPDATE items SET quantity=10 WHERE id=1").run();
          throw new Error("Falha simulada");
        })(),
      );
      assert.equal(
        (await db.prepare("SELECT quantity FROM items WHERE id=1").get())
          .quantity,
        0,
      );
    } finally {
      db.close();
    }
  });
}

test("cloud migration resumes after interruption, copies blobs and refuses overwriting a ready database", async () => {
  const source = new Database(":memory:");
  source.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE products(id INTEGER PRIMARY KEY,image BLOB)",
  );
  source.prepare("INSERT INTO users VALUES(1,'Teste')").run();
  const image = Buffer.from([1, 2, 3, 4]);
  source.prepare("INSERT INTO products VALUES(1,?)").run(image);
  const client = createClient({ url: "file::memory:" });
  let calls = 0;
  const broken = {
    execute: (...args) => client.execute(...args),
    batch: (...args) => {
      if (++calls === 2) throw new Error("Conexão interrompida");
      return client.batch(...args);
    },
  };
  try {
    await assert.rejects(migrateDatabase(source, broken));
    assert.equal(
      (await client.execute("SELECT status FROM app_cloud_migration")).rows[0]
        .status,
      "copying",
    );
    await migrateDatabase(source, client);
    assert.equal(
      (await client.execute("SELECT COUNT(*) count FROM users")).rows[0].count,
      1,
    );
    assert.deepEqual(
      Buffer.from(
        (await client.execute("SELECT image FROM products")).rows[0].image,
      ),
      image,
    );
    await assert.rejects(migrateDatabase(source, client), /já foi migrado/);
  } finally {
    source.close();
    client.close();
  }
});

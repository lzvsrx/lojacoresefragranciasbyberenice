import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { protectDefaultAdmin } from "./admin-bootstrap.js";

test("deployment recovery rotates only the seed password and invalidates old sessions", async () => {
  const db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE users (username TEXT, password TEXT, session_version INTEGER DEFAULT 0)",
    );
    db.prepare("INSERT INTO users (username,password) VALUES (?,?)").run(
      "admin",
      await bcrypt.hash("admin123", 4),
    );
    await assert.rejects(protectDefaultAdmin(db, {}), /Troque a senha/);
    await assert.rejects(
      protectDefaultAdmin(db, {
        ADMIN_BOOTSTRAP_PASSWORD_HASH: await bcrypt.hash("admin123", 12),
      }),
      /Troque a senha/,
    );
    const hash = await bcrypt.hash("isolated-strong-recovery-76ce875f", 12);
    assert.equal(
      await protectDefaultAdmin(db, { ADMIN_BOOTSTRAP_PASSWORD_HASH: hash }),
      true,
    );
    const account = db.prepare("SELECT * FROM users").get();
    assert.equal(account.password, hash);
    assert.equal(account.session_version, 1);
    assert.equal(
      await protectDefaultAdmin(db, {
        ADMIN_BOOTSTRAP_PASSWORD_HASH: await bcrypt.hash(
          "different-password",
          12,
        ),
      }),
      false,
    );
    assert.equal(db.prepare("SELECT password FROM users").get().password, hash);
  } finally {
    db.close();
  }
});

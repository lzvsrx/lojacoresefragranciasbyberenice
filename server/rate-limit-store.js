import { digest } from "./security.js";

// Shared SQLite/Turso counters survive cold starts and multiple application instances.
export class DatabaseRateLimitStore {
  constructor(db, secret, namespace) {
    this.db = db;
    this.secret = secret;
    this.namespace = namespace;
    this.localKeys = false;
  }
  init(options) {
    this.windowMs = options.windowMs;
  }
  key(value) {
    return digest(`${this.namespace}:${value}`, this.secret);
  }
  async increment(key) {
    const now = Date.now();
    const row = await this.db
      .prepare(
        `INSERT INTO security_rate_limits(key,total,expires_at) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET total=CASE WHEN expires_at<=? THEN 1 ELSE total+1 END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING total,expires_at`,
      )
      .get(this.key(key), now + this.windowMs, now, now);
    if (Math.random() < 0.01)
      await this.db
        .prepare("DELETE FROM security_rate_limits WHERE expires_at<=?")
        .run(now);
    return { totalHits: row.total, resetTime: new Date(row.expires_at) };
  }
  async decrement(key) {
    await this.db
      .prepare(
        "UPDATE security_rate_limits SET total=MAX(0,total-1) WHERE key=?",
      )
      .run(this.key(key));
  }
  async resetKey(key) {
    await this.db
      .prepare("DELETE FROM security_rate_limits WHERE key=?")
      .run(this.key(key));
  }
}

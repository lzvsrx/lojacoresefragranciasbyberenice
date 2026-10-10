import test from "node:test";
import assert from "node:assert/strict";
import { expirationStatus, storeToday } from "./expiration.js";

test("expiration includes today and the 30-day boundary without expiring early", () => {
  assert.equal(expirationStatus("2026-10-09", "2026-10-10").status, "expired");
  assert.equal(expirationStatus("2026-10-10", "2026-10-10").days, 0);
  assert.equal(expirationStatus("2026-11-09", "2026-10-10").status, "soon");
  assert.equal(expirationStatus("2026-11-10", "2026-10-10").status, "valid");
});

test("missing and invalid dates do not create false expiration warnings", () => {
  for (const value of [
    null,
    undefined,
    "",
    "invalid",
    "2026-02-30",
    "2026-13-01",
  ])
    assert.equal(expirationStatus(value, "2026-10-10"), null);
  assert.equal(expirationStatus("09/10/2026", "2026-10-10").status, "expired");
  assert.equal(expirationStatus("2028-02-29", "2028-02-28").days, 1);
});

test("uses the Sao Paulo calendar date across UTC midnight", () => {
  assert.equal(storeToday(new Date("2026-10-11T02:59:59Z")), "2026-10-10");
  assert.equal(storeToday(new Date("2026-10-11T03:00:00Z")), "2026-10-11");
});

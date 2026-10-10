import test from "node:test";
import assert from "node:assert/strict";
import { parseProductData } from "./product-data.js";

test("product data accepts empty and populated API responses", () => {
  const products = [{ id: 1, name: "Perfume", quantity: 2 }];
  const movements = [{ id: 1, quantity: 2 }];
  const losses = { items: [], total_cents: 0 };
  assert.deepEqual(parseProductData(products, movements, losses), {
    products, movements, losses,
  });
  assert.deepEqual(parseProductData([], [], losses).products, []);
});

test("invalid responses become recoverable load errors instead of render crashes", () => {
  const losses = { items: [], total_cents: 0 };
  for (const response of [
    [null, [], losses],
    [{ error: "unavailable" }, [], losses],
    [[null], [], losses],
    [[], {}, losses],
    [[], [null], losses],
    [[], [], null],
    [[], [], {}],
    [[], [], { items: [null], total_cents: 0 }],
    [[], [], { items: [], total_cents: "invalid" }],
  ]) {
    assert.throws(() => parseProductData(...response), /Tente novamente/);
  }
});

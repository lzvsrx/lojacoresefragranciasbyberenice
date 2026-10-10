import test from "node:test";
import assert from "node:assert/strict";
import { matchesProduct } from "./search.js";

test("product search ignores accents and matches words across name, brand and category", () => {
  const product = {
    id: 42,
    name: "Perfume Ação",
    brand: "Essência",
    type: "Cuidados",
    style: "Floral",
  };
  assert.equal(matchesProduct(product, "  ESSENCIA acao  "), true);
  assert.equal(matchesProduct(product, "floral 42 cuidados"), true);
  assert.equal(matchesProduct(product, "acao shampoo"), false);
  assert.equal(matchesProduct(product, ""), true);
});

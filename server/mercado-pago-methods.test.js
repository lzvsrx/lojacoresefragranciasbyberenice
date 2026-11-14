import test from "node:test";
import assert from "node:assert/strict";
import { normalizePaymentMethods } from "./mercado-pago-methods.js";

test("imported payment methods follow provider status and stock reservation policy", () => {
  const methods = normalizePaymentMethods([
    {
      id: "pix",
      name: "Pix",
      payment_type_id: "bank_transfer",
      status: "active",
      min_allowed_amount: 0.01,
      max_allowed_amount: 1000,
    },
    {
      id: "visa",
      name: "Visa",
      payment_type_id: "credit_card",
      status: "temporally_deactive",
    },
    {
      id: "boleto",
      name: "Boleto",
      payment_type_id: "ticket",
      status: "active",
    },
  ]);
  assert.equal(methods[0].enabled, true);
  assert.equal(methods[0].min_cents, 1);
  assert.equal(methods[0].max_cents, 100000);
  assert.equal(methods[1].enabled, false);
  assert.equal(methods[2].enabled, false);
  assert.throws(() => normalizePaymentMethods({ items: methods }));
  assert.throws(() =>
    normalizePaymentMethods([
      {
        id: "pix",
        name: "Pix",
        payment_type_id: "bank_transfer",
        status: "active",
      },
      {
        id: "pix",
        name: "Pix",
        payment_type_id: "bank_transfer",
        status: "active",
      },
    ]),
  );
  assert.throws(() =>
    normalizePaymentMethods([
      {
        id: "../unsafe",
        name: "Bad",
        payment_type_id: "credit_card",
        status: "active",
      },
    ]),
  );
});

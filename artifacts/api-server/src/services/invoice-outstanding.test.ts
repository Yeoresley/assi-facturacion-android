import assert from "node:assert/strict";
import test from "node:test";
import { outstandingByCurrency } from "./invoice-outstanding";

test("sums outstanding balances precisely by currency", () => {
  assert.deepEqual(
    outstandingByCurrency([
      { currency: "USD", status: "sent", balanceDue: 0.1 },
      { currency: "USD", status: "accepted", balanceDue: 0.2 },
      { currency: "CUP", status: "finished", balanceDue: 1.05 },
      { currency: "CUP", status: "confirmed", balanceDue: 2.15 },
    ]),
    [
      { currency: "CUP", amount: 3.2 },
      { currency: "USD", amount: 0.3 },
    ],
  );
});

test("excludes non-issued invoices and invoices without a pending balance", () => {
  assert.deepEqual(
    outstandingByCurrency([
      { currency: "USD", status: "draft", balanceDue: 50 },
      { currency: "USD", status: "paid", balanceDue: 0 },
      { currency: "CUP", status: "sent", balanceDue: 0 },
    ]),
    [],
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateSettlementPaymentBalance } from "./settlement-calculation";

test("keeps a preliminary amount pending until a real settlement payment is recorded", () => {
  assert.deepEqual(calculateSettlementPaymentBalance(1250, []), {
    paidAmount: 0,
    pendingAmount: 1250,
    overpaidAmount: 0,
    paymentStatus: "pending",
  });
});

test("tracks partial transfers and sums their paid amount", () => {
  assert.deepEqual(calculateSettlementPaymentBalance(1250, [{ amount: 300 }, { amount: 200.5 }]), {
    paidAmount: 500.5,
    pendingAmount: 749.5,
    overpaidAmount: 0,
    paymentStatus: "partial",
  });
});

test("marks the settlement paid only when its estimated amount has actually been recorded", () => {
  assert.deepEqual(calculateSettlementPaymentBalance(1250, [{ amount: 700 }, { amount: 550 }]), {
    paidAmount: 1250,
    pendingAmount: 0,
    overpaidAmount: 0,
    paymentStatus: "paid",
  });
});

test("distinguishes payments above the approved net from an exactly paid settlement", () => {
  assert.deepEqual(calculateSettlementPaymentBalance(1000, [{ amount: 700 }, { amount: 350 }]), {
    paidAmount: 1050,
    pendingAmount: 0,
    overpaidAmount: 50,
    paymentStatus: "overpaid",
  });
});

test("does not label a zero estimate as paid when no transfer exists", () => {
  assert.deepEqual(calculateSettlementPaymentBalance(0, []), {
    paidAmount: 0,
    pendingAmount: 0,
    overpaidAmount: 0,
    paymentStatus: "pending",
  });
});

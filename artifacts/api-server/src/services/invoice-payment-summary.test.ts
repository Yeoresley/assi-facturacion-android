import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizePaymentsByMethod } from "./invoice-payment";

test("payment summary uses effective corrections, excludes reversals and groups unspecified methods and currencies", () => {
  const result = summarizePaymentsByMethod([
    { id: 1, amount: 10, currency: "CUP", paidOn: "2026-09-30", paymentMethod: "transfer" },
    { id: 2, amount: 25, currency: "CUP", paidOn: "2026-10-15", paymentMethod: "cash" },
    { id: 3, amount: 70, currency: "USD", paidOn: "2026-10-15", paymentMethod: null },
    { id: 4, amount: 40, currency: "CUP", paidOn: "2026-10-15", paymentMethod: "other" },
  ], [
    { id: 1, targetPaymentId: 1, reversedPaymentId: null, afterPaymentAmount: 12, afterPaidOn: "2026-10-10" },
    { id: 2, targetPaymentId: 1, reversedPaymentId: null, afterPaymentAmount: 14.5, afterPaidOn: "2026-10-12", afterPaymentMethod: "cash" },
    { id: 3, targetPaymentId: null, reversedPaymentId: 4, afterPaymentAmount: null, afterPaidOn: null },
  ], "2026-10-01", "2026-10-31");

  assert.deepEqual(result, [
    { currency: "CUP", method: "cash", amount: 39.5, count: 2 },
    { currency: "USD", method: "unspecified", amount: 70, count: 1 },
  ]);
});

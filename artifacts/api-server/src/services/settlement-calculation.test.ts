import assert from "node:assert/strict";
import test from "node:test";
import {
  applySettlementPaymentCorrections,
  calculateIncomeTax,
  calculateSettlementTotals,
  convertToCup,
  settlementPaymentCompletionDate,
} from "./settlement-calculation";

test("progressive income tax applies each 2026 bracket only to its marginal slice", () => {
  assert.equal(calculateIncomeTax(3260), 0);
  assert.equal(calculateIncomeTax(9510), 187.5);
  assert.equal(calculateIncomeTax(15000), 462);
  assert.equal(calculateIncomeTax(20000), 837);
  assert.equal(calculateIncomeTax(25000), 1337);
  assert.equal(calculateIncomeTax(30000), 2087);
  assert.equal(calculateIncomeTax(0), 0);
  assert.equal(calculateIncomeTax(-100), 0);
});

test("calculates the 10/40/60/coefficient/CESS and income-tax sequence", () => {
  const result = calculateSettlementTotals({
    grossLicenses: 100000,
    grossServices: 50000,
    licenseCosts: 10000,
    operatingExpenses: 5000,
  });

  assert.deepEqual(result, {
    grossLicenses: 100000,
    grossServices: 50000,
    salesTax: 15000,
    licenseCosts: 10000,
    operatingExpenses: 5000,
    netLicenses: 80000,
    netServices: 40000,
    distributionBase: 56000,
    salaryAccrued: 43137.61,
    cess: 3563.76,
    incomeTax: 4714.52,
    netPayable: 34859.33,
  });
});

test("converts foreign-currency invoice values to CUP with half-up cent rounding", () => {
  assert.equal(convertToCup(12.345, 25.5), 314.8);
});

test("uses the final active receipt date and excludes reversed payments", () => {
  const payments = [
    { id: 1, amount: 60, paidOn: "2026-09-30" },
    { id: 2, amount: 40, paidOn: "2026-10-04" },
  ];
  assert.equal(settlementPaymentCompletionDate(100, payments), "2026-10-04");
  assert.equal(settlementPaymentCompletionDate(100, payments, [2]), null);
  assert.equal(settlementPaymentCompletionDate(100, payments.slice(0, 1)), null);
});

test("a corrected receipt date moves settlement month without changing original receipt data", () => {
  const originalPayments = [
    { id: 1, amount: 60, paidOn: "2026-09-29" },
    { id: 2, amount: 40, paidOn: "2026-10-01" },
  ];
  const corrections = [
    {
      id: 1,
      targetPaymentId: 1,
      reversedPaymentId: null,
      afterPaymentAmount: 55,
      afterPaidOn: "2026-09-29",
    },
    {
      id: 2,
      targetPaymentId: 2,
      reversedPaymentId: null,
      afterPaymentAmount: 45,
      afterPaidOn: "2026-09-30",
    },
  ];
  const originalCompletionDate = settlementPaymentCompletionDate(100, originalPayments);
  const { payments: effectivePayments, reversedPaymentIds } =
    applySettlementPaymentCorrections(originalPayments, corrections);
  const effectiveCompletionDate =
    settlementPaymentCompletionDate(100, effectivePayments, reversedPaymentIds);
  const effectivePaidAmount = effectivePayments.reduce((sum, payment) => sum + Number(payment.amount), 0);

  assert.equal(originalCompletionDate, "2026-10-01");
  assert.equal(effectiveCompletionDate, "2026-09-30");
  assert.equal(effectiveCompletionDate?.slice(0, 7), "2026-09");
  assert.equal(effectivePaidAmount, 100);
  assert.deepEqual(originalPayments, [
    { id: 1, amount: 60, paidOn: "2026-09-29" },
    { id: 2, amount: 40, paidOn: "2026-10-01" },
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
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

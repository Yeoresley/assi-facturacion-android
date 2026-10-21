import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollCsv } from './payroll-report';

test('genera un CSV de nómina compatible con Excel y separa las excepciones manuales', () => {
  const csv = buildPayrollCsv('2026-10', [{
    specialistName: 'Ana Pérez',
    includedInvoiceCount: 3,
    manualInclusionCount: 1,
    grossLicenses: 1200,
    grossServices: 850,
    salesTax: 205,
    licenseCosts: 40,
    operatingExpenses: 60,
    distributionBase: 1300,
    salaryAccrued: 1001.41,
    cess: 50.07,
    incomeTax: 12,
    netPayable: 939.34,
  }]);

  assert.ok(csv.startsWith('\uFEFF"Período";"Especialista"'));
  assert.match(csv, /"2026-10";"Ana Pérez";"3";"1"/);
  assert.match(csv, /"1001\.41";"50\.07";"12";"939\.34"/);
});

test('protege nombres que podrían convertirse en fórmulas al abrir el CSV', () => {
  const csv = buildPayrollCsv('2026-10', [{
    specialistName: '=HYPERLINK("https://example.com")',
    includedInvoiceCount: 1,
    manualInclusionCount: 0,
    grossLicenses: 0,
    grossServices: 100,
    salesTax: 10,
    licenseCosts: 0,
    operatingExpenses: 0,
    distributionBase: 54,
    salaryAccrued: 41.6,
    cess: 2.08,
    incomeTax: 0,
    netPayable: 39.52,
  }]);

  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.com""\)"/);
});

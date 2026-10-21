export type PayrollReportRow = {
  specialistName: string;
  includedInvoiceCount: number;
  manualInclusionCount: number;
  grossLicenses: number;
  grossServices: number;
  salesTax: number;
  licenseCosts: number;
  operatingExpenses: number;
  distributionBase: number;
  salaryAccrued: number;
  cess: number;
  incomeTax: number;
  netPayable: number;
};

function csvCell(value: string | number) {
  const raw = String(value);
  const safe = typeof value === 'string' && /^[\u0000-\u0020]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildPayrollCsv(period: string, rows: PayrollReportRow[]) {
  const headers = [
    'Período', 'Especialista', 'Facturas incluidas', 'Excepciones manuales',
    'Licencias brutas (CUP)', 'Servicios brutos (CUP)', 'Impuesto sobre ventas (CUP)',
    'Costos de licencias (CUP)', 'Gastos operativos (CUP)', 'Base de distribución (CUP)',
    'Salario devengado (CUP)', 'CESS (CUP)', 'Impuesto personal (CUP)', 'Neto estimado (CUP)',
  ];
  const table = [
    headers,
    ...rows.map((row) => [
      period,
      row.specialistName,
      row.includedInvoiceCount,
      row.manualInclusionCount,
      row.grossLicenses,
      row.grossServices,
      row.salesTax,
      row.licenseCosts,
      row.operatingExpenses,
      row.distributionBase,
      row.salaryAccrued,
      row.cess,
      row.incomeTax,
      row.netPayable,
    ]),
  ];
  return `\uFEFF${table.map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
}

import Decimal from "decimal.js";

export const settlementRules = {
  baseCurrency: "CUP",
  salesTaxRate: new Decimal("0.10"),
  licenseShare: new Decimal("0.40"),
  serviceShare: new Decimal("0.60"),
  salaryCoefficient: new Decimal("1.298171"),
  cessFirstBracketLimit: new Decimal("15000"),
  cessFirstRate: new Decimal("0.05"),
  cessExcessRate: new Decimal("0.10"),
  incomeTaxBrackets: [
    { limit: new Decimal("3260"), rate: new Decimal("0") },
    { limit: new Decimal("9510"), rate: new Decimal("0.03") },
    { limit: new Decimal("15000"), rate: new Decimal("0.05") },
    { limit: new Decimal("20000"), rate: new Decimal("0.075") },
    { limit: new Decimal("25000"), rate: new Decimal("0.10") },
    { limit: new Decimal("30000"), rate: new Decimal("0.15") },
    { limit: null, rate: new Decimal("0.20") },
  ],
} as const;

export type SettlementCalculationInput = {
  grossLicenses: Decimal.Value;
  grossServices: Decimal.Value;
  licenseCosts: Decimal.Value;
  operatingExpenses: Decimal.Value;
};

export function settlementPaymentCompletionDate(
  total: Decimal.Value,
  payments: Array<{ id: number; amount: Decimal.Value; paidOn: string }>,
  reversedPaymentIds: Iterable<number> = [],
): string | null {
  const reversed = new Set(reversedPaymentIds);
  const activePayments = payments.filter((payment) => !reversed.has(payment.id));
  const activeTotal = activePayments.reduce((sum, payment) => sum.plus(payment.amount), new Decimal(0));
  if (activeTotal.plus("0.005").lt(total) || activePayments.length === 0) return null;
  return activePayments.reduce<string | null>((latest, payment) =>
    !latest || payment.paidOn > latest ? payment.paidOn : latest, null);
}

function rounded(value: Decimal) {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function incomeTaxAmount(taxableSalary: Decimal.Value): Decimal {
  let remaining = Decimal.max(0, new Decimal(taxableSalary));
  let lowerLimit = new Decimal(0);
  let tax = new Decimal(0);

  for (const bracket of settlementRules.incomeTaxBrackets) {
    if (remaining.lte(0)) break;
    const bracketWidth = bracket.limit === null
      ? remaining
      : Decimal.min(remaining, new Decimal(bracket.limit).minus(lowerLimit));
    if (bracketWidth.gt(0)) tax = tax.plus(bracketWidth.mul(bracket.rate));
    if (bracket.limit === null) break;
    remaining = remaining.minus(bracketWidth);
    lowerLimit = new Decimal(bracket.limit);
  }

  return tax;
}

export function calculateIncomeTax(taxableSalary: Decimal.Value): number {
  return rounded(incomeTaxAmount(taxableSalary));
}

export function calculateSettlementTotals(input: SettlementCalculationInput) {
  const grossLicenses = new Decimal(input.grossLicenses);
  const grossServices = new Decimal(input.grossServices);
  const licenseCosts = new Decimal(input.licenseCosts);
  const operatingExpenses = new Decimal(input.operatingExpenses);
  const salesTax = grossLicenses.plus(grossServices).mul(settlementRules.salesTaxRate);
  const netLicenses = grossLicenses.mul(new Decimal(1).minus(settlementRules.salesTaxRate)).minus(licenseCosts);
  const netServices = grossServices.mul(new Decimal(1).minus(settlementRules.salesTaxRate)).minus(operatingExpenses);
  const distributionBase = netLicenses.mul(settlementRules.licenseShare)
    .plus(netServices.mul(settlementRules.serviceShare));
  const salaryAccrued = distributionBase.div(settlementRules.salaryCoefficient);
  const positiveSalary = Decimal.max(0, salaryAccrued);
  const cess = Decimal.min(positiveSalary, settlementRules.cessFirstBracketLimit)
    .mul(settlementRules.cessFirstRate)
    .plus(Decimal.max(0, positiveSalary.minus(settlementRules.cessFirstBracketLimit))
      .mul(settlementRules.cessExcessRate));
  const incomeTax = incomeTaxAmount(positiveSalary);
  const netPayable = salaryAccrued.minus(cess).minus(incomeTax);

  return {
    grossLicenses: rounded(grossLicenses),
    grossServices: rounded(grossServices),
    salesTax: rounded(salesTax),
    licenseCosts: rounded(licenseCosts),
    operatingExpenses: rounded(operatingExpenses),
    netLicenses: rounded(netLicenses),
    netServices: rounded(netServices),
    distributionBase: rounded(distributionBase),
    salaryAccrued: rounded(salaryAccrued),
    cess: rounded(cess),
    incomeTax: rounded(incomeTax),
    netPayable: rounded(netPayable),
  };
}

export function convertToCup(amount: Decimal.Value, rateToCup: Decimal.Value): number {
  return rounded(new Decimal(amount).mul(rateToCup));
}

import Decimal from "decimal.js";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  invoicesTable,
  settlementClassificationsTable,
  settlementExchangeRatesTable,
  settlementExpensesTable,
  settlementInvoiceInclusionsTable,
  teamMembersTable,
  type SettlementClosureSnapshot,
} from "@workspace/db";
import { getInvoiceRows } from "./invoice-records";
import {
  calculateSettlementTotals,
  convertToCup,
  settlementRules,
  settlementPaymentCompletionDate,
} from "./settlement-calculation";

function invoicePaidOn(invoice: Awaited<ReturnType<typeof getInvoiceRows>>[number]): string | null {
  const reversed = invoice.paymentCorrections.flatMap(({ reversedPaymentId }) =>
    reversedPaymentId === null ? [] : [reversedPaymentId]);
  const correctedPayments = new Map(invoice.paymentCorrections
    .filter((correction) => correction.targetPaymentId !== null)
    .sort((a, b) => a.id - b.id)
    .map((correction) => [correction.targetPaymentId!, correction]));
  const effectivePayments = invoice.payments.map((payment) => {
    const correction = correctedPayments.get(payment.id);
    return {
      ...payment,
      amount: correction?.afterPaymentAmount ?? payment.amount,
      paidOn: correction?.afterPaidOn ?? payment.paidOn,
    };
  });
  return settlementPaymentCompletionDate(invoice.total, effectivePayments, reversed);
}

const numberValue = (value: Decimal.Value) => new Decimal(value).toNumber();

export async function buildSettlementClosureSnapshot(
  period: string,
  specialistId: string,
): Promise<{
  snapshot: SettlementClosureSnapshot;
  missingServiceCount: number;
  missingCurrencies: string[];
}> {
  const [invoices, classifications, expenses, manualInclusions, activeInclusions, rates, teamMember] = await Promise.all([
    getInvoiceRows(undefined, and(
      eq(invoicesTable.status, "confirmed"),
      eq(invoicesTable.specialistId, specialistId),
    )),
    db.select().from(settlementClassificationsTable),
    db.select().from(settlementExpensesTable).where(and(
      eq(settlementExpensesTable.period, period),
      eq(settlementExpensesTable.specialistId, specialistId),
    )),
    db.select().from(settlementInvoiceInclusionsTable).where(and(
      eq(settlementInvoiceInclusionsTable.period, period),
      isNull(settlementInvoiceInclusionsTable.revokedAt),
    )),
    db.select({ invoiceId: settlementInvoiceInclusionsTable.invoiceId })
      .from(settlementInvoiceInclusionsTable).where(isNull(settlementInvoiceInclusionsTable.revokedAt)),
    db.select().from(settlementExchangeRatesTable).where(eq(settlementExchangeRatesTable.period, period)),
    db.select({ name: teamMembersTable.name }).from(teamMembersTable)
      .where(and(eq(teamMembersTable.userId, specialistId), eq(teamMembersTable.role, "specialist"))).limit(1),
  ]);

  const activeInclusionInvoiceIds = new Set(activeInclusions.map(({ invoiceId }) => invoiceId));
  const manualByInvoice = new Map(manualInclusions.map((inclusion) => [inclusion.invoiceId, inclusion]));
  const rateByCurrency = new Map<string, number>([[settlementRules.baseCurrency, 1]]);
  for (const rate of rates) rateByCurrency.set(rate.currency.toUpperCase(), rate.rateToCup);
  const byServiceCode = new Map(classifications.flatMap((entry) =>
    entry.serviceCode ? [[entry.serviceCode, entry.salesType] as const] : []));
  const byInvoiceLine = new Map(classifications.flatMap((entry) =>
    entry.invoiceLineId !== null ? [[entry.invoiceLineId, entry.salesType] as const] : []));
  const specialistName = teamMember[0]?.name
    ?? invoices.find((invoice) => invoice.specialistName)?.specialistName
    ?? "Especialista";
  const includedInvoices: Array<{
    invoice: (typeof invoices)[number];
    inclusionType: "paid_in_month" | "manual";
    inclusionReason: string | null;
  }> = [];
  for (const invoice of invoices) {
    const inclusion = manualByInvoice.get(invoice.id);
    if (inclusion) {
      includedInvoices.push({ invoice, inclusionType: "manual", inclusionReason: inclusion.reason });
      continue;
    }
    if (invoice.paymentStatus !== "paid" || activeInclusionInvoiceIds.has(invoice.id)) continue;
    const paidOn = invoicePaidOn(invoice);
    if (paidOn?.startsWith(period)) {
      includedInvoices.push({ invoice, inclusionType: "paid_in_month", inclusionReason: null });
    }
  }

  let grossLicenses = new Decimal(0);
  let grossServices = new Decimal(0);
  let missingServiceCount = 0;
  const missingCurrencies = new Set<string>();
  const closureInvoices: SettlementClosureSnapshot["invoices"] = [];

  for (const { invoice, inclusionType, inclusionReason } of includedInvoices) {
    const rateToCup = rateByCurrency.get(invoice.currency.toUpperCase());
    if (rateToCup === undefined) missingCurrencies.add(invoice.currency);
    const lines = invoice.lines.map((line) => {
      const salesType = byInvoiceLine.get(line.id) ?? (line.serviceCode ? byServiceCode.get(line.serviceCode) : undefined);
      if (!salesType) missingServiceCount++;
      if (salesType && rateToCup !== undefined) {
        const converted = convertToCup(line.amount, rateToCup);
        if (salesType === "license") grossLicenses = grossLicenses.plus(converted);
        else grossServices = grossServices.plus(converted);
      }
      return {
        invoiceLineId: line.id,
        description: line.description,
        serviceCode: line.serviceCode,
        quantity: line.quantity,
        amount: line.amount,
        // Any missing classification is returned as a blocker; the API never persists this snapshot in that case.
        salesType: salesType!,
        rateToCup: rateToCup ?? 0,
        amountInCup: rateToCup === undefined ? 0 : convertToCup(line.amount, rateToCup),
      };
    });
    closureInvoices.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.versatNumber ?? invoice.number,
      customerName: invoice.customerName,
      specialistId,
      specialistName: invoice.specialistName || specialistName,
      issueDate: invoice.issueDate,
      currency: invoice.currency,
      total: invoice.total,
      totalPaid: invoice.totalPaid,
      balanceDue: invoice.balanceDue,
      paidOn: invoicePaidOn(invoice),
      inclusionType,
      inclusionReason,
      lines,
    });
  }

  let licenseCosts = new Decimal(0);
  let operatingExpenses = new Decimal(0);
  const closureExpenses: SettlementClosureSnapshot["expenses"] = expenses.map((expense) => {
    const rateToCup = rateByCurrency.get(expense.currency.toUpperCase());
    if (rateToCup === undefined && !expense.voidedAt) missingCurrencies.add(expense.currency);
    const effectiveRate = rateToCup ?? 0;
    const amountInCup = expense.voidedAt ? 0 : convertToCup(expense.amount, effectiveRate);
    if (!expense.voidedAt && rateToCup !== undefined) {
      if (expense.expenseType === "license_cost") licenseCosts = licenseCosts.plus(amountInCup);
      else operatingExpenses = operatingExpenses.plus(amountInCup);
    }
    return {
      id: expense.id,
      expenseType: expense.expenseType,
      amount: expense.amount,
      currency: expense.currency,
      description: expense.description,
      createdBy: expense.createdBy,
      createdAt: expense.createdAt.toISOString(),
      voidedAt: expense.voidedAt?.toISOString() ?? null,
      voidedBy: expense.voidedBy,
      voidReason: expense.voidReason,
      rateToCup: effectiveRate,
      amountInCup,
    };
  });

  const totals = calculateSettlementTotals({ grossLicenses, grossServices, licenseCosts, operatingExpenses });
  const snapshot: SettlementClosureSnapshot = {
    invoices: closureInvoices,
    expenses: closureExpenses,
    exchangeRates: rates.map((rate) => ({
      currency: rate.currency,
      rateToCup: rate.rateToCup,
      updatedBy: rate.updatedBy,
      updatedAt: rate.updatedAt.toISOString(),
    })),
    rules: {
      calculationVersion: "modelo-2026-v1",
      calculationSteps: [
        "Neto de licencias = ingresos brutos de licencias × (1 − impuesto sobre ventas) − costos de licencias.",
        "Neto de servicios = ingresos brutos de servicios × (1 − impuesto sobre ventas) − gastos operativos.",
        "Base de distribución = neto de licencias × porcentaje de licencias + neto de servicios × porcentaje de servicios.",
        "Salario devengado = base de distribución ÷ coeficiente salarial.",
        "Neto aprobado = salario devengado − CESS − impuesto personal progresivo.",
      ],
      baseCurrency: settlementRules.baseCurrency,
      salesTaxRate: numberValue(settlementRules.salesTaxRate),
      licenseShare: numberValue(settlementRules.licenseShare),
      serviceShare: numberValue(settlementRules.serviceShare),
      salaryCoefficient: numberValue(settlementRules.salaryCoefficient),
      cessBrackets: [
        { limit: numberValue(settlementRules.cessFirstBracketLimit), rate: numberValue(settlementRules.cessFirstRate) },
        { limit: null, rate: numberValue(settlementRules.cessExcessRate) },
      ],
      incomeTaxBrackets: settlementRules.incomeTaxBrackets.map((bracket) => ({
        limit: bracket.limit === null ? null : numberValue(bracket.limit),
        rate: numberValue(bracket.rate),
      })),
    },
    totals,
  };
  return { snapshot, missingServiceCount, missingCurrencies: [...missingCurrencies].sort() };
}

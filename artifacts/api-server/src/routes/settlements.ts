import Decimal from "decimal.js";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateSettlementClassificationBody,
  CreateSettlementClassificationResponse,
  CreateSettlementClosureBody,
  CreateSettlementClosureResponse,
  CreateSettlementExpenseBody,
  CreateSettlementExpenseResponse,
  CreateSettlementInvoiceInclusionBody,
  CreateSettlementInvoiceInclusionResponse,
  CreateSettlementPaymentBody,
  CreateSettlementPaymentResponse,
  CorrectSettlementClosureBody,
  CorrectSettlementClosureParams,
  GetMonthlySettlementQueryParams,
  GetMonthlySettlementResponse,
  RevokeSettlementInvoiceInclusionBody,
  RevokeSettlementInvoiceInclusionParams,
  RevokeSettlementInvoiceInclusionResponse,
  UpdateSettlementExchangeRateBody,
  UpdateSettlementExchangeRateResponse,
  VoidSettlementExpenseBody,
  VoidSettlementExpenseParams,
  VoidSettlementExpenseResponse,
} from "@workspace/api-zod";
import {
  db,
  invoicesTable,
  invoiceLinesTable,
  settlementClassificationsTable,
  settlementClosuresTable,
  settlementExchangeRatesTable,
  settlementExpensesTable,
  settlementInvoiceInclusionsTable,
  settlementPaymentsTable,
  teamMembersTable,
  versatCatalogTable,
} from "@workspace/db";
import { resolveTeamMember } from "../middlewares/team-access";
import { getInvoiceRows } from "../services/invoice-records";
import {
  applySettlementPaymentCorrections,
  calculateSettlementPaymentBalance, convertToCup, calculateSettlementTotals,
  settlementPaymentCompletionDate, settlementRules,
} from "../services/settlement-calculation";
import { buildSettlementClosureSnapshot } from "../services/settlement-snapshot";

const router: IRouter = Router();
const roundedMoney = (value: number) => new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

class SettlementRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function isDuplicate(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; cause?: unknown };
  return value.code === "23505" || isDuplicate(value.cause);
}

function settlementPaidOn(invoice: Awaited<ReturnType<typeof getInvoiceRows>>[number]): string | null {
  const { payments, reversedPaymentIds } = applySettlementPaymentCorrections(
    invoice.payments,
    invoice.paymentCorrections,
  );
  return settlementPaymentCompletionDate(invoice.total, payments, reversedPaymentIds);
}

function serializedExpense(expense: typeof settlementExpensesTable.$inferSelect) {
  return {
    ...expense,
    createdAt: expense.createdAt.toISOString(),
    voidedAt: expense.voidedAt?.toISOString() ?? null,
  };
}

function serializedRate(rate: typeof settlementExchangeRatesTable.$inferSelect) {
  return { ...rate, updatedAt: rate.updatedAt.toISOString() };
}

function serializedInclusion(inclusion: typeof settlementInvoiceInclusionsTable.$inferSelect) {
  return {
    ...inclusion,
    includedAt: inclusion.includedAt.toISOString(),
    revokedAt: inclusion.revokedAt?.toISOString() ?? null,
  };
}

function serializedSettlementPayment(payment: typeof settlementPaymentsTable.$inferSelect) {
  return { ...payment, recordedAt: payment.recordedAt.toISOString() };
}

function serializedSettlementClosure(closure: typeof settlementClosuresTable.$inferSelect) {
  return { ...closure, approvedAt: closure.approvedAt.toISOString() };
}

async function settlementNetPayableForPayment(period: string, specialistId: string): Promise<number> {
  const [closure] = await db.select().from(settlementClosuresTable).where(and(
    eq(settlementClosuresTable.period, period),
    eq(settlementClosuresTable.specialistId, specialistId),
  )).orderBy(desc(settlementClosuresTable.version)).limit(1);
  if (closure) return closure.snapshot.totals.netPayable;

  const invoiceScope = and(
    eq(invoicesTable.status, "confirmed"),
    eq(invoicesTable.specialistId, specialistId),
  );
  const [invoices, classifications, expenses, periodInclusions, activeInclusions, rates] = await Promise.all([
    getInvoiceRows(undefined, invoiceScope),
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
  ]);
  const activeInclusionIds = new Set(activeInclusions.map(({ invoiceId }) => invoiceId));
  const manualInclusionIds = new Set(periodInclusions.map(({ invoiceId }) => invoiceId));
  const includedInvoices = invoices.filter((invoice) => manualInclusionIds.has(invoice.id)
    || (invoice.paymentStatus === "paid" && !activeInclusionIds.has(invoice.id)
      && settlementPaidOn(invoice)?.startsWith(period)));
  const byServiceCode = new Map(classifications.flatMap((entry) =>
    entry.serviceCode ? [[entry.serviceCode, entry.salesType] as const] : []));
  const byInvoiceLine = new Map(classifications.flatMap((entry) =>
    entry.invoiceLineId !== null ? [[entry.invoiceLineId, entry.salesType] as const] : []));
  const rateByCurrency = new Map<string, number>([[settlementRules.baseCurrency, 1]]);
  for (const rate of rates) rateByCurrency.set(rate.currency.toUpperCase(), rate.rateToCup);
  let grossLicenses = new Decimal(0);
  let grossServices = new Decimal(0);
  let missingServiceCount = 0;
  const missingCurrencies = new Set<string>();

  for (const invoice of includedInvoices) {
    const rateToCup = rateByCurrency.get(invoice.currency.toUpperCase());
    if (rateToCup === undefined) missingCurrencies.add(invoice.currency);
    for (const line of invoice.lines) {
      const salesType = byInvoiceLine.get(line.id) ?? (line.serviceCode ? byServiceCode.get(line.serviceCode) : undefined);
      if (!salesType) {
        missingServiceCount++;
      } else if (rateToCup !== undefined) {
        const convertedAmount = convertToCup(line.amount, rateToCup);
        if (salesType === "license") grossLicenses = grossLicenses.plus(convertedAmount);
        else grossServices = grossServices.plus(convertedAmount);
      }
    }
  }

  let licenseCosts = new Decimal(0);
  let operatingExpenses = new Decimal(0);
  for (const expense of expenses) {
    if (expense.voidedAt) continue;
    const rateToCup = rateByCurrency.get(expense.currency.toUpperCase());
    if (rateToCup === undefined) {
      missingCurrencies.add(expense.currency);
      continue;
    }
    const convertedAmount = convertToCup(expense.amount, rateToCup);
    if (expense.expenseType === "license_cost") licenseCosts = licenseCosts.plus(convertedAmount);
    else operatingExpenses = operatingExpenses.plus(convertedAmount);
  }

  if (missingServiceCount > 0 || missingCurrencies.size > 0) {
    throw new SettlementRequestError(
      "No se puede registrar el pago: primero completa las clasificaciones y tasas de la liquidación.",
      422,
    );
  }
  return calculateSettlementTotals({ grossLicenses, grossServices, licenseCosts, operatingExpenses }).netPayable;
}

router.get("/settlements", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const parsed = GetMonthlySettlementQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Selecciona un mes válido para la liquidación." });
    return;
  }

  const period = parsed.data.period;
  const owner = member.role === "owner";
  // Settlement ownership comes only from the saved specialist assignment. Versat's
  // commercialId is an export field and must never move salary credit implicitly.
  const invoiceScope = and(
    eq(invoicesTable.status, "confirmed"),
    owner ? undefined : eq(invoicesTable.specialistId, member.userId),
  );
  const paidAwaitingConfirmationScope = and(
    inArray(invoicesTable.status, ["finished", "accepted", "sent", "paid"]),
    owner ? undefined : eq(invoicesTable.specialistId, member.userId),
  );
  const [invoices, paidAwaitingConfirmationRows, classifications, expenses, currentPeriodInclusions, activeInclusions, rates, catalogServices, teamMembers, settlementPayments, closures] =
    await Promise.all([
      getInvoiceRows(undefined, invoiceScope),
      getInvoiceRows(undefined, paidAwaitingConfirmationScope),
      db.select().from(settlementClassificationsTable),
      db.select().from(settlementExpensesTable).where(and(
        eq(settlementExpensesTable.period, period),
        owner ? undefined : eq(settlementExpensesTable.specialistId, member.userId),
      )),
      db.select().from(settlementInvoiceInclusionsTable).where(and(
        eq(settlementInvoiceInclusionsTable.period, period),
        isNull(settlementInvoiceInclusionsTable.revokedAt),
      )),
      db.select({ invoiceId: settlementInvoiceInclusionsTable.invoiceId })
        .from(settlementInvoiceInclusionsTable).where(isNull(settlementInvoiceInclusionsTable.revokedAt)),
      db.select().from(settlementExchangeRatesTable).where(eq(settlementExchangeRatesTable.period, period)),
      db.select({
        serviceCode: versatCatalogTable.code,
        name: versatCatalogTable.name,
      }).from(versatCatalogTable).where(eq(versatCatalogTable.kind, "service"))
        .orderBy(versatCatalogTable.code),
      owner
        ? db.select({ userId: teamMembersTable.userId, name: teamMembersTable.name })
          .from(teamMembersTable).where(eq(teamMembersTable.role, "specialist"))
        : Promise.resolve([]),
      db.select().from(settlementPaymentsTable).where(and(
        eq(settlementPaymentsTable.period, period),
        owner ? undefined : eq(settlementPaymentsTable.specialistId, member.userId),
      )),
      db.select().from(settlementClosuresTable).where(and(
        eq(settlementClosuresTable.period, period),
        owner ? undefined : eq(settlementClosuresTable.specialistId, member.userId),
      )).orderBy(desc(settlementClosuresTable.version)),
    ]);
  const closureBySpecialist = new Map<string, typeof closures[number]>();
  const closureHistoryBySpecialist = new Map<string, typeof closures>();
  for (const closure of closures) {
    if (!closureBySpecialist.has(closure.specialistId)) closureBySpecialist.set(closure.specialistId, closure);
    const history = closureHistoryBySpecialist.get(closure.specialistId) ?? [];
    history.push(closure);
    closureHistoryBySpecialist.set(closure.specialistId, history);
  }

  const byServiceCode = new Map(classifications.flatMap((entry) =>
    entry.serviceCode ? [[entry.serviceCode, entry] as const] : []));
  const byInvoiceLine = new Map(classifications.flatMap((entry) =>
    entry.invoiceLineId !== null ? [[entry.invoiceLineId, entry] as const] : []));
  const activeInclusionByInvoice = new Map(activeInclusions.map((entry) => [entry.invoiceId, true]));
  const rateByCurrency = new Map<string, number>([[settlementRules.baseCurrency, 1]]);
  for (const rate of rates) rateByCurrency.set(rate.currency.toUpperCase(), rate.rateToCup);

  const confirmedInvoices = invoices.filter((invoice) => invoice.status === "confirmed");
  const paidAwaitingConfirmation = paidAwaitingConfirmationRows.flatMap((invoice) => {
    if (invoice.paymentStatus !== "paid") return [];
    // Legacy invoices may have been marked paid before payment receipts were recorded.
    const paidOn = settlementPaidOn(invoice) ?? invoice.paidAt?.toISOString().slice(0, 10) ?? null;
    if (!paidOn?.startsWith(period)) return [];
    return [{
      invoiceId: invoice.id,
      invoiceNumber: invoice.versatNumber ?? invoice.number,
      customerName: invoice.customerName,
      specialistId: invoice.specialistId,
      specialistName: invoice.specialistName,
      issueDate: invoice.issueDate,
      currency: invoice.currency,
      total: invoice.total,
      totalPaid: invoice.totalPaid,
      paidOn,
    }];
  }).sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.invoiceId - a.invoiceId);
  const automaticInvoices = confirmedInvoices.flatMap((invoice) => {
    if (invoice.paymentStatus !== "paid" || activeInclusionByInvoice.has(invoice.id)) return [];
    const paidOn = settlementPaidOn(invoice);
    return paidOn?.startsWith(period)
      ? [{ invoice, inclusion: null, paidOn, inclusionType: "paid_in_month" as const }]
      : [];
  });
  const manualInvoices = currentPeriodInclusions.flatMap((inclusion) => {
    const invoice = confirmedInvoices.find((candidate) => candidate.id === inclusion.invoiceId);
    return invoice
      ? [{ invoice, inclusion, paidOn: settlementPaidOn(invoice), inclusionType: "manual" as const }]
      : [];
  });
  const includedById = new Map<number, (typeof automaticInvoices)[number] | (typeof manualInvoices)[number]>();
  for (const item of automaticInvoices) includedById.set(item.invoice.id, item);
  for (const item of manualInvoices) includedById.set(item.invoice.id, item);
  const includedInvoices = [...includedById.values()];

  const specialistNames = new Map<string, string>();
  if (!owner) specialistNames.set(member.userId, member.name);
  for (const teamMember of teamMembers) specialistNames.set(teamMember.userId, teamMember.name);
  for (const { invoice } of includedInvoices) {
    if (!specialistNames.has(invoice.specialistId)) {
      specialistNames.set(invoice.specialistId, invoice.specialistName || "Especialista");
    }
  }
  for (const expense of expenses) {
    specialistNames.set(expense.specialistId, specialistNames.get(expense.specialistId) || "Especialista");
  }
  for (const payment of settlementPayments) {
    specialistNames.set(payment.specialistId, specialistNames.get(payment.specialistId) || "Especialista");
  }
  const paymentsBySpecialist = new Map<string, ReturnType<typeof serializedSettlementPayment>[]>();
  for (const payment of settlementPayments) {
    const payments = paymentsBySpecialist.get(payment.specialistId) ?? [];
    payments.push(serializedSettlementPayment(payment));
    paymentsBySpecialist.set(payment.specialistId, payments);
  }

  const resultsBySpecialist = new Map<string, {
    specialistId: string;
    specialistName: string;
    invoices: Array<Record<string, unknown>>;
    expenses: ReturnType<typeof serializedExpense>[];
    missingServiceCount: number;
    missingCurrencies: Set<string>;
    grossLicenses: Decimal;
    grossServices: Decimal;
    licenseCosts: Decimal;
    operatingExpenses: Decimal;
  }>();
  for (const [specialistId, specialistName] of specialistNames) {
    resultsBySpecialist.set(specialistId, {
      specialistId,
      specialistName,
      invoices: [],
      expenses: [],
      missingServiceCount: 0,
      missingCurrencies: new Set(),
      grossLicenses: new Decimal(0),
      grossServices: new Decimal(0),
      licenseCosts: new Decimal(0),
      operatingExpenses: new Decimal(0),
    });
  }

  const unclassifiedLines: Array<Record<string, unknown>> = [];
  for (const item of includedInvoices) {
    const { invoice } = item;
    const result = resultsBySpecialist.get(invoice.specialistId);
    if (!result) continue;
    const lines = invoice.lines.map((line) => {
      const category = byInvoiceLine.get(line.id) ?? (line.serviceCode ? byServiceCode.get(line.serviceCode) : undefined);
      if (!category) {
        unclassifiedLines.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.versatNumber ?? invoice.number,
          customerName: invoice.customerName,
          specialistId: invoice.specialistId,
          specialistName: invoice.specialistName,
          invoiceLineId: line.id,
          serviceCode: line.serviceCode,
          description: line.description,
          amount: line.amount,
          currency: invoice.currency,
        });
      }
      return {
        invoiceLineId: line.id,
        description: line.description,
        serviceCode: line.serviceCode,
        quantity: line.quantity,
        amount: line.amount,
        salesType: category?.salesType ?? null,
      };
    });
    const missingLineCount = lines.filter((line) => line.salesType === null).length;
    result.missingServiceCount += missingLineCount;
    const rateToCup = rateByCurrency.get(invoice.currency.toUpperCase());
    if (rateToCup === undefined) result.missingCurrencies.add(invoice.currency);
    if (!missingLineCount && rateToCup !== undefined) {
      for (const line of lines) {
        const convertedAmount = convertToCup(line.amount, rateToCup);
        if (line.salesType === "license") result.grossLicenses = result.grossLicenses.plus(convertedAmount);
        else if (line.salesType === "service") result.grossServices = result.grossServices.plus(convertedAmount);
      }
    }
    result.invoices.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.versatNumber ?? invoice.number,
      customerName: invoice.customerName,
      specialistId: invoice.specialistId,
      specialistName: invoice.specialistName,
      issueDate: invoice.issueDate,
      currency: invoice.currency,
      total: invoice.total,
      totalPaid: invoice.totalPaid,
      balanceDue: invoice.balanceDue,
      paidOn: item.paidOn,
      inclusionType: item.inclusionType,
      inclusionId: item.inclusion?.id ?? null,
      inclusionReason: item.inclusion?.reason ?? null,
      lines,
    });
  }

  for (const expense of expenses) {
    const result = resultsBySpecialist.get(expense.specialistId);
    if (!result) continue;
    result.expenses.push(serializedExpense(expense));
    if (expense.voidedAt) continue;
    const rateToCup = rateByCurrency.get(expense.currency.toUpperCase());
    if (rateToCup === undefined) {
      result.missingCurrencies.add(expense.currency);
      continue;
    }
    const convertedAmount = convertToCup(expense.amount, rateToCup);
    if (expense.expenseType === "license_cost") result.licenseCosts = result.licenseCosts.plus(convertedAmount);
    else result.operatingExpenses = result.operatingExpenses.plus(convertedAmount);
  }

  const results = [...resultsBySpecialist.values()].map((result) => {
    const totals = calculateSettlementTotals({
      grossLicenses: result.grossLicenses,
      grossServices: result.grossServices,
      licenseCosts: result.licenseCosts,
      operatingExpenses: result.operatingExpenses,
    });
    const payments = (paymentsBySpecialist.get(result.specialistId) ?? [])
      .sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.id - b.id);
    const closure = closureBySpecialist.get(result.specialistId) ?? null;
    const balance = calculateSettlementPaymentBalance(closure?.snapshot.totals.netPayable ?? totals.netPayable, payments);
    return {
      specialistId: result.specialistId,
      specialistName: result.specialistName,
      invoices: result.invoices,
      expenses: result.expenses.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      totals,
      missingServiceCount: result.missingServiceCount,
      missingCurrencies: [...result.missingCurrencies].sort(),
      payments,
      closure: closure ? serializedSettlementClosure(closure) : null,
      closureHistory: (closureHistoryBySpecialist.get(result.specialistId) ?? [])
        .slice().reverse().map(serializedSettlementClosure),
      ...balance,
    };
  }).sort((a, b) => a.specialistName.localeCompare(b.specialistName));

  const serviceTypes = new Map(byServiceCode);
  const serviceCatalog = catalogServices.map((entry) => ({
    serviceCode: entry.serviceCode,
    name: entry.name,
    salesType: serviceTypes.get(entry.serviceCode)?.salesType ?? null,
  }));
  const unpaidCandidates = owner
    ? confirmedInvoices
      .filter((invoice) => invoice.paymentStatus === "pending" && !activeInclusionByInvoice.has(invoice.id))
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.id - a.id)
      .slice(0, 500)
      .map((invoice) => ({
        invoiceId: invoice.id,
        invoiceNumber: invoice.versatNumber ?? invoice.number,
        specialistId: invoice.specialistId,
        specialistName: invoice.specialistName,
        customerName: invoice.customerName,
        issueDate: invoice.issueDate,
        currency: invoice.currency,
        total: invoice.total,
        totalPaid: invoice.totalPaid,
        balanceDue: invoice.balanceDue,
      }))
    : [];

  res.json(GetMonthlySettlementResponse.parse({
    period,
    baseCurrency: settlementRules.baseCurrency,
    results,
    serviceCatalog,
    unpaidCandidates,
    paidAwaitingConfirmation,
    exchangeRates: rates.map(serializedRate),
    unclassifiedLines,
  }));
});

router.post("/settlements/classifications", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  if (member.role !== "owner") { res.status(403).json({ error: "Solo el administrador puede clasificar los servicios." }); return; }
  const parsed = CreateSettlementClassificationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "La clasificación no es válida." }); return; }
  const serviceCode = parsed.data.serviceCode?.trim() || null;
  const invoiceLineId = parsed.data.invoiceLineId ?? null;
  if (Boolean(serviceCode) === (invoiceLineId !== null)) {
    res.status(400).json({ error: "Indica un código de servicio o un renglón de factura, pero no ambos." });
    return;
  }

  let label: string | null = null;
  if (serviceCode) {
    const [catalogEntry] = await db.select({ name: versatCatalogTable.name }).from(versatCatalogTable)
      .where(and(eq(versatCatalogTable.kind, "service"), eq(versatCatalogTable.code, serviceCode))).limit(1);
    const [previousLine] = await db.select({ description: invoiceLinesTable.description }).from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.serviceCode, serviceCode)).limit(1);
    label = catalogEntry?.name ?? previousLine?.description ?? null;
  } else if (invoiceLineId !== null) {
    const [line] = await db.select({ description: invoiceLinesTable.description })
      .from(invoiceLinesTable).innerJoin(invoicesTable, eq(invoiceLinesTable.invoiceId, invoicesTable.id))
      .where(and(eq(invoiceLinesTable.id, invoiceLineId), eq(invoicesTable.status, "confirmed"))).limit(1);
    label = line?.description ?? null;
  }
  if (!label) { res.status(404).json({ error: "No se encontró el servicio o renglón de factura." }); return; }

  try {
    const existing = await db.select().from(settlementClassificationsTable).where(serviceCode
      ? eq(settlementClassificationsTable.serviceCode, serviceCode)
      : eq(settlementClassificationsTable.invoiceLineId, invoiceLineId!)).limit(1);
    const [saved] = existing.length
      ? await db.update(settlementClassificationsTable).set({
        salesType: parsed.data.salesType, label, updatedBy: member.userId, updatedAt: new Date(),
      }).where(eq(settlementClassificationsTable.id, existing[0].id)).returning()
      : await db.insert(settlementClassificationsTable).values({
        serviceCode, invoiceLineId, salesType: parsed.data.salesType, label, updatedBy: member.userId,
      }).returning();
    res.status(201).json(CreateSettlementClassificationResponse.parse({
      id: saved.id, serviceCode: saved.serviceCode, invoiceLineId: saved.invoiceLineId,
      salesType: saved.salesType, label: saved.label, updatedAt: saved.updatedAt.toISOString(),
    }));
  } catch (error) {
    res.status(isDuplicate(error) ? 409 : 500).json({
      error: isDuplicate(error) ? "La clasificación cambió en otra sesión. Actualiza la página." : "No se pudo guardar la clasificación.",
    });
  }
});

router.post("/settlements/expenses", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  if (member.role !== "owner") { res.status(403).json({ error: "Solo el administrador puede registrar gastos." }); return; }
  const parsed = CreateSettlementExpenseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Revisa el mes, importe, moneda y descripción del gasto." }); return; }
  const input = parsed.data;
  const description = input.description.trim();
  if (!description) { res.status(400).json({ error: "La descripción del gasto es obligatoria." }); return; }
  if (new Decimal(input.amount).decimalPlaces() > 2) {
    res.status(422).json({ error: "El importe del gasto admite como máximo dos decimales." });
    return;
  }
  const currency = input.currency.trim();
  const [knownSpecialist] = await db.select({ userId: teamMembersTable.userId }).from(teamMembersTable)
    .where(and(eq(teamMembersTable.userId, input.specialistId), eq(teamMembersTable.role, "specialist"))).limit(1);
  const [invoiceAssignment] = await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(eq(invoicesTable.specialistId, input.specialistId)).limit(1);
  if (!knownSpecialist && !invoiceAssignment) {
    res.status(404).json({ error: "No se encontró el especialista seleccionado." });
    return;
  }
  const [currencyCatalog] = await db.select({ id: versatCatalogTable.id }).from(versatCatalogTable)
    .where(and(eq(versatCatalogTable.kind, "currency"), eq(versatCatalogTable.code, currency))).limit(1);
  const [currencyUsed] = currencyCatalog ? [null] : await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(eq(invoicesTable.currency, currency)).limit(1);
  if (!currencyCatalog && !currencyUsed && currency !== settlementRules.baseCurrency) {
    res.status(422).json({ error: "La moneda no aparece en los catálogos ni en facturas existentes." });
    return;
  }
  const [created] = await db.insert(settlementExpensesTable).values({
    ...input,
    currency,
    description,
    createdBy: member.userId,
  }).returning();
  res.status(201).json(CreateSettlementExpenseResponse.parse(serializedExpense(created)));
});

router.post("/settlements/expenses/:id/void", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  if (member.role !== "owner") { res.status(403).json({ error: "Solo el administrador puede anular gastos." }); return; }
  const params = VoidSettlementExpenseParams.safeParse(req.params);
  const body = VoidSettlementExpenseBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "El motivo de anulación no es válido." }); return; }
  const reason = body.data.reason.trim();
  if (reason.length < 5) { res.status(400).json({ error: "El motivo debe tener al menos cinco caracteres." }); return; }
  const [expense] = await db.select().from(settlementExpensesTable)
    .where(eq(settlementExpensesTable.id, params.data.id)).limit(1);
  if (!expense) { res.status(404).json({ error: "No se encontró el gasto." }); return; }
  if (expense.voidedAt) { res.status(409).json({ error: "El gasto ya está anulado." }); return; }
  const [voided] = await db.update(settlementExpensesTable).set({
    voidedAt: new Date(),
    voidedBy: member.userId,
    voidReason: reason,
  }).where(eq(settlementExpensesTable.id, expense.id)).returning();
  res.json(VoidSettlementExpenseResponse.parse(serializedExpense(voided)));
});

router.post("/settlements/inclusions", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  if (member.role !== "owner") { res.status(403).json({ error: "Solo el administrador puede incluir una factura no cobrada." }); return; }
  const parsed = CreateSettlementInvoiceInclusionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "La excepción de liquidación no es válida." }); return; }
  const reason = parsed.data.reason.trim();
  if (reason.length < 5) { res.status(400).json({ error: "El motivo debe tener al menos cinco caracteres." }); return; }
  try {
    const created = await db.transaction(async (tx) => {
      const [locked] = await tx.select({ id: invoicesTable.id }).from(invoicesTable)
        .where(eq(invoicesTable.id, parsed.data.invoiceId)).for("update");
      if (!locked) throw new SettlementRequestError("No se encontró la factura.", 404);
      const [invoice] = await getInvoiceRows([locked.id], undefined, tx);
      if (!invoice || invoice.status !== "confirmed" || invoice.paymentStatus !== "pending") {
        throw new SettlementRequestError(
          "La inclusión manual solo se permite para facturas confirmadas que aún no estén completamente cobradas.",
          409,
        );
      }
      const [created] = await tx.insert(settlementInvoiceInclusionsTable).values({
        invoiceId: invoice.id, period: parsed.data.period, reason, includedBy: member.userId,
      }).returning();
      return created;
    });
    res.status(201).json(CreateSettlementInvoiceInclusionResponse.parse(serializedInclusion(created)));
  } catch (error) {
    const knownError = error instanceof SettlementRequestError;
    const duplicate = isDuplicate(error);
    res.status(knownError ? error.status : duplicate ? 409 : 500).json({
      error: knownError ? error.message
        : duplicate ? "Esta factura ya está incluida manualmente en una liquidación. Actualiza la página."
          : "No se pudo incluir la factura.",
    });
  }
});

router.post("/settlements/inclusions/:id/revoke", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  if (member.role !== "owner") { res.status(403).json({ error: "Solo el administrador puede retirar una excepción." }); return; }
  const params = RevokeSettlementInvoiceInclusionParams.safeParse(req.params);
  const body = RevokeSettlementInvoiceInclusionBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "El motivo para retirar la excepción no es válido." }); return; }
  const reason = body.data.reason.trim();
  if (reason.length < 5) { res.status(400).json({ error: "El motivo debe tener al menos cinco caracteres." }); return; }
  const [inclusion] = await db.select().from(settlementInvoiceInclusionsTable)
    .where(eq(settlementInvoiceInclusionsTable.id, params.data.id)).limit(1);
  if (!inclusion) { res.status(404).json({ error: "No se encontró la excepción." }); return; }
  if (inclusion.revokedAt) { res.status(409).json({ error: "La excepción ya fue retirada." }); return; }
  const [revoked] = await db.update(settlementInvoiceInclusionsTable).set({
    revokedAt: new Date(), revokedBy: member.userId, revokeReason: reason,
  }).where(eq(settlementInvoiceInclusionsTable.id, inclusion.id)).returning();
  res.json(RevokeSettlementInvoiceInclusionResponse.parse(serializedInclusion(revoked)));
});

router.put("/settlements/exchange-rates", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  if (member.role !== "owner") { res.status(403).json({ error: "Solo el administrador puede establecer tasas de conversión." }); return; }
  const parsed = UpdateSettlementExchangeRateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "La tasa de conversión no es válida." }); return; }
  const input = parsed.data;
  const currency = input.currency.trim();
  if (!currency) { res.status(400).json({ error: "Indica el código de moneda." }); return; }
  if (new Decimal(input.rateToCup).decimalPlaces() > 8) {
    res.status(422).json({ error: "La tasa admite como máximo ocho decimales." });
    return;
  }
  if (currency === settlementRules.baseCurrency) {
    res.status(422).json({ error: "La tasa de CUP es fija en 1 y no se puede cambiar." });
    return;
  }
  const [currencyCatalog] = await db.select({ id: versatCatalogTable.id }).from(versatCatalogTable)
    .where(and(eq(versatCatalogTable.kind, "currency"), eq(versatCatalogTable.code, currency))).limit(1);
  const [currencyUsed] = currencyCatalog ? [null] : await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(eq(invoicesTable.currency, currency)).limit(1);
  if (!currencyCatalog && !currencyUsed) {
    res.status(422).json({ error: "La moneda no aparece en los catálogos ni en facturas existentes." });
    return;
  }
  const [saved] = await db.insert(settlementExchangeRatesTable).values({
    ...input, currency, updatedBy: member.userId,
  }).onConflictDoUpdate({
    target: [settlementExchangeRatesTable.period, settlementExchangeRatesTable.currency],
    set: { rateToCup: input.rateToCup, updatedBy: member.userId, updatedAt: new Date() },
  }).returning();
  res.json(UpdateSettlementExchangeRateResponse.parse(serializedRate(saved)));
});

router.post("/settlements/closures", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  if (member.role !== "owner") {
    res.status(403).json({ error: "Solo el propietario puede aprobar y cerrar liquidaciones." });
    return;
  }
  const parsed = CreateSettlementClosureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Revisa el período y el especialista de la liquidación." });
    return;
  }
  const { period, specialistId } = parsed.data;
  const [specialist] = await db.select({ userId: teamMembersTable.userId }).from(teamMembersTable)
    .where(and(eq(teamMembersTable.userId, specialistId), eq(teamMembersTable.role, "specialist"))).limit(1);
  if (!specialist) {
    res.status(404).json({ error: "No se encontró el especialista." });
    return;
  }
  const { snapshot, missingServiceCount, missingCurrencies } =
    await buildSettlementClosureSnapshot(period, specialistId);
  if (missingServiceCount || missingCurrencies.length) {
    const missing: string[] = [];
    if (missingServiceCount) missing.push(`${missingServiceCount} clasificación(es)`);
    if (missingCurrencies.length) missing.push(`tasas para ${missingCurrencies.join(", ")}`);
    res.status(422).json({
      error: `No se puede cerrar: faltan ${missing.join(" y ")}.`,
    });
    return;
  }
  try {
    const created = await db.transaction(async (tx) => {
      const lockKey = `${period}:${specialistId}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const [latest] = await tx.select().from(settlementClosuresTable).where(and(
        eq(settlementClosuresTable.period, period),
        eq(settlementClosuresTable.specialistId, specialistId),
      )).orderBy(desc(settlementClosuresTable.version)).limit(1);
      if (latest) throw new SettlementRequestError("Esta liquidación ya está cerrada. Usa la opción de corrección.", 409);
      const [closure] = await tx.insert(settlementClosuresTable).values({
        period,
        specialistId,
        version: 1,
        snapshot,
        approvedBy: member.userId,
      }).returning();
      return closure;
    });
    res.status(201).json(CreateSettlementClosureResponse.parse(serializedSettlementClosure(created)));
  } catch (error) {
    const knownError = error instanceof SettlementRequestError;
    res.status(knownError ? error.status : 500).json({
      error: knownError ? error.message : "No se pudo cerrar la liquidación.",
    });
  }
});

router.post("/settlements/closures/:id/corrections", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  if (member.role !== "owner") {
    res.status(403).json({ error: "Solo el propietario puede corregir una liquidación cerrada." });
    return;
  }
  const params = CorrectSettlementClosureParams.safeParse(req.params);
  const parsed = CorrectSettlementClosureBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Indica un motivo válido para la corrección." });
    return;
  }
  const reason = parsed.data.reason.trim();
  if (reason.length < 5) {
    res.status(400).json({ error: "El motivo de la corrección debe tener al menos cinco caracteres." });
    return;
  }
  const [previous] = await db.select().from(settlementClosuresTable)
    .where(eq(settlementClosuresTable.id, params.data.id)).limit(1);
  if (!previous) {
    res.status(404).json({ error: "No se encontró el cierre que quieres corregir." });
    return;
  }
  const { snapshot, missingServiceCount, missingCurrencies } =
    await buildSettlementClosureSnapshot(previous.period, previous.specialistId);
  if (missingServiceCount || missingCurrencies.length) {
    res.status(422).json({
      error: "No se puede guardar la corrección mientras haya clasificaciones o tasas pendientes.",
    });
    return;
  }
  try {
    const created = await db.transaction(async (tx) => {
      const lockKey = `${previous.period}:${previous.specialistId}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const [latest] = await tx.select().from(settlementClosuresTable).where(and(
        eq(settlementClosuresTable.period, previous.period),
        eq(settlementClosuresTable.specialistId, previous.specialistId),
      )).orderBy(desc(settlementClosuresTable.version)).limit(1);
      if (!latest || latest.id !== previous.id) {
        throw new SettlementRequestError("La liquidación cambió en otra sesión. Actualiza la página.", 409);
      }
      const [closure] = await tx.insert(settlementClosuresTable).values({
        period: previous.period,
        specialistId: previous.specialistId,
        version: previous.version + 1,
        supersedesId: previous.id,
        snapshot,
        approvedBy: member.userId,
        correctionReason: reason,
      }).returning();
      return closure;
    });
    res.status(201).json(CreateSettlementClosureResponse.parse(serializedSettlementClosure(created)));
  } catch (error) {
    const knownError = error instanceof SettlementRequestError;
    res.status(knownError ? error.status : 500).json({
      error: knownError ? error.message : "No se pudo guardar la corrección.",
    });
  }
});

router.post("/settlements/payments", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  if (member.role !== "owner") {
    res.status(403).json({ error: "Solo el propietario puede registrar pagos de liquidación." });
    return;
  }

  const parsed = CreateSettlementPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Revisa el período, importe, fecha y referencia del pago." });
    return;
  }
  const input = parsed.data;
  const reference = input.reference.trim();
  if (!input.confirmReview) {
    res.status(400).json({ error: "Confirma que revisaste el cálculo antes de registrar el pago." });
    return;
  }
  if (!reference) {
    res.status(400).json({ error: "La referencia de transferencia es obligatoria." });
    return;
  }
  if (new Decimal(input.amount).decimalPlaces() > 2) {
    res.status(422).json({ error: "El importe del pago admite como máximo dos decimales." });
    return;
  }
  const paidOn = input.paidOn.toISOString().slice(0, 10);
  const rawPaidOn = (req.body as { paidOn?: unknown } | undefined)?.paidOn;
  if (typeof rawPaidOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rawPaidOn)
    || paidOn !== rawPaidOn || paidOn > new Date().toISOString().slice(0, 10)) {
    res.status(400).json({ error: "La fecha del pago debe ser válida y no futura." });
    return;
  }

  try {
    const netPayable = await settlementNetPayableForPayment(input.period, input.specialistId);
    if (netPayable <= 0) {
      res.status(422).json({ error: "El neto estimado debe ser positivo para registrar un pago." });
      return;
    }
    const created = await db.transaction(async (tx) => {
      const lockKey = `${input.period}:${input.specialistId}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const previousPayments = await tx.select().from(settlementPaymentsTable).where(and(
        eq(settlementPaymentsTable.period, input.period),
        eq(settlementPaymentsTable.specialistId, input.specialistId),
      ));
      const [latestClosure] = await tx.select().from(settlementClosuresTable).where(and(
        eq(settlementClosuresTable.period, input.period),
        eq(settlementClosuresTable.specialistId, input.specialistId),
      )).orderBy(desc(settlementClosuresTable.version)).limit(1);
      const approvedNetPayable = latestClosure?.snapshot.totals.netPayable ?? netPayable;
      const balance = calculateSettlementPaymentBalance(approvedNetPayable, previousPayments);
      if (balance.pendingAmount <= 0 || new Decimal(input.amount).gt(balance.pendingAmount)) {
        throw new SettlementRequestError(
          "El importe supera el saldo pendiente de la liquidación. Actualiza la página y revisa el cálculo.",
          409,
        );
      }
      const [payment] = await tx.insert(settlementPaymentsTable).values({
        period: input.period,
        specialistId: input.specialistId,
        amount: input.amount,
        paidOn,
        reference,
        recordedBy: member.userId,
      }).returning();
      return payment;
    });
    res.status(201).json(CreateSettlementPaymentResponse.parse(serializedSettlementPayment(created)));
  } catch (error) {
    const knownError = error instanceof SettlementRequestError;
    res.status(knownError ? error.status : 500).json({
      error: knownError ? error.message : "No se pudo registrar el pago de liquidación.",
    });
  }
});

export default router;

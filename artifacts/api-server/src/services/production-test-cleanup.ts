import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  invoiceLinesTable,
  invoiceNumberReservationsTable,
  invoicePaymentsTable,
  invoicePaymentCorrectionsTable,
  invoiceSharesTable,
  invoicesTable,
  settlementExpensesTable,
  settlementInvoiceInclusionsTable,
} from "@workspace/db";
import { lockNumbering } from "./invoice-numbering";

export type TestCleanupInvoiceTarget = {
  id: number;
  number: string;
  versatNumber: string;
  talon: string;
};

export type TestCleanupExpenseTarget = {
  id: number;
  period: string;
};

export type TestCleanupTargets = {
  invoices: TestCleanupInvoiceTarget[];
  expenses: TestCleanupExpenseTarget[];
};

export class TestCleanupError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

function ids(targets: TestCleanupTargets) {
  return targets.invoices.map(({ id }) => id);
}

function normalizedNumber(number: string) {
  return number.replaceAll("-", "");
}

async function countReservationConflicts(targets: TestCleanupTargets, executor = db) {
  let conflicts = 0;
  for (const target of targets.invoices) {
    const matches = await executor.select().from(invoiceNumberReservationsTable).where(
      sql`replace(${invoiceNumberReservationsTable.number}, '-', '') = ${normalizedNumber(target.versatNumber)}`,
    );
    if (
      matches.length > 1 ||
      (matches[0] && matches[0].invoiceId !== null && matches[0].invoiceId !== target.id) ||
      (matches[0]?.talon && matches[0].talon !== target.talon)
    ) conflicts += 1;
  }
  return conflicts;
}

export async function getProductionTestCleanupPreview(targets: TestCleanupTargets) {
  const invoiceIds = ids(targets);
  const invoiceRows = await db.select({
    id: invoicesTable.id,
    number: invoicesTable.number,
    versatNumber: invoicesTable.versatNumber,
    status: invoicesTable.status,
  }).from(invoicesTable).where(inArray(invoicesTable.id, invoiceIds));
  const expenseRows = targets.expenses.length
    ? await db.select({ id: settlementExpensesTable.id, period: settlementExpensesTable.period })
      .from(settlementExpensesTable)
      .where(inArray(settlementExpensesTable.id, targets.expenses.map(({ id }) => id)))
    : [];

  const [lines, payments, corrections, shares, inclusions] = invoiceIds.length
    ? await Promise.all([
      db.select({ id: invoiceLinesTable.id }).from(invoiceLinesTable).where(inArray(invoiceLinesTable.invoiceId, invoiceIds)),
      db.select({ id: invoicePaymentsTable.id }).from(invoicePaymentsTable).where(inArray(invoicePaymentsTable.invoiceId, invoiceIds)),
      db.select({ id: invoicePaymentCorrectionsTable.id }).from(invoicePaymentCorrectionsTable).where(inArray(invoicePaymentCorrectionsTable.invoiceId, invoiceIds)),
      db.select({ id: invoiceSharesTable.id }).from(invoiceSharesTable).where(inArray(invoiceSharesTable.invoiceId, invoiceIds)),
      db.select({ id: settlementInvoiceInclusionsTable.id }).from(settlementInvoiceInclusionsTable).where(inArray(settlementInvoiceInclusionsTable.invoiceId, invoiceIds)),
    ])
    : [[], [], [], [], []];

  const allTargetsPresent = invoiceRows.length === targets.invoices.length &&
    targets.invoices.every((target) => {
      const row = invoiceRows.find((candidate) => candidate.id === target.id);
      return row?.number === target.number && row.versatNumber === target.versatNumber;
    }) &&
    expenseRows.length === targets.expenses.length &&
    targets.expenses.every((target) => expenseRows.some((row) => row.id === target.id && row.period === target.period));
  const alreadyCleaned = invoiceRows.length === 0 && expenseRows.length === 0 &&
    lines.length === 0 && payments.length === 0 && corrections.length === 0 && shares.length === 0 && inclusions.length === 0;
  const reservationConflicts = await countReservationConflicts(targets);

  return {
    ready: allTargetsPresent && reservationConflicts === 0,
    alreadyCleaned,
    reason: !alreadyCleaned && !allTargetsPresent
      ? "Los registros de producción no coinciden completamente con el alcance autorizado. No se borrará nada."
      : reservationConflicts > 0
        ? "Hay una reserva de numeración incompatible. No se borrará nada."
        : null,
    invoices: invoiceRows.map(({ number, versatNumber, status }) => ({ number, versatNumber, status })),
    expenses: expenseRows.map(({ period }) => ({ period })),
    counts: {
      invoices: invoiceRows.length,
      lines: lines.length,
      payments: payments.length,
      corrections: corrections.length,
      shares: shares.length,
      settlementInclusions: inclusions.length,
      expenses: expenseRows.length,
    },
    reservationsToPreserve: targets.invoices.map(({ versatNumber }) => versatNumber),
  };
}

export async function deleteAuthorizedProductionTestData(targets: TestCleanupTargets) {
  return db.transaction(async (tx) => {
    await lockNumbering(tx);
    const invoiceIds = ids(targets);
    const invoiceRows = await tx.select().from(invoicesTable)
      .where(inArray(invoicesTable.id, invoiceIds)).for("update");
    const expenses = targets.expenses.length
      ? await tx.select().from(settlementExpensesTable)
        .where(inArray(settlementExpensesTable.id, targets.expenses.map(({ id }) => id))).for("update")
      : [];

    const targetsMatch = invoiceRows.length === targets.invoices.length &&
      targets.invoices.every((target) => {
        const row = invoiceRows.find((candidate) => candidate.id === target.id);
        return row?.number === target.number && row.versatNumber === target.versatNumber;
      }) &&
      expenses.length === targets.expenses.length &&
      targets.expenses.every((target) => expenses.some((row) => row.id === target.id && row.period === target.period));
    if (!targetsMatch) {
      throw new TestCleanupError("Los registros actuales no coinciden con la vista previa. No se borró nada.");
    }

    for (const target of targets.invoices) {
      const matches = await tx.select().from(invoiceNumberReservationsTable).where(
        sql`replace(${invoiceNumberReservationsTable.number}, '-', '') = ${normalizedNumber(target.versatNumber)}`,
      ).for("update");
      if (
        matches.length > 1 ||
        (matches[0] && matches[0].invoiceId !== null && matches[0].invoiceId !== target.id) ||
        (matches[0]?.talon && matches[0].talon !== target.talon)
      ) throw new TestCleanupError("Hay una reserva de numeración incompatible. No se borró nada.");
    }

    let reservationsCreated = 0;
    for (const target of targets.invoices) {
      const [reservation] = await tx.select().from(invoiceNumberReservationsTable).where(
        sql`replace(${invoiceNumberReservationsTable.number}, '-', '') = ${normalizedNumber(target.versatNumber)}`,
      ).for("update");
      if (!reservation) {
        await tx.insert(invoiceNumberReservationsTable).values({
          number: target.versatNumber,
          invoiceId: null,
          talon: target.talon,
        });
        reservationsCreated += 1;
      } else if (reservation.invoiceId !== null) {
        await tx.update(invoiceNumberReservationsTable)
          .set({ invoiceId: null, talon: target.talon })
          .where(eq(invoiceNumberReservationsTable.number, reservation.number));
    } else if (reservation.talon !== target.talon) {
      await tx.update(invoiceNumberReservationsTable)
        .set({ talon: target.talon })
        .where(eq(invoiceNumberReservationsTable.number, reservation.number));
      }
    }

    const deletedInclusions = invoiceIds.length
      ? await tx.delete(settlementInvoiceInclusionsTable)
        .where(inArray(settlementInvoiceInclusionsTable.invoiceId, invoiceIds)).returning({ id: settlementInvoiceInclusionsTable.id })
      : [];
    const deletedCorrections = invoiceIds.length
      ? await tx.delete(invoicePaymentCorrectionsTable)
        .where(inArray(invoicePaymentCorrectionsTable.invoiceId, invoiceIds)).returning({ id: invoicePaymentCorrectionsTable.id })
      : [];
    const deletedShares = invoiceIds.length
      ? await tx.delete(invoiceSharesTable)
        .where(inArray(invoiceSharesTable.invoiceId, invoiceIds)).returning({ id: invoiceSharesTable.id })
      : [];
    const deletedPayments = invoiceIds.length
      ? await tx.delete(invoicePaymentsTable)
        .where(inArray(invoicePaymentsTable.invoiceId, invoiceIds)).returning({ id: invoicePaymentsTable.id })
      : [];
    const deletedLines = invoiceIds.length
      ? await tx.delete(invoiceLinesTable)
        .where(inArray(invoiceLinesTable.invoiceId, invoiceIds)).returning({ id: invoiceLinesTable.id })
      : [];
    const deletedExpenses = targets.expenses.length
      ? await tx.delete(settlementExpensesTable)
        .where(inArray(settlementExpensesTable.id, targets.expenses.map(({ id }) => id))).returning({ id: settlementExpensesTable.id })
      : [];
    const deletedInvoices = invoiceIds.length
      ? await tx.delete(invoicesTable)
        .where(inArray(invoicesTable.id, invoiceIds)).returning({ id: invoicesTable.id })
      : [];

    if (deletedInvoices.length !== targets.invoices.length || deletedExpenses.length !== targets.expenses.length) {
      throw new TestCleanupError("No se pudieron borrar todos los registros autorizados; la transacción se revirtió.", 500);
    }

    return {
      deleted: {
        invoices: deletedInvoices.length,
        lines: deletedLines.length,
        payments: deletedPayments.length,
        corrections: deletedCorrections.length,
        shares: deletedShares.length,
        settlementInclusions: deletedInclusions.length,
        expenses: deletedExpenses.length,
      },
      reservationsCreated,
      reservationsPreserved: targets.invoices.length,
    };
  });
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  customersTable,
  db,
  invoiceLinesTable,
  invoiceNumberReservationsTable,
  invoicePaymentsTable,
  invoicePaymentCorrectionsTable,
  invoiceSharesTable,
  invoicesTable,
  invoiceSeriesTable,
  pool,
  settlementExpensesTable,
  settlementInvoiceInclusionsTable,
} from "@workspace/db";
import { deleteAuthorizedProductionTestData } from "./production-test-cleanup";

const tag = `TEST_CLEANUP_${randomUUID().replaceAll("-", "").slice(0, 12)}_`;
const reservationNumbers = [`${tag}HAB-26-091`, `${tag}HAB-26-092`];
let customerId: number;
let seriesId: number | undefined;
const invoiceIds: number[] = [];
const expenseIds: number[] = [];

before(async () => {
  const [customer] = await db.insert(customersTable).values({ name: tag }).returning();
  customerId = customer.id;
});

after(async () => {
  await db.delete(settlementInvoiceInclusionsTable).where(inArray(settlementInvoiceInclusionsTable.invoiceId, invoiceIds));
  await db.delete(invoicePaymentCorrectionsTable).where(inArray(invoicePaymentCorrectionsTable.invoiceId, invoiceIds));
  await db.delete(invoiceSharesTable).where(inArray(invoiceSharesTable.invoiceId, invoiceIds));
  await db.delete(invoicePaymentsTable).where(inArray(invoicePaymentsTable.invoiceId, invoiceIds));
  await db.delete(invoiceLinesTable).where(inArray(invoiceLinesTable.invoiceId, invoiceIds));
  await db.delete(invoiceNumberReservationsTable).where(inArray(invoiceNumberReservationsTable.number, reservationNumbers));
  await db.delete(invoicesTable).where(inArray(invoicesTable.id, invoiceIds));
  await db.delete(settlementExpensesTable).where(inArray(settlementExpensesTable.id, expenseIds));
  if (seriesId) await db.delete(invoiceSeriesTable).where(eq(invoiceSeriesTable.id, seriesId));
  if (customerId) await db.delete(customersTable).where(eq(customersTable.id, customerId));
  await pool.end();
});

test("authorized cleanup removes only target activity and permanently reserves issued numbers", async () => {
  const [series] = await db.insert(invoiceSeriesTable).values({
    name: `${tag}series`,
    prefix: `${tag}HAB-26-`,
    suffix: "",
    width: 3,
    talon: "5",
    nextNumber: 93,
    confirmedBy: "test",
  }).returning();
  seriesId = series.id;

  const [first, second] = await db.insert(invoicesTable).values([
    {
      number: `${tag}app-091`, customerId, specialistId: `${tag}user`,
      specialistName: "Test specialist", issueDate: "2026-10-20", currency: "CUP",
      status: "confirmed", versatNumber: reservationNumbers[0], seriesId: series.id, total: 10,
    },
    {
      number: `${tag}app-092`, customerId, specialistId: `${tag}user`,
      specialistName: "Test specialist", issueDate: "2026-10-20", currency: "CUP",
      status: "confirmed", versatNumber: reservationNumbers[1], seriesId: series.id, total: 20,
    },
  ]).returning();
  invoiceIds.push(first.id, second.id);

  await db.insert(invoiceLinesTable).values({
    invoiceId: first.id, description: "Synthetic test line", quantity: 1, unitPrice: 10, amount: 10,
  });
  const [payment] = await db.insert(invoicePaymentsTable).values({
    invoiceId: first.id, idempotencyKey: randomUUID(), amount: 10, currency: "CUP",
    paidOn: "2026-10-20", paidBy: `${tag}owner`,
  }).returning();
  await db.insert(invoicePaymentCorrectionsTable).values({
    invoiceId: first.id, idempotencyKey: randomUUID(), reason: "Synthetic test correction",
    correctedBy: `${tag}owner`, targetPaymentId: payment.id, beforeInvoiceStatus: "accepted",
    afterInvoiceStatus: "confirmed", beforePaymentStatus: "paid", afterPaymentStatus: "paid",
    beforeTotalPaid: 10, afterTotalPaid: 10,
  });
  await db.insert(invoiceSharesTable).values({
    invoiceId: first.id, paymentId: payment.id, tokenHash: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000),
  });
  await db.insert(settlementInvoiceInclusionsTable).values({
    invoiceId: first.id, period: "2026-10", reason: "Synthetic test inclusion", includedBy: `${tag}owner`,
  });
  const [expense] = await db.insert(settlementExpensesTable).values({
    period: "2026-10", specialistId: `${tag}user`, expenseType: "operating_expense",
    amount: 1, currency: "CUP", description: "Synthetic test expense", createdBy: `${tag}owner`,
  }).returning();
  expenseIds.push(expense.id);

  await db.insert(invoiceNumberReservationsTable).values({
    number: reservationNumbers[1], invoiceId: second.id, talon: "5",
  });

  const result = await deleteAuthorizedProductionTestData({
    invoices: [
      { id: first.id, number: first.number, versatNumber: reservationNumbers[0], talon: "5" },
      { id: second.id, number: second.number, versatNumber: reservationNumbers[1], talon: "5" },
    ],
    expenses: [{ id: expense.id, period: "2026-10" }],
  });

  assert.deepEqual(result.deleted, {
    invoices: 2,
    lines: 1,
    payments: 1,
    corrections: 1,
    shares: 1,
    settlementInclusions: 1,
    expenses: 1,
  });
  assert.equal(result.reservationsCreated, 1);
  assert.equal(result.reservationsPreserved, 2);
  assert.equal((await db.select().from(invoicesTable).where(inArray(invoicesTable.id, invoiceIds))).length, 0);
  assert.equal((await db.select().from(customersTable).where(eq(customersTable.id, customerId))).length, 1);
  assert.equal((await db.select().from(settlementExpensesTable).where(inArray(settlementExpensesTable.id, expenseIds))).length, 0);
  const reservations = await db.select().from(invoiceNumberReservationsTable)
    .where(inArray(invoiceNumberReservationsTable.number, reservationNumbers));
  assert.deepEqual(reservations.map((reservation) => [reservation.number, reservation.invoiceId, reservation.talon]), [
    [reservationNumbers[0], null, "5"],
    [reservationNumbers[1], null, "5"],
  ]);
  const [savedSeries] = await db.select().from(invoiceSeriesTable).where(eq(invoiceSeriesTable.id, series.id));
  assert.equal(savedSeries.nextNumber, 93);
});

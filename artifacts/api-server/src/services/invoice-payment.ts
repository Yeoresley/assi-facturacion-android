import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import {
  db, invoicePaymentCorrectionsTable, invoicePaymentsTable, invoicesTable, type Invoice,
} from "@workspace/db";
import type { CurrentTeamMember } from "../middlewares/team-access";

export const collectibleStatuses = ["finished", "accepted", "confirmed", "sent", "paid"] as const;

export function paymentStatus(invoice: Pick<Invoice, "status" | "paymentStatus">): "pending" | "paid" {
  // Preserve historical payment records without treating acceptance/import as payment.
  return invoice.status === "paid" ? "paid" : invoice.paymentStatus;
}

export function canRecordPayment(invoice: Pick<Invoice, "status" | "paymentStatus">): boolean {
  return paymentStatus(invoice) === "pending" && (collectibleStatuses as readonly string[]).includes(invoice.status);
}

export function cents(value: number): number {
  if (!Number.isFinite(value)) return NaN;
  const result = Math.round(value * 100);
  return Number.isSafeInteger(result) && Math.abs(result / 100 - value) < 1e-7 ? result : NaN;
}

export function validPaymentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function summarizePayments(invoice: Pick<Invoice, "id" | "status" | "paymentStatus" | "total">,
  payments: Array<Pick<typeof invoicePaymentsTable.$inferSelect, "id" | "amount" | "currency" | "paidOn" | "recordedAt">>,
  corrections: Array<typeof invoicePaymentCorrectionsTable.$inferSelect> = []) {
  const reversedPaymentIds = new Set(corrections.flatMap(({ reversedPaymentId }) =>
    reversedPaymentId === null ? [] : [reversedPaymentId]));
  const activePayments = payments.filter((payment) => !reversedPaymentIds.has(payment.id));
  const recordedCents = activePayments.reduce((sum, payment) => sum + cents(payment.amount), 0);
  // Legacy records marked paid before the payment ledger existed remain settled, without a fake receipt.
  const totalPaidCents = invoice.status === "paid" || invoice.paymentStatus === "paid"
    ? cents(invoice.total)
    : Math.min(recordedCents, cents(invoice.total));
  return {
    paymentStatus: invoice.status === "paid" || invoice.paymentStatus === "paid" ||
      totalPaidCents >= cents(invoice.total) ? "paid" as const : "pending" as const,
    totalPaid: totalPaidCents / 100,
    balanceDue: Math.max(0, cents(invoice.total) - totalPaidCents) / 100,
    payments: payments.map(({ id, amount, currency, paidOn, recordedAt }) => ({
      id, amount, currency, paidOn, recordedAt: recordedAt.toISOString(),
    })),
    paymentCorrections: corrections.map((correction) => ({
      ...correction,
      createdAt: correction.createdAt.toISOString(),
      originalPaidAt: correction.originalPaidAt?.toISOString() ?? null,
    })),
  };
}

export function paymentFilter(status: "pending" | "paid") {
  return status === "paid"
    ? or(eq(invoicesTable.paymentStatus, "paid"), eq(invoicesTable.status, "paid"))!
    : and(inArray(invoicesTable.status, [...collectibleStatuses]), ne(invoicesTable.status, "paid"),
      eq(invoicesTable.paymentStatus, "pending"))!;
}

export class InvoicePaymentError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function recordInvoicePayment(
  id: number,
  input: { amount: number; paidOn: string; idempotencyKey: string },
  actor: Pick<CurrentTeamMember, "role" | "userId">,
) {
  if (actor.role !== "owner") throw new InvoicePaymentError("Solo el administrador puede registrar abonos.", 403);
  const amountCents = cents(input.amount);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new InvoicePaymentError("El importe debe ser positivo y tener como máximo dos decimales.", 422);
  }
  if (!validPaymentDate(input.paidOn)) throw new InvoicePaymentError("Indica una fecha de pago válida.", 422);
  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id)).for("update");
    if (!invoice) throw new InvoicePaymentError("Factura no encontrada.", 404);
    const [duplicate] = await tx.select().from(invoicePaymentsTable).where(and(
      eq(invoicePaymentsTable.invoiceId, id),
      eq(invoicePaymentsTable.idempotencyKey, input.idempotencyKey),
    ));
    const corrections = await tx.select().from(invoicePaymentCorrectionsTable)
      .where(eq(invoicePaymentCorrectionsTable.invoiceId, id));
    if (duplicate) {
      if (cents(duplicate.amount) !== amountCents || duplicate.paidOn !== input.paidOn) {
        throw new InvoicePaymentError("Esta solicitud ya se usó para otro abono.", 409);
      }
      const entries = await tx.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, id));
      return { ...summarizePayments(invoice, entries, corrections), created: false };
    }
    if (!canRecordPayment(invoice)) {
      throw new InvoicePaymentError("Solo puedes registrar abonos de una factura terminada, aceptada o confirmada. No se admiten borradores, anuladas, canceladas ni facturas con error.", 409);
    }
    const entries = await tx.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, id));
    const alreadyPaidCents = cents(summarizePayments(invoice, entries, corrections).totalPaid);
    const totalCents = cents(invoice.total);
    if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new InvoicePaymentError("El total de la factura no es válido.", 409);
    const remainingCents = Math.max(0, totalCents - alreadyPaidCents);
    if (paymentStatus(invoice) === "paid" || remainingCents === 0) {
      throw new InvoicePaymentError("La factura ya está pagada por completo.", 409);
    }
    if (amountCents > remainingCents) {
      throw new InvoicePaymentError(`El abono supera el saldo pendiente de ${(remainingCents / 100).toFixed(2)} ${invoice.currency}.`, 422);
    }
    const nextPaidCents = alreadyPaidCents + amountCents;
    const [payment] = await tx.insert(invoicePaymentsTable).values({
      invoiceId: id, idempotencyKey: input.idempotencyKey,
      amount: amountCents / 100, currency: invoice.currency, paidOn: input.paidOn, paidBy: actor.userId,
    }).returning();
    const nextPayments = [...entries, payment];
    if (nextPaidCents === totalCents) {
      await tx.update(invoicesTable).set({
        paymentStatus: "paid", paidAt: new Date(), paidBy: actor.userId,
      }).where(eq(invoicesTable.id, id));
    }
    return { ...summarizePayments(
      { ...invoice, paymentStatus: nextPaidCents === totalCents ? "paid" : invoice.paymentStatus },
      nextPayments,
      corrections,
    ), created: true };
  });
}

export async function correctInvoicePayment(
  id: number,
  input: { reason: string; idempotencyKey: string; confirmed: boolean },
  actor: Pick<CurrentTeamMember, "role" | "userId">,
) {
  if (actor.role !== "owner") throw new InvoicePaymentError("Solo el administrador puede corregir un pago.", 403);
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 1000) {
    throw new InvoicePaymentError("El motivo debe tener entre 5 y 1000 caracteres.", 422);
  }
  if (input.confirmed !== true) throw new InvoicePaymentError("Confirma explícitamente la corrección.", 422);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) {
    throw new InvoicePaymentError("La clave de corrección no es válida.", 422);
  }

  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id)).for("update");
    if (!invoice) throw new InvoicePaymentError("Factura no encontrada.", 404);

    const [previousRequest] = await tx.select().from(invoicePaymentCorrectionsTable).where(and(
      eq(invoicePaymentCorrectionsTable.invoiceId, id),
      eq(invoicePaymentCorrectionsTable.idempotencyKey, input.idempotencyKey),
    ));
    const entries = await tx.select().from(invoicePaymentsTable)
      .where(eq(invoicePaymentsTable.invoiceId, id));
    const corrections = await tx.select().from(invoicePaymentCorrectionsTable)
      .where(eq(invoicePaymentCorrectionsTable.invoiceId, id));
    if (previousRequest) {
      if (previousRequest.reason !== reason) {
        throw new InvoicePaymentError("Esta solicitud ya se usó para otra corrección.", 409);
      }
      return { ...summarizePayments(invoice, entries, corrections), created: false };
    }

    if (paymentStatus(invoice) !== "paid") {
      throw new InvoicePaymentError("La factura ya no figura pagada; actualiza la factura antes de corregirla.", 409);
    }
    const before = summarizePayments(invoice, entries, corrections);
    const reversedPaymentIds = new Set(corrections.flatMap(({ reversedPaymentId }) =>
      reversedPaymentId === null ? [] : [reversedPaymentId]));
    const reversedPayment = [...entries].reverse().find((payment) => !reversedPaymentIds.has(payment.id));
    const afterInvoiceStatus = invoice.status === "paid"
      ? invoice.confirmedAt ? "confirmed" : invoice.acceptedAt ? "accepted" : "sent"
      : invoice.status;
    const afterInvoice = { ...invoice, status: afterInvoiceStatus as Invoice["status"], paymentStatus: "pending" as const };
    const afterEntries = reversedPayment
      ? entries.filter((payment) => payment.id !== reversedPayment.id)
      : entries;
    const after = summarizePayments(afterInvoice, afterEntries, corrections);
    const [correction] = await tx.insert(invoicePaymentCorrectionsTable).values({
      invoiceId: id,
      idempotencyKey: input.idempotencyKey,
      reason,
      correctedBy: actor.userId,
      reversedPaymentId: reversedPayment?.id ?? null,
      beforeInvoiceStatus: invoice.status,
      afterInvoiceStatus,
      beforePaymentStatus: "paid",
      afterPaymentStatus: "pending",
      beforeTotalPaid: before.totalPaid,
      afterTotalPaid: after.totalPaid,
      originalPaidBy: invoice.paidBy,
      originalPaidAt: invoice.paidAt,
    }).returning();
    await tx.update(invoicesTable).set({
      status: afterInvoiceStatus,
      paymentStatus: "pending",
      paidBy: null,
      paidAt: null,
    }).where(eq(invoicesTable.id, id));
    return {
      ...summarizePayments(afterInvoice, entries, [...corrections, correction]),
      created: true,
    };
  });
}

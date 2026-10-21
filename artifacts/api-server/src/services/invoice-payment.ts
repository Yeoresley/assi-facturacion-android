import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db, invoicePaymentsTable, invoicesTable, type Invoice } from "@workspace/db";
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
  payments: Array<Pick<typeof invoicePaymentsTable.$inferSelect, "id" | "amount" | "currency" | "paidOn" | "recordedAt">>) {
  const recordedCents = payments.reduce((sum, payment) => sum + cents(payment.amount), 0);
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
    if (duplicate) {
      if (cents(duplicate.amount) !== amountCents || duplicate.paidOn !== input.paidOn) {
        throw new InvoicePaymentError("Esta solicitud ya se usó para otro abono.", 409);
      }
      const entries = await tx.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, id));
      return { ...summarizePayments(invoice, entries), created: false };
    }
    if (!canRecordPayment(invoice)) {
      throw new InvoicePaymentError("Solo puedes registrar abonos de una factura terminada, aceptada o confirmada. No se admiten borradores, anuladas, canceladas ni facturas con error.", 409);
    }
    const entries = await tx.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, id));
    const alreadyPaidCents = invoice.status === "paid" || invoice.paymentStatus === "paid"
      ? cents(invoice.total)
      : entries.reduce((sum, entry) => sum + cents(entry.amount), 0);
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
    ), created: true };
  });
}

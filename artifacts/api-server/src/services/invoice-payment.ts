import { and, eq, inArray, ne, or } from "drizzle-orm";
import { db, invoicesTable, type Invoice } from "@workspace/db";
import type { CurrentTeamMember } from "../middlewares/team-access";

export const collectibleStatuses = ["finished", "accepted", "confirmed", "sent", "paid"] as const;

export function paymentStatus(invoice: Pick<Invoice, "status" | "paymentStatus">): "pending" | "paid" {
  // Preserve historical payment records without treating acceptance/import as payment.
  return invoice.status === "paid" ? "paid" : invoice.paymentStatus;
}

export function canRecordPayment(invoice: Pick<Invoice, "status" | "paymentStatus">): boolean {
  return paymentStatus(invoice) === "pending" && (collectibleStatuses as readonly string[]).includes(invoice.status);
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

export async function markInvoicePaid(id: number, actor: Pick<CurrentTeamMember, "role" | "userId">) {
  if (actor.role !== "owner") throw new InvoicePaymentError("Solo el administrador puede marcar una factura como pagada.", 403);
  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id)).for("update");
    if (!invoice) throw new InvoicePaymentError("Factura no encontrada.", 404);
    if (paymentStatus(invoice) === "paid") return; // Retry without changing the original actor/date.
    if (!canRecordPayment(invoice)) {
      throw new InvoicePaymentError("Solo puedes registrar el pago de una factura terminada, aceptada o confirmada. No se admiten borradores, anuladas, canceladas ni facturas con error.", 409);
    }
    await tx.update(invoicesTable).set({
      paymentStatus: "paid", paidAt: new Date(), paidBy: actor.userId,
    }).where(eq(invoicesTable.id, id));
  });
}

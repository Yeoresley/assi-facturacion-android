import { type BillingTransaction } from "./invoice-numbering";
import { invoiceAcceptanceNotificationsTable, type Invoice } from "@workspace/db";

export async function createInvoiceAcceptanceNotification(
  tx: BillingTransaction,
  invoice: Pick<Invoice, "id" | "number" | "specialistId">,
  reason: "payment" | "versat_import",
) {
  await tx.insert(invoiceAcceptanceNotificationsTable).values({
    invoiceId: invoice.id,
    recipientUserId: invoice.specialistId,
    invoiceNumber: invoice.number,
    reason,
  }).onConflictDoNothing({ target: invoiceAcceptanceNotificationsTable.invoiceId });
}

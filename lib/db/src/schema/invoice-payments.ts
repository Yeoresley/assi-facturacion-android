import { date, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { invoicesTable } from "./invoices";

// Append-only receipts. Corrections must retain the original row for audit.
export const invoicePaymentsTable = pgTable("invoice_payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull()
    .references(() => invoicesTable.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  paidOn: date("paid_on", { mode: "string" }).notNull(),
  paidBy: text("paid_by").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("invoice_payments_invoice_idempotency_uq")
    .on(table.invoiceId, table.idempotencyKey),
]);

export type InvoicePayment = typeof invoicePaymentsTable.$inferSelect;

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
  reference: text("reference"),
  paymentMethod: text("payment_method", { enum: ["transfer", "cash", "other"] }),
  paidBy: text("paid_by").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("invoice_payments_invoice_idempotency_uq")
    .on(table.invoiceId, table.idempotencyKey),
]);

// Append-only audit events. A correction references, but never edits or deletes, its receipt.
export const invoicePaymentCorrectionsTable = pgTable("invoice_payment_corrections", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull()
    .references(() => invoicesTable.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  reason: text("reason").notNull(),
  correctedBy: text("corrected_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  targetPaymentId: integer("target_payment_id")
    .references(() => invoicePaymentsTable.id),
  reversedPaymentId: integer("reversed_payment_id")
    .references(() => invoicePaymentsTable.id),
  beforePaymentAmount: numeric("before_payment_amount", { precision: 14, scale: 2, mode: "number" }),
  afterPaymentAmount: numeric("after_payment_amount", { precision: 14, scale: 2, mode: "number" }),
  beforePaidOn: date("before_paid_on", { mode: "string" }),
  afterPaidOn: date("after_paid_on", { mode: "string" }),
  beforePaymentMethod: text("before_payment_method", { enum: ["transfer", "cash", "other"] }),
  afterPaymentMethod: text("after_payment_method", { enum: ["transfer", "cash", "other"] }),
  beforeInvoiceStatus: text("before_invoice_status").notNull(),
  afterInvoiceStatus: text("after_invoice_status").notNull(),
  beforePaymentStatus: text("before_payment_status").notNull(),
  afterPaymentStatus: text("after_payment_status").notNull(),
  beforeTotalPaid: numeric("before_total_paid", { precision: 14, scale: 2, mode: "number" }).notNull(),
  afterTotalPaid: numeric("after_total_paid", { precision: 14, scale: 2, mode: "number" }).notNull(),
  originalPaidBy: text("original_paid_by"),
  originalPaidAt: timestamp("original_paid_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("invoice_payment_corrections_invoice_idempotency_uq")
    .on(table.invoiceId, table.idempotencyKey),
  uniqueIndex("invoice_payment_corrections_reversed_payment_uq")
    .on(table.reversedPaymentId),
]);

export type InvoicePayment = typeof invoicePaymentsTable.$inferSelect;
export type InvoicePaymentCorrection = typeof invoicePaymentCorrectionsTable.$inferSelect;

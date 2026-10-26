import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { invoicesTable } from "./invoices";

export const invoiceAcceptanceNotificationsTable = pgTable("invoice_acceptance_notifications", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => invoicesTable.id, { onDelete: "cascade" }),
  recipientUserId: text("recipient_user_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  reason: text("reason").$type<"payment" | "versat_import">().notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("invoice_acceptance_notifications_invoice_unique").on(table.invoiceId),
  index("invoice_acceptance_notifications_recipient_delivered_idx").on(table.recipientUserId, table.deliveredAt),
]);

export type InvoiceAcceptanceNotification = typeof invoiceAcceptanceNotificationsTable.$inferSelect;

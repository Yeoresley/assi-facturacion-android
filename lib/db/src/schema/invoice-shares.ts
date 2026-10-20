import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable } from "./invoices";

export const invoiceSharesTable = pgTable("invoice_shares", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => invoicesTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const insertInvoiceShareSchema = createInsertSchema(invoiceSharesTable).omit({
  id: true,
});
export type InsertInvoiceShare = z.infer<typeof insertInvoiceShareSchema>;
export type InvoiceShareRecord = typeof invoiceSharesTable.$inferSelect;

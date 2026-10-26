import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable } from "./invoices";
import { invoiceSharesTable } from "./invoice-shares";

export const invoiceImageAccessesTable = pgTable("invoice_image_accesses", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => invoicesTable.id, { onDelete: "cascade" }),
  shareId: integer("share_id")
    .notNull()
    .references(() => invoiceSharesTable.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"stamp" | "signature">().notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("invoice_image_accesses_invoice_opened_idx").on(table.invoiceId, table.openedAt),
]);

export const insertInvoiceImageAccessSchema = createInsertSchema(invoiceImageAccessesTable).omit({
  id: true,
});
export type InsertInvoiceImageAccess = z.infer<typeof insertInvoiceImageAccessSchema>;
export type InvoiceImageAccessRecord = typeof invoiceImageAccessesTable.$inferSelect;

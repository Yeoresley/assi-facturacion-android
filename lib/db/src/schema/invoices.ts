import {
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import type { VersatInvoiceSnapshot } from "./versat-catalog";
import type { LegalDocument } from "./issuer";

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  number: text("number").notNull().unique(),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customersTable.id),
  specialistId: text("specialist_id").notNull(),
  specialistName: text("specialist_name").notNull(),
  issueDate: date("issue_date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }),
  currency: text("currency").notNull(),
  status: text("status")
    .$type<"draft" | "sent" | "paid" | "cancelled">()
    .notNull()
    .default("draft"),
  notes: text("notes"),
  legalDocument: jsonb("legal_document").$type<LegalDocument>(),
  versat: jsonb("versat").$type<VersatInvoiceSnapshot>(),
  versatNumber: text("versat_number").unique(),
  // Kept without a circular FK; series are never deleted.
  seriesId: integer("series_id"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  total: numeric("total", { precision: 14, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const invoiceLinesTable = pgTable("invoice_lines", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => invoicesTable.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  serviceId: integer("service_id"),
  serviceCode: text("service_code"),
  groupCode: text("group_code"),
  unitCode: text("unit_code"),
  quantity: numeric("quantity", { precision: 14, scale: 4, mode: "number" })
    .notNull(),
  unitPrice: numeric("unit_price", { precision: 18, scale: 5, mode: "number" })
    .notNull(),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "number" })
    .notNull(),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
export type InvoiceLine = typeof invoiceLinesTable.$inferSelect;

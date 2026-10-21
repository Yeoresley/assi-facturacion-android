import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { invoicesTable } from "./invoices";

// Formats are immutable. Owners may retire a series or advance its counter, never rewind it.
export const invoiceSeriesTable = pgTable("invoice_series", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  prefix: text("prefix").notNull(),
  suffix: text("suffix").notNull(),
  width: integer("width").notNull(),
  talon: text("talon").notNull(),
  nextNumber: integer("next_number").notNull(),
  active: boolean("active").notNull().default(true),
  confirmedBy: text("confirmed_by").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only: even abandoned draft numbers remain unavailable to other invoices.
export const invoiceNumberReservationsTable = pgTable("invoice_number_reservations", {
  number: text("number").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id),
  talon: text("talon"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

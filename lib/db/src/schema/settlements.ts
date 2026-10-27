import {
  check,
  date,
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { invoiceLinesTable, invoicesTable } from "./invoices";

export type SettlementSalesType = "license" | "service";
export type SettlementExpenseType = "license_cost" | "operating_expense";

export type SettlementClosureSnapshot = {
  invoices: Array<{
    invoiceId: number;
    invoiceNumber: string;
    customerName: string;
    specialistId: string;
    specialistName: string;
    issueDate: string;
    currency: string;
    total: number;
    totalPaid: number;
    balanceDue: number;
    paidOn: string | null;
    inclusionType: "paid_in_month" | "manual";
    inclusionReason: string | null;
    lines: Array<{
      invoiceLineId: number;
      description: string;
      serviceCode: string | null;
      quantity: number;
      amount: number;
      salesType: SettlementSalesType;
      rateToCup: number;
      amountInCup: number;
    }>;
  }>;
  expenses: Array<{
    id: number;
    expenseType: SettlementExpenseType;
    amount: number;
    currency: string;
    description: string;
    createdBy: string;
    createdAt: string;
    voidedAt: string | null;
    voidedBy: string | null;
    voidReason: string | null;
    rateToCup: number;
    amountInCup: number;
  }>;
  exchangeRates: Array<{
    currency: string;
    rateToCup: number;
    updatedBy: string;
    updatedAt: string;
  }>;
  rules: {
    calculationVersion: string;
    calculationSteps: string[];
    baseCurrency: string;
    salesTaxRate: number;
    licenseShare: number;
    serviceShare: number;
    salaryCoefficient: number;
    cessBrackets: Array<{ limit: number | null; rate: number }>;
    incomeTaxBrackets: Array<{ limit: number | null; rate: number }>;
  };
  totals: {
    grossLicenses: number;
    grossServices: number;
    salesTax: number;
    licenseCosts: number;
    operatingExpenses: number;
    netLicenses: number;
    netServices: number;
    distributionBase: number;
    salaryAccrued: number;
    cess: number;
    incomeTax: number;
    netPayable: number;
  };
};

export const settlementClassificationsTable = pgTable("settlement_classifications", {
  id: serial("id").primaryKey(),
  serviceCode: text("service_code"),
  invoiceLineId: integer("invoice_line_id").references(() => invoiceLinesTable.id, { onDelete: "cascade" }),
  salesType: text("sales_type").$type<SettlementSalesType>().notNull(),
  label: text("label").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check(
    "settlement_classifications_one_target_check",
    sql`num_nonnulls(${table.serviceCode}, ${table.invoiceLineId}) = 1`,
  ),
  check(
    "settlement_classifications_sales_type_check",
    sql`${table.salesType} IN ('license', 'service')`,
  ),
  uniqueIndex("settlement_classifications_service_code_uq")
    .on(table.serviceCode)
    .where(sql`${table.serviceCode} IS NOT NULL`),
  uniqueIndex("settlement_classifications_invoice_line_uq")
    .on(table.invoiceLineId)
    .where(sql`${table.invoiceLineId} IS NOT NULL`),
]);

export const settlementExpensesTable = pgTable("settlement_expenses", {
  id: serial("id").primaryKey(),
  period: text("period").notNull(),
  specialistId: text("specialist_id").notNull(),
  expenseType: text("expense_type").$type<SettlementExpenseType>().notNull(),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  description: text("description").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedBy: text("voided_by"),
  voidReason: text("void_reason"),
}, (table) => [
  check("settlement_expenses_period_check", sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check("settlement_expenses_positive_amount_check", sql`${table.amount} > 0`),
  check(
    "settlement_expenses_type_check",
    sql`${table.expenseType} IN ('license_cost', 'operating_expense')`,
  ),
  index("settlement_expenses_period_specialist_idx").on(table.period, table.specialistId),
]);

export const settlementInvoiceInclusionsTable = pgTable("settlement_invoice_inclusions", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "restrict" }),
  period: text("period").notNull(),
  reason: text("reason").notNull(),
  includedBy: text("included_by").notNull(),
  includedAt: timestamp("included_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by"),
  revokeReason: text("revoke_reason"),
}, (table) => [
  check("settlement_invoice_inclusions_period_check", sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  uniqueIndex("settlement_invoice_inclusions_active_invoice_uq")
    .on(table.invoiceId)
    .where(sql`${table.revokedAt} IS NULL`),
  index("settlement_invoice_inclusions_period_idx").on(table.period),
]);

export const settlementExchangeRatesTable = pgTable("settlement_exchange_rates", {
  id: serial("id").primaryKey(),
  period: text("period").notNull(),
  currency: text("currency").notNull(),
  rateToCup: numeric("rate_to_cup", { precision: 18, scale: 8, mode: "number" }).notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("settlement_exchange_rates_period_check", sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check("settlement_exchange_rates_positive_rate_check", sql`${table.rateToCup} > 0`),
  uniqueIndex("settlement_exchange_rates_period_currency_uq").on(table.period, table.currency),
]);

export const settlementPaymentsTable = pgTable("settlement_payments", {
  id: serial("id").primaryKey(),
  period: text("period").notNull(),
  specialistId: text("specialist_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  paidOn: date("paid_on", { mode: "string" }).notNull(),
  reference: text("reference").notNull(),
  recordedBy: text("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("settlement_payments_period_check", sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check("settlement_payments_positive_amount_check", sql`${table.amount} > 0`),
  index("settlement_payments_period_specialist_idx").on(table.period, table.specialistId),
]);

export const settlementClosuresTable = pgTable("settlement_closures", {
  id: serial("id").primaryKey(),
  period: text("period").notNull(),
  specialistId: text("specialist_id").notNull(),
  version: integer("version").notNull(),
  supersedesId: integer("supersedes_id").references((): AnyPgColumn => settlementClosuresTable.id, { onDelete: "restrict" }),
  snapshot: jsonb("snapshot").$type<SettlementClosureSnapshot>().notNull(),
  approvedBy: text("approved_by").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  correctionReason: text("correction_reason"),
}, (table) => [
  check("settlement_closures_period_check", sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check("settlement_closures_version_check", sql`${table.version} > 0`),
  check(
    "settlement_closures_correction_check",
    sql`(${table.version} = 1 AND ${table.supersedesId} IS NULL AND ${table.correctionReason} IS NULL)
      OR (${table.version} > 1 AND ${table.supersedesId} IS NOT NULL AND ${table.correctionReason} IS NOT NULL)`,
  ),
  uniqueIndex("settlement_closures_period_specialist_version_uq")
    .on(table.period, table.specialistId, table.version),
  index("settlement_closures_period_specialist_idx").on(table.period, table.specialistId, table.version),
]);

export const settlementOverpaymentResolutionsTable = pgTable("settlement_overpayment_resolutions", {
  id: serial("id").primaryKey(),
  period: text("period").notNull(),
  specialistId: text("specialist_id").notNull(),
  closureId: integer("closure_id").notNull().references(() => settlementClosuresTable.id, { onDelete: "restrict" }),
  closureVersion: integer("closure_version").notNull(),
  overpaidAmount: numeric("overpaid_amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  resolution: text("resolution").notNull(),
  reason: text("reason").notNull(),
  recordedBy: text("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  check("settlement_overpayment_resolutions_period_check", sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check("settlement_overpayment_resolutions_version_check", sql`${table.closureVersion} > 0`),
  check("settlement_overpayment_resolutions_positive_amount_check", sql`${table.overpaidAmount} > 0`),
  index("settlement_overpayment_resolutions_period_specialist_idx").on(table.period, table.specialistId, table.recordedAt),
]);

export type SettlementClassification = typeof settlementClassificationsTable.$inferSelect;
export type SettlementExpense = typeof settlementExpensesTable.$inferSelect;
export type SettlementInvoiceInclusion = typeof settlementInvoiceInclusionsTable.$inferSelect;
export type SettlementExchangeRate = typeof settlementExchangeRatesTable.$inferSelect;
export type SettlementPayment = typeof settlementPaymentsTable.$inferSelect;
export type SettlementClosure = typeof settlementClosuresTable.$inferSelect;
export type SettlementOverpaymentResolution = typeof settlementOverpaymentResolutionsTable.$inferSelect;

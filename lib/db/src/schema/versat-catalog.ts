import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

export type CatalogKind = "service" | "unit" | "currency" | "concept" | "operation" | "commercial" | "payment";
export type CatalogMetadata = {
  unitCode?: string;
  unitName?: string;
  groupCode?: string;
  position?: string;
};

export const versatCatalogTable = pgTable("versat_catalog", {
  id: serial("id").primaryKey(),
  kind: text("kind").$type<CatalogKind>().notNull(),
  sourceId: integer("source_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  exportValue: text("export_value").notNull(),
  metadata: jsonb("metadata").$type<CatalogMetadata>().notNull().default({}),
  active: boolean("active").notNull().default(true),
}, (table) => [unique("versat_catalog_source_unique").on(table.kind, table.sourceId)]);

export type VersatCatalogAuditValues = {
  kind: CatalogKind;
  sourceId: number;
  code: string;
  name: string;
  exportValue: string;
  unitCode: string | null;
  unitName: string | null;
  groupCode: string | null;
  position: string | null;
  active: boolean;
};

export type VersatCatalogAuditAction = "created" | "updated" | "deactivated" | "reactivated";

export const versatCatalogAuditTable = pgTable("versat_catalog_audit", {
  id: serial("id").primaryKey(),
  catalogEntryId: integer("catalog_entry_id").notNull(),
  kind: text("kind").$type<CatalogKind>().notNull(),
  sourceId: integer("source_id").notNull(),
  action: text("action").$type<VersatCatalogAuditAction>().notNull(),
  actorUserId: text("actor_user_id").notNull(),
  actorName: text("actor_name").notNull(),
  actorEmail: text("actor_email"),
  previousValues: jsonb("previous_values").$type<VersatCatalogAuditValues | null>(),
  newValues: jsonb("new_values").$type<VersatCatalogAuditValues>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("versat_catalog_audit_entry_created_idx").on(table.catalogEntryId, table.createdAt)]);

export type VersatInvoiceSnapshot = {
  conceptId: number;
  operationId: number;
  commercialId: number;
  paymentId: number;
  number: string | null;
  talon: string | null;
  bankAccountMC: string | null;
  bankAccountOM: string | null;
  contract: string | null;
  currencyName: string;
  conceptCode: string;
  operationName: string;
  commercialName: string;
  commercialPosition: string;
  paymentName: string;
  customerCode: string | null;
  customerName: string;
  customerAddress: string | null;
  customerTaxId: string | null;
};

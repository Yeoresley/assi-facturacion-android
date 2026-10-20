import { integer, jsonb, pgTable, serial, text, unique } from "drizzle-orm/pg-core";

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
}, (table) => [unique("versat_catalog_source_unique").on(table.kind, table.sourceId)]);

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

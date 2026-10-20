import { desc, eq, inArray } from "drizzle-orm";
import { customersTable, db, invoiceLinesTable, invoicesTable } from "@workspace/db";

export type InvoiceRecord = typeof invoicesTable.$inferSelect & {
  customerName: string;
  lines: Array<typeof invoiceLinesTable.$inferSelect>;
};

export async function getInvoiceRows(ids?: number[]): Promise<InvoiceRecord[]> {
  if (ids && !ids.length) return [];
  const query = db.select({ invoice: invoicesTable, customerName: customersTable.name })
    .from(invoicesTable)
    .innerJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .orderBy(desc(invoicesTable.createdAt));
  const rows = ids ? await query.where(inArray(invoicesTable.id, ids)) : await query;
  if (!rows.length) return [];
  const lines = await db.select().from(invoiceLinesTable)
    .where(inArray(invoiceLinesTable.invoiceId, rows.map(({ invoice }) => invoice.id)));
  return rows.map(({ invoice, customerName }) => ({
    ...invoice,
    customerName: invoice.versat?.customerName ?? customerName,
    lines: lines.filter((line) => line.invoiceId === invoice.id),
  }));
}

export async function getInvoiceRow(id: number): Promise<InvoiceRecord | null> {
  return (await getInvoiceRows([id]))[0] ?? null;
}

export function serializeInvoice(invoice: InvoiceRecord) {
  return { ...invoice, createdAt: invoice.createdAt.toISOString() };
}

export function toDateOnly(date: Date | string) {
  return typeof date === "string" ? date.slice(0, 10) : date.toISOString().slice(0, 10);
}

export function dateQuery(query: Record<string, unknown>) {
  const result = { ...query };
  for (const key of ["from", "to"]) {
    if (typeof result[key] === "string") result[key] = new Date(result[key] as string);
  }
  return result;
}

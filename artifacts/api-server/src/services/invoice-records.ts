import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import {
  customersTable, db, invoiceLinesTable, invoicePaymentCorrectionsTable, invoicePaymentsTable, invoicesTable,
} from "@workspace/db";
import { statusCodes, type WorkflowStatus } from "./invoice-status";
import { paymentStatus, summarizePayments } from "./invoice-payment";

export type InvoiceRecord = typeof invoicesTable.$inferSelect & {
  customerName: string;
  lines: Array<typeof invoiceLinesTable.$inferSelect>;
  totalPaid: number;
  balanceDue: number;
  payments: Array<{
    id: number;
    amount: number;
    currency: string;
    paidOn: string;
    recordedAt: string;
    reference: string | null;
  }>;
  paymentCorrections: ReturnType<typeof summarizePayments>["paymentCorrections"];
};

export async function getInvoiceRows(ids?: number[], scope?: SQL, reader: Pick<typeof db, "select"> = db): Promise<InvoiceRecord[]> {
  if (ids && !ids.length) return [];
  const query = reader.select({ invoice: invoicesTable, customerName: customersTable.name })
    .from(invoicesTable)
    .innerJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .orderBy(desc(invoicesTable.createdAt));
  const rows = await query.where(and(ids ? inArray(invoicesTable.id, ids) : undefined, scope));
  if (!rows.length) return [];
  const lines = await reader.select().from(invoiceLinesTable)
    .where(inArray(invoiceLinesTable.invoiceId, rows.map(({ invoice }) => invoice.id)));
  const paymentRows = await reader.select().from(invoicePaymentsTable)
    .where(inArray(invoicePaymentsTable.invoiceId, rows.map(({ invoice }) => invoice.id)))
    .orderBy(invoicePaymentsTable.paidOn, invoicePaymentsTable.id);
  const paymentCorrections = await reader.select().from(invoicePaymentCorrectionsTable)
    .where(inArray(invoicePaymentCorrectionsTable.invoiceId, rows.map(({ invoice }) => invoice.id)))
    .orderBy(invoicePaymentCorrectionsTable.createdAt, invoicePaymentCorrectionsTable.id);
  return rows.map(({ invoice, customerName }) => {
    const totals = summarizePayments(
      invoice,
      paymentRows.filter((payment) => payment.invoiceId === invoice.id),
      paymentCorrections.filter((correction) => correction.invoiceId === invoice.id),
    );
    return {
      ...invoice,
      customerName: invoice.versat?.customerName ?? customerName,
      lines: lines.filter((line) => line.invoiceId === invoice.id),
      ...totals,
    };
  });
}

export async function getInvoiceRow(id: number, scope?: SQL): Promise<InvoiceRecord | null> {
  return (await getInvoiceRows([id], scope))[0] ?? null;
}

export function serializeInvoice(invoice: InvoiceRecord) {
  return {
    ...invoice,
    statusCode: statusCodes[invoice.status as WorkflowStatus] ?? null,
    paymentStatus: paymentStatus(invoice),
    totalPaid: invoice.totalPaid,
    balanceDue: invoice.balanceDue,
    payments: invoice.payments,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    acceptedAt: invoice.acceptedAt?.toISOString() ?? null,
    confirmedAt: invoice.confirmedAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
  };
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

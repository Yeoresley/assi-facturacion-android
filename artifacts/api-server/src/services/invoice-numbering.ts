import { eq, ne, and, sql } from "drizzle-orm";
import { db, invoicesTable, invoiceSeriesTable, invoiceNumberReservationsTable } from "@workspace/db";
import { facNumber } from "./versat-identity";

export type BillingTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class NumberingError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

// One transaction-scoped lock coordinates automatic issuance, manual reservations and owner changes.
// It also covers differently named series whose rendered formats overlap.
export async function lockNumbering(tx: BillingTransaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(684210, 1)`);
}

export function formatSeries(series: { prefix: string; suffix: string; width: number; nextNumber: number }) {
  if (String(series.nextNumber).length > series.width || series.nextNumber > 2147483646) {
    throw new NumberingError("La serie ha agotado el ancho o el rango declarado. El propietario debe configurar otra serie.");
  }
  return `${series.prefix}${String(series.nextNumber).padStart(series.width, "0")}${series.suffix}`;
}

export async function reserveNumber(tx: BillingTransaction, invoiceId: number, number: string | null, talon: string | null) {
  if (!number) return;
  const [existing] = await tx.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(and(sql`replace(${invoicesTable.versatNumber}, '-', '') = ${facNumber(number)}`, ne(invoicesTable.id, invoiceId)));
  if (existing) throw new NumberingError("Ese número de Versat ya pertenece a otra factura, incluso si está anulada.");
  const [compactReservation] = await tx.select({ invoiceId: invoiceNumberReservationsTable.invoiceId })
    .from(invoiceNumberReservationsTable).where(and(
      sql`replace(${invoiceNumberReservationsTable.number}, '-', '') = ${facNumber(number)}`,
      ne(invoiceNumberReservationsTable.invoiceId, invoiceId),
    ));
  if (compactReservation) throw new NumberingError("Ese número de Versat ya está reservado, también al quitar los guiones.");
  await tx.insert(invoiceNumberReservationsTable).values({ number, invoiceId, talon }).onConflictDoNothing();
  const [reservation] = await tx.select().from(invoiceNumberReservationsTable)
    .where(eq(invoiceNumberReservationsTable.number, number));
  if (reservation.invoiceId !== invoiceId) {
    throw new NumberingError("Ese número de Versat ya está reservado y no se puede reutilizar.");
  }
}

export async function validateSeriesSelection(tx: BillingTransaction, seriesId: number | null, versat: { number: string | null; talon: string | null } | null) {
  if (!seriesId) return;
  const [series] = await tx.select().from(invoiceSeriesTable).where(eq(invoiceSeriesTable.id, seriesId));
  if (!series?.active) throw new NumberingError("La serie no existe o está inactiva. Selecciona otra serie.");
  if (versat?.number || versat?.talon) {
    throw new NumberingError("En modo automático no se admite un número ni talón manual.", 422);
  }
}

export async function allocateNumber(tx: BillingTransaction, invoice: typeof invoicesTable.$inferSelect) {
  if (!invoice.seriesId) {
    if (!invoice.versat?.number || !invoice.versat.talon) {
      throw new NumberingError("Completa el número y talón manuales, o elige una serie automática.", 422);
    }
    await reserveNumber(tx, invoice.id, invoice.versat.number, invoice.versat.talon);
    return invoice.versat;
  }
  const [series] = await tx.select().from(invoiceSeriesTable)
    .where(eq(invoiceSeriesTable.id, invoice.seriesId)).for("update");
  if (!series?.active) throw new NumberingError("La serie está inactiva. Elige otra serie en el borrador.");
  if (!invoice.versat) throw new NumberingError("Completa los datos de Versat antes de emitir.", 422);
  const number = formatSeries(series);
  await reserveNumber(tx, invoice.id, number, series.talon);
  await tx.update(invoiceSeriesTable).set({ nextNumber: series.nextNumber + 1 }).where(eq(invoiceSeriesTable.id, series.id));
  return { ...invoice.versat, number, talon: series.talon };
}

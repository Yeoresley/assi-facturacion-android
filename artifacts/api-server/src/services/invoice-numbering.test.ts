import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  customersTable, db, pool, invoiceLinesTable, invoiceNumberReservationsTable, invoicesTable,
  invoiceSeriesTable, type LegalDocument, type VersatInvoiceSnapshot,
} from "@workspace/db";
import { allocateNumber, formatSeries, lockNumbering, reserveNumber, validateSeriesSelection } from "./invoice-numbering";
import { transitionInvoice as scopedTransitionInvoice } from "./issue-invoice";
import { invoiceScope } from "./invoice-access";
import { buildFac } from "./versat-file";

// Integration tests use only explicitly created synthetic fixtures, never business invoices.
const tag = `TEST_${randomUUID().replaceAll("-", "").slice(0, 12)}_`;
const invoiceIds: number[] = [];
const seriesIds: number[] = [];
const transitionInvoice = (id: number, status: "draft" | "sent" | "paid" | "cancelled") =>
  scopedTransitionInvoice(id, status, sql`true`);
let customerId: number;
const legal: LegalDocument = {
  confirm: true, useStamp: false, useSignature: false, stampPath: null, signaturePath: null,
  issuer: { name: "Test", nit: "TEST", ircc: "TEST", address: "TEST", organization: "TEST", paymentBeneficiary: "TEST", bankAccount: "TEST", bankBranch: "TEST", bankName: "TEST" },
  preparedBy: "Test", preparedPosition: "Test", deliveredBy: "", accountedBy: "", transportedBy: "",
  transportId: "", vehiclePlate: "", drivingLicense: "", receivedBy: "", receivedPosition: "",
  receivedId: "", customerIrcc: "", customerBankAccount: "", authorizedAt: new Date().toISOString(), authorizedBy: "test",
};
const snapshot: VersatInvoiceSnapshot = {
  number: null, talon: null, conceptId: 1, operationId: 1, commercialId: 1, paymentId: 1,
  bankAccountMC: null, bankAccountOM: null, contract: null, currencyName: "Test", conceptCode: "Test",
  operationName: "Servicios", commercialName: "Test", commercialPosition: "Test", paymentName: "Efectivo",
  customerCode: "TEST", customerName: "Test", customerAddress: null, customerTaxId: null,
};
before(async () => {
  const [customer] = await db.insert(customersTable).values({ name: tag }).returning();
  customerId = customer.id;
});
after(async () => {
  if (invoiceIds.length) {
    await db.delete(invoiceNumberReservationsTable).where(inArray(invoiceNumberReservationsTable.invoiceId, invoiceIds));
    await db.delete(invoiceLinesTable).where(inArray(invoiceLinesTable.invoiceId, invoiceIds));
    await db.delete(invoicesTable).where(inArray(invoicesTable.id, invoiceIds));
  }
  if (seriesIds.length) await db.delete(invoiceSeriesTable).where(inArray(invoiceSeriesTable.id, seriesIds));
  if (customerId) await db.delete(customersTable).where(eq(customersTable.id, customerId));
  await pool.end();
});
async function series(options: Partial<typeof invoiceSeriesTable.$inferInsert> = {}) {
  const [row] = await db.insert(invoiceSeriesTable).values({
    name: `${tag}${seriesIds.length}`, prefix: `${tag}${seriesIds.length}_`, suffix: "", width: 4,
    nextNumber: 1, talon: "00009", confirmedBy: "test", ...options,
  }).returning();
  seriesIds.push(row.id);
  return row;
}
async function draft(seriesId: number | null, extra: Partial<typeof invoicesTable.$inferInsert> = {}) {
  const [row] = await db.insert(invoicesTable).values({
    number: tag + randomUUID(), customerId, specialistId: randomUUID(), specialistName: "Test specialist",
    issueDate: "2026-10-20", currency: "CUP", seriesId, versat: snapshot, legalDocument: legal,
    subtotal: 1, total: 1, ...extra,
  }).returning();
  invoiceIds.push(row.id);
  await db.insert(invoiceLinesTable).values({
    invoiceId: row.id, description: "Synthetic service", serviceCode: "TEST", unitCode: "U",
    groupCode: "TEST", quantity: 1, unitPrice: 1, amount: 1,
  });
  return row;
}
async function stored(id: number) {
  return (await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)))[0];
}
async function counter(id: number) {
  return (await db.select().from(invoiceSeriesTable).where(eq(invoiceSeriesTable.id, id)))[0].nextNumber;
}

test("parallel specialists persist distinct sequential numbers and the declared talon", async () => {
  const s = await series();
  const drafts = await Promise.all(Array.from({ length: 12 }, () => draft(s.id)));
  await Promise.all(drafts.map((d) => transitionInvoice(d.id, "sent")));
  const issued = await Promise.all(drafts.map((d) => stored(d.id)));
  assert.equal(new Set(issued.map((d) => d.versatNumber)).size, 12);
  assert.deepEqual(issued.map((d) => d.versatNumber).sort(), Array.from({ length: 12 }, (_, i) => formatSeries({ ...s, nextNumber: i + 1 })).sort());
  assert.ok(issued.every((d) => d.status === "sent" && d.versat?.talon === "00009"));
  assert.equal(await counter(s.id), 13);
  // Read on an independent connection: results do not depend on in-memory state.
  const connection = await pool.connect();
  try {
    const result = await connection.query("select next_number from invoice_series where id=$1", [s.id]);
    assert.equal(result.rows[0].next_number, 13);
  } finally { connection.release(); }
  const lines = await db.select().from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, issued[0].id));
  const fac = buildFac({ ...issued[0], lines });
  assert.ok(fac.includes(`Numero=${issued[0].versatNumber}\r\n`));
  assert.ok(fac.includes("Talon=00009\r\n"));
});

test("concurrent retries on the same invoice consume only one number", async () => {
  const s = await series();
  const d = await draft(s.id);
  await Promise.all(Array.from({ length: 10 }, () => transitionInvoice(d.id, "sent")));
  const first = await stored(d.id);
  await transitionInvoice(d.id, "paid");
  assert.equal((await stored(d.id)).versatNumber, first.versatNumber);
  assert.equal(await counter(s.id), 2);
  await assert.rejects(transitionInvoice(d.id, "draft"), /borrador/);
});

test("commercial scope is checked inside the issuance transaction before allocating", async () => {
  const s = await series();
  const d = await draft(s.id);
  await assert.rejects(scopedTransitionInvoice(d.id, "sent", invoiceScope({ role: "specialist", commercialId: 2 })), /no encontrada/);
  assert.equal(await counter(s.id), 1);
  assert.equal((await stored(d.id)).status, "draft");
  await scopedTransitionInvoice(d.id, "sent", invoiceScope({ role: "specialist", commercialId: snapshot.commercialId }));
  assert.equal((await stored(d.id)).versatNumber, formatSeries(s));
});

test("validation failure after allocation rolls back number, reservation, counter and status", async () => {
  const s = await series();
  const d = await draft(s.id);
  await db.update(invoiceLinesTable).set({ groupCode: null }).where(eq(invoiceLinesTable.invoiceId, d.id));
  await assert.rejects(transitionInvoice(d.id, "sent"), /agrupador/);
  assert.equal(await counter(s.id), 1);
  assert.equal((await stored(d.id)).status, "draft");
  assert.equal((await stored(d.id)).versatNumber, null);
  assert.equal((await db.select().from(invoiceNumberReservationsTable).where(eq(invoiceNumberReservationsTable.invoiceId, d.id))).length, 0);
  await db.update(invoiceLinesTable).set({ groupCode: "TEST" }).where(eq(invoiceLinesTable.invoiceId, d.id));
  await transitionInvoice(d.id, "sent");
  assert.equal((await stored(d.id)).versatNumber, formatSeries(s));
});

test("interrupted transaction can retry; committed cancelled invoices cannot release numbers", async () => {
  const s = await series();
  const d = await draft(s.id);
  await assert.rejects(db.transaction(async (tx) => {
    await lockNumbering(tx);
    await allocateNumber(tx, d);
    throw new Error("simulated failure");
  }), /simulated/);
  assert.equal(await counter(s.id), 1);
  await transitionInvoice(d.id, "sent");
  await transitionInvoice(d.id, "cancelled");
  await assert.rejects(transitionInvoice(d.id, "sent"), /reactivarse/);
  const other = await draft(null);
  await assert.rejects(db.transaction(async (tx) => {
    await lockNumbering(tx);
    await reserveNumber(tx, other.id, formatSeries(s), s.talon);
  }), /otra factura/);
});

test("manual draft changes preserve earlier reservations, including against automatic series", async () => {
  const s = await series();
  const manual = await draft(null);
  await db.transaction(async (tx) => {
    await lockNumbering(tx);
    await reserveNumber(tx, manual.id, formatSeries(s), "00009");
    await reserveNumber(tx, manual.id, `${tag}replacement`, "00009");
    await tx.update(invoicesTable).set({
      versatNumber: `${tag}replacement`, versat: { ...snapshot, number: `${tag}replacement`, talon: "00009" },
    }).where(eq(invoicesTable.id, manual.id));
  });
  const auto = await draft(s.id);
  await assert.rejects(transitionInvoice(auto.id, "sent"), /reservado/);
  assert.equal(await counter(s.id), 1);
  await transitionInvoice(manual.id, "sent");
  assert.equal((await stored(manual.id)).versatNumber, `${tag}replacement`);
});

test("inactive, exhausted and missing series fail explicitly, and automatic input rejects manual values", async () => {
  const inactive = await series({ active: false });
  const exhausted = await series({ width: 1, nextNumber: 10 });
  await assert.rejects(transitionInvoice((await draft(inactive.id)).id, "sent"), /inactiva/);
  await assert.rejects(transitionInvoice((await draft(exhausted.id)).id, "sent"), /agotado/);
  const s = await series();
  await assert.rejects(db.transaction((tx) => validateSeriesSelection(tx, s.id, { number: "MANUAL", talon: null })), /manual/);
  await assert.rejects(db.transaction((tx) => validateSeriesSelection(tx, 2147483647, null)), /no existe/);
  assert.equal(formatSeries({ prefix: "", suffix: "", width: 4, nextNumber: 0 }), "0000");
});

test("overlapping series and historical manual numbers cannot duplicate a number", async () => {
  const s = await series();
  const overlap = await series({ prefix: s.prefix });
  const a = await draft(s.id);
  const b = await draft(overlap.id);
  const results = await Promise.allSettled([transitionInvoice(a.id, "sent"), transitionInvoice(b.id, "sent")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  const history = await series();
  const number = formatSeries(history);
  const historic = await draft(null, { status: "cancelled", versatNumber: number, versat: { ...snapshot, number, talon: history.talon } });
  const original = await stored(historic.id);
  await assert.rejects(transitionInvoice((await draft(history.id)).id, "sent"), /otra factura/);
  assert.deepEqual(await stored(historic.id), original);
});

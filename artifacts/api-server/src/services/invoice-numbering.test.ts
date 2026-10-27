import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  customersTable, db, pool, invoiceAcceptanceNotificationsTable, invoiceLinesTable, invoiceNumberReservationsTable, invoicePaymentsTable, invoicesTable,
  invoicePaymentCorrectionsTable, invoiceSeriesTable, teamMembersTable, type LegalDocument, type VersatInvoiceSnapshot,
} from "@workspace/db";
import billingRouter from "../routes/billing";
import { allocateNumber, formatSeries, lockNumbering, reserveNumber, validateSeriesSelection } from "./invoice-numbering";
import { transitionInvoice as scopedTransitionInvoice } from "./issue-invoice";
import { invoiceScope } from "./invoice-access";
import { buildFac } from "./versat-file";
import type { WorkflowStatus } from "./invoice-status";
import {
  correctInvoicePayment, recordInvoicePayment, paymentFilter, paymentStatus,
} from "./invoice-payment";
import { CreateInvoiceSeriesResponse } from "@workspace/api-zod";

// Integration tests use only explicitly created synthetic fixtures, never business invoices.
const tag = `TEST_${randomUUID().replaceAll("-", "").slice(0, 12)}_`;
const invoiceIds: number[] = [];
const seriesIds: number[] = [];
const specialist = { userId: "test-specialist", role: "specialist" as const, commercialId: 1 };
const transitionInvoice = (id: number, status: WorkflowStatus) =>
  scopedTransitionInvoice(id, status, sql`true`, specialist);
const recordPayment = (
  id: number,
  actor: { userId: string; role: "owner" | "specialist" },
  amount = 1,
  paidOn = "2026-10-20",
  idempotencyKey = randomUUID(),
) => recordInvoicePayment(id, { amount, paidOn, idempotencyKey }, actor);
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
test("created invoice series response matches the saved series contract", () => {
  const saved = {
    id: 1, name: "Facturas HAB 2026", prefix: "HAB-26-", suffix: "",
    width: 3, talon: "5", nextNumber: 91, active: true,
  };
  assert.deepEqual(CreateInvoiceSeriesResponse.parse(saved), saved);
});

test("a different authenticated specialist cannot read or mark another recipient's notice as read", async () => {
  const recipientId = `${tag}notice-recipient`;
  const otherSpecialistId = `${tag}other-specialist`;
  const identities = [recipientId, otherSpecialistId];
  let server: Server | undefined;
  const email = (userId: string) => `${userId}@example.invalid`;

  mock.method(clerkClient.users, "getUser", async (id: string) => ({
    id,
    firstName: "Synthetic",
    lastName: "Notice Test",
    primaryEmailAddressId: "verified",
    emailAddresses: [{
      id: "verified",
      emailAddress: email(id),
      verification: { status: "verified" },
    }],
  }));

  try {
    await db.insert(teamMembersTable).values(identities.map((userId) => ({
      userId, name: userId, email: email(userId), role: "specialist" as const,
    })));
    const invoice = await draft(null, {
      number: `${tag}PRIVATE_NOTICE_INVOICE`,
      specialistId: recipientId,
      specialistName: recipientId,
    });
    const [notice] = await db.insert(invoiceAcceptanceNotificationsTable).values({
      invoiceId: invoice.id,
      recipientUserId: recipientId,
      invoiceNumber: `${tag}PRIVATE_NOTICE_NUMBER`,
      reason: "payment",
    }).returning();

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const auth = Object.assign(
        () => ({ userId: req.headers["x-synthetic-id"] ?? null, tokenType: "session_token" }),
        { [Symbol.for("@clerk/express.auth")]: true },
      );
      Object.assign(req, { auth });
      next();
    });
    app.use("/api", billingRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    const request = (path: string, actor: string, method = "GET") => fetch(`${base}${path}`, {
      method,
      headers: { "x-synthetic-id": actor },
    });

    const recipientNoticesResponse = await request("/notifications", recipientId);
    assert.equal(recipientNoticesResponse.status, 200);
    const recipientNotices = await recipientNoticesResponse.json() as Array<{ id: number }>;
    assert.ok(recipientNotices.some(({ id }) => id === notice.id));

    const otherNoticesResponse = await request("/notifications", otherSpecialistId);
    assert.equal(otherNoticesResponse.status, 200);
    const otherNoticesText = await otherNoticesResponse.text();
    assert.deepEqual(JSON.parse(otherNoticesText), []);
    assert.equal(otherNoticesText.includes(`${tag}PRIVATE_NOTICE_NUMBER`), false);
    assert.equal(otherNoticesText.includes(`${tag}PRIVATE_NOTICE_INVOICE`), false);

    const markReadResponse = await request(`/notifications/${notice.id}/read`, otherSpecialistId, "PATCH");
    assert.equal(markReadResponse.status, 404);
    const markReadBody = await markReadResponse.text();
    assert.deepEqual(JSON.parse(markReadBody), { error: "Notice not found" });
    assert.equal(markReadBody.includes(`${tag}PRIVATE_NOTICE_NUMBER`), false);
    assert.equal(markReadBody.includes(`${tag}PRIVATE_NOTICE_INVOICE`), false);

    const [storedNotice] = await db.select().from(invoiceAcceptanceNotificationsTable)
      .where(eq(invoiceAcceptanceNotificationsTable.id, notice.id));
    assert.equal(storedNotice.readAt, null);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    mock.restoreAll();
    await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, identities));
  }
});

test("orphaned number reservations still block reuse, including compact spellings", async () => {
  const d = await draft(null);
  const reservedNumber = `${tag}ORPHAN-91`;
  await db.insert(invoiceNumberReservationsTable).values({
    number: reservedNumber, invoiceId: null, talon: "5",
  });
  try {
    await assert.rejects(db.transaction(async (tx) => {
      await lockNumbering(tx);
      await reserveNumber(tx, d.id, reservedNumber.replaceAll("-", ""), "5");
    }), /reservado/);
  } finally {
    await db.delete(invoiceNumberReservationsTable).where(eq(invoiceNumberReservationsTable.number, reservedNumber));
  }
});

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
  await Promise.all(drafts.map((d) => transitionInvoice(d.id, "finished")));
  const issued = await Promise.all(drafts.map((d) => stored(d.id)));
  assert.equal(new Set(issued.map((d) => d.versatNumber)).size, 12);
  assert.deepEqual(issued.map((d) => d.versatNumber).sort(), Array.from({ length: 12 }, (_, i) => formatSeries({ ...s, nextNumber: i + 1 })).sort());
  assert.ok(issued.every((d) => d.status === "finished" && d.versat?.talon === "00009"));
  assert.equal(await counter(s.id), 13);
  // Read on an independent connection: results do not depend on in-memory state.
  const connection = await pool.connect();
  try {
    const result = await connection.query("select next_number from invoice_series where id=$1", [s.id]);
    assert.equal(result.rows[0].next_number, 13);
  } finally { connection.release(); }
  const lines = await db.select().from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, issued[0].id));
  await transitionInvoice(issued[0].id, "accepted");
  const fac = buildFac({ ...await stored(issued[0].id), lines });
  assert.ok(fac.includes(`Numero=${issued[0].versatNumber}\r\n`));
  assert.ok(fac.includes("Talon=00009\r\n"));
});

test("concurrent retries on the same invoice consume only one number", async () => {
  const s = await series();
  const d = await draft(s.id);
  await Promise.all(Array.from({ length: 10 }, () => transitionInvoice(d.id, "finished")));
  const first = await stored(d.id);
  await transitionInvoice(d.id, "accepted");
  assert.equal((await stored(d.id)).versatNumber, first.versatNumber);
  assert.equal(await counter(s.id), 2);
  await assert.rejects(transitionInvoice(d.id, "draft"), /Edición/);
});

test("a specialist cannot change a foreign commercial invoice, while the owner can issue it", async () => {
  const s = await series();
  const commercialOneInvoice = await draft(s.id, { versat: { ...snapshot, commercialId: 1 } });
  const commercialTwoInvoice = await draft(s.id, { versat: { ...snapshot, commercialId: 2 } });
  const beforeOne = await stored(commercialOneInvoice.id);
  const beforeTwo = await stored(commercialTwoInvoice.id);
  const otherSpecialist = { ...specialist, userId: "other-commercial-specialist", commercialId: 2 };
  await assert.rejects(scopedTransitionInvoice(
    commercialTwoInvoice.id, "finished", invoiceScope(specialist), specialist,
  ), /no encontrada/);
  await assert.rejects(scopedTransitionInvoice(
    commercialOneInvoice.id, "finished", invoiceScope(otherSpecialist), otherSpecialist,
  ), /no encontrada/);
  assert.deepEqual(await stored(commercialOneInvoice.id), beforeOne);
  assert.deepEqual(await stored(commercialTwoInvoice.id), beforeTwo);
  assert.equal(await counter(s.id), 1);
  assert.equal((await db.select().from(invoiceNumberReservationsTable)
    .where(inArray(invoiceNumberReservationsTable.invoiceId, [commercialOneInvoice.id, commercialTwoInvoice.id]))).length, 0);

  await scopedTransitionInvoice(
    commercialTwoInvoice.id, "finished", invoiceScope({ role: "owner", commercialId: null }),
    { userId: "test-owner", role: "owner", commercialId: null },
  );
  assert.equal((await stored(commercialTwoInvoice.id)).versatNumber, formatSeries(s));
  assert.equal((await stored(commercialTwoInvoice.id)).status, "finished");
});

test("validation failure after allocation rolls back number, reservation, counter and status", async () => {
  const s = await series();
  const d = await draft(s.id);
  await db.update(invoiceLinesTable).set({ groupCode: null }).where(eq(invoiceLinesTable.invoiceId, d.id));
  await assert.rejects(transitionInvoice(d.id, "finished"), /agrupador/);
  assert.equal(await counter(s.id), 1);
  assert.equal((await stored(d.id)).status, "draft");
  assert.equal((await stored(d.id)).versatNumber, null);
  assert.equal((await db.select().from(invoiceNumberReservationsTable).where(eq(invoiceNumberReservationsTable.invoiceId, d.id))).length, 0);
  await db.update(invoiceLinesTable).set({ groupCode: "TEST" }).where(eq(invoiceLinesTable.invoiceId, d.id));
  await transitionInvoice(d.id, "finished");
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
  await transitionInvoice(d.id, "finished");
  await transitionInvoice(d.id, "cancelled");
  await assert.rejects(transitionInvoice(d.id, "finished"), /reactivarse/);
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
  await assert.rejects(transitionInvoice(auto.id, "finished"), /reservado/);
  assert.equal(await counter(s.id), 1);
  await transitionInvoice(manual.id, "finished");
  assert.equal((await stored(manual.id)).versatNumber, `${tag}replacement`);
});

test("inactive, exhausted and missing series fail explicitly, and automatic input rejects manual values", async () => {
  const inactive = await series({ active: false });
  const exhausted = await series({ width: 1, nextNumber: 10 });
  await assert.rejects(transitionInvoice((await draft(inactive.id)).id, "finished"), /inactiva/);
  await assert.rejects(transitionInvoice((await draft(exhausted.id)).id, "finished"), /agotado/);
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
  const results = await Promise.allSettled([transitionInvoice(a.id, "finished"), transitionInvoice(b.id, "finished")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  const history = await series();
  const number = formatSeries(history);
  const historic = await draft(null, { status: "cancelled", versatNumber: number, versat: { ...snapshot, number, talon: history.talon } });
  const original = await stored(historic.id);
  await assert.rejects(transitionInvoice((await draft(history.id)).id, "finished"), /otra factura/);
  assert.deepEqual(await stored(historic.id), original);
});

test("acceptance is specialist-only, import confirmation owner-only, with persistent actor and dates", async () => {
  const s = await series();
  const d = await draft(s.id);
  const owner = { userId: "test-owner", role: "owner" as const, commercialId: null };
  await assert.rejects(transitionInvoice(d.id, "accepted"), /no permitido/);
  await transitionInvoice(d.id, "finished");
  await assert.rejects(scopedTransitionInvoice(d.id, "accepted", sql`true`, owner), /especialista/);
  assert.throws(() => buildFac({ ...d, status: "finished", lines: [] }), /Falta el número de factura/);
  await Promise.all(Array.from({ length: 4 }, () => transitionInvoice(d.id, "accepted")));
  const accepted = await stored(d.id);
  assert.equal(accepted.acceptedBy, specialist.userId);
  assert.ok(accepted.acceptedAt instanceof Date);
  assert.equal(accepted.acceptedSource, "specialist");
  await transitionInvoice(d.id, "accepted");
  assert.deepEqual((await stored(d.id)).acceptedAt, accepted.acceptedAt);
  await assert.rejects(transitionInvoice(d.id, "confirmed"), /administrador/);
  await scopedTransitionInvoice(d.id, "confirmed", sql`true`, owner);
  const confirmed = await stored(d.id);
  assert.equal(confirmed.confirmedBy, owner.userId);
  assert.ok(confirmed.confirmedAt instanceof Date);
  assert.equal(confirmed.status, "confirmed");
  assert.throws(() => buildFac({ ...confirmed, lines: [] }), /ya está confirmada/);
  await assert.rejects(transitionInvoice(d.id, "accepted"), /reactivarse/);
  assert.equal(await counter(s.id), 2);

  const forgottenAcceptance = await draft(s.id);
  await transitionInvoice(forgottenAcceptance.id, "finished");
  await scopedTransitionInvoice(forgottenAcceptance.id, "confirmed", sql`true`, owner);
  await scopedTransitionInvoice(forgottenAcceptance.id, "confirmed", sql`true`, owner);
  const autoAccepted = await stored(forgottenAcceptance.id);
  assert.equal(autoAccepted.status, "confirmed");
  assert.equal(autoAccepted.acceptedBy, owner.userId);
  assert.ok(autoAccepted.acceptedAt instanceof Date);
  assert.equal(autoAccepted.acceptedSource, "versat_import");
  assert.equal(autoAccepted.confirmedBy, owner.userId);
  assert.ok(autoAccepted.confirmedAt instanceof Date);
  const importNotices = await db.select().from(invoiceAcceptanceNotificationsTable)
    .where(eq(invoiceAcceptanceNotificationsTable.invoiceId, forgottenAcceptance.id));
  assert.equal(importNotices.length, 1);
  assert.equal(importNotices[0].recipientUserId, forgottenAcceptance.specialistId);
  assert.equal(importNotices[0].reason, "versat_import");
  assert.equal((await db.select().from(invoiceAcceptanceNotificationsTable)
    .where(eq(invoiceAcceptanceNotificationsTable.invoiceId, d.id))).length, 0);

  const historicalAccepted = await draft(s.id);
  await transitionInvoice(historicalAccepted.id, "finished");
  const historicalAcceptedAt = new Date("2024-01-15T10:00:00.000Z");
  await db.update(invoicesTable).set({
    status: "accepted",
    acceptedBy: "historic-specialist",
    acceptedAt: historicalAcceptedAt,
  }).where(eq(invoicesTable.id, historicalAccepted.id));
  await scopedTransitionInvoice(historicalAccepted.id, "confirmed", sql`true`, owner);
  const historicalConfirmed = await stored(historicalAccepted.id);
  assert.equal(historicalConfirmed.acceptedSource, null);
  assert.equal(historicalConfirmed.acceptedBy, "historic-specialist");
  assert.deepEqual(historicalConfirmed.acceptedAt, historicalAcceptedAt);
});

test("error recovery keeps the same official number, requires acceptance again, and enforces commercial", async () => {
  const s = await series();
  const d = await draft(s.id);
  await transitionInvoice(d.id, "finished");
  await transitionInvoice(d.id, "accepted");
  const number = (await stored(d.id)).versatNumber;
  await transitionInvoice(d.id, "error");
  await assert.rejects(transitionInvoice(d.id, "accepted"), /no permitido/);
  await assert.rejects(transitionInvoice(d.id, "draft"), /numerada/);
  await transitionInvoice(d.id, "finished");
  assert.equal((await stored(d.id)).versatNumber, number);
  assert.equal(await counter(s.id), 2);
  await assert.rejects(scopedTransitionInvoice(d.id, "accepted", sql`true`, { ...specialist, commercialId: 2 }), /no encontrada/);
  await transitionInvoice(d.id, "accepted");
  assert.equal((await stored(d.id)).status, "accepted");
});

test("formatted and compact numbers cannot reserve the same desktop invoice identity", async () => {
  const a = await draft(null);
  const b = await draft(null);
  const formatted = `${tag}HAB-26-091`;
  const compact = `${tag}HAB26091`;
  await db.transaction(async (tx) => {
    await lockNumbering(tx);
    await reserveNumber(tx, a.id, formatted, "5");
  });
  await assert.rejects(db.transaction(async (tx) => {
    await lockNumbering(tx);
    await reserveNumber(tx, b.id, compact, "5");
  }), /reservado/);
  await db.update(invoicesTable).set({ versatNumber: formatted }).where(eq(invoicesTable.id, a.id));
  await assert.rejects(db.transaction(async (tx) => {
    await lockNumbering(tx);
    await reserveNumber(tx, b.id, compact, "5");
  }), /otra factura/);
});

test("only the administrator records payment; a full payment marks the invoice accepted", async () => {
  const s = await series();
  const d = await draft(s.id);
  const owner = { userId: "payment-test-owner", role: "owner" as const };
  await assert.rejects(recordPayment(d.id, owner), /terminada, aceptada o confirmada/);
  await transitionInvoice(d.id, "finished");
  const before = await stored(d.id);
  await assert.rejects(recordPayment(d.id, specialist), /administrador/);
  const retryKey = randomUUID();
  const retries = await Promise.all(Array.from({ length: 4 }, () => recordPayment(d.id, owner, 1, "2026-10-19", retryKey)));
  const paid = await stored(d.id);
  const paymentNotices = await db.select().from(invoiceAcceptanceNotificationsTable)
    .where(eq(invoiceAcceptanceNotificationsTable.invoiceId, d.id));
  assert.equal(paymentNotices.length, 1);
  assert.equal(paymentNotices[0].recipientUserId, d.specialistId);
  assert.equal(paymentNotices[0].invoiceNumber, d.number);
  assert.equal(paymentNotices[0].reason, "payment");
  assert.ok(paymentNotices[0].deliveredAt instanceof Date);
  assert.equal(retries.filter((result) => result.created).length, 1);
  assert.equal(retries[0].totalPaid, 1);
  assert.equal(retries[0].balanceDue, 0);
  assert.equal(retries[0].payments.length, 1);
  assert.equal(paid.paymentStatus, "paid");
  assert.equal(paid.paidBy, owner.userId);
  assert.ok(paid.paidAt instanceof Date);
  assert.equal(paid.status, "accepted");
  assert.equal(paid.acceptedBy, owner.userId);
  assert.ok(paid.acceptedAt instanceof Date);
  assert.equal(paid.acceptedSource, "payment");
  assert.equal(paid.confirmedAt, null);
  assert.deepEqual(paid.legalDocument, before.legalDocument);
  assert.equal(paid.versatNumber, before.versatNumber);
  assert.equal(await counter(s.id), 2);
  assert.throws(() => buildFac({ ...paid, lines: [] }), /líneas/);
  const duplicate = await recordPayment(d.id, { userId: "other-owner", role: "owner" }, 1, "2026-10-19", retryKey);
  assert.equal(duplicate.created, false);
  assert.equal((await db.select().from(invoiceAcceptanceNotificationsTable)
    .where(eq(invoiceAcceptanceNotificationsTable.invoiceId, d.id))).length, 1);
  assert.equal((await stored(d.id)).paidBy, owner.userId);
  assert.deepEqual((await stored(d.id)).paidAt, paid.paidAt);
  await transitionInvoice(d.id, "accepted");
  assert.equal((await stored(d.id)).paymentStatus, "paid");
  assert.equal((await db.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, d.id))).length, 1);
});

test("partial abonos mark the invoice accepted and preserve exact cents, date and balance", async () => {
  const d = await draft(await series().then((row) => row.id));
  await transitionInvoice(d.id, "finished");
  const owner = { userId: "partial-owner", role: "owner" as const };
  const firstKey = randomUUID();
  const first = await recordPayment(d.id, owner, 0.4, "2026-10-10", firstKey);
  assert.equal(first.created, true);
  assert.equal(first.paymentStatus, "pending");
  assert.equal(first.totalPaid, 0.4);
  assert.equal(first.balanceDue, 0.6);
  assert.equal(first.payments[0].paidOn, "2026-10-10");
  const firstSaved = await stored(d.id);
  assert.equal(firstSaved.status, "accepted");
  assert.equal(firstSaved.acceptedBy, owner.userId);
  assert.ok(firstSaved.acceptedAt instanceof Date);
  assert.equal(firstSaved.acceptedSource, "payment");
  assert.equal((await stored(d.id)).paidAt, null);
  assert.equal((await stored(d.id)).paidBy, null);
  assert.equal((await stored(d.id)).paymentStatus, "pending");
  const retry = await recordPayment(d.id, owner, 0.4, "2026-10-10", firstKey);
  assert.equal(retry.created, false);
  assert.equal(retry.totalPaid, 0.4);
  await assert.rejects(recordPayment(d.id, owner, 0.41, "2026-10-10", firstKey), /solicitud ya se usó/);
  await assert.rejects(recordPayment(d.id, owner, -0.01), /importe debe ser positivo/);
  await assert.rejects(recordPayment(d.id, owner, 0.61), /supera el saldo/);
  await assert.rejects(recordPayment(d.id, owner, 0.001), /dos decimales/);
  await assert.rejects(recordPayment(d.id, owner, 0.1, "2026-02-30"), /fecha.*válida/);
  const final = await recordPayment(d.id, owner, 0.6, "2026-10-20");
  assert.equal(final.paymentStatus, "paid");
  assert.equal(final.totalPaid, 1);
  assert.equal(final.balanceDue, 0);
  assert.equal(final.payments.length, 2);
  const saved = await stored(d.id);
  assert.equal(saved.status, "accepted");
  assert.equal(saved.paymentStatus, "paid");
  assert.equal(saved.acceptedBy, owner.userId);
  assert.deepEqual(saved.acceptedAt, firstSaved.acceptedAt);
  assert.equal(saved.paidBy, owner.userId);
  assert.ok(saved.paidAt instanceof Date);
  assert.equal((await db.select().from(invoiceAcceptanceNotificationsTable)
    .where(eq(invoiceAcceptanceNotificationsTable.invoiceId, d.id))).length, 1);
  assert.equal((await db.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, d.id))).length, 2);
  await transitionInvoice(d.id, "accepted");
  assert.equal((await stored(d.id)).paymentStatus, "paid");
});

test("concurrent different abonos lock the invoice and cannot overpay its remaining balance", async () => {
  const d = await draft(await series().then((row) => row.id));
  await transitionInvoice(d.id, "finished");
  const owner = { userId: "parallel-payment-owner", role: "owner" as const };
  const outcomes = await Promise.allSettled([
    recordPayment(d.id, owner, 0.6),
    recordPayment(d.id, owner, 0.6),
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  const failures = outcomes.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.equal(failures.length, 1);
  assert.match(String(failures[0].reason), /supera el saldo/);
  assert.equal((await stored(d.id)).paymentStatus, "pending");
  assert.equal((await db.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, d.id))).length, 1);
});

test("administrator correction edits one selected partial payment without changing either receipt", async () => {
  const d = await draft(await series().then((row) => row.id));
  await transitionInvoice(d.id, "finished");
  const owner = { userId: "payment-correction-owner", role: "owner" as const };
  await recordPayment(d.id, owner, 0.4, "2026-10-10");
  await recordPayment(d.id, owner, 0.6, "2026-10-11");
  const receipts = await db.select().from(invoicePaymentsTable)
    .where(eq(invoicePaymentsTable.invoiceId, d.id)).orderBy(asc(invoicePaymentsTable.id));
  await transitionInvoice(d.id, "accepted");
  const before = await stored(d.id);
  const key = randomUUID();
  const corrections = await Promise.all(Array.from({ length: 4 }, () => correctInvoicePayment(d.id, {
    paymentId: receipts[0].id,
    amount: 0.25,
    paidOn: "2026-10-09",
    reason: "Importe registrado por error",
    confirmed: true,
    idempotencyKey: key,
  }, owner)));
  const saved = await stored(d.id);
  const audit = await db.select().from(invoicePaymentCorrectionsTable)
    .where(eq(invoicePaymentCorrectionsTable.invoiceId, d.id));
  assert.equal(corrections.filter((result) => result.created).length, 1);
  assert.equal(corrections[0].paymentStatus, "pending");
  assert.equal(corrections[0].totalPaid, 0.85);
  assert.equal(corrections[0].balanceDue, 0.15);
  assert.equal(corrections[0].payments.length, 2);
  assert.equal((await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(and(eq(invoicesTable.id, d.id), paymentFilter("partial")))).length, 1);
  assert.equal(saved.paymentStatus, "pending");
  assert.equal(saved.status, "accepted");
  assert.equal(saved.acceptedBy, before.acceptedBy);
  assert.deepEqual(saved.acceptedAt, before.acceptedAt);
  assert.equal(saved.versatNumber, before.versatNumber);
  assert.equal(saved.paidBy, null);
  assert.equal(saved.paidAt, null);
  assert.equal(receipts.length, 2);
  assert.equal(receipts[0].amount, 0.4);
  assert.equal(receipts[0].paidOn, "2026-10-10");
  assert.equal(receipts[1].amount, 0.6);
  assert.equal(receipts[1].paidOn, "2026-10-11");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].reason, "Importe registrado por error");
  assert.equal(audit[0].correctedBy, owner.userId);
  assert.equal(audit[0].targetPaymentId, receipts[0].id);
  assert.equal(audit[0].reversedPaymentId, null);
  assert.equal(audit[0].beforePaymentAmount, 0.4);
  assert.equal(audit[0].afterPaymentAmount, 0.25);
  assert.equal(audit[0].beforePaidOn, "2026-10-10");
  assert.equal(audit[0].afterPaidOn, "2026-10-09");
  assert.equal(audit[0].beforeTotalPaid, 1);
  assert.equal(audit[0].afterTotalPaid, 0.85);
  assert.equal(audit[0].beforeInvoiceStatus, "accepted");
  assert.equal(audit[0].afterPaymentStatus, "pending");
  const revised = await correctInvoicePayment(d.id, {
    paymentId: receipts[0].id,
    amount: 0.3,
    paidOn: "2026-10-12",
    reason: "Ajuste de fecha y monto",
    confirmed: true,
    idempotencyKey: randomUUID(),
  }, owner);
  assert.equal(revised.totalPaid, 0.9);
  assert.equal(revised.paymentCorrections.length, 2);
  assert.equal(revised.paymentCorrections[1].beforePaymentAmount, 0.25);
  assert.equal(revised.paymentCorrections[1].beforePaidOn, "2026-10-09");
  const paidAgain = await correctInvoicePayment(d.id, {
    paymentId: receipts[0].id,
    amount: 0.4,
    paidOn: "2026-10-13",
    reason: "Restaurar importe correcto",
    confirmed: true,
    idempotencyKey: randomUUID(),
  }, owner);
  assert.equal(paidAgain.paymentStatus, "paid");
  assert.equal(paidAgain.totalPaid, 1);
  assert.equal((await stored(d.id)).paidBy, owner.userId);
  const beforeMethodCorrection = await stored(d.id);
  const methodCorrected = await correctInvoicePayment(d.id, {
    paymentId: receipts[0].id,
    paymentMethod: "transfer",
    reason: "El medio se registró por error",
    confirmed: true,
    idempotencyKey: randomUUID(),
  }, owner);
  const afterMethodCorrection = await stored(d.id);
  const methodAudit = methodCorrected.paymentCorrections.at(-1)!;
  assert.equal(methodCorrected.paymentStatus, "paid");
  assert.equal(methodCorrected.totalPaid, 1);
  const effectiveMethodCorrectedPayment = methodCorrected.payments.find(({ id }) => id === receipts[0].id);
  assert.equal(effectiveMethodCorrectedPayment?.paymentMethod, "transfer");
  assert.equal(effectiveMethodCorrectedPayment?.amount, 0.4);
  assert.equal(effectiveMethodCorrectedPayment?.paidOn, "2026-10-13");
  assert.equal(receipts[0].paymentMethod, null);
  assert.equal(methodAudit.beforePaymentMethod, null);
  assert.equal(methodAudit.afterPaymentMethod, "transfer");
  assert.equal(methodAudit.correctedBy, owner.userId);
  assert.equal(methodAudit.reason, "El medio se registró por error");
  assert.equal(afterMethodCorrection.status, beforeMethodCorrection.status);
  assert.equal(afterMethodCorrection.paymentStatus, beforeMethodCorrection.paymentStatus);
  assert.deepEqual(afterMethodCorrection.paidAt, beforeMethodCorrection.paidAt);
  await assert.rejects(correctInvoicePayment(d.id, {
    paymentId: receipts[1].id,
    amount: 0.71,
    paidOn: "2026-10-11",
    reason: "Sobrepasa el total",
    confirmed: true,
    idempotencyKey: randomUUID(),
  }, owner), /supera el total/);
  await assert.rejects(correctInvoicePayment(d.id, {
    reason: "Motivo distinto para la misma clave", confirmed: true, idempotencyKey: key,
  }, owner), /solicitud ya se usó/);
  await assert.rejects(correctInvoicePayment(d.id, {
    reason: "Sin permiso", confirmed: true, idempotencyKey: randomUUID(),
  }, specialist), /administrador/);
  await assert.rejects(correctInvoicePayment(d.id, {
    reason: "No confirmado", confirmed: false, idempotencyKey: randomUUID(),
  }, owner), /Confirma explícitamente/);
  await assert.rejects(correctInvoicePayment(d.id, {
    paymentId: receipts[1].id,
    amount: 0.6,
    paidOn: "2026-10-11",
    reason: "No confirmó selección",
    confirmed: true,
    idempotencyKey: randomUUID(),
  }, owner), /ya tiene esos datos/);
});

test("correcting a historical paid status reopens it without inventing a receipt or acceptance", async () => {
  const d = await draft(null, {
    status: "paid", paidBy: "legacy-accounting", paidAt: new Date("2025-01-01T12:00:00Z"),
  });
  const owner = { userId: "legacy-correction-owner", role: "owner" as const };
  const result = await correctInvoicePayment(d.id, {
    reason: "Registro heredado incorrecto", confirmed: true, idempotencyKey: randomUUID(),
  }, owner);
  const saved = await stored(d.id);
  const receipts = await db.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, d.id));
  assert.equal(result.created, true);
  assert.equal(result.paymentStatus, "pending");
  assert.equal(result.totalPaid, 0);
  assert.equal(result.balanceDue, 1);
  assert.equal(result.payments.length, 0);
  assert.equal(result.paymentCorrections[0].originalPaidBy, "legacy-accounting");
  assert.equal(result.paymentCorrections[0].originalPaidAt, "2025-01-01T12:00:00.000Z");
  assert.equal(saved.status, "sent");
  assert.equal(saved.acceptedAt, null);
  assert.equal(saved.confirmedAt, null);
  assert.equal(receipts.length, 0);
});

test("pending-payment filter respects commercial scope and excludes unissued, voided, error and historical paid", async () => {
  const s = await series();
  const pending = await draft(s.id);
  await transitionInvoice(pending.id, "finished");
  const partiallyPaid = await draft(s.id);
  await transitionInvoice(partiallyPaid.id, "finished");
  await recordPayment(partiallyPaid.id, { userId: "filter-owner", role: "owner" }, 0.4);
  const paid = await draft(s.id);
  await transitionInvoice(paid.id, "finished");
  await recordPayment(paid.id, { userId: "test-owner", role: "owner" });
  const unissued = await draft(s.id);
  const errored = await draft(s.id, { status: "error" });
  const cancelled = await draft(s.id, { status: "cancelled" });
  const voided = await draft(s.id, { status: "voided" });
  const oldPaid = await draft(null, {
    status: "paid", versatNumber: `${tag}LEGACY`,
    versat: { ...snapshot, number: `${tag}LEGACY`, talon: "5" },
  });
  const ids = [pending.id, partiallyPaid.id, paid.id, unissued.id, errored.id, cancelled.id, voided.id, oldPaid.id];
  const rows = await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(and(inArray(invoicesTable.id, ids), paymentFilter("pending"), invoiceScope(specialist)));
  assert.deepEqual(rows.map(r => r.id).sort((a, b) => a - b), [pending.id, partiallyPaid.id].sort((a, b) => a - b));
  const other = await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(and(inArray(invoicesTable.id, ids), paymentFilter("pending"), invoiceScope({ role: "specialist", commercialId: 2 })));
  assert.equal(other.length, 0);
  const completed = await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(and(inArray(invoicesTable.id, ids), paymentFilter("paid"), invoiceScope(specialist)));
  assert.deepEqual(completed.map(r => r.id).sort((a, b) => a - b), [paid.id, oldPaid.id].sort((a, b) => a - b));
  const partial = await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(and(inArray(invoicesTable.id, ids), paymentFilter("partial"), invoiceScope(specialist)));
  assert.deepEqual(partial.map(r => r.id), [partiallyPaid.id]);
  const otherPartial = await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(and(inArray(invoicesTable.id, ids), paymentFilter("partial"), invoiceScope({ role: "specialist", commercialId: 2 })));
  assert.equal(otherPartial.length, 0);
  assert.equal(paymentStatus(await stored(oldPaid.id)), "paid");
  await transitionInvoice(oldPaid.id, "accepted");
  const adopted = await stored(oldPaid.id);
  assert.equal(adopted.paymentStatus, "paid");
  assert.equal(adopted.paidAt, null); // Don't fabricate a historical payment date.
  for (const id of [unissued.id, errored.id, cancelled.id, voided.id]) {
    await assert.rejects(recordPayment(id, { userId: "owner", role: "owner" }), /terminada, aceptada o confirmada/);
  }
});

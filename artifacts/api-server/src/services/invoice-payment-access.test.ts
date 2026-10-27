import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import {
  CreateInvoicePaymentResponse,
  CreateInvoiceShareResponse,
  GetInvoiceResponse,
  GetSharedInvoiceResponse,
  ListInvoicesResponse,
  ListOwnerInvoiceAssignmentReviewsResponse,
  AssignOwnerInvoiceToSpecialistResponse,
} from "@workspace/api-zod";
import { eq, inArray } from "drizzle-orm";
import {
  customersTable,
  db,
  invoiceLinesTable,
  invoiceNumberReservationsTable,
  invoicePaymentsTable,
  invoicePaymentCorrectionsTable,
  invoicesTable,
  invoiceSharesTable,
  pool,
  teamInvitationsTable,
  teamMembersTable,
  versatCatalogTable,
  type VersatInvoiceSnapshot,
} from "@workspace/db";
import billingRouter from "../routes/billing";
import { summarizePayments } from "./invoice-payment";

const tag = `payment-access-${randomUUID()}`;
const ownerId = `${tag}-owner`;
const specialistOneId = `${tag}-specialist-one`;
const specialistTwoId = `${tag}-specialist-two`;
const identities = [ownerId, specialistOneId, specialistTwoId];
const email = (id: string) => `${id}@example.invalid`;
let server: Server;
let base: string;
let customerId: number;
let commercialOneId: number;
let commercialTwoId: number;
let invoiceOneId: number;
let invoiceTwoId: number;
let invoiceOnePaymentId: number;
const mutationInvoiceIds: number[] = [];
const mutationCatalogIds: number[] = [];

before(async () => {
  mock.method(clerkClient.users, "getUser", async (id: string) => ({
    id,
    firstName: "Synthetic",
    lastName: "Payment Access",
    primaryEmailAddressId: "verified",
    emailAddresses: [{
      id: "verified",
      emailAddress: email(id),
      verification: { status: "verified" },
    }],
  }));

  await db.insert(teamMembersTable).values(identities.map((userId) => ({
    userId,
    name: userId,
    email: email(userId),
    role: userId === ownerId ? "owner" as const : "specialist" as const,
  })));
  const occupiedCommercialIds = new Set((await db.select({ versat: invoicesTable.versat }).from(invoicesTable))
    .map(({ versat }) => versat?.commercialId)
    .filter((id): id is number => typeof id === "number"));
  async function insertSyntheticCommercial(suffix: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [commercial] = await db.insert(versatCatalogTable).values({
        kind: "commercial",
        sourceId: -Math.floor(Math.random() * 1_000_000_000),
        code: `${tag}-${suffix}`,
        name: `${tag}-${suffix}`,
        exportValue: `${tag}-${suffix}`,
      }).returning();
      if (!occupiedCommercialIds.has(commercial.id)) {
        occupiedCommercialIds.add(commercial.id);
        return commercial;
      }
      await db.delete(versatCatalogTable).where(eq(versatCatalogTable.id, commercial.id));
    }
    throw new Error("Could not allocate an isolated synthetic commercial id.");
  }
  const commercialOne = await insertSyntheticCommercial("one");
  const commercialTwo = await insertSyntheticCommercial("two");
  commercialOneId = commercialOne.id;
  commercialTwoId = commercialTwo.id;
  await db.insert(teamInvitationsTable).values([
    { email: email(specialistOneId), commercialId: commercialOneId },
    { email: email(specialistTwoId), commercialId: commercialTwoId },
  ]);

  const [customer] = await db.insert(customersTable).values({ name: tag }).returning();
  customerId = customer.id;
  const snapshot = (commercialId: number, suffix: string): VersatInvoiceSnapshot => ({
    commercialId,
    conceptId: 1,
    operationId: 1,
    paymentId: 1,
    number: null,
    talon: null,
    bankAccountMC: null,
    bankAccountOM: null,
    contract: null,
    currencyName: "CUP",
    conceptCode: "TEST",
    operationName: `${tag}-${suffix}`,
    commercialName: `${tag}-${suffix}`,
    commercialPosition: "",
    paymentName: "Synthetic payment",
    customerCode: "TEST",
    customerName: `${tag}-${suffix}`,
    customerAddress: null,
    customerTaxId: null,
  });
  const [invoiceOne, invoiceTwo] = await db.insert(invoicesTable).values([
    {
      number: `${tag}-one`,
      customerId,
      specialistId: specialistOneId,
      specialistName: specialistOneId,
      issueDate: "2026-10-21",
      currency: "CUP",
      status: "sent",
      versat: snapshot(commercialOneId, "one"),
      subtotal: 100,
      total: 100,
    },
    {
      number: `${tag}-two`,
      customerId,
      specialistId: specialistTwoId,
      specialistName: specialistTwoId,
      issueDate: "2026-10-21",
      currency: "CUP",
      status: "sent",
      versat: snapshot(commercialTwoId, "two"),
      subtotal: 200,
      total: 200,
    },
  ]).returning();
  invoiceOneId = invoiceOne.id;
  invoiceTwoId = invoiceTwo.id;
  const paymentRows = await db.insert(invoicePaymentsTable).values([
    {
      invoiceId: invoiceOneId, idempotencyKey: randomUUID(), amount: 10, currency: tag,
      paidOn: "2026-10-19", paidBy: ownerId, paymentMethod: "transfer", recordedAt: new Date("2026-10-19T12:00:00Z"),
    },
    { invoiceId: invoiceOneId, idempotencyKey: randomUUID(), amount: 25, currency: tag, paidOn: "2026-10-20", paidBy: ownerId, paymentMethod: "cash" },
    { invoiceId: invoiceTwoId, idempotencyKey: randomUUID(), amount: 80, currency: tag, paidOn: "2026-10-19", paidBy: ownerId, paymentMethod: "other" },
    { invoiceId: invoiceTwoId, idempotencyKey: randomUUID(), amount: 20, currency: tag, paidOn: "2026-10-20", paidBy: ownerId },
  ]).returning({ id: invoicePaymentsTable.id, invoiceId: invoicePaymentsTable.invoiceId });
  const paymentOneId = paymentRows.find((payment) => payment.invoiceId === invoiceOneId)!.id;
  invoiceOnePaymentId = paymentOneId;
  const paymentTwoId = paymentRows.find((payment) => payment.invoiceId === invoiceTwoId)!.id;
  await db.insert(invoicePaymentCorrectionsTable).values([
    {
      invoiceId: invoiceOneId, idempotencyKey: randomUUID(), reason: 'Motivo "solo factura uno"',
      correctedBy: ownerId, targetPaymentId: paymentOneId, reversedPaymentId: null,
      beforePaymentAmount: 10, afterPaymentAmount: 8, beforePaidOn: "2026-10-19", afterPaidOn: "2026-10-18",
      beforeInvoiceStatus: "sent", afterInvoiceStatus: "accepted", beforePaymentStatus: "pending", afterPaymentStatus: "pending",
      beforeTotalPaid: 35, afterTotalPaid: 33, originalPaidBy: null, originalPaidAt: null,
    },
    {
      invoiceId: invoiceTwoId, idempotencyKey: randomUUID(), reason: "OTRA_FACTURA_NO_EXPORTAR",
      correctedBy: specialistTwoId, targetPaymentId: paymentTwoId, reversedPaymentId: null,
      beforePaymentAmount: 80, afterPaymentAmount: 70, beforePaidOn: "2026-10-19", afterPaidOn: "2026-10-18",
      beforeInvoiceStatus: "sent", afterInvoiceStatus: "accepted", beforePaymentStatus: "pending", afterPaymentStatus: "pending",
      beforeTotalPaid: 100, afterTotalPaid: 90, originalPaidBy: ownerId, originalPaidAt: new Date("2026-10-19T12:00:00Z"),
    },
  ]);

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
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  mock.restoreAll();
  const invoiceIds = [invoiceOneId, invoiceTwoId].filter(Boolean);
  invoiceIds.push(...mutationInvoiceIds);
  if (invoiceIds.length) {
    await db.delete(invoiceSharesTable).where(inArray(invoiceSharesTable.invoiceId, invoiceIds));
    await db.delete(invoiceNumberReservationsTable).where(inArray(invoiceNumberReservationsTable.invoiceId, invoiceIds));
    await db.delete(invoiceLinesTable).where(inArray(invoiceLinesTable.invoiceId, invoiceIds));
    await db.delete(invoicesTable).where(inArray(invoicesTable.id, invoiceIds));
  }
  if (customerId) await db.delete(customersTable).where(eq(customersTable.id, customerId));
  await db.delete(teamInvitationsTable).where(inArray(teamInvitationsTable.email, identities.map(email)));
  await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, identities));
  if (commercialOneId && commercialTwoId) {
    await db.delete(versatCatalogTable).where(inArray(versatCatalogTable.id, [commercialOneId, commercialTwoId]));
  }
  if (mutationCatalogIds.length) {
    await db.delete(versatCatalogTable).where(inArray(versatCatalogTable.id, mutationCatalogIds));
  }
  await pool.end();
});

const request = (path: string, actor = specialistOneId, method = "GET", body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      "x-synthetic-id": actor,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test("owner can review historical invoices separately and reassign only a confirmed, matching invoice", async () => {
  const [historicInvoice] = await db.insert(invoicesTable).values({
    number: `${tag}-owner-historic`,
    customerId,
    specialistId: ownerId,
    specialistName: "Synthetic owner",
    issueDate: "2025-06-14",
    currency: "CUP",
    status: "confirmed",
    versat: {
      conceptId: 1,
      operationId: 1,
      commercialId: commercialOneId,
      paymentId: 1,
      number: "HIST",
      talon: "1",
      bankAccountMC: null,
      bankAccountOM: null,
      contract: null,
      currencyName: "CUP",
      conceptCode: "TEST",
      operationName: `${tag}-historic`,
      commercialName: `${tag}-one`,
      commercialPosition: "",
      paymentName: "Synthetic payment",
      customerCode: "TEST",
      customerName: `${tag}-historic customer`,
      customerAddress: null,
      customerTaxId: null,
    },
    subtotal: 40,
    total: 40,
  }).returning();
  try {
    const specialistList = await request("/invoices/owner-assignment-reviews", specialistOneId);
    assert.equal(specialistList.status, 403);

    const ownerResponse = await request("/invoices/owner-assignment-reviews", ownerId);
    assert.equal(ownerResponse.status, 200);
    const reviews = ListOwnerInvoiceAssignmentReviewsResponse.parse(await ownerResponse.json());
    const review = reviews.find(({ id }) => id === historicInvoice.id);
    assert.ok(review);
    assert.equal(review.currentSpecialistId, ownerId);
    assert.equal(review.currentSpecialistName, "Synthetic owner");
    assert.equal(review.versatCommercialId, commercialOneId);
    assert.equal(review.versatCommercialName, `${tag}-one`);
    assert.deepEqual(review.matchingSpecialists, [{
      specialistId: specialistOneId,
      specialistName: "Synthetic Payment Access",
    }]);

    const rejected = await request(
      `/invoices/${historicInvoice.id}/owner-assignment`, ownerId, "PATCH", { specialistId: specialistTwoId },
    );
    assert.equal(rejected.status, 422);
    assert.equal(
      (await db.select({ specialistId: invoicesTable.specialistId }).from(invoicesTable)
        .where(eq(invoicesTable.id, historicInvoice.id)))[0].specialistId,
      ownerId,
    );

    const assigned = await request(
      `/invoices/${historicInvoice.id}/owner-assignment`, ownerId, "PATCH", { specialistId: specialistOneId },
    );
    assert.equal(assigned.status, 200);
    const result = AssignOwnerInvoiceToSpecialistResponse.parse(await assigned.json());
    assert.deepEqual(result, {
      id: historicInvoice.id,
      specialistId: specialistOneId,
      specialistName: "Synthetic Payment Access",
    });
    assert.equal(
      (await db.select({ specialistId: invoicesTable.specialistId }).from(invoicesTable)
        .where(eq(invoicesTable.id, invoiceTwoId)))[0].specialistId,
      specialistTwoId,
    );

    const afterAssignment = await request("/invoices/owner-assignment-reviews", ownerId);
    const remaining = ListOwnerInvoiceAssignmentReviewsResponse.parse(await afterAssignment.json());
    assert.ok(!remaining.some(({ id }) => id === historicInvoice.id));
  } finally {
    await db.delete(invoicesTable).where(eq(invoicesTable.id, historicInvoice.id));
  }
});

function assertPaymentSnapshot(
  invoice: { id: number; totalPaid: number; balanceDue: number; payments: Array<{ amount: number }> },
  expected: { id: number; totalPaid: number; balanceDue: number; payments: number[] },
) {
  assert.equal(invoice.id, expected.id);
  assert.equal(invoice.totalPaid, expected.totalPaid);
  assert.equal(invoice.balanceDue, expected.balanceDue);
  assert.deepEqual(invoice.payments.map(({ amount }) => amount), expected.payments);
}

test("only the owner can download corrections for the requested invoice", async () => {
  const [noReceiptCorrection] = await db.insert(invoicePaymentCorrectionsTable).values({
    invoiceId: invoiceOneId,
    idempotencyKey: randomUUID(),
    reason: "Corrección histórica sin recibo",
    correctedBy: ownerId,
    targetPaymentId: null,
    reversedPaymentId: null,
    beforeInvoiceStatus: "sent",
    afterInvoiceStatus: "sent",
    beforePaymentStatus: "pending",
    afterPaymentStatus: "pending",
    beforeTotalPaid: 33,
    afterTotalPaid: 30,
    originalPaidBy: null,
    originalPaidAt: null,
  }).returning({ id: invoicePaymentCorrectionsTable.id });
  const [originalReceipt] = await db.select({
    reference: invoicePaymentsTable.reference,
  }).from(invoicePaymentsTable).where(eq(invoicePaymentsTable.id, invoiceOnePaymentId));
  await db.update(invoicePaymentsTable).set({ reference: "REF-RECIBO-UNO" })
    .where(eq(invoicePaymentsTable.id, invoiceOnePaymentId));
  try {
    const specialistResponse = await request(`/invoices/${invoiceOneId}/payment-corrections/export`, specialistOneId);
    assert.equal(specialistResponse.status, 403);

    const ownerResponse = await request(`/invoices/${invoiceOneId}/payment-corrections/export`, ownerId);
    assert.equal(ownerResponse.status, 200);
    const result = await ownerResponse.json() as { filename: string; base64: string; contentType: string };
    assert.equal(result.filename, `correcciones-factura-${invoiceOneId}.csv`);
    assert.equal(result.contentType, "text/csv; charset=utf-8");
    const csv = Buffer.from(result.base64, "base64").toString("utf8");
    assert.ok(csv.startsWith("\uFEFF"));
    const [headerLine, ...dataLines] = csv.slice(1).trimEnd().split("\r\n");
    const parseCsvLine = (line: string) => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)]
      .map(([, value]) => value.replaceAll('""', '"'));
    const headers = parseCsvLine(headerLine);
    const exportedRows = dataLines.map(parseCsvLine);
    const receiptCorrection = exportedRows.find((row) => row[headers.indexOf("Abono")] === String(invoiceOnePaymentId));
    const noReceiptCorrection = exportedRows.find((row) => row[headers.indexOf("Abono")] === "Sin recibo original");
    assert.ok(receiptCorrection);
    assert.ok(noReceiptCorrection);
    assert.ok(headers.includes("Importe antes (CUP)"));
    assert.ok(headers.includes("Total abonado antes (CUP)"));
    assert.equal(receiptCorrection[headers.indexOf("Referencia del recibo")], "REF-RECIBO-UNO");
    assert.equal(receiptCorrection[headers.indexOf("Registrado por")], ownerId);
    assert.equal(receiptCorrection[headers.indexOf("Fecha de registro")], "2026-10-19T12:00:00.000Z");
    assert.equal(receiptCorrection[headers.indexOf("Autor")], ownerId);
    assert.equal(receiptCorrection[headers.indexOf("Motivo")], 'Motivo "solo factura uno"');
    assert.deepEqual([
      receiptCorrection[headers.indexOf("Importe antes (CUP)")],
      receiptCorrection[headers.indexOf("Importe después (CUP)")],
      receiptCorrection[headers.indexOf("Fecha antes")],
      receiptCorrection[headers.indexOf("Fecha después")],
      receiptCorrection[headers.indexOf("Total abonado antes (CUP)")],
      receiptCorrection[headers.indexOf("Total abonado después (CUP)")],
    ], ["10.00", "8.00", "2026-10-19", "2026-10-18", "35.00", "33.00"]);
    assert.equal(noReceiptCorrection[headers.indexOf("Referencia del recibo")], "");
    assert.equal(noReceiptCorrection[headers.indexOf("Registrado por")], "");
    assert.equal(noReceiptCorrection[headers.indexOf("Fecha de registro")], "");
    assert.equal(noReceiptCorrection[headers.indexOf("Autor")], ownerId);
    assert.equal(noReceiptCorrection[headers.indexOf("Motivo")], "Corrección histórica sin recibo");
    assert.deepEqual([
      noReceiptCorrection[headers.indexOf("Importe antes (CUP)")],
      noReceiptCorrection[headers.indexOf("Importe después (CUP)")],
      noReceiptCorrection[headers.indexOf("Fecha antes")],
      noReceiptCorrection[headers.indexOf("Fecha después")],
      noReceiptCorrection[headers.indexOf("Total abonado antes (CUP)")],
      noReceiptCorrection[headers.indexOf("Total abonado después (CUP)")],
    ], ["", "", "", "", "33.00", "30.00"]);
    assert.ok(!csv.includes("OTRA_FACTURA_NO_EXPORTAR"));
    const foreignInvoiceResponse = await request(`/invoices/${invoiceOneId}/payment-corrections/export`, specialistTwoId);
    assert.equal(foreignInvoiceResponse.status, 403);
  } finally {
    await db.delete(invoicePaymentCorrectionsTable)
      .where(eq(invoicePaymentCorrectionsTable.id, noReceiptCorrection.id));
    await db.update(invoicePaymentsTable).set({ reference: originalReceipt.reference })
      .where(eq(invoicePaymentsTable.id, invoiceOnePaymentId));
  }
});

test("invoice summaries use the highest correction ID and retain the original receipt", async () => {
  const originalReference = `${tag}-ORIGINAL-RECEIPT`;
  await db.update(invoicePaymentsTable).set({ reference: originalReference })
    .where(eq(invoicePaymentsTable.id, invoiceOnePaymentId));
  const [latestCorrection] = await db.insert(invoicePaymentCorrectionsTable).values({
    invoiceId: invoiceOneId,
    idempotencyKey: randomUUID(),
    reason: "Ajuste posterior del mismo recibo",
    correctedBy: ownerId,
    targetPaymentId: invoiceOnePaymentId,
    reversedPaymentId: null,
    beforePaymentAmount: 8,
    afterPaymentAmount: 6,
    beforePaidOn: "2026-10-18",
    afterPaidOn: null,
    beforePaymentMethod: null,
    afterPaymentMethod: null,
    beforeInvoiceStatus: "sent",
    afterInvoiceStatus: "sent",
    beforePaymentStatus: "pending",
    afterPaymentStatus: "pending",
    beforeTotalPaid: 33,
    afterTotalPaid: 31,
    originalPaidBy: ownerId,
    originalPaidAt: new Date("2026-10-19T12:00:00Z"),
  }).returning();

  try {
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceOneId));
    const payments = await db.select().from(invoicePaymentsTable)
      .where(eq(invoicePaymentsTable.invoiceId, invoiceOneId));
    const corrections = await db.select().from(invoicePaymentCorrectionsTable)
      .where(eq(invoicePaymentCorrectionsTable.invoiceId, invoiceOneId));
    const shuffledSummary = summarizePayments(invoice, payments, [...corrections].reverse());
    assert.equal(shuffledSummary.totalPaid, 31);
    assert.equal(shuffledSummary.balanceDue, 69);
    assert.deepEqual(shuffledSummary.payments
      .filter(({ id }) => id === invoiceOnePaymentId)
      .map(({ amount, reference }) => ({ amount, reference })), [
      { amount: 6, reference: originalReference },
    ]);

    const detailResponse = await request(`/invoices/${invoiceOneId}`, ownerId);
    assert.equal(detailResponse.status, 200);
    const detail = GetInvoiceResponse.parse(await detailResponse.json());
    assert.equal(detail.totalPaid, 31);
    assert.equal(detail.balanceDue, 69);
    assert.deepEqual(detail.payments
      .filter(({ id }) => id === invoiceOnePaymentId)
      .map(({ amount, reference }) => ({ amount, reference })), [
      { amount: 6, reference: originalReference },
    ]);

    const listResponse = await request("/invoices", ownerId);
    assert.equal(listResponse.status, 200);
    const list = ListInvoicesResponse.parse(await listResponse.json());
    const listedInvoice = list.find(({ id }) => id === invoiceOneId);
    assert.ok(listedInvoice);
    assert.equal(listedInvoice.totalPaid, 31);
    assert.equal(listedInvoice.balanceDue, 69);

    const [storedPayment] = await db.select().from(invoicePaymentsTable)
      .where(eq(invoicePaymentsTable.id, invoiceOnePaymentId));
    assert.equal(storedPayment.amount, 10);
    assert.equal(storedPayment.reference, originalReference);
  } finally {
    await db.delete(invoicePaymentCorrectionsTable)
      .where(eq(invoicePaymentCorrectionsTable.id, latestCorrection.id));
    await db.update(invoicePaymentsTable).set({ reference: null })
      .where(eq(invoicePaymentsTable.id, invoiceOnePaymentId));
  }
});

test("specialists see only their commercial's invoice payments in lists, details and authorized public links", async () => {
  const ownSummary = { id: invoiceOneId, totalPaid: 33, balanceDue: 67, payments: [8, 25] };
  const otherSummary = { id: invoiceTwoId, totalPaid: 90, balanceDue: 110, payments: [70, 20] };

  for (const [specialist, visible, hidden] of [
    [specialistOneId, ownSummary, otherSummary],
    [specialistTwoId, otherSummary, ownSummary],
  ] as const) {
    const listResponse = await request("/invoices", specialist);
    assert.equal(listResponse.status, 200);
    const list = ListInvoicesResponse.parse(await listResponse.json());
    assert.deepEqual(
      list.map(({ id }) => id),
      [visible.id],
      `specialist ${specialist}, assigned commercial ${specialist === specialistOneId ? commercialOneId : commercialTwoId}, returned ${JSON.stringify(list.map(({ id, versat }) => ({ id, commercialId: versat?.commercialId })))}`,
    );
    assertPaymentSnapshot(list[0], visible);

    const detailResponse = await request(`/invoices/${visible.id}`, specialist);
    assert.equal(detailResponse.status, 200);
    assertPaymentSnapshot(GetInvoiceResponse.parse(await detailResponse.json()), visible);

    const foreignDetail = await request(`/invoices/${hidden.id}`, specialist);
    assert.equal(foreignDetail.status, 404);
    const foreignBody = await foreignDetail.text();
    assert.ok(!foreignBody.includes(String(hidden.totalPaid)));
    assert.ok(!foreignBody.includes(String(hidden.payments[0])));

    const deniedShare = await request(`/invoices/${hidden.id}/share`, specialist, "POST");
    assert.equal(deniedShare.status, 404);
  }

  const reference = `${tag}-TRANSFER-145`;
  const paymentInput = {
    amount: 5,
    paidOn: "2026-10-21",
    idempotencyKey: randomUUID(),
    reference,
    paymentMethod: "transfer" as const,
  };
  const paymentResponse = await request(`/invoices/${invoiceOneId}/payments`, ownerId, "POST", paymentInput);
  assert.equal(paymentResponse.status, 201);
  const paymentResult = CreateInvoicePaymentResponse.parse(await paymentResponse.json());
  const referencedPayment = paymentResult.payments.find(({ reference: value }) => value === reference);
  assert.ok(referencedPayment);
  assert.equal(referencedPayment.paymentMethod, "transfer");
  const retryResponse = await request(`/invoices/${invoiceOneId}/payments`, ownerId, "POST", paymentInput);
  assert.equal(retryResponse.status, 200);
  const mismatchedRetryResponse = await request(`/invoices/${invoiceOneId}/payments`, ownerId, "POST", {
    ...paymentInput,
    paymentMethod: "cash",
  });
  assert.equal(mismatchedRetryResponse.status, 409);
  assert.ok(paymentResult.payments
    .filter(({ id }) => id !== referencedPayment.id)
    .every(({ reference: value }) => value === null));
  const paymentSummaryResponse = await request("/billing/payment-method-summary?from=2026-10-18&to=2026-10-21", ownerId);
  assert.equal(paymentSummaryResponse.status, 200);
  const paymentSummary = await paymentSummaryResponse.json() as Array<{
    currency: string; method: string; amount: number; count: number;
  }>;
  assert.deepEqual(paymentSummary.filter(({ currency }) => currency === tag)
    .map(({ method, amount, count }) => ({ method, amount, count })),
  [
    { method: "cash", amount: 25, count: 1 },
    { method: "other", amount: 70, count: 1 },
    { method: "transfer", amount: 8, count: 1 },
    { method: "unspecified", amount: 20, count: 1 },
  ]);
  const narrowedSummaryResponse = await request("/billing/payment-method-summary?from=2026-10-20&to=2026-10-20", ownerId);
  assert.equal(narrowedSummaryResponse.status, 200);
  const narrowedSummary = await narrowedSummaryResponse.json() as typeof paymentSummary;
  assert.deepEqual(narrowedSummary.filter(({ currency }) => currency === tag)
    .map(({ method, amount, count }) => ({ method, amount, count })),
  [
    { method: "cash", amount: 25, count: 1 },
    { method: "unspecified", amount: 20, count: 1 },
  ]);
  const invalidPeriodResponse = await request("/billing/payment-method-summary?from=2026-10-21&to=2026-10-18", ownerId);
  assert.equal(invalidPeriodResponse.status, 400);
  const specialistSummaryResponse = await request(
    "/billing/payment-method-summary?from=2026-10-18&to=2026-10-21", specialistOneId,
  );
  assert.equal(specialistSummaryResponse.status, 403);
  const updatedOwnSummary = { id: invoiceOneId, totalPaid: 38, balanceDue: 62, payments: [8, 25, 5] };

  const createdResponse = await request(`/invoices/${invoiceOneId}/share`, specialistOneId, "POST");
  assert.equal(createdResponse.status, 200);
  const createdShare = CreateInvoiceShareResponse.parse(await createdResponse.json());
  const token = new URL(createdShare.url).pathname.split("/").at(-1)!;

  const sharedResponse = await request(`/shared-invoices/${token}`, "");
  assert.equal(sharedResponse.status, 200);
  const sharedBody = await sharedResponse.json() as Record<string, unknown>;
  const sharedInvoice = GetSharedInvoiceResponse.parse(sharedBody);
  assert.equal(sharedInvoice.total, 100);
  const sharedFields = new Set([
    "payments", "paymentStatus", "totalPaid", "balanceDue", "paymentCorrections",
    "paymentId", "targetPaymentId", "reversedPaymentId", "reference", "paidOn",
    "paidBy", "recordedAt", "paymentMethod", "correctedBy", "reason",
  ]);
  const collectKeys = (value: unknown): string[] => {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(collectKeys);
    return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
  };
  for (const key of collectKeys(sharedBody)) {
    assert.equal(sharedFields.has(key), false, `shared invoice must omit ${key}`);
  }
  const sharedJson = JSON.stringify(sharedBody);
  for (const privateValue of [
    reference,
    'Motivo "solo factura uno"',
    ownerId,
  ]) {
    assert.equal(sharedJson.includes(privateValue), false, `shared invoice must omit ${privateValue}`);
  }

  const ownerListResponse = await request("/invoices", ownerId);
  assert.equal(ownerListResponse.status, 200);
  const ownerInvoices = ListInvoicesResponse.parse(await ownerListResponse.json());
  const ownerInvoiceIds = ownerInvoices.map(({ id }) => id);
  assert.ok(ownerInvoiceIds.includes(invoiceOneId));
  assert.ok(ownerInvoiceIds.includes(invoiceTwoId));
  assertPaymentSnapshot(ownerInvoices.find(({ id }) => id === invoiceOneId)!, updatedOwnSummary);
  assertPaymentSnapshot(ownerInvoices.find(({ id }) => id === invoiceTwoId)!, otherSummary);
  for (const expected of [updatedOwnSummary, otherSummary]) {
    const ownerDetail = await request(`/invoices/${expected.id}`, ownerId);
    assert.equal(ownerDetail.status, 200);
    assertPaymentSnapshot(GetInvoiceResponse.parse(await ownerDetail.json()), expected);
  }
});

test("foreign specialists cannot edit drafts or change their status; denied requests leave all invoice data untouched", async () => {
  const [currency, concept, operation, payment] = await db.insert(versatCatalogTable).values([
    { kind: "currency", sourceId: -Math.floor(Math.random() * 1_000_000_000), code: `${tag}-CUR`, name: "Synthetic currency", exportValue: "Synthetic currency" },
    { kind: "concept", sourceId: -Math.floor(Math.random() * 1_000_000_000), code: `${tag}-CON`, name: "Synthetic concept", exportValue: "Synthetic concept" },
    { kind: "operation", sourceId: -Math.floor(Math.random() * 1_000_000_000), code: `${tag}-OP`, name: "Synthetic operation", exportValue: "Synthetic operation" },
    { kind: "payment", sourceId: -Math.floor(Math.random() * 1_000_000_000), code: `${tag}-PAY`, name: "Synthetic payment", exportValue: "Synthetic payment" },
  ]).returning();
  mutationCatalogIds.push(currency.id, concept.id, operation.id, payment.id);

  const snapshot = (commercialId: number, label: string): VersatInvoiceSnapshot => ({
    commercialId,
    conceptId: concept.id,
    operationId: operation.id,
    paymentId: payment.id,
    number: `${tag}-${label}-original`,
    talon: "9",
    bankAccountMC: null,
    bankAccountOM: null,
    contract: null,
    currencyName: currency.exportValue,
    conceptCode: concept.code,
    operationName: operation.exportValue,
    commercialName: label,
    commercialPosition: "",
    paymentName: payment.exportValue,
    customerCode: "TEST",
    customerName: tag,
    customerAddress: null,
    customerTaxId: null,
  });
  const [draftOne, draftTwo] = await db.insert(invoicesTable).values([
    {
      number: `${tag}-draft-one`, customerId, specialistId: specialistOneId, specialistName: specialistOneId,
      issueDate: "2026-10-21", currency: currency.code, status: "draft",
      versat: snapshot(commercialOneId, "one"), versatNumber: `${tag}-one-original`, subtotal: 20, total: 20,
    },
    {
      number: `${tag}-draft-two`, customerId, specialistId: specialistTwoId, specialistName: specialistTwoId,
      issueDate: "2026-10-21", currency: currency.code, status: "draft",
      versat: snapshot(commercialTwoId, "two"), versatNumber: `${tag}-two-original`, subtotal: 40, total: 40,
    },
  ]).returning();
  mutationInvoiceIds.push(draftOne.id, draftTwo.id);
  await db.insert(invoiceLinesTable).values([
    { invoiceId: draftOne.id, description: "Original one", quantity: 1, unitPrice: 20, amount: 20, groupCode: "TEST" },
    { invoiceId: draftTwo.id, description: "Original two", quantity: 1, unitPrice: 40, amount: 40, groupCode: "TEST" },
  ]);
  const originalRows = [draftOne, draftTwo];
  const originalLines = await db.select().from(invoiceLinesTable)
    .where(inArray(invoiceLinesTable.invoiceId, mutationInvoiceIds));
  const editBody = (commercialId: number, label: string) => ({
    customerId,
    issueDate: "2026-10-22",
    currency: currency.code,
    notes: `${tag}-edited-${label}`,
    versat: {
      conceptId: concept.id,
      operationId: operation.id,
      commercialId,
      paymentId: payment.id,
      number: `${tag.slice(0, 20)}-${label}-edited`,
      talon: "9",
    },
    lines: [{ description: `Edited ${label}`, groupCode: "TEST", quantity: 2, unitPrice: 30 }],
  });

  for (const [actor, foreignDraft, foreignCommercial] of [
    [specialistOneId, draftTwo, commercialTwoId],
    [specialistTwoId, draftOne, commercialOneId],
  ] as const) {
    const edit = await request(`/invoices/${foreignDraft.id}`, actor, "PATCH", editBody(foreignCommercial, "denied"));
    assert.equal(edit.status, 404);
    const status = await request(`/invoices/${foreignDraft.id}/status`, actor, "PATCH", { status: "finished" });
    assert.equal(status.status, 404);
  }

  const afterDeniedRows = await db.select().from(invoicesTable)
    .where(inArray(invoicesTable.id, mutationInvoiceIds));
  const afterDeniedLines = await db.select().from(invoiceLinesTable)
    .where(inArray(invoiceLinesTable.invoiceId, mutationInvoiceIds));
  assert.deepEqual(afterDeniedRows, originalRows);
  assert.deepEqual(afterDeniedLines, originalLines);

  const ownerEdit = await request(
    `/invoices/${draftTwo.id}`, ownerId, "PATCH", editBody(commercialTwoId, "owner"),
  );
  assert.equal(ownerEdit.status, 200, await ownerEdit.text());
  const updated = (await db.select().from(invoicesTable).where(eq(invoicesTable.id, draftTwo.id)))[0];
  assert.equal(updated.status, "draft");
  assert.equal(updated.notes, `${tag}-edited-owner`);
  assert.equal(updated.versatNumber, `${tag.slice(0, 20)}-owner-edited`);
  const updatedLines = await db.select().from(invoiceLinesTable)
    .where(eq(invoiceLinesTable.invoiceId, draftTwo.id));
  assert.equal(updatedLines.length, 1);
  assert.equal(updatedLines[0].description, "Edited owner");
});

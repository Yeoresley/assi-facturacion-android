import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import {
  CreateSettlementClosureResponse,
  CreateSettlementOverpaymentFulfillmentResponse,
  CreateSettlementOverpaymentResolutionResponse,
  CreateSettlementPaymentResponse,
  GetMonthlySettlementResponse,
  ListSettlementOverpaymentNotificationsResponse,
  MarkSettlementOverpaymentNotificationReadResponse,
} from "@workspace/api-zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  customersTable,
  db,
  invoiceLinesTable,
  invoicePaymentCorrectionsTable,
  invoicePaymentsTable,
  invoicesTable,
  pool,
  settlementClassificationsTable,
  settlementClosuresTable,
  settlementExchangeRatesTable,
  settlementOverpaymentResolutionsTable,
  settlementOverpaymentFulfillmentsTable,
  settlementPaymentsTable,
  teamMembersTable,
} from "@workspace/db";
import settlementsRouter from "../routes/settlements";
import { correctInvoicePayment } from "./invoice-payment";

const tag = `settlement-payment-access-${randomUUID()}`;
const ownerId = `${tag}-owner`;
const specialistOneId = `${tag}-one`;
const specialistTwoId = `${tag}-two`;
const identities = [ownerId, specialistOneId, specialistTwoId];
const paidOn = new Date().toISOString().slice(0, 10);
const period = paidOn.slice(0, 7);
const email = (id: string) => `${id}@example.invalid`;
const testCurrency = `T${randomUUID().slice(0, 7).toUpperCase()}`;
let server: Server;
let base: string;
let customerId: number;
let invoiceId: number;
let ownerCommercialInvoiceId: number;
let awaitingConfirmationInvoiceId: number;
let correctedPartialInvoiceId: number;
let inactivePaidInvoiceIds: number[] = [];
let invoiceLineId: number;

before(async () => {
  mock.method(clerkClient.users, "getUser", async (id: string) => ({
    id,
    firstName: "Synthetic",
    lastName: "Settlement",
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
  const [customer] = await db.insert(customersTable).values({ name: `${tag}-customer` }).returning();
  customerId = customer.id;
  const [invoice] = await db.insert(invoicesTable).values({
    number: `${tag}-invoice`,
    customerId,
    specialistId: specialistOneId,
    specialistName: specialistOneId,
    issueDate: paidOn,
    currency: "CUP",
    status: "confirmed",
    paymentStatus: "paid",
    confirmedBy: ownerId,
    confirmedAt: new Date(),
    subtotal: 10_000,
    total: 10_000,
  }).returning();
  invoiceId = invoice.id;
  const [ownerCommercialInvoice] = await db.insert(invoicesTable).values({
    number: `${tag}-owner-commercial-invoice`,
    customerId,
    specialistId: ownerId,
    specialistName: "Synthetic owner",
    issueDate: paidOn,
    currency: "CUP",
    status: "confirmed",
    paymentStatus: "paid",
    versat: {
      conceptId: 1,
      operationId: 1,
      commercialId: 9876,
      paymentId: 1,
      number: null,
      talon: null,
      bankAccountMC: null,
      bankAccountOM: null,
      contract: null,
      currencyName: "CUP",
      conceptCode: "CON",
      operationName: "Venta",
      commercialName: "Comercial de Versat",
      commercialPosition: "",
      paymentName: "Transferencia",
      customerCode: null,
      customerName: `${tag}-customer`,
      customerAddress: null,
      customerTaxId: null,
    },
    subtotal: 500,
    total: 500,
  }).returning();
  ownerCommercialInvoiceId = ownerCommercialInvoice.id;
  await db.insert(invoicePaymentsTable).values({
    invoiceId: ownerCommercialInvoiceId,
    idempotencyKey: randomUUID(),
    amount: 500,
    currency: "CUP",
    paidOn,
    paidBy: ownerId,
  });
  const [line] = await db.insert(invoiceLinesTable).values({
    invoiceId,
    description: `${tag}-service`,
    serviceCode: `${tag}-service-code`,
    quantity: 1,
    unitPrice: 10_000,
    amount: 10_000,
  }).returning();
  invoiceLineId = line.id;
  const [correctedPartialInvoice] = await db.insert(invoicesTable).values({
    number: `${tag}-corrected-partial`,
    customerId,
    specialistId: specialistOneId,
    specialistName: specialistOneId,
    issueDate: paidOn,
    currency: "CUP",
    status: "confirmed",
    paymentStatus: "paid",
    confirmedBy: ownerId,
    confirmedAt: new Date(),
    subtotal: 100,
    total: 100,
  }).returning();
  correctedPartialInvoiceId = correctedPartialInvoice.id;
  await db.insert(invoiceLinesTable).values({
    invoiceId: correctedPartialInvoiceId,
    description: `${tag}-corrected-partial-service`,
    serviceCode: `${tag}-corrected-partial-service-code`,
    quantity: 1,
    unitPrice: 100,
    amount: 100,
  });
  const [correctedPayment] = await db.insert(invoicePaymentsTable).values({
    invoiceId: correctedPartialInvoiceId,
    idempotencyKey: randomUUID(),
    amount: 100,
    currency: "CUP",
    paidOn,
    paidBy: ownerId,
  }).returning();
  await correctInvoicePayment(correctedPartialInvoiceId, {
    paymentId: correctedPayment.id,
    amount: 99.99,
    paidOn,
    reason: "Ajuste de prueba de importe",
    idempotencyKey: randomUUID(),
    confirmed: true,
  }, { role: "owner", userId: ownerId });
  await db.insert(invoicePaymentsTable).values({
    invoiceId,
    idempotencyKey: randomUUID(),
    amount: 10_000,
    currency: "CUP",
    paidOn,
    paidBy: ownerId,
  });
  const [awaitingConfirmationInvoice] = await db.insert(invoicesTable).values({
    number: `${tag}-awaiting-confirmation`,
    customerId,
    specialistId: specialistOneId,
    specialistName: specialistOneId,
    issueDate: paidOn,
    currency: "CUP",
    status: "accepted",
    paymentStatus: "paid",
    subtotal: 3_000,
    total: 3_000,
  }).returning();
  awaitingConfirmationInvoiceId = awaitingConfirmationInvoice.id;
  await db.insert(invoicePaymentsTable).values({
    invoiceId: awaitingConfirmationInvoiceId,
    idempotencyKey: randomUUID(),
    amount: 3_000,
    currency: "CUP",
    paidOn,
    paidBy: ownerId,
  });
  const inactivePaidInvoices = await db.insert(invoicesTable).values([
    {
      number: `${tag}-voided-paid`,
      customerId,
      specialistId: specialistOneId,
      specialistName: specialistOneId,
      issueDate: paidOn,
      currency: "CUP",
      status: "voided",
      paymentStatus: "paid",
      paidAt: new Date(),
      subtotal: 700,
      total: 700,
    },
    {
      number: `${tag}-cancelled-paid`,
      customerId,
      specialistId: specialistOneId,
      specialistName: specialistOneId,
      issueDate: paidOn,
      currency: "CUP",
      status: "cancelled",
      paymentStatus: "paid",
      paidAt: new Date(),
      subtotal: 800,
      total: 800,
    },
  ]).returning({ id: invoicesTable.id });
  inactivePaidInvoiceIds = inactivePaidInvoices.map(({ id }) => id);
  await db.insert(settlementClassificationsTable).values({
    invoiceLineId: line.id,
    salesType: "service",
    label: "Servicio de prueba",
    updatedBy: ownerId,
  });
  await db.insert(settlementPaymentsTable).values([
    { period, specialistId: specialistOneId, amount: 125, paidOn, reference: `${tag}-one`, recordedBy: ownerId },
    { period, specialistId: specialistTwoId, amount: 225, paidOn, reference: `${tag}-two`, recordedBy: ownerId },
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
  app.use("/api", settlementsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  mock.restoreAll();
  const resolutionIdsToClean = await db.select({ id: settlementOverpaymentResolutionsTable.id })
    .from(settlementOverpaymentResolutionsTable)
    .where(inArray(settlementOverpaymentResolutionsTable.specialistId, [specialistOneId, specialistTwoId]));
  if (resolutionIdsToClean.length) {
    await db.delete(settlementOverpaymentFulfillmentsTable).where(inArray(
      settlementOverpaymentFulfillmentsTable.resolutionId,
      resolutionIdsToClean.map(({ id }) => id),
    ));
  }
  await db.delete(settlementOverpaymentResolutionsTable).where(inArray(
    settlementOverpaymentResolutionsTable.specialistId,
    [specialistOneId, specialistTwoId],
  ));
  await db.delete(settlementClosuresTable).where(and(
    inArray(settlementClosuresTable.specialistId, [specialistOneId, specialistTwoId]),
    eq(settlementClosuresTable.version, 3),
  ));
  await db.delete(settlementClosuresTable).where(and(
    inArray(settlementClosuresTable.specialistId, [specialistOneId, specialistTwoId]),
    eq(settlementClosuresTable.version, 2),
  ));
  await db.delete(settlementClosuresTable).where(inArray(settlementClosuresTable.specialistId, [specialistOneId, specialistTwoId]));
  await db.delete(settlementExchangeRatesTable).where(and(
    eq(settlementExchangeRatesTable.period, period),
    eq(settlementExchangeRatesTable.currency, testCurrency),
  ));
  await db.delete(settlementPaymentsTable).where(inArray(settlementPaymentsTable.specialistId, [specialistOneId, specialistTwoId]));
  if (correctedPartialInvoiceId) {
    await db.delete(invoicePaymentCorrectionsTable)
      .where(eq(invoicePaymentCorrectionsTable.invoiceId, correctedPartialInvoiceId));
    await db.delete(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, correctedPartialInvoiceId));
  }
  if (invoiceId || ownerCommercialInvoiceId || awaitingConfirmationInvoiceId || correctedPartialInvoiceId || inactivePaidInvoiceIds.length) {
    await db.delete(invoicesTable).where(inArray(invoicesTable.id, [
      invoiceId, ownerCommercialInvoiceId, awaitingConfirmationInvoiceId, correctedPartialInvoiceId,
      ...inactivePaidInvoiceIds,
    ].filter((id): id is number => Boolean(id))));
  }
  if (customerId) await db.delete(customersTable).where(inArray(customersTable.id, [customerId]));
  await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, identities));
  await pool.end();
});

const request = (
  actor: string,
  method = "GET",
  body?: unknown,
  path = `/settlements?period=${period}`,
) => fetch(`${base}${path}`, {
  method,
  headers: {
    "x-synthetic-id": actor,
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function editDuringSettlementExpenseRead(
  startRequest: () => Promise<Response>,
  edit: () => Promise<void>,
): Promise<Response> {
  let releaseLock!: () => void;
  let signalLockReady!: () => void;
  const lockReady = new Promise<void>((resolve) => { signalLockReady = resolve; });
  const holdLock = new Promise<void>((resolve) => { releaseLock = resolve; });
  const blocker = db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE settlement_expenses IN ACCESS EXCLUSIVE MODE`);
    signalLockReady();
    await holdLock;
  });
  await lockReady;
  const responsePromise = startRequest();
  let waitingForExpenseRead = false;
  try {
    const waitDeadline = Date.now() + 5_000;
    while (!waitingForExpenseRead && Date.now() < waitDeadline) {
      const { rows } = await pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%settlement_expenses%' LIMIT 1",
      );
      waitingForExpenseRead = rows.length > 0;
      if (!waitingForExpenseRead) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (waitingForExpenseRead) await edit();
  } finally {
    releaseLock();
    await blocker;
  }
  const response = await responsePromise;
  assert.equal(waitingForExpenseRead, true, "request should pause during its expense read");
  return response;
}

test("specialists see only their settlement transfer history, while the owner can see the team", async () => {
  const ownResponse = await request(specialistOneId);
  assert.equal(ownResponse.status, 200);
  const ownResult = GetMonthlySettlementResponse.parse(await ownResponse.json());
  assert.deepEqual(ownResult.results.map(({ specialistId }) => specialistId), [specialistOneId]);
  assert.deepEqual(ownResult.results[0].payments.map(({ reference }) => reference), [`${tag}-one`]);
  assert.equal(JSON.stringify(ownResult).includes(`${tag}-two`), false);

  const ownerResponse = await request(ownerId);
  assert.equal(ownerResponse.status, 200);
  const ownerResult = GetMonthlySettlementResponse.parse(await ownerResponse.json());
  assert.ok(ownerResult.results.some((result) => result.payments.some(({ reference }) => reference === `${tag}-one`)));
  assert.ok(ownerResult.results.some((result) => result.payments.some(({ reference }) => reference === `${tag}-two`)));
  assert.ok(ownerResult.results.find((result) => result.specialistId === specialistOneId)!.pendingAmount > 125);
});

test("paid invoices awaiting Versat confirmation are visible only in their specialist scope and stay outside the calculation", async () => {
  const specialistResponse = await request(specialistOneId);
  assert.equal(specialistResponse.status, 200);
  const specialistResult = GetMonthlySettlementResponse.parse(await specialistResponse.json());
  const specialistAwaitingConfirmation = specialistResult.paidAwaitingConfirmation.find(
    ({ invoiceId: id }) => id === awaitingConfirmationInvoiceId,
  );
  assert.ok(specialistAwaitingConfirmation);
  assert.ok(Number.isInteger(specialistAwaitingConfirmation.confirmationAgeDays));
  assert.ok(specialistAwaitingConfirmation.confirmationAgeDays >= 0);
  assert.equal(
    specialistAwaitingConfirmation.confirmationOverdue,
    specialistAwaitingConfirmation.confirmationAgeDays >= 7,
  );
  assert.deepEqual(specialistResult.paidAwaitingConfirmation.map(({ invoiceId: id, paidOn: date }) => ({
    invoiceId: id,
    paidOn: date.toISOString().slice(0, 10),
  })), [{ invoiceId: awaitingConfirmationInvoiceId, paidOn }]);
  assert.equal(
    specialistResult.results[0].invoices.some(({ invoiceId: id }) => id === awaitingConfirmationInvoiceId),
    false,
  );

  const otherSpecialistResponse = await request(specialistTwoId);
  assert.equal(otherSpecialistResponse.status, 200);
  const otherSpecialistResult = GetMonthlySettlementResponse.parse(await otherSpecialistResponse.json());
  assert.deepEqual(otherSpecialistResult.paidAwaitingConfirmation, []);
  assert.equal(JSON.stringify(otherSpecialistResult).includes(`${tag}-awaiting-confirmation`), false);

  const ownerResponse = await request(ownerId);
  assert.equal(ownerResponse.status, 200);
  const ownerResult = GetMonthlySettlementResponse.parse(await ownerResponse.json());
  assert.ok(ownerResult.paidAwaitingConfirmation.some(({ invoiceId: id }) => id === awaitingConfirmationInvoiceId));
  assert.equal(
    ownerResult.results.some((result) => result.invoices.some(({ invoiceId: id }) => id === awaitingConfirmationInvoiceId)),
    false,
  );
});

test("voided and cancelled invoices never appear in the Versat confirmation list, even with a legacy paid marker", async () => {
  const specialistResponse = await request(specialistOneId);
  assert.equal(specialistResponse.status, 200);
  const specialistResult = GetMonthlySettlementResponse.parse(await specialistResponse.json());
  assert.equal(
    specialistResult.paidAwaitingConfirmation.some(({ invoiceId: id }) => inactivePaidInvoiceIds.includes(id)),
    false,
  );

  const otherSpecialistResponse = await request(specialistTwoId);
  assert.equal(otherSpecialistResponse.status, 200);
  const otherSpecialistResult = GetMonthlySettlementResponse.parse(await otherSpecialistResponse.json());
  assert.deepEqual(otherSpecialistResult.paidAwaitingConfirmation, []);
  assert.equal(JSON.stringify(otherSpecialistResult).includes(`${tag}-voided-paid`), false);
  assert.equal(JSON.stringify(otherSpecialistResult).includes(`${tag}-cancelled-paid`), false);

  const ownerResponse = await request(ownerId);
  assert.equal(ownerResponse.status, 200);
  const ownerResult = GetMonthlySettlementResponse.parse(await ownerResponse.json());
  assert.equal(
    ownerResult.paidAwaitingConfirmation.some(({ invoiceId: id }) => inactivePaidInvoiceIds.includes(id)),
    false,
  );
});

test("a receipt correction that leaves a balance does not add the invoice to an automatic settlement month", async () => {
  const [invoice] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, correctedPartialInvoiceId));
  assert.equal(invoice.paymentStatus, "pending");

  const response = await request(specialistOneId);
  assert.equal(response.status, 200);
  const result = GetMonthlySettlementResponse.parse(await response.json());
  assert.equal(
    result.results.flatMap(({ invoices }) => invoices)
      .some(({ invoiceId: id }) => id === correctedPartialInvoiceId),
    false,
  );
  assert.equal(
    result.paidAwaitingConfirmation.some(({ invoiceId: id }) => id === correctedPartialInvoiceId),
    false,
  );
});

test("settlement follows the saved invoice assignment instead of Versat commercial data", async () => {
  const specialistResponse = await request(specialistOneId);
  assert.equal(specialistResponse.status, 200);
  const specialistResult = GetMonthlySettlementResponse.parse(await specialistResponse.json());
  assert.equal(
    specialistResult.results[0].invoices.some(({ invoiceId: id }) => id === ownerCommercialInvoiceId),
    false,
  );

  const ownerResponse = await request(ownerId);
  assert.equal(ownerResponse.status, 200);
  const ownerResult = GetMonthlySettlementResponse.parse(await ownerResponse.json());
  const ownerInvoices = ownerResult.results.find((result) => result.specialistId === ownerId)?.invoices ?? [];
  assert.ok(ownerInvoices.some(({ invoiceId: id }) => id === ownerCommercialInvoiceId));
});

test("owner can record a reviewed partial transfer with its date and reference", async () => {
  const beforeResponse = await request(ownerId);
  assert.equal(beforeResponse.status, 200);
  const before = GetMonthlySettlementResponse.parse(await beforeResponse.json());
  const beforeOne = before.results.find((result) => result.specialistId === specialistOneId)!;
  assert.ok(beforeOne.pendingAmount > 125);

  const excessiveResponse = await request(ownerId, "POST", {
    period,
    specialistId: specialistOneId,
    amount: beforeOne.pendingAmount + 1,
    paidOn,
    reference: `${tag}-overpay`,
    confirmReview: true,
  }, "/settlements/payments");
  assert.equal(excessiveResponse.status, 409);

  const reference = `${tag}-partial`;
  const response = await request(ownerId, "POST", {
    period,
    specialistId: specialistOneId,
    amount: 100,
    paidOn,
    reference,
    confirmReview: true,
  }, "/settlements/payments");
  assert.equal(response.status, 201);
  const payment = CreateSettlementPaymentResponse.parse(await response.json());
  assert.equal(payment.amount, 100);
  assert.equal(payment.reference, reference);
  assert.equal(payment.paidOn.toISOString().slice(0, 10), paidOn);

  const specialistResponse = await request(specialistOneId);
  const updated = GetMonthlySettlementResponse.parse(await specialistResponse.json());
  const ownResult = updated.results[0];
  assert.equal(ownResult.paidAmount, 225);
  assert.equal(ownResult.pendingAmount, beforeOne.pendingAmount - 100);
  assert.equal(ownResult.paymentStatus, "partial");
  assert.ok(ownResult.payments.some((entry) => entry.reference === reference && entry.paidOn.toISOString().slice(0, 10) === paidOn));
});

test("specialists cannot register settlement payments", async () => {
  const response = await request(specialistOneId, "POST", {}, "/settlements/payments");
  assert.equal(response.status, 403);
});

test("owner closes a frozen snapshot and corrections append an auditable version", async () => {
  const forbidden = await request(specialistOneId, "POST", {
    period,
    specialistId: specialistOneId,
  }, "/settlements/closures");
  assert.equal(forbidden.status, 403);

  await db.delete(settlementClassificationsTable)
    .where(eq(settlementClassificationsTable.invoiceLineId, invoiceLineId));
  const blockedClose = await request(ownerId, "POST", {
    period,
    specialistId: specialistOneId,
  }, "/settlements/closures");
  assert.equal(blockedClose.status, 422);
  await db.insert(settlementClassificationsTable).values({
    invoiceLineId,
    salesType: "service",
    label: "Servicio de prueba",
    updatedBy: ownerId,
  });
  await db.update(invoicesTable).set({ currency: testCurrency }).where(eq(invoicesTable.id, invoiceId));
  await db.insert(settlementExchangeRatesTable).values({
    period,
    currency: testCurrency,
    rateToCup: 1.25,
    updatedBy: ownerId,
  });

  const closeResponse = await editDuringSettlementExpenseRead(
    () => request(ownerId, "POST", {
      period,
      specialistId: specialistOneId,
    }, "/settlements/closures"),
    async () => {
      await db.transaction(async (tx) => {
        await tx.update(invoiceLinesTable).set({ unitPrice: 20_000, amount: 20_000 })
          .where(eq(invoiceLinesTable.id, invoiceLineId));
        await tx.update(settlementClassificationsTable).set({ salesType: "license" })
          .where(eq(settlementClassificationsTable.invoiceLineId, invoiceLineId));
      });
      const rateResponse = await request(ownerId, "PUT", {
        period,
        currency: testCurrency,
        rateToCup: 2.5,
      }, "/settlements/exchange-rates");
      assert.equal(rateResponse.status, 200);
    },
  );
  assert.equal(closeResponse.status, 201);
  const firstClosure = CreateSettlementClosureResponse.parse(await closeResponse.json());
  assert.equal(firstClosure.version, 1);
  assert.equal(firstClosure.supersedesId, null);
  assert.equal(firstClosure.approvedBy, ownerId);
  assert.equal(firstClosure.snapshot.invoices[0]?.lines[0]?.salesType, "service");
  assert.equal(firstClosure.snapshot.invoices[0]?.lines[0]?.amount, 10_000);
  assert.equal(firstClosure.snapshot.invoices[0]?.lines[0]?.rateToCup, 1.25);
  assert.equal(firstClosure.snapshot.invoices[0]?.lines[0]?.amountInCup, 12_500);
  assert.deepEqual(firstClosure.snapshot.exchangeRates
    .filter(({ currency }) => currency === testCurrency)
    .map(({ rateToCup }) => rateToCup), [1.25]);
  const firstVersions = await db.select({ version: settlementClosuresTable.version })
    .from(settlementClosuresTable).where(and(
      eq(settlementClosuresTable.period, period),
      eq(settlementClosuresTable.specialistId, specialistOneId),
    ));
  assert.deepEqual(firstVersions.map(({ version }) => version), [1]);
  const approvedNet = firstClosure.snapshot.totals.netPayable;

  const otherSpecialistResponse = await request(specialistTwoId);
  const otherSpecialist = GetMonthlySettlementResponse.parse(await otherSpecialistResponse.json()).results[0]!;
  assert.equal(otherSpecialist.specialistId, specialistTwoId);
  assert.equal(otherSpecialist.closureHistory.length, 0);

  const duplicate = await request(ownerId, "POST", {
    period,
    specialistId: specialistOneId,
  }, "/settlements/closures");
  assert.equal(duplicate.status, 409);

  await db.update(settlementClassificationsTable).set({ salesType: "license" })
    .where(eq(settlementClassificationsTable.invoiceLineId, invoiceLineId));
  const afterEditResponse = await request(specialistOneId);
  const afterEdit = GetMonthlySettlementResponse.parse(await afterEditResponse.json()).results[0]!;
  assert.notEqual(afterEdit.totals.netPayable, approvedNet);
  assert.equal(afterEdit.closure?.snapshot.totals.netPayable, approvedNet);
  assert.equal(afterEdit.pendingAmount, approvedNet - afterEdit.paidAmount);
  assert.equal(afterEdit.closureHistory.length, 1);

  const reason = "Clasificación corregida tras revisar el servicio";
  const correctionResponse = await editDuringSettlementExpenseRead(
    () => request(ownerId, "POST", { reason },
      `/settlements/closures/${firstClosure.id}/corrections`),
    () => db.transaction(async (tx) => {
      await tx.update(invoiceLinesTable).set({ unitPrice: 30_000, amount: 30_000 })
        .where(eq(invoiceLinesTable.id, invoiceLineId));
      await tx.update(settlementClassificationsTable).set({ salesType: "service" })
        .where(eq(settlementClassificationsTable.invoiceLineId, invoiceLineId));
    }),
  );
  assert.equal(correctionResponse.status, 201);
  const correction = CreateSettlementClosureResponse.parse(await correctionResponse.json());
  assert.equal(correction.version, 2);
  assert.equal(correction.supersedesId, firstClosure.id);
  assert.equal(correction.approvedBy, ownerId);
  assert.equal(correction.correctionReason, reason);
  assert.equal(correction.snapshot.invoices[0]?.lines[0]?.salesType, "license");
  assert.equal(correction.snapshot.invoices[0]?.lines[0]?.amount, 20_000);
  assert.equal(correction.snapshot.invoices[0]?.lines[0]?.rateToCup, 2.5);
  assert.equal(correction.snapshot.invoices[0]?.lines[0]?.amountInCup, 50_000);
  assert.deepEqual(correction.snapshot.exchangeRates
    .filter(({ currency }) => currency === testCurrency)
    .map(({ rateToCup }) => rateToCup), [2.5]);

  const correctedResponse = await request(specialistOneId);
  const corrected = GetMonthlySettlementResponse.parse(await correctedResponse.json()).results[0]!;
  assert.equal(corrected.closureHistory.length, 2);
  assert.deepEqual(corrected.closureHistory.map(({ version }) => version), [1, 2]);
  assert.equal(corrected.closureHistory[0]?.snapshot.totals.netPayable, approvedNet);

  const staleCorrection = await request(ownerId, "POST", { reason: "Intento de versión anterior" },
    `/settlements/closures/${firstClosure.id}/corrections`);
  assert.equal(staleCorrection.status, 409);

  const specialistCorrection = await request(specialistOneId, "POST", { reason: "Motivo válido" },
    `/settlements/closures/${correction.id}/corrections`);
  assert.equal(specialistCorrection.status, 403);

  await db.update(invoicesTable).set({ currency: "CUP" }).where(eq(invoicesTable.id, invoiceId));
  await db.update(invoicesTable).set({ subtotal: 0.01, total: 0.01 }).where(eq(invoicesTable.id, invoiceId));
  await db.update(invoiceLinesTable).set({ unitPrice: 0.01, amount: 0.01 }).where(eq(invoiceLinesTable.id, invoiceLineId));
  const reducedClosureResponse = await request(ownerId, "POST", {
    reason: "Corrección reduce el neto aprobado después de las transferencias",
  }, `/settlements/closures/${correction.id}/corrections`);
  assert.equal(reducedClosureResponse.status, 201);
  const reducedClosure = CreateSettlementClosureResponse.parse(await reducedClosureResponse.json());
  assert.equal(reducedClosure.version, 3);
  assert.equal(reducedClosure.snapshot.totals.netPayable, 0);
  assert.equal(firstClosure.snapshot.totals.netPayable, approvedNet);

  const ownerOverpaidResponse = await request(ownerId);
  assert.equal(ownerOverpaidResponse.status, 200);
  const ownerOverpaid = GetMonthlySettlementResponse.parse(await ownerOverpaidResponse.json())
    .results.find((result) => result.specialistId === specialistOneId)!;
  assert.equal(ownerOverpaid.paymentStatus, "overpaid");
  assert.equal(ownerOverpaid.paidAmount, 225);
  assert.equal(ownerOverpaid.pendingAmount, 0);
  assert.equal(ownerOverpaid.overpaidAmount, 225);
  assert.equal(ownerOverpaid.payments.length, 2);

  const resolutionText = "Devolver por transferencia en un plazo de cinco días";
  const reasonText = "El cierre corregido quedó por debajo del importe ya transferido";
  const specialistResolution = await request(specialistOneId, "POST", {
    period,
    specialistId: specialistOneId,
    resolution: resolutionText,
    reason: reasonText,
  }, "/settlements/overpayment-resolutions");
  assert.equal(specialistResolution.status, 403);
  const resolutionResponse = await request(ownerId, "POST", {
    period,
    specialistId: specialistOneId,
    resolution: resolutionText,
    reason: reasonText,
  }, "/settlements/overpayment-resolutions");
  assert.equal(resolutionResponse.status, 201);
  const createdResolution = CreateSettlementOverpaymentResolutionResponse.parse(
    await resolutionResponse.json(),
  );
  assert.equal((await request(ownerId, "POST", {
    period,
    specialistId: specialistOneId,
    resolution: resolutionText,
    reason: reasonText,
  }, "/settlements/overpayment-resolutions")).status, 409);
  assert.equal(createdResolution.fulfillmentStatus, "pending");
  assert.equal(createdResolution.fulfilledAmount, 0);
  assert.deepEqual(createdResolution.fulfillments, []);

  const fulfillmentPath = `/settlements/overpayment-resolutions/${createdResolution.id}/fulfillments`;
  assert.equal((await request(specialistOneId, "POST", {
    fulfilledOn: paidOn,
    amount: 100,
    reason: "Devolución registrada por transferencia",
  }, fulfillmentPath)).status, 403);
  assert.equal((await request(ownerId, "POST", {
    fulfilledOn: paidOn,
    amount: 226,
    reason: "Importe superior al excedente pendiente",
  }, fulfillmentPath)).status, 409);

  const firstFulfillmentResponse = await request(ownerId, "POST", {
    fulfilledOn: paidOn,
    amount: 100,
    reason: "Primera parte devuelta mediante transferencia",
  }, fulfillmentPath);
  assert.equal(firstFulfillmentResponse.status, 201);
  const firstFulfillment = CreateSettlementOverpaymentFulfillmentResponse.parse(
    await firstFulfillmentResponse.json(),
  );
  assert.equal(firstFulfillment.resolutionId, createdResolution.id);
  assert.equal(firstFulfillment.amount, 100);
  assert.equal(firstFulfillment.recordedBy, ownerId);

  const afterPartialFulfillment = GetMonthlySettlementResponse.parse(
    await (await request(ownerId)).json(),
  ).results.find((result) => result.specialistId === specialistOneId)!;
  assert.equal(afterPartialFulfillment.overpaymentResolutions[0]?.fulfillmentStatus, "pending");
  assert.equal(afterPartialFulfillment.overpaymentResolutions[0]?.fulfilledAmount, 100);
  assert.equal(afterPartialFulfillment.overpaymentResolutions[0]?.fulfillments.length, 1);
  assert.equal(afterPartialFulfillment.overpaidAmount, 225);
  assert.equal(afterPartialFulfillment.payments.length, 2);
  assert.deepEqual(afterPartialFulfillment.closureHistory.map(({ version }) => version), [1, 2, 3]);

  const finalFulfillmentResponse = await request(ownerId, "POST", {
    fulfilledOn: paidOn,
    amount: 125,
    reason: "Saldo compensado en la liquidación siguiente",
  }, fulfillmentPath);
  assert.equal(finalFulfillmentResponse.status, 201);
  const finalFulfillment = CreateSettlementOverpaymentFulfillmentResponse.parse(
    await finalFulfillmentResponse.json(),
  );
  assert.equal(finalFulfillment.amount, 125);
  assert.equal((await request(ownerId, "POST", {
    fulfilledOn: paidOn,
    amount: 0.01,
    reason: "No debe permitirse un exceso de registro",
  }, fulfillmentPath)).status, 409);

  const noticesPath = "/settlements/overpayment-notifications";
  const specialistNoticesResponse = await request(specialistOneId, "GET", undefined, noticesPath);
  assert.equal(specialistNoticesResponse.status, 200);
  const specialistNotices = ListSettlementOverpaymentNotificationsResponse.parse(
    await specialistNoticesResponse.json(),
  );
  assert.equal(specialistNotices.length, 1);
  assert.deepEqual(specialistNotices.map(({ period: noticePeriod, overpaidAmount, resolution, readAt }) => ({
    period: noticePeriod,
    overpaidAmount,
    resolution,
    readAt,
  })), [{ period, overpaidAmount: 225, resolution: resolutionText, readAt: null }]);
  assert.equal(JSON.stringify(specialistNotices).includes(specialistTwoId), false);

  const otherSpecialistNoticesResponse = await request(specialistTwoId, "GET", undefined, noticesPath);
  assert.equal(otherSpecialistNoticesResponse.status, 200);
  assert.deepEqual(await otherSpecialistNoticesResponse.json(), []);
  assert.equal((await request(ownerId, "GET", undefined, noticesPath)).status, 403);
  assert.equal(
    (await request(specialistTwoId, "PATCH", undefined, `${noticesPath}/${specialistNotices[0]!.id}/read`)).status,
    404,
  );

  const failedResolution = await request(ownerId, "POST", {
    period,
    specialistId: specialistTwoId,
    resolution: "Devolver por transferencia",
    reason: "No se encuentra un cierre para este especialista",
  }, "/settlements/overpayment-resolutions");
  assert.equal(failedResolution.status, 409);
  assert.deepEqual(
    await (await request(specialistTwoId, "GET", undefined, noticesPath)).json(),
    [],
  );

  const markReadResponse = await request(
    specialistOneId,
    "PATCH",
    undefined,
    `${noticesPath}/${specialistNotices[0]!.id}/read`,
  );
  assert.equal(markReadResponse.status, 200);
  assert.ok(MarkSettlementOverpaymentNotificationReadResponse.parse(await markReadResponse.json()).readAt);
  assert.deepEqual(
    await (await request(specialistOneId, "GET", undefined, noticesPath)).json(),
    [],
  );

  const ownerAfterResolution = GetMonthlySettlementResponse.parse(
    await (await request(ownerId)).json(),
  ).results.find((result) => result.specialistId === specialistOneId)!;
  const specialistAfterResolution = GetMonthlySettlementResponse.parse(
    await (await request(specialistOneId)).json(),
  ).results[0]!;
  for (const result of [ownerAfterResolution, specialistAfterResolution]) {
    assert.equal(result.paymentStatus, "overpaid");
    assert.equal(result.overpaidAmount, 225);
    assert.equal(result.payments.length, 2);
    assert.equal(result.overpaymentResolutions.length, 1);
    assert.equal(result.overpaymentResolutions[0]?.overpaidAmount, 225);
    assert.equal(result.overpaymentResolutions[0]?.closureVersion, 3);
    assert.equal(result.overpaymentResolutions[0]?.resolution, resolutionText);
    assert.equal(result.overpaymentResolutions[0]?.reason, reasonText);
    assert.equal(result.overpaymentResolutions[0]?.recordedBy, ownerId);
    assert.equal(result.overpaymentResolutions[0]?.fulfillmentStatus, "resolved");
    assert.equal(result.overpaymentResolutions[0]?.fulfilledAmount, 225);
    assert.deepEqual(result.overpaymentResolutions[0]?.fulfillments.map(({ amount }) => amount), [100, 125]);
    assert.deepEqual(result.overpaymentResolutions[0]?.fulfillments.map(({ reason }) => reason), [
      "Primera parte devuelta mediante transferencia",
      "Saldo compensado en la liquidación siguiente",
    ]);
    assert.deepEqual(result.closureHistory.map(({ version }) => version), [1, 2, 3]);
    assert.equal(result.closureHistory[0]?.snapshot.totals.netPayable, approvedNet);
  }
  const storedPayments = await db.select().from(settlementPaymentsTable).where(and(
    eq(settlementPaymentsTable.period, period),
    eq(settlementPaymentsTable.specialistId, specialistOneId),
  ));
  assert.equal(storedPayments.length, 2);
  assert.equal((await db.select().from(settlementOverpaymentFulfillmentsTable)
    .where(eq(settlementOverpaymentFulfillmentsTable.resolutionId, createdResolution.id))).length, 2);
});

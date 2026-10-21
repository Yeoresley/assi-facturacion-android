import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import {
  CreateSettlementClosureResponse,
  CreateSettlementPaymentResponse,
  GetMonthlySettlementResponse,
} from "@workspace/api-zod";
import { and, eq, inArray } from "drizzle-orm";
import {
  customersTable,
  db,
  invoiceLinesTable,
  invoicePaymentsTable,
  invoicesTable,
  pool,
  settlementClassificationsTable,
  settlementClosuresTable,
  settlementPaymentsTable,
  teamMembersTable,
} from "@workspace/db";
import settlementsRouter from "../routes/settlements";

const tag = `settlement-payment-access-${randomUUID()}`;
const ownerId = `${tag}-owner`;
const specialistOneId = `${tag}-one`;
const specialistTwoId = `${tag}-two`;
const identities = [ownerId, specialistOneId, specialistTwoId];
const paidOn = new Date().toISOString().slice(0, 10);
const period = paidOn.slice(0, 7);
const email = (id: string) => `${id}@example.invalid`;
let server: Server;
let base: string;
let customerId: number;
let invoiceId: number;
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
  const [line] = await db.insert(invoiceLinesTable).values({
    invoiceId,
    description: `${tag}-service`,
    serviceCode: `${tag}-service-code`,
    quantity: 1,
    unitPrice: 10_000,
    amount: 10_000,
  }).returning();
  invoiceLineId = line.id;
  await db.insert(invoicePaymentsTable).values({
    invoiceId,
    idempotencyKey: randomUUID(),
    amount: 10_000,
    currency: "CUP",
    paidOn,
    paidBy: ownerId,
  });
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
  await db.delete(settlementClosuresTable).where(and(
    inArray(settlementClosuresTable.specialistId, [specialistOneId, specialistTwoId]),
    eq(settlementClosuresTable.version, 2),
  ));
  await db.delete(settlementClosuresTable).where(inArray(settlementClosuresTable.specialistId, [specialistOneId, specialistTwoId]));
  await db.delete(settlementPaymentsTable).where(inArray(settlementPaymentsTable.specialistId, [specialistOneId, specialistTwoId]));
  if (invoiceId) await db.delete(invoicesTable).where(inArray(invoicesTable.id, [invoiceId]));
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

  const closeResponse = await request(ownerId, "POST", {
    period,
    specialistId: specialistOneId,
  }, "/settlements/closures");
  assert.equal(closeResponse.status, 201);
  const firstClosure = CreateSettlementClosureResponse.parse(await closeResponse.json());
  assert.equal(firstClosure.version, 1);
  assert.equal(firstClosure.supersedesId, null);
  assert.equal(firstClosure.approvedBy, ownerId);
  assert.equal(firstClosure.snapshot.invoices[0]?.lines[0]?.salesType, "service");
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
  const correctionResponse = await request(ownerId, "POST", { reason },
    `/settlements/closures/${firstClosure.id}/corrections`);
  assert.equal(correctionResponse.status, 201);
  const correction = CreateSettlementClosureResponse.parse(await correctionResponse.json());
  assert.equal(correction.version, 2);
  assert.equal(correction.supersedesId, firstClosure.id);
  assert.equal(correction.approvedBy, ownerId);
  assert.equal(correction.correctionReason, reason);
  assert.equal(correction.snapshot.invoices[0]?.lines[0]?.salesType, "license");

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
});

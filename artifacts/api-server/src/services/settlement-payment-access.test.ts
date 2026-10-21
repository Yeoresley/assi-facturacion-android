import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import { CreateSettlementPaymentResponse, GetMonthlySettlementResponse } from "@workspace/api-zod";
import { inArray } from "drizzle-orm";
import {
  customersTable,
  db,
  invoiceLinesTable,
  invoicePaymentsTable,
  invoicesTable,
  pool,
  settlementClassificationsTable,
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

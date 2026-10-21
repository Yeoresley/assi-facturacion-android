import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import {
  CreateInvoiceShareResponse,
  GetInvoiceResponse,
  GetSharedInvoiceResponse,
  ListInvoicesResponse,
} from "@workspace/api-zod";
import { eq, inArray } from "drizzle-orm";
import {
  customersTable,
  db,
  invoicePaymentsTable,
  invoicesTable,
  invoiceSharesTable,
  pool,
  teamInvitationsTable,
  teamMembersTable,
  versatCatalogTable,
  type VersatInvoiceSnapshot,
} from "@workspace/db";
import billingRouter from "../routes/billing";

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
  await db.insert(invoicePaymentsTable).values([
    { invoiceId: invoiceOneId, idempotencyKey: randomUUID(), amount: 10, currency: "CUP", paidOn: "2026-10-19", paidBy: ownerId },
    { invoiceId: invoiceOneId, idempotencyKey: randomUUID(), amount: 25, currency: "CUP", paidOn: "2026-10-20", paidBy: ownerId },
    { invoiceId: invoiceTwoId, idempotencyKey: randomUUID(), amount: 80, currency: "CUP", paidOn: "2026-10-19", paidBy: ownerId },
    { invoiceId: invoiceTwoId, idempotencyKey: randomUUID(), amount: 20, currency: "CUP", paidOn: "2026-10-20", paidBy: ownerId },
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
  if (invoiceIds.length) {
    await db.delete(invoiceSharesTable).where(inArray(invoiceSharesTable.invoiceId, invoiceIds));
    await db.delete(invoicesTable).where(inArray(invoicesTable.id, invoiceIds));
  }
  if (customerId) await db.delete(customersTable).where(eq(customersTable.id, customerId));
  await db.delete(teamInvitationsTable).where(inArray(teamInvitationsTable.email, identities.map(email)));
  await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, identities));
  if (commercialOneId && commercialTwoId) {
    await db.delete(versatCatalogTable).where(inArray(versatCatalogTable.id, [commercialOneId, commercialTwoId]));
  }
  await pool.end();
});

const request = (path: string, actor = specialistOneId, method = "GET") =>
  fetch(`${base}${path}`, { method, headers: { "x-synthetic-id": actor } });

function assertPaymentSnapshot(
  invoice: { id: number; totalPaid: number; balanceDue: number; payments: Array<{ amount: number }> },
  expected: { id: number; totalPaid: number; balanceDue: number; payments: number[] },
) {
  assert.equal(invoice.id, expected.id);
  assert.equal(invoice.totalPaid, expected.totalPaid);
  assert.equal(invoice.balanceDue, expected.balanceDue);
  assert.deepEqual(invoice.payments.map(({ amount }) => amount), expected.payments);
}

test("specialists see only their commercial's invoice payments in lists, details and authorized public links", async () => {
  const ownSummary = { id: invoiceOneId, totalPaid: 35, balanceDue: 65, payments: [10, 25] };
  const otherSummary = { id: invoiceTwoId, totalPaid: 100, balanceDue: 100, payments: [80, 20] };

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

  const createdResponse = await request(`/invoices/${invoiceOneId}/share`, specialistOneId, "POST");
  assert.equal(createdResponse.status, 200);
  const createdShare = CreateInvoiceShareResponse.parse(await createdResponse.json());
  const token = new URL(createdShare.url).pathname.split("/").at(-1)!;

  const sharedResponse = await request(`/shared-invoices/${token}`, "");
  assert.equal(sharedResponse.status, 200);
  assertPaymentSnapshot(GetSharedInvoiceResponse.parse(await sharedResponse.json()), ownSummary);

  const ownerListResponse = await request("/invoices", ownerId);
  assert.equal(ownerListResponse.status, 200);
  const ownerInvoices = ListInvoicesResponse.parse(await ownerListResponse.json());
  const ownerInvoiceIds = ownerInvoices.map(({ id }) => id);
  assert.ok(ownerInvoiceIds.includes(invoiceOneId));
  assert.ok(ownerInvoiceIds.includes(invoiceTwoId));
  assertPaymentSnapshot(ownerInvoices.find(({ id }) => id === invoiceOneId)!, ownSummary);
  assertPaymentSnapshot(ownerInvoices.find(({ id }) => id === invoiceTwoId)!, otherSummary);
  for (const expected of [ownSummary, otherSummary]) {
    const ownerDetail = await request(`/invoices/${expected.id}`, ownerId);
    assert.equal(ownerDetail.status, 200);
    assertPaymentSnapshot(GetInvoiceResponse.parse(await ownerDetail.json()), expected);
  }
});

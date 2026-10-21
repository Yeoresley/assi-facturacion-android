import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import {
  CreateInvoiceShareResponse,
  GetInvoiceResponse,
  GetSharedInvoiceResponse,
  ListInvoiceSharesResponse,
} from "@workspace/api-zod";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, customersTable, invoicesTable, invoicePaymentCorrectionsTable, invoiceSharesTable, invoiceSeriesTable,
  teamMembersTable, teamInvitationsTable, versatCatalogTable, type LegalDocument,
  type VersatInvoiceSnapshot,
} from "@workspace/db";
import billingRouter from "../routes/billing";
import legalRouter from "../routes/legal-documents";
import { imageStorage } from "../lib/private-images";

const tag = `share-test-${randomUUID()}`;
const owner = `${tag}-owner`;
const specialist = `${tag}-specialist`;
const other = `${tag}-other`;
const unassigned = `${tag}-unassigned`;
const pending = `${tag}-pending`;
const identities = [owner, specialist, other, unassigned, pending];
const email = (id: string) => `${id}@example.invalid`;
const token = randomUUID();
const expiredToken = randomUUID();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let server: Server;
let base: string;
let customerId: number;
let commercialId: number;
let otherCommercialId: number;
let invoiceId: number;
let otherInvoiceId: number;
let shareId: number;
let downloads = 0;

before(async () => {
  mock.method(clerkClient.users, "getUser", async (id: string) => ({
    id, firstName: "Synthetic", lastName: "Share", primaryEmailAddressId: "verified",
    emailAddresses: [{ id: "verified", emailAddress: email(id), verification: { status: "verified" } }],
  }));
  // No real image, storage request, Clerk identity or invoice issuance is needed.
  mock.method(imageStorage, "bucket", () => ({
    file: () => ({ download: async () => { downloads++; return [Buffer.from("synthetic-image")]; } }),
  }));
  await db.insert(teamMembersTable).values(identities.map(userId => ({
    userId, name: tag, email: email(userId), role: userId === owner ? "owner" as const : userId === pending ? "pending" as const : "specialist" as const,
  })));
  const [commercial] = await db.insert(versatCatalogTable).values({
    kind: "commercial", sourceId: -Math.floor(Math.random() * 1_000_000_000), code: tag, name: tag, exportValue: tag,
  }).returning();
  commercialId = commercial.id;
  const [otherCommercial] = await db.insert(versatCatalogTable).values({
    kind: "commercial", sourceId: -Math.floor(Math.random() * 1_000_000_000), code: `${tag}-other`, name: `${tag}-other`, exportValue: `${tag}-other`,
  }).returning();
  otherCommercialId = otherCommercial.id;
  await db.insert(teamInvitationsTable).values([
    { email: email(specialist), commercialId }, { email: email(other) }, { email: email(unassigned) },
  ]);
  const [customer] = await db.insert(customersTable).values({ name: tag }).returning();
  customerId = customer.id;
  const versat: VersatInvoiceSnapshot = {
    commercialId, conceptId: 1, operationId: 1, paymentId: 1, number: null, talon: null,
    bankAccountMC: null, bankAccountOM: null, contract: null, currencyName: "CUP", conceptCode: "TEST",
    operationName: tag, commercialName: tag, commercialPosition: "", paymentName: tag, customerCode: tag,
    customerName: tag, customerAddress: null, customerTaxId: null,
  };
  const legalDocument: LegalDocument = {
    useStamp: true, useSignature: true, confirm: true,
    issuer: { name: tag, nit: "SYNTHETIC", ircc: "SYNTHETIC", address: tag, organization: tag, paymentBeneficiary: tag, bankAccount: tag, bankBranch: tag, bankName: tag },
    preparedBy: tag, preparedPosition: tag, deliveredBy: "", accountedBy: "", transportedBy: "", transportId: "",
    vehiclePlate: "", drivingLicense: "", receivedBy: "", receivedPosition: "", receivedId: "",
    customerIrcc: "", customerBankAccount: "", stampPath: "/objects/legal/synthetic.png",
    signaturePath: "/objects/legal/synthetic.png", authorizedAt: new Date().toISOString(), authorizedBy: owner,
  };
  const [invoice, foreign] = await db.insert(invoicesTable).values([
    { number: tag, customerId, specialistId: owner, specialistName: tag, issueDate: "2026-10-21", currency: "CUP", status: "sent", versat, legalDocument },
    {
      number: `${tag}-foreign`, customerId, specialistId: specialist, specialistName: tag, issueDate: "2026-10-21",
      currency: "CUP", status: "sent", versat: { ...versat, commercialId: otherCommercialId }, legalDocument,
    },
  ]).returning();
  invoiceId = invoice.id;
  otherInvoiceId = foreign.id;
  const [share] = await db.insert(invoiceSharesTable).values([
    { invoiceId, tokenHash: hash(token), expiresAt: new Date(Date.now() + 3600_000) },
    { invoiceId, tokenHash: hash(expiredToken), expiresAt: new Date(Date.now() - 1000) },
  ]).returning();
  shareId = share.id;
  await db.insert(invoicePaymentCorrectionsTable).values({
    invoiceId,
    idempotencyKey: `${tag}-correction`,
    reason: `${tag}-internal-correction-reason`,
    correctedBy: `${tag}-internal-corrector`,
    beforeInvoiceStatus: "sent",
    afterInvoiceStatus: "sent",
    beforePaymentStatus: "pending",
    afterPaymentStatus: "pending",
    beforeTotalPaid: 0,
    afterTotalPaid: 0,
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { auth: Object.assign(
      () => ({ userId: req.headers["x-synthetic-id"] || null, tokenType: "session_token" }),
      { [Symbol.for("@clerk/express.auth")]: true },
    ) });
    next();
  });
  app.use("/api", billingRouter, legalRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  mock.restoreAll();
  const invoiceIds = [invoiceId, otherInvoiceId].filter(Boolean);
  if (invoiceIds.length) await db.delete(invoicesTable).where(inArray(invoicesTable.id, invoiceIds));
  if (customerId) await db.delete(customersTable).where(eq(customersTable.id, customerId));
  await db.delete(teamInvitationsTable).where(inArray(teamInvitationsTable.email, identities.map(email)));
  await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, identities));
  if (commercialId) await db.delete(versatCatalogTable).where(eq(versatCatalogTable.id, commercialId));
  if (otherCommercialId) await db.delete(versatCatalogTable).where(eq(versatCatalogTable.id, otherCommercialId));
  await pool.end();
});

const request = (path: string, actor = specialist, method = "GET") =>
  fetch(`${base}${path}`, { method, headers: { "x-synthetic-id": actor } });

test("public shares omit internal correction audit while team detail preserves it; scoped revocation preserves history", async () => {
  const initialInvoices = await db.select().from(invoicesTable).where(inArray(invoicesTable.id, [invoiceId, otherInvoiceId])).orderBy(invoicesTable.id);
  const initialSeries = await db.select().from(invoiceSeriesTable);
  const list = `/invoices/${invoiceId}/shares`;
  const revoke = `${list}/${shareId}`;
  for (const actor of [other, unassigned]) {
    assert.equal((await request(list, actor)).status, 404);
    assert.equal((await request(revoke, actor, "DELETE")).status, 404);
    assert.equal((await request(`/invoices/${invoiceId}/share`, actor, "POST")).status, 404);
  }
  for (const [actor, status] of [["", 401], [pending, 403]] as const) {
    assert.equal((await request(list, actor)).status, status);
    assert.equal((await request(revoke, actor, "DELETE")).status, status);
  }
  assert.equal((await request(`/invoices/${otherInvoiceId}/shares`, specialist)).status, 404);
  assert.equal((await request(`/invoices/${otherInvoiceId}/shares/${shareId}`, owner, "DELETE")).status, 404);
  assert.equal((await request(`${list}/bad`, owner, "DELETE")).status, 400);
  const listed = await request(list);
  assert.match(listed.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(await listed.json(), [{ id: shareId, createdAt: null, expiresAt: (await db.select().from(invoiceSharesTable).where(eq(invoiceSharesTable.id, shareId)))[0].expiresAt.toISOString() }]);

  assert.equal((await request(`/invoices/${invoiceId}`, specialist)).status, 200);
  const foreignInvoice = await request(`/invoices/${otherInvoiceId}`, specialist);
  assert.equal(foreignInvoice.status, 404);
  const foreignInvoiceBody = await foreignInvoice.text();
  assert.ok(!foreignInvoiceBody.includes(tag) && !foreignInvoiceBody.includes("/objects/legal/"));
  const priorDownloads = downloads;
  for (const kind of ["stamp", "signature"]) {
    const ownImage = await request(`/invoices/${invoiceId}/images/${kind}`, specialist);
    assert.equal(ownImage.status, 200);
    assert.equal(await ownImage.text(), "synthetic-image");
    const foreignImage = await request(`/invoices/${otherInvoiceId}/images/${kind}`, specialist);
    assert.equal(foreignImage.status, 404);
    const foreignBody = await foreignImage.text();
    assert.ok(!foreignBody.includes(tag) && !foreignBody.includes("synthetic-image"));
  }
  assert.equal(downloads, priorDownloads + 2);

  for (const status of ["finished", "accepted", "confirmed", "sent", "paid"] as const) {
    await db.update(invoicesTable).set({ status }).where(eq(invoicesTable.id, invoiceId));
    const issuedImage = await request(`/invoices/${invoiceId}/images/stamp`, specialist);
    assert.equal(issuedImage.status, 200, `stamp should be available for ${status} invoices`);
    assert.equal(await issuedImage.text(), "synthetic-image");
  }
  await db.update(invoicesTable).set({ status: "draft" }).where(eq(invoicesTable.id, invoiceId));
  assert.equal((await request(`/invoices/${invoiceId}/images/stamp`, specialist)).status, 404);
  await db.update(invoicesTable).set({ status: "sent" }).where(eq(invoicesTable.id, invoiceId));

  const liveData = await request(`/shared-invoices/${token}`, "");
  assert.equal(liveData.status, 200);
  assert.match(liveData.headers.get("cache-control")!, /no-store/);
  const sharedBody = await liveData.json() as Record<string, unknown>;
  assert.equal(GetSharedInvoiceResponse.parse(sharedBody).id, invoiceId);
  assert.equal(Object.hasOwn(sharedBody, "paymentCorrections"), false);
  assert.equal(JSON.stringify(sharedBody).includes(`${tag}-internal-correction-reason`), false);
  assert.equal(JSON.stringify(sharedBody).includes(`${tag}-internal-corrector`), false);
  const teamDetail = GetInvoiceResponse.parse(await (await request(`/invoices/${invoiceId}`, owner)).json());
  assert.equal(teamDetail.paymentCorrections?.length, 1);
  assert.equal(teamDetail.paymentCorrections?.[0].reason, `${tag}-internal-correction-reason`);
  assert.equal(teamDetail.paymentCorrections?.[0].correctedBy, `${tag}-internal-corrector`);
  for (const kind of ["stamp", "signature"]) {
    const image = await request(`/shared-invoices/${token}/images/${kind}`, "");
    assert.equal(image.status, 200);
    assert.match(image.headers.get("cache-control")!, /no-store/);
    assert.equal(await image.text(), "synthetic-image");
  }
  const created = await request(`/invoices/${invoiceId}/share`, specialist, "POST");
  assert.match(created.headers.get("cache-control")!, /no-store/);
  const newLink = CreateInvoiceShareResponse.parse(await created.json());
  assert.ok(newLink.id !== shareId);
  const newToken = new URL(newLink.url).pathname.split("/").at(-1)!;
  assert.notEqual(newToken, token);
  assert.equal((await request(list)).status, 200);
  assert.equal((await request(revoke, specialist, "DELETE")).status, 204);
  const [revoked] = await db.select().from(invoiceSharesTable).where(eq(invoiceSharesTable.id, shareId));
  assert.ok(revoked.revokedAt);
  assert.equal(revoked.revokedBy, specialist);
  assert.equal(revoked.tokenHash, hash(token));
  assert.equal((await request(revoke, owner, "DELETE")).status, 204);
  assert.deepEqual((await db.select().from(invoiceSharesTable).where(eq(invoiceSharesTable.id, shareId)))[0], revoked);

  const previousDownloads = downloads;
  for (const invalidToken of [token, expiredToken, "unknown-token"]) {
    for (const suffix of ["", "/images/stamp", "/images/signature"]) {
      const response = await request(`/shared-invoices/${invalidToken}${suffix}`, "");
      assert.equal(response.status, 404);
      assert.match(response.headers.get("cache-control")!, /no-store/);
      const content = await response.text();
      assert.ok(!content.includes(tag) && !content.includes("synthetic-image"));
    }
  }
  assert.equal(downloads, previousDownloads);
  const remaining = ListInvoiceSharesResponse.parse(await (await request(list, owner)).json());
  assert.deepEqual(remaining.map(link => link.id), [newLink.id]);
  assert.ok(remaining[0].createdAt);
  assert.equal((await request(`/shared-invoices/${newToken}`, "")).status, 200);
  assert.equal((await request(`${list}/${newLink.id}`, owner, "DELETE")).status, 204);
  assert.deepEqual(await (await request(list)).json(), []);
  const renewed = CreateInvoiceShareResponse.parse(await (await request(`/invoices/${invoiceId}/share`, owner, "POST")).json());
  assert.notEqual(renewed.id, newLink.id);
  assert.notEqual(renewed.url, newLink.url);
  assert.equal((await request(`/shared-invoices/${new URL(renewed.url).pathname.split("/").at(-1)}`, "")).status, 200);
  assert.deepEqual(await db.select().from(invoicesTable).where(inArray(invoicesTable.id, [invoiceId, otherInvoiceId])).orderBy(invoicesTable.id), initialInvoices);
  assert.deepEqual(await db.select().from(invoiceSeriesTable), initialSeries);
});

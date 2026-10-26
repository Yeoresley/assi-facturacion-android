import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import {
  CreateInvoiceShareResponse,
  GetImageAccessNotificationSettingsResponse,
  GetInvoiceResponse,
  GetSharedInvoiceResponse,
  ListImageAccessNotificationsResponse,
  ListInvoiceImageAccessesResponse,
  ListInvoiceSharesResponse,
  MarkImageAccessNotificationReadResponse,
} from "@workspace/api-zod";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, customersTable, invoicesTable, invoiceLinesTable, invoicePaymentCorrectionsTable, invoiceSharesTable,
  invoiceImageAccessNotificationSettingsTable, invoiceSeriesTable,
  invoicePaymentsTable, teamMembersTable, teamInvitationsTable, versatCatalogTable, type LegalDocument,
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
const noPaymentToken = randomUUID();
const expiredToken = randomUUID();
const expiredReceiptToken = randomUUID();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let server: Server;
let base: string;
let customerId: number;
let commercialId: number;
let otherCommercialId: number;
let invoiceId: number;
let otherInvoiceId: number;
let shareId: number;
let paymentId: number;
let correctionId: number;
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
    {
      number: tag, customerId, specialistId: owner, specialistName: tag, issueDate: "2026-10-21",
      currency: "CUP", status: "sent", versat, legalDocument, subtotal: 100, total: 100,
    },
    {
      number: `${tag}-foreign`, customerId, specialistId: specialist, specialistName: tag, issueDate: "2026-10-21",
      currency: "CUP", status: "sent", versat: { ...versat, commercialId: otherCommercialId }, legalDocument,
    },
  ]).returning();
  invoiceId = invoice.id;
  otherInvoiceId = foreign.id;
  await db.insert(invoiceLinesTable).values({
    invoiceId,
    description: "Synthetic legal service",
    serviceCode: "SVC-TEST",
    groupCode: `${tag}-internal-group`,
    unitCode: "EA",
    quantity: 2,
    unitPrice: 12.5,
    amount: 25,
  });
  const [payment] = await db.insert(invoicePaymentsTable).values([
    { invoiceId, idempotencyKey: `${tag}-payment`, amount: 25, currency: "CUP", paidOn: "2026-10-20", reference: `${tag}-reference`, paymentMethod: "transfer", paidBy: owner },
  ]).returning();
  paymentId = payment.id;
  const [share] = await db.insert(invoiceSharesTable).values([
    { invoiceId, tokenHash: hash(token), expiresAt: new Date(Date.now() + 3600_000) },
    { invoiceId, tokenHash: hash(expiredToken), expiresAt: new Date(Date.now() - 1000) },
  ]).returning();
  shareId = share.id;
  await db.insert(invoiceSharesTable).values({
    invoiceId, paymentId, tokenHash: hash(expiredReceiptToken), expiresAt: new Date(Date.now() - 1000),
  });
  await db.insert(invoiceSharesTable).values({
    invoiceId: otherInvoiceId, tokenHash: hash(noPaymentToken), expiresAt: new Date(Date.now() + 3600_000),
  });
  const [correction] = await db.insert(invoicePaymentCorrectionsTable).values({
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
  }).returning({ id: invoicePaymentCorrectionsTable.id });
  correctionId = correction.id;
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
  await db.delete(invoiceImageAccessNotificationSettingsTable)
    .where(eq(invoiceImageAccessNotificationSettingsTable.ownerUserId, owner));
  await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, identities));
  if (commercialId) await db.delete(versatCatalogTable).where(eq(versatCatalogTable.id, commercialId));
  if (otherCommercialId) await db.delete(versatCatalogTable).where(eq(versatCatalogTable.id, otherCommercialId));
  await pool.end();
});

const request = (path: string, actor = specialist, method = "GET") =>
  fetch(`${base}${path}`, { method, headers: { "x-synthetic-id": actor } });

const requestJson = (path: string, actor: string, method: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { "x-synthetic-id": actor, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function assertSharedInvoiceHasNoPaymentData(body: Record<string, unknown>, privateValues: string[] = []) {
  const forbiddenFields = new Set([
    "payments", "paymentStatus", "totalPaid", "balanceDue", "paymentCorrections",
    "paymentId", "targetPaymentId", "reversedPaymentId", "reference", "paidOn",
    "paidBy", "recordedAt", "paymentMethod", "correctedBy", "reason",
  ]);
  const collectKeys = (value: unknown): string[] => {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(collectKeys);
    return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
  };
  for (const key of collectKeys(body)) {
    assert.equal(forbiddenFields.has(key), false, `shared invoice must omit ${key}`);
  }
  const serialized = JSON.stringify(body);
  for (const value of privateValues) {
    assert.equal(serialized.includes(value), false, `shared invoice must omit private value ${value}`);
  }
}

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
  const parsedShared = GetSharedInvoiceResponse.parse(sharedBody);
  assert.equal(parsedShared.number, tag);
  assert.equal(parsedShared.confirmedAt, null, "un enlace autorizado antes de confirmar mantiene la fecha de emisión en el pie");
  assert.deepEqual(Object.keys(sharedBody).sort(), [
    "confirmedAt", "currency", "customerName", "dueDate", "issueDate", "legalDocument",
    "lines", "notes", "number", "status", "subtotal", "total", "versat",
  ]);
  assert.equal(Object.hasOwn(sharedBody, "id"), false);
  assert.equal(Object.hasOwn(sharedBody, "payments"), false);
  assert.equal(Object.hasOwn(sharedBody, "paymentStatus"), false);
  assert.equal(Object.hasOwn(sharedBody, "paymentCorrections"), false);
  assertSharedInvoiceHasNoPaymentData(sharedBody, [
    `${tag}-reference`, `${tag}-internal-correction-reason`, `${tag}-internal-corrector`,
  ]);
  assert.equal(JSON.stringify(sharedBody).includes("/objects/legal/"), false);
  const sharedLegalDocument = sharedBody.legalDocument as Record<string, unknown>;
  assert.deepEqual(Object.keys(sharedLegalDocument).sort(), [
    "accountedBy", "customerBankAccount", "customerIrcc", "deliveredBy", "drivingLicense",
    "hasSignature", "hasStamp", "issuer", "preparedBy", "preparedPosition", "receivedBy",
    "receivedId", "receivedPosition", "transportId", "transportedBy", "vehiclePlate",
  ]);
  assert.equal(sharedLegalDocument.hasStamp, true);
  assert.equal(sharedLegalDocument.hasSignature, true);
  for (const privateField of ["stampPath", "signaturePath", "authorizedAt", "authorizedBy", "useStamp", "useSignature", "confirm"]) {
    assert.equal(Object.hasOwn(sharedLegalDocument, privateField), false, `shared legal document must omit ${privateField}`);
  }
  assert.deepEqual(Object.keys(sharedBody.versat as object).sort(), [
    "contract", "customerAddress", "customerCode", "customerName", "customerTaxId", "number", "operationName", "paymentName",
  ]);
  assert.deepEqual(Object.keys((sharedBody.lines as object[])[0]).sort(), [
    "amount", "description", "quantity", "serviceCode", "unitCode", "unitPrice",
  ]);
  assert.equal((await request(`/shared-invoices/${token}/receipts/${paymentId}`, "")).status, 404);

  const noPaymentResponse = await request(`/shared-invoices/${noPaymentToken}`, "");
  assert.equal(noPaymentResponse.status, 200);
  const noPaymentBody = await noPaymentResponse.json() as Record<string, unknown>;
  GetSharedInvoiceResponse.parse(noPaymentBody);
  assertSharedInvoiceHasNoPaymentData(noPaymentBody);

  const receiptShareResponse = await request(`/invoices/${invoiceId}/payments/${paymentId}/share`, specialist, "POST");
  assert.equal(receiptShareResponse.status, 200);
  assert.match(receiptShareResponse.headers.get("cache-control")!, /no-store/);
  const receiptLink = CreateInvoiceShareResponse.parse(await receiptShareResponse.json());
  const receiptUrl = new URL(receiptLink.url);
  assert.equal(receiptUrl.searchParams.get("receipt"), String(paymentId));
  const receiptToken = receiptUrl.pathname.split("/").at(-1)!;
  assert.equal((await request(`/shared-invoices/${receiptToken}`, "")).status, 404);
  const receiptResponse = await request(`/shared-invoices/${receiptToken}/receipts/${paymentId}`, "");
  assert.equal(receiptResponse.status, 200);
  assert.match(receiptResponse.headers.get("cache-control")!, /no-store/);
  const receiptBody = await receiptResponse.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(receiptBody).sort(), [
    "amount", "corrected", "currency", "customerName", "invoiceNumber", "paidOn", "paymentCurrency", "paymentMethod", "reference", "remainingBalance",
  ]);
  assert.deepEqual(receiptBody, {
    invoiceNumber: tag,
    customerName: tag,
    currency: "CUP",
    amount: 25,
    paidOn: "2026-10-20T00:00:00.000Z",
    paymentCurrency: "CUP",
    paymentMethod: "transfer",
    reference: `${tag}-reference`,
    remainingBalance: 75,
    corrected: false,
  });
  assert.equal(JSON.stringify(receiptBody).includes(tag + "-internal-correction-reason"), false);
  assert.equal((await request(`/shared-invoices/${receiptToken}/receipts/999999`, "")).status, 404);

  await db.update(invoicePaymentCorrectionsTable).set({
    targetPaymentId: paymentId,
    beforePaymentAmount: 25,
    afterPaymentAmount: 20,
    beforePaidOn: "2026-10-20",
    afterPaidOn: "2026-10-19",
    beforeTotalPaid: 25,
    afterTotalPaid: 20,
  }).where(eq(invoicePaymentCorrectionsTable.id, correctionId));
  const correctedSharedResponse = await request(`/shared-invoices/${token}`, "");
  assert.equal(correctedSharedResponse.status, 200);
  const correctedSharedBody = await correctedSharedResponse.json() as Record<string, unknown>;
  GetSharedInvoiceResponse.parse(correctedSharedBody);
  assertSharedInvoiceHasNoPaymentData(correctedSharedBody, [
    `${tag}-reference`, `${tag}-internal-correction-reason`, `${tag}-internal-corrector`,
  ]);
  const correctedReceiptResponse = await request(`/shared-invoices/${receiptToken}/receipts/${paymentId}`, "");
  assert.equal(correctedReceiptResponse.status, 200);
  const correctedReceiptBody = await correctedReceiptResponse.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(correctedReceiptBody).sort(), [
    "amount", "corrected", "currency", "customerName", "invoiceNumber", "paidOn",
    "paymentCurrency", "paymentMethod", "reference", "remainingBalance",
  ]);
  assert.deepEqual(correctedReceiptBody, {
    ...receiptBody,
    amount: 20,
    paidOn: "2026-10-19T00:00:00.000Z",
    remainingBalance: 80,
    corrected: true,
  });
  assert.equal(JSON.stringify(correctedReceiptBody).includes(`${tag}-internal-correction-reason`), false);
  assert.equal(JSON.stringify(correctedReceiptBody).includes(`${tag}-internal-corrector`), false);

  await db.update(invoicePaymentCorrectionsTable).set({ reversedPaymentId: paymentId })
    .where(eq(invoicePaymentCorrectionsTable.id, correctionId));
  const reversedSharedResponse = await request(`/shared-invoices/${token}`, "");
  assert.equal(reversedSharedResponse.status, 200);
  const reversedSharedBody = await reversedSharedResponse.json() as Record<string, unknown>;
  GetSharedInvoiceResponse.parse(reversedSharedBody);
  assertSharedInvoiceHasNoPaymentData(reversedSharedBody, [
    `${tag}-reference`, `${tag}-internal-correction-reason`, `${tag}-internal-corrector`,
  ]);
  assert.equal((await request(`/shared-invoices/${receiptToken}/receipts/${paymentId}`, "")).status, 404);

  const teamDetail = GetInvoiceResponse.parse(await (await request(`/invoices/${invoiceId}`, owner)).json());
  assert.equal(teamDetail.paymentCorrections?.length, 1);
  assert.equal(teamDetail.paymentCorrections?.[0].reason, `${tag}-internal-correction-reason`);
  assert.equal(teamDetail.paymentCorrections?.[0].correctedBy, `${tag}-internal-corrector`);
  for (const kind of ["stamp", "signature"]) {
    const image = await request(`/shared-invoices/${token}/images/${kind}`, "");
    assert.equal(image.status, 200);
    assert.match(image.headers.get("cache-control")!, /no-store/);
    assert.equal(await image.text(), "synthetic-image");
    assert.equal((await request(`/shared-invoices/${receiptToken}/images/${kind}`, "")).status, 404);
  }

  const versatConfirmation = new Date("2026-10-25T12:00:00.000Z");
  await db.update(invoicesTable).set({ status: "confirmed", confirmedAt: versatConfirmation }).where(eq(invoicesTable.id, invoiceId));
  const confirmedShared = GetSharedInvoiceResponse.parse(await (await request(`/shared-invoices/${token}`, "")).json());
  assert.equal(confirmedShared.status, "confirmed");
  assert.equal(confirmedShared.confirmedAt?.toISOString(), versatConfirmation.toISOString());
  const confirmedTeam = GetInvoiceResponse.parse(await (await request(`/invoices/${invoiceId}`, owner)).json());
  assert.equal(confirmedTeam.confirmedAt?.toISOString(), versatConfirmation.toISOString());
  await db.update(invoicesTable).set({ status: "sent", confirmedAt: null }).where(eq(invoicesTable.id, invoiceId));

  for (const status of ["draft", "voided", "cancelled"] as const) {
    await db.update(invoicesTable).set({ status }).where(eq(invoicesTable.id, invoiceId));
    for (const kind of ["stamp", "signature"] as const) {
      assert.equal((await request(`/invoices/${invoiceId}/images/${kind}`, specialist)).status, 404, `${status} team ${kind} must stay hidden`);
      assert.equal((await request(`/shared-invoices/${token}/images/${kind}`, "")).status, 404, `${status} shared ${kind} must stay hidden`);
    }
  }
  await db.update(invoicesTable).set({ status: "sent" }).where(eq(invoicesTable.id, invoiceId));

  const imageAccessUrl = `/invoices/${invoiceId}/image-accesses`;
  for (const [actor, status] of [[owner, 200], [specialist, 403], [other, 403], [unassigned, 403], ["", 401], [pending, 403]] as const) {
    const historyResponse = await request(imageAccessUrl, actor);
    assert.equal(historyResponse.status, status);
    assert.match(historyResponse.headers.get("cache-control")!, /no-store/);
    if (actor === owner) {
      const history = ListInvoiceImageAccessesResponse.parse(await historyResponse.json());
      assert.deepEqual(history.map(({ invoiceId: recordedInvoice, shareId: recordedShare, kind }) =>
        ({ invoiceId: recordedInvoice, shareId: recordedShare, kind })), [
        { invoiceId, shareId, kind: "signature" },
        { invoiceId, shareId, kind: "stamp" },
      ]);
      assert.ok(history.every(access => Number.isFinite(access.openedAt.getTime())));
      assert.ok(!JSON.stringify(history).includes(token));
      assert.ok(!JSON.stringify(history).includes(hash(token)));
    }
  }
  const foreignHistory = await request(`/invoices/${otherInvoiceId}/image-accesses`, owner);
  assert.equal(foreignHistory.status, 200);
  assert.deepEqual(ListInvoiceImageAccessesResponse.parse(await foreignHistory.json()), []);
  const notificationSettingsUrl = "/issuer/image-access-notifications";
  const notificationSettings = GetImageAccessNotificationSettingsResponse.parse(
    await (await request(notificationSettingsUrl, owner)).json(),
  );
  assert.deepEqual(notificationSettings, { enabled: false });
  assert.equal((await request(notificationSettingsUrl, specialist)).status, 403);
  assert.equal((await request("/image-access-notifications", specialist)).status, 403);
  assert.equal((await requestJson(notificationSettingsUrl, specialist, "PATCH", { enabled: true })).status, 403);
  const enabledSettings = await requestJson(notificationSettingsUrl, owner, "PATCH", { enabled: true });
  assert.deepEqual(GetImageAccessNotificationSettingsResponse.parse(await enabledSettings.json()), { enabled: true });
  assert.deepEqual(ListImageAccessNotificationsResponse.parse(
    await (await request("/image-access-notifications", owner)).json(),
  ), [], "prior image history should not become new notices when enabled");
  const notifiedImage = await request(`/shared-invoices/${token}/images/stamp`, "");
  assert.equal(notifiedImage.status, 200);
  const imageNoticesResponse = await request("/image-access-notifications", owner);
  assert.equal(imageNoticesResponse.status, 200);
  assert.match(imageNoticesResponse.headers.get("cache-control")!, /no-store/);
  const imageNotices = ListImageAccessNotificationsResponse.parse(await imageNoticesResponse.json());
  assert.equal(imageNotices.length, 1);
  assert.deepEqual(
    (({ invoiceId: noticeInvoiceId, invoiceNumber, shareId: noticeShareId, kind }) =>
      ({ invoiceId: noticeInvoiceId, invoiceNumber, shareId: noticeShareId, kind }))(imageNotices[0]),
    { invoiceId, invoiceNumber: tag, shareId, kind: "stamp" },
  );
  assert.ok(Number.isFinite(imageNotices[0].openedAt.getTime()));
  assert.ok(!JSON.stringify(imageNotices).includes(token));
  assert.ok(!JSON.stringify(imageNotices).includes(hash(token)));
  assert.ok(!JSON.stringify(imageNotices).includes("visitor"));
  const readNoticeResponse = await request(`/image-access-notifications/${imageNotices[0].id}/read`, owner, "PATCH");
  assert.equal(readNoticeResponse.status, 200);
  MarkImageAccessNotificationReadResponse.parse(await readNoticeResponse.json());
  assert.deepEqual(ListImageAccessNotificationsResponse.parse(
    await (await request("/image-access-notifications", owner)).json(),
  ), []);
  assert.equal((await request(`/image-access-notifications/${imageNotices[0].id}/read`, specialist, "PATCH")).status, 403);
  const disabledSettings = await requestJson(notificationSettingsUrl, owner, "PATCH", { enabled: false });
  assert.deepEqual(GetImageAccessNotificationSettingsResponse.parse(await disabledSettings.json()), { enabled: false });
  assert.equal((await request(`/shared-invoices/${token}/images/signature`, "")).status, 200);
  assert.deepEqual(ListImageAccessNotificationsResponse.parse(
    await (await request("/image-access-notifications", owner)).json(),
  ), []);
  const reenabledSettings = await requestJson(notificationSettingsUrl, owner, "PATCH", { enabled: true });
  assert.deepEqual(GetImageAccessNotificationSettingsResponse.parse(await reenabledSettings.json()), { enabled: true });
  assert.deepEqual(ListImageAccessNotificationsResponse.parse(
    await (await request("/image-access-notifications", owner)).json(),
  ), [], "opens made while disabled should not be delivered retroactively");
  const created = await request(`/invoices/${invoiceId}/share`, specialist, "POST");
  assert.match(created.headers.get("cache-control")!, /no-store/);
  const newLink = CreateInvoiceShareResponse.parse(await created.json());
  assert.ok(newLink.id !== shareId);
  const newToken = new URL(newLink.url).pathname.split("/").at(-1)!;
  assert.notEqual(newToken, token);
  for (const kind of ["stamp", "signature"] as const) {
    const image = await request(`/shared-invoices/${newToken}/images/${kind}`, "");
    assert.equal(image.status, 200, `a newly created link should serve ${kind} while the invoice is issued`);
    assert.equal(await image.text(), "synthetic-image");
  }
  const downloadsBeforeCancellation = downloads;
  for (const status of ["voided", "cancelled"] as const) {
    await db.update(invoicesTable).set({ status }).where(eq(invoicesTable.id, invoiceId));
    for (const kind of ["stamp", "signature"] as const) {
      const image = await request(`/shared-invoices/${newToken}/images/${kind}`, "");
      assert.equal(image.status, 404, `${status} shared ${kind} must stay hidden`);
      assert.ok(!(await image.text()).includes("synthetic-image"), `${status} shared ${kind} must not send image contents`);
    }
  }
  assert.equal(downloads, downloadsBeforeCancellation, "an annulled or cancelled invoice must not download either scan");
  await db.update(invoicesTable).set({ status: "sent" }).where(eq(invoicesTable.id, invoiceId));
  assert.equal((await request(list)).status, 200);
  assert.deepEqual(ListInvoiceSharesResponse.parse(await (await request(list)).json()).map(link => link.id).sort((a, b) => a - b), [shareId, receiptLink.id, newLink.id].sort((a, b) => a - b));
  const receiptRevoke = `${list}/${receiptLink.id}`;
  assert.equal((await request(receiptRevoke, specialist, "DELETE")).status, 204);
  const [revokedReceipt] = await db.select().from(invoiceSharesTable).where(eq(invoiceSharesTable.id, receiptLink.id));
  assert.ok(revokedReceipt.revokedAt);
  assert.equal(revokedReceipt.paymentId, paymentId);
  assert.equal((await request(`/shared-invoices/${receiptToken}/receipts/${paymentId}`, "")).status, 404);
  assert.equal((await request(revoke, specialist, "DELETE")).status, 204);
  const [revoked] = await db.select().from(invoiceSharesTable).where(eq(invoiceSharesTable.id, shareId));
  assert.ok(revoked.revokedAt);
  assert.equal(revoked.revokedBy, specialist);
  assert.equal(revoked.tokenHash, hash(token));
  assert.equal((await request(revoke, owner, "DELETE")).status, 204);
  assert.deepEqual((await db.select().from(invoiceSharesTable).where(eq(invoiceSharesTable.id, shareId)))[0], revoked);

  const previousDownloads = downloads;
  for (const invalidToken of [token, expiredToken, expiredReceiptToken, receiptToken, "unknown-token"]) {
    for (const suffix of ["", "/images/stamp", "/images/signature", `/receipts/${paymentId}`]) {
      const response = await request(`/shared-invoices/${invalidToken}${suffix}`, "");
      assert.equal(response.status, 404);
      assert.match(response.headers.get("cache-control")!, /no-store/);
      const content = await response.text();
      assert.ok(!content.includes(tag) && !content.includes("synthetic-image"));
    }
  }
  assert.equal(downloads, previousDownloads);
  const afterInvalidAccesses = ListInvoiceImageAccessesResponse.parse(await (await request(imageAccessUrl, owner)).json());
  assert.equal(afterInvalidAccesses.length, 6, "only successful image requests should be recorded; expired, revoked, cancelled and annulled requests must not be");
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

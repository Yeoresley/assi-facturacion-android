import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import { unzipSync } from "fflate";
import { eq, inArray } from "drizzle-orm";
import {
  customersTable,
  db,
  invoiceLinesTable,
  invoiceNumberReservationsTable,
  invoicesTable,
  pool,
  teamInvitationsTable,
  teamMembersTable,
  versatCatalogAuditTable,
  versatCatalogTable,
} from "@workspace/db";
import billingRouter from "../routes/billing";
import versatRouter from "../routes/versat";
import { getInvoiceRows } from "./invoice-records";
import { buildFac } from "./versat-file";

const tag = `catalog-history-${randomUUID().slice(0, 8)}`;
const ownerId = `${tag}-owner`;
const specialistId = `${tag}-specialist`;
const otherSpecialistId = `${tag}-other-specialist`;
const ownerEmail = `${ownerId}@example.invalid`;
const specialistEmail = `${specialistId}@example.invalid`;
const otherSpecialistEmail = `${otherSpecialistId}@example.invalid`;
const userIds = [ownerId, specialistId, otherSpecialistId];
const catalogIds: number[] = [];
const invoiceIds: number[] = [];
const originalCatalogExportValues: Array<{ id: number; exportValue: string }> = [];
let server: Server;
let base: string;
let customerId: number;
let commercialId: number;
let entries: Record<string, typeof versatCatalogTable.$inferSelect>;

before(async () => {
  mock.method(clerkClient.users, "getUser", async (id: string) => {
    const email = id === ownerId
      ? ownerEmail
      : id === otherSpecialistId ? otherSpecialistEmail : specialistEmail;
    return {
      id,
      firstName: "Synthetic",
      lastName: "Catalog History",
      primaryEmailAddressId: "verified",
      emailAddresses: [{
        id: "verified",
        emailAddress: email,
        verification: { status: "verified" },
      }],
    };
  });

  await db.insert(teamMembersTable).values([
    { userId: ownerId, name: ownerId, email: ownerEmail, role: "owner" },
    { userId: specialistId, name: specialistId, email: specialistEmail, role: "specialist" },
    { userId: otherSpecialistId, name: otherSpecialistId, email: otherSpecialistEmail, role: "specialist" },
  ]);

  const sourceId = () => Math.floor(Math.random() * 1_000_000_000) + 1;
  const createdEntries = await db.insert(versatCatalogTable).values([
    { kind: "currency", sourceId: sourceId(), code: `${tag}-CUR`, name: "Historical currency", exportValue: "HISTORICAL CURRENCY" },
    { kind: "currency", sourceId: sourceId(), code: `${tag}-NEW-CUR`, name: "Inactive currency", exportValue: "INACTIVE CURRENCY" },
    { kind: "currency", sourceId: sourceId(), code: `${tag}-ACTIVE-CUR`, name: "Alternative currency", exportValue: "ALTERNATIVE CURRENCY" },
    { kind: "concept", sourceId: sourceId(), code: `${tag}-CON`, name: "Historical concept", exportValue: "HISTORICAL CONCEPT" },
    { kind: "concept", sourceId: sourceId(), code: `${tag}-NEW-CON`, name: "Inactive concept", exportValue: "INACTIVE CONCEPT" },
    { kind: "concept", sourceId: sourceId(), code: `${tag}-ACTIVE-CON`, name: "Alternative concept", exportValue: "ALTERNATIVE CONCEPT" },
    { kind: "operation", sourceId: sourceId(), code: `${tag}-OP`, name: "Historical operation", exportValue: "HISTORICAL OPERATION" },
    { kind: "commercial", sourceId: sourceId(), code: `${tag}-COM`, name: "Historical commercial", exportValue: "HISTORICAL COMMERCIAL", metadata: { position: "Historical position" } },
    { kind: "payment", sourceId: sourceId(), code: `${tag}-PAY`, name: "Historical payment", exportValue: "HISTORICAL PAYMENT" },
    { kind: "service", sourceId: sourceId(), code: `${tag}-SRV`, name: "Historical service", exportValue: "HISTORICAL SERVICE", metadata: { unitCode: "EA", groupCode: "CAT-HISTORY" } },
    { kind: "service", sourceId: sourceId(), code: `${tag}-NEW-SRV`, name: "Inactive service", exportValue: "INACTIVE SERVICE", metadata: { unitCode: "EA", groupCode: "CAT-HISTORY" } },
    { kind: "service", sourceId: sourceId(), code: `${tag}-ACTIVE-SRV`, name: "Alternative service", exportValue: "ALTERNATIVE SERVICE", metadata: { unitCode: "EA", groupCode: "CAT-HISTORY" } },
    { kind: "unit", sourceId: sourceId(), code: `${tag}-UNIT`, name: "Access control unit", exportValue: "ACCESS CONTROL UNIT" },
  ]).returning();
  catalogIds.push(...createdEntries.map(({ id }) => id));
  entries = Object.fromEntries(createdEntries.map((entry) => [entry.code.slice(tag.length + 1), entry]));
  commercialId = entries.COM.id;
  await db.insert(teamInvitationsTable).values([
    { email: specialistEmail, commercialId },
    { email: otherSpecialistEmail, commercialId },
  ]);

  const [customer] = await db.insert(customersTable).values({
    name: `${tag} customer`,
    versatCode: `${tag}-CUSTOMER`,
    taxId: "HISTORICAL TAX ID",
    address: "Historical address",
  }).returning();
  customerId = customer.id;

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
  app.use("/api", billingRouter, versatRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  mock.restoreAll();
  for (const entry of originalCatalogExportValues) {
    await db.update(versatCatalogTable).set({ exportValue: entry.exportValue })
      .where(eq(versatCatalogTable.id, entry.id));
  }
  originalCatalogExportValues.length = 0;
  if (invoiceIds.length) {
    await db.delete(invoiceNumberReservationsTable)
      .where(inArray(invoiceNumberReservationsTable.invoiceId, invoiceIds));
    await db.delete(invoiceLinesTable).where(inArray(invoiceLinesTable.invoiceId, invoiceIds));
    await db.delete(invoicesTable).where(inArray(invoicesTable.id, invoiceIds));
  }
  if (customerId) await db.delete(customersTable).where(eq(customersTable.id, customerId));
  await db.delete(teamInvitationsTable).where(inArray(teamInvitationsTable.email, [
    specialistEmail,
    otherSpecialistEmail,
  ]));
  await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, userIds));
  if (catalogIds.length) {
    await db.delete(versatCatalogAuditTable)
      .where(inArray(versatCatalogAuditTable.catalogEntryId, catalogIds));
    await db.delete(versatCatalogTable).where(inArray(versatCatalogTable.id, catalogIds));
  }
  await pool.end();
});

async function request(
  path: string,
  actor = ownerId,
  method = "GET",
  body?: unknown,
) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "x-synthetic-id": actor, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const invoiceBody = (overrides: Record<string, unknown> = {}) => ({
  customerId,
  issueDate: "2098-12-30",
  currency: entries.CUR.code,
  versat: {
    conceptId: entries.CON.id,
    operationId: entries.OP.id,
    commercialId,
    paymentId: entries.PAY.id,
    number: `${tag}-FAC`,
    talon: "0042",
  },
  lines: [{
    description: "Historical service description",
    serviceId: entries.SRV.id,
    quantity: 2,
    unitPrice: 125,
  }],
  ...overrides,
});

test("invoice assignment is owner-controlled and limited to existing team specialists", async () => {
  const ownerCreated = await request("/invoices", ownerId, "POST", invoiceBody({
    specialistId,
    versat: { ...invoiceBody().versat, number: `${tag}-OWNER-CREATE` },
  }));
  assert.equal(ownerCreated.status, 201);
  const created = await ownerCreated.json() as { id: number };
  invoiceIds.push(created.id);
  const [createdInvoice] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, created.id));
  assert.equal(createdInvoice.specialistId, specialistId);

  const ownerEdit = await request(`/invoices/${created.id}`, ownerId, "PATCH", invoiceBody({
    specialistId: otherSpecialistId,
    versat: { ...invoiceBody().versat, number: `${tag}-OWNER-EDIT` },
  }));
  assert.equal(ownerEdit.status, 200);
  const [reassignedInvoice] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, created.id));
  assert.equal(reassignedInvoice.status, "draft");
  assert.equal(reassignedInvoice.specialistId, otherSpecialistId);

  const invalidOwnerCreate = await request("/invoices", ownerId, "POST", invoiceBody({
    specialistId: `${tag}-not-a-team-specialist`,
    versat: { ...invoiceBody().versat, number: `${tag}-INVALID-OWNER` },
  }));
  assert.equal(invalidOwnerCreate.status, 422);

  const specialistCreate = await request("/invoices", specialistId, "POST", invoiceBody({
    specialistId: otherSpecialistId,
    versat: { ...invoiceBody().versat, number: `${tag}-SPECIALIST-CREATE` },
  }));
  assert.equal(specialistCreate.status, 201);
  const specialistCreated = await specialistCreate.json() as { id: number };
  invoiceIds.push(specialistCreated.id);
  const [specialistDraft] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, specialistCreated.id));
  assert.equal(specialistDraft.specialistId, specialistId);

  const specialistEdit = await request(
    `/invoices/${specialistCreated.id}`,
    specialistId,
    "PATCH",
    invoiceBody({
      specialistId: otherSpecialistId,
      versat: { ...invoiceBody().versat, number: `${tag}-SPECIALIST-EDIT` },
    }),
  );
  assert.equal(specialistEdit.status, 200);
  const [specialistEditedDraft] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, specialistCreated.id));
  assert.equal(specialistEditedDraft.status, "draft");
  assert.equal(specialistEditedDraft.specialistId, specialistId);
});

async function deactivateCatalogEntry(id: number) {
  await db.update(versatCatalogTable).set({ active: false })
    .where(eq(versatCatalogTable.id, id));
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function activeCatalogCsv(mismatch = false): Promise<string> {
  const activeEntries = await db.select({
    kind: versatCatalogTable.kind,
    sourceId: versatCatalogTable.sourceId,
    code: versatCatalogTable.code,
    exportValue: versatCatalogTable.exportValue,
  }).from(versatCatalogTable).where(eq(versatCatalogTable.active, true));
  assert.ok(activeEntries.length > 0, "test needs at least one active catalog entry");
  activeEntries.sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.sourceId - b.sourceId || a.code.localeCompare(b.code));
  return [
    "kind,sourceId,code,exportValue",
    ...activeEntries.map((entry, index) => [
      entry.kind,
      entry.sourceId,
      entry.code,
      mismatch && index === 0 ? `${entry.exportValue}-MISMATCH` : entry.exportValue,
    ].map(csvCell).join(",")),
  ].join("\n");
}

async function normalizePaddedCatalogValuesForTest() {
  const activeEntries = await db.select({
    id: versatCatalogTable.id,
    exportValue: versatCatalogTable.exportValue,
  }).from(versatCatalogTable).where(eq(versatCatalogTable.active, true));
  for (const entry of activeEntries) {
    const exportValue = entry.exportValue.trim();
    if (exportValue === entry.exportValue) continue;
    originalCatalogExportValues.push({ id: entry.id, exportValue: entry.exportValue });
    await db.update(versatCatalogTable).set({ exportValue })
      .where(eq(versatCatalogTable.id, entry.id));
  }
}

test("inactive catalog entries stay out of new invoices, remain on their drafts and export from saved snapshots", async () => {
  const created = await request("/invoices", specialistId, "POST", invoiceBody());
  assert.equal(created.status, 201);
  const createdInvoice = await created.json() as { id: number };
  invoiceIds.push(createdInvoice.id);

  for (const key of ["CUR", "CON", "SRV"]) {
    await deactivateCatalogEntry(entries[key].id);
  }
  await deactivateCatalogEntry(entries["NEW-CUR"].id);
  await deactivateCatalogEntry(entries["NEW-CON"].id);
  await deactivateCatalogEntry(entries["NEW-SRV"].id);

  const newInvoiceWithInactiveCurrency = await request(
    "/invoices",
    specialistId,
    "POST",
    invoiceBody({
      currency: entries["NEW-CUR"].code,
      lines: [{ ...invoiceBody().lines[0], serviceId: entries["ACTIVE-SRV"].id }],
    }),
  );
  assert.equal(newInvoiceWithInactiveCurrency.status, 422);
  const newInvoiceWithInactiveConcept = await request(
    "/invoices",
    specialistId,
    "POST",
    invoiceBody({
      currency: entries["ACTIVE-CUR"].code,
      versat: { ...invoiceBody().versat, conceptId: entries["NEW-CON"].id },
      lines: [{ ...invoiceBody().lines[0], serviceId: entries["ACTIVE-SRV"].id }],
    }),
  );
  assert.equal(newInvoiceWithInactiveConcept.status, 422);
  const newInvoiceWithInactiveService = await request(
    "/invoices",
    specialistId,
    "POST",
    invoiceBody({
      currency: entries["ACTIVE-CUR"].code,
      versat: { ...invoiceBody().versat, conceptId: entries["ACTIVE-CON"].id },
      lines: [{ ...invoiceBody().lines[0], serviceId: entries["NEW-SRV"].id }],
    }),
  );
  assert.equal(newInvoiceWithInactiveService.status, 422);

  const preservedDraft = await request(
    `/invoices/${createdInvoice.id}`,
    specialistId,
    "PATCH",
    invoiceBody(),
  );
  assert.equal(preservedDraft.status, 200, await preservedDraft.text());

  const draftBeforeRejectedChange = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, createdInvoice.id));
  const addedInactiveConcept = await request(
    `/invoices/${createdInvoice.id}`,
    specialistId,
    "PATCH",
    invoiceBody({
      versat: { ...invoiceBody().versat, conceptId: entries["NEW-CON"].id },
    }),
  );
  assert.equal(addedInactiveConcept.status, 422);
  const addedInactiveService = await request(
    `/invoices/${createdInvoice.id}`,
    specialistId,
    "PATCH",
    invoiceBody({
      lines: [{ ...invoiceBody().lines[0], serviceId: entries["NEW-SRV"].id }],
    }),
  );
  assert.equal(addedInactiveService.status, 422);
  const addedInactiveCurrency = await request(
    `/invoices/${createdInvoice.id}`,
    specialistId,
    "PATCH",
    invoiceBody({ currency: entries["NEW-CUR"].code }),
  );
  assert.equal(addedInactiveCurrency.status, 422);
  assert.deepEqual(
    await db.select().from(invoicesTable).where(eq(invoicesTable.id, createdInvoice.id)),
    draftBeforeRejectedChange,
  );

  const createDenied = await request("/versat/catalogs", specialistId, "POST", {
    kind: "unit",
    sourceId: 2_000_000_000,
    code: `${tag}-SPECIALIST-UNIT`,
    name: "Must not be created",
    exportValue: "MUST NOT BE CREATED",
  });
  assert.equal(createDenied.status, 403);
  const updateDenied = await request(`/versat/catalogs/${entries.UNIT.id}`, specialistId, "PATCH", {
    name: "Must not be updated",
  });
  assert.equal(updateDenied.status, 403);
  const deactivateDenied = await request(`/versat/catalogs/${entries.UNIT.id}`, specialistId, "PATCH", {
    active: false,
  });
  assert.equal(deactivateDenied.status, 403);
  const reactivateDenied = await request(`/versat/catalogs/${entries["NEW-CON"].id}`, specialistId, "PATCH", {
    active: true,
  });
  assert.equal(reactivateDenied.status, 403);
  const [unchangedUnit] = await db.select().from(versatCatalogTable)
    .where(eq(versatCatalogTable.id, entries.UNIT.id));
  const [stillInactiveConcept] = await db.select().from(versatCatalogTable)
    .where(eq(versatCatalogTable.id, entries["NEW-CON"].id));
  assert.equal(unchangedUnit.active, true);
  assert.equal(unchangedUnit.name, "Access control unit");
  assert.equal(stillInactiveConcept.active, false);

  const reactivatedConcept = await request(
    `/versat/catalogs/${entries["NEW-CON"].id}`,
    ownerId,
    "PATCH",
    { active: true },
  );
  assert.equal(reactivatedConcept.status, 200);
  assert.equal((await reactivatedConcept.json() as { active: boolean }).active, true);

  const invoiceUsingReactivatedConcept = await request(
    "/invoices",
    specialistId,
    "POST",
    invoiceBody({
      currency: entries["ACTIVE-CUR"].code,
      versat: {
        ...invoiceBody().versat,
        conceptId: entries["NEW-CON"].id,
        number: `${tag}-REACTIVATED-FAC`,
        talon: "0043",
      },
      lines: [{ ...invoiceBody().lines[0], serviceId: entries["ACTIVE-SRV"].id }],
    }),
  );
  assert.equal(invoiceUsingReactivatedConcept.status, 201);
  const reactivatedInvoice = await invoiceUsingReactivatedConcept.json() as { id: number; versat: { conceptId: number } };
  invoiceIds.push(reactivatedInvoice.id);
  assert.equal(reactivatedInvoice.versat.conceptId, entries["NEW-CON"].id);
  const originalAcceptanceAt = new Date("2098-12-30T12:00:00.000Z");
  await db.update(invoicesTable).set({
    status: "accepted",
    acceptedBy: specialistId,
    acceptedAt: originalAcceptanceAt,
    acceptedSource: "specialist",
  }).where(eq(invoicesTable.id, reactivatedInvoice.id));

  const conceptHistoryResponse = await request(
    `/versat/catalogs/${entries["NEW-CON"].id}/history`,
    ownerId,
  );
  assert.equal(conceptHistoryResponse.status, 200);
  const conceptHistory = await conceptHistoryResponse.json() as Array<{
    action: string;
    actorUserId: string;
    previousValues: { active: boolean } | null;
    newValues: { active: boolean };
  }>;
  assert.equal(conceptHistory.length, 1);
  assert.equal(conceptHistory[0].action, "reactivated");
  assert.equal(conceptHistory[0].actorUserId, ownerId);
  assert.equal(conceptHistory[0].previousValues?.active, false);
  assert.equal(conceptHistory[0].newValues.active, true);

  await db.update(invoicesTable).set({ status: "finished" })
    .where(eq(invoicesTable.id, createdInvoice.id));
  const preview = await request("/versat/export?from=2098-12-30&to=2098-12-30");
  assert.equal(preview.status, 200);
  const previewRows = await preview.json() as Array<{ invoiceNumber: string; currency: string; taxId: string | null }>;
  assert.equal(previewRows.length, 2);
  const originalSnapshotPreview = previewRows.find(({ currency }) => currency === entries.CUR.code);
  assert.ok(originalSnapshotPreview);
  assert.equal(originalSnapshotPreview.taxId, "HISTORICAL TAX ID");
  assert.equal(originalSnapshotPreview.currency, entries.CUR.code);

  // The comparator trims imported cells; normalize legacy padded DB values only
  // for this test's compatible-catalog export and restore them in the teardown.
  await normalizePaddedCatalogValuesForTest();
  const compatibleCatalogCsv = await activeCatalogCsv();
  const incompatibleCatalogCsv = await activeCatalogCsv(true);
  const catalogCheck = await request(
    "/versat/catalogs/compare",
    ownerId,
    "POST",
    { catalogCsv: compatibleCatalogCsv },
  );
  assert.equal(catalogCheck.status, 200);
  const catalogComparison = await catalogCheck.json() as { compatible: boolean; differences: Array<{ detail: string }> };
  assert.equal(catalogComparison.compatible, true, JSON.stringify(catalogComparison.differences));
  const invoiceBeforeRejectedExports = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, createdInvoice.id));
  const linesBeforeRejectedExports = await db.select().from(invoiceLinesTable)
    .where(eq(invoiceLinesTable.invoiceId, createdInvoice.id));

  const blockedIndividual = await request(
    `/invoices/${createdInvoice.id}/versat-file`,
    ownerId,
    "POST",
    { catalogCsv: incompatibleCatalogCsv },
  );
  assert.equal(blockedIndividual.status, 422);
  const individualError = await blockedIndividual.json() as { error: string; base64?: string };
  assert.match(individualError.error, /No se generó ningún \.Fac/);
  assert.match(individualError.error, /valor exportado difiere/);
  assert.equal(individualError.base64, undefined, "blocked individual export must not return a file");

  const blockedPeriod = await request(
    "/versat/export-file?from=2098-12-30&to=2098-12-30",
    ownerId,
    "POST",
    { catalogCsv: incompatibleCatalogCsv },
  );
  assert.equal(blockedPeriod.status, 422);
  const periodError = await blockedPeriod.json() as { error: string; base64?: string };
  assert.match(periodError.error, /No se generó ningún \.Fac/);
  assert.match(periodError.error, /valor exportado difiere/);
  assert.equal(periodError.base64, undefined, "blocked period export must not return a file");

  assert.deepEqual(
    await db.select().from(invoicesTable).where(eq(invoicesTable.id, createdInvoice.id)),
    invoiceBeforeRejectedExports,
    "blocked exports must not alter invoice status or any other invoice data",
  );
  assert.deepEqual(
    await db.select().from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, createdInvoice.id)),
    linesBeforeRejectedExports,
    "blocked exports must not alter invoice lines",
  );

  const individualExport = await request(
    `/invoices/${createdInvoice.id}/versat-file`,
    ownerId,
    "POST",
    { catalogCsv: compatibleCatalogCsv },
  );
  const individualExportBody = await individualExport.text();
  assert.equal(individualExport.status, 200, individualExportBody);
  const individualFile = JSON.parse(individualExportBody) as {
    filename: string;
    base64: string;
    contentType: string;
    invoiceCount: number;
  };
  assert.match(individualFile.filename, /\.Fac$/);
  assert.equal(individualFile.contentType, "text/plain;charset=windows-1252");
  assert.equal(individualFile.invoiceCount, 1);
  assert.match(Buffer.from(individualFile.base64, "base64").toString("latin1"), /Numero=/);
  const [acceptedInvoice] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, createdInvoice.id));
  assert.equal(acceptedInvoice.status, "accepted");
  assert.equal(acceptedInvoice.acceptedBy, ownerId);
  assert.ok(acceptedInvoice.acceptedAt instanceof Date);
  assert.equal(acceptedInvoice.acceptedSource, "versat_export");

  const acceptedReexport = await request(
    `/invoices/${reactivatedInvoice.id}/versat-file`,
    ownerId,
    "POST",
    { catalogCsv: compatibleCatalogCsv },
  );
  assert.equal(acceptedReexport.status, 200, await acceptedReexport.text());
  const [stillOriginallyAccepted] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, reactivatedInvoice.id));
  assert.equal(stillOriginallyAccepted.status, "accepted");
  assert.equal(stillOriginallyAccepted.acceptedBy, specialistId);
  assert.deepEqual(stillOriginallyAccepted.acceptedAt, originalAcceptanceAt);
  assert.equal(stillOriginallyAccepted.acceptedSource, "specialist");

  const periodInvoiceResponse = await request("/invoices", specialistId, "POST", invoiceBody({
    currency: entries["ACTIVE-CUR"].code,
    versat: {
      ...invoiceBody().versat,
      conceptId: entries["ACTIVE-CON"].id,
      number: `${tag}-PERIOD-FAC`,
    },
    lines: [{ ...invoiceBody().lines[0], serviceId: entries["ACTIVE-SRV"].id }],
  }));
  const periodInvoiceBody = await periodInvoiceResponse.text();
  assert.equal(periodInvoiceResponse.status, 201, periodInvoiceBody);
  const periodInvoice = JSON.parse(periodInvoiceBody) as { id: number };
  invoiceIds.push(periodInvoice.id);
  await db.update(invoicesTable).set({ status: "finished" })
    .where(eq(invoicesTable.id, periodInvoice.id));

  const periodExport = await request(
    "/versat/export-file?from=2098-12-30&to=2098-12-30",
    ownerId,
    "POST",
    { catalogCsv: compatibleCatalogCsv },
  );
  const periodExportBody = await periodExport.text();
  assert.equal(periodExport.status, 200, periodExportBody);
  const periodFile = JSON.parse(periodExportBody) as {
    filename: string;
    base64: string;
    contentType: string;
    invoiceCount: number;
  };
  assert.match(periodFile.filename, /\.zip$/);
  assert.equal(periodFile.contentType, "application/zip");
  assert.equal(periodFile.invoiceCount, 3);
  const archive = unzipSync(Buffer.from(periodFile.base64, "base64"));
  assert.equal(Object.keys(archive).filter((filename) => filename.endsWith(".Fac")).length, 3);
  assert.ok(archive["LEEME.txt"]);
  const [periodAcceptedInvoice] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, periodInvoice.id));
  assert.equal(periodAcceptedInvoice.status, "accepted");
  assert.equal(periodAcceptedInvoice.acceptedBy, ownerId);
  assert.ok(periodAcceptedInvoice.acceptedAt instanceof Date);
  assert.equal(periodAcceptedInvoice.acceptedSource, "versat_export");
  const [periodReexportedInvoice] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.id, reactivatedInvoice.id));
  assert.equal(periodReexportedInvoice.status, "accepted");
  assert.equal(periodReexportedInvoice.acceptedBy, specialistId);
  assert.deepEqual(periodReexportedInvoice.acceptedAt, originalAcceptanceAt);
  assert.equal(periodReexportedInvoice.acceptedSource, "specialist");
  for (const entry of originalCatalogExportValues) {
    await db.update(versatCatalogTable).set({ exportValue: entry.exportValue })
      .where(eq(versatCatalogTable.id, entry.id));
  }
  originalCatalogExportValues.length = 0;

  const [savedInvoice] = await getInvoiceRows([createdInvoice.id]);
  assert.ok(savedInvoice);
  const content = buildFac(savedInvoice);
  for (const historicalValue of [
    "HISTORICAL CURRENCY",
    entries.CON.code,
    "HISTORICAL OPERATION",
    "HISTORICAL COMMERCIAL",
    "Historical position",
    "HISTORICAL PAYMENT",
    entries.SRV.code,
    "CAT-HISTORY",
    "EA",
  ]) {
    assert.ok(content.includes(historicalValue), `export should retain ${historicalValue}`);
  }
});

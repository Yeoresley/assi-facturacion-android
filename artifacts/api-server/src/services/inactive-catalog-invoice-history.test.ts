import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
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
  versatCatalogTable,
} from "@workspace/db";
import billingRouter from "../routes/billing";
import versatRouter from "../routes/versat";
import { getInvoiceRows } from "./invoice-records";
import { buildFac } from "./versat-file";

const tag = `catalog-history-${randomUUID().slice(0, 8)}`;
const ownerId = `${tag}-owner`;
const specialistId = `${tag}-specialist`;
const ownerEmail = `${ownerId}@example.invalid`;
const specialistEmail = `${specialistId}@example.invalid`;
const userIds = [ownerId, specialistId];
const catalogIds: number[] = [];
const invoiceIds: number[] = [];
let server: Server;
let base: string;
let customerId: number;
let commercialId: number;
let entries: Record<string, typeof versatCatalogTable.$inferSelect>;

before(async () => {
  mock.method(clerkClient.users, "getUser", async (id: string) => {
    const email = id === ownerId ? ownerEmail : specialistEmail;
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
  await db.insert(teamInvitationsTable).values({ email: specialistEmail, commercialId });

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
  if (invoiceIds.length) {
    await db.delete(invoiceNumberReservationsTable)
      .where(inArray(invoiceNumberReservationsTable.invoiceId, invoiceIds));
    await db.delete(invoiceLinesTable).where(inArray(invoiceLinesTable.invoiceId, invoiceIds));
    await db.delete(invoicesTable).where(inArray(invoicesTable.id, invoiceIds));
  }
  if (customerId) await db.delete(customersTable).where(eq(customersTable.id, customerId));
  await db.delete(teamInvitationsTable).where(eq(teamInvitationsTable.email, specialistEmail));
  await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, userIds));
  if (catalogIds.length) {
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

async function deactivateCatalogEntry(id: number) {
  await db.update(versatCatalogTable).set({ active: false })
    .where(eq(versatCatalogTable.id, id));
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

  await db.update(invoicesTable).set({ status: "finished" })
    .where(eq(invoicesTable.id, createdInvoice.id));
  const preview = await request("/versat/export?from=2098-12-30&to=2098-12-30");
  assert.equal(preview.status, 200);
  const previewRows = await preview.json() as Array<{ invoiceNumber: string; currency: string; taxId: string | null }>;
  assert.equal(previewRows.length, 1);
  assert.equal(previewRows[0].taxId, "HISTORICAL TAX ID");
  assert.equal(previewRows[0].currency, entries.CUR.code);

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

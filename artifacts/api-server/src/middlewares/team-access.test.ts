import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, teamMembersTable, teamInvitationsTable, customersTable, invoicesTable,
  invoiceSharesTable, versatCatalogTable, type VersatInvoiceSnapshot,
} from "@workspace/db";
import billingRouter from "../routes/billing";
import versatRouter from "../routes/versat";
import legalRouter from "../routes/legal-documents";
import { GetCurrentTeamMemberResponse } from "@workspace/api-zod";

// This harness supplies synthetic verified identities; it never contacts or edits Clerk.
const tag = `suspension-${randomUUID()}`;
const ownerId = `${tag}-owner`;
const specialistId = `${tag}-specialist`;
const replacementId = `${tag}-replacement`;
const pendingId = `${tag}-pending`;
const email = `${tag}@example.invalid`;
const inviteEmail = `invite-${email}`;
const ownerEmail = `owner-${email}`;
const ids = [ownerId, specialistId, replacementId, pendingId];
const emails = [email, inviteEmail];
let server: Server;
let base: string;
let customerId: number;
let commercialId: number;
let invoiceId: number;
let initialInvoice: typeof invoicesTable.$inferSelect;
const token = randomUUID();

before(async () => {
  mock.method(clerkClient.users, "getUser", async (id: string) => ({
    id, firstName: "Synthetic", lastName: "Test", primaryEmailAddressId: "verified",
    emailAddresses: [{ id: "verified", emailAddress: id === ownerId ? ownerEmail : id === pendingId ? inviteEmail : email, verification: { status: "verified" } }],
  }));
  await db.insert(teamMembersTable).values([
    { userId: ownerId, name: tag, email: ownerEmail, role: "owner" },
    { userId: specialistId, name: tag, email, role: "specialist" },
  ]);
  const [commercial] = await db.insert(versatCatalogTable).values({ kind: "commercial", sourceId: -Math.floor(Math.random() * 1_000_000_000), code: tag, name: tag, exportValue: tag }).returning();
  commercialId = commercial.id;
  await db.insert(teamInvitationsTable).values([{ email, commercialId }, { email: inviteEmail, commercialId }]);
  const [customer] = await db.insert(customersTable).values({ name: tag }).returning();
  customerId = customer.id;
  [initialInvoice] = await db.insert(invoicesTable).values({
    number: tag, customerId, specialistId, specialistName: tag, issueDate: "2026-10-21", currency: "CUP",
    versat: {
      commercialId, conceptId: 1, operationId: 1, paymentId: 1, number: null, talon: null,
      bankAccountMC: null, bankAccountOM: null, contract: null, currencyName: "CUP",
      conceptCode: "TEST", operationName: "Test", commercialName: tag, commercialPosition: "",
      paymentName: "Test", customerCode: "TEST", customerName: tag, customerAddress: null, customerTaxId: null,
    } satisfies VersatInvoiceSnapshot,
  }).returning();
  invoiceId = initialInvoice.id;
  await db.insert(invoiceSharesTable).values({
    invoiceId, tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60_000),
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Only the in-process harness can supply this identity; no bypass enters the actual app.
    const auth = Object.assign(
      () => ({ userId: req.headers["x-synthetic-id"] ?? null, tokenType: "session_token" }),
      { [Symbol.for("@clerk/express.auth")]: true },
    );
    Object.assign(req, { auth });
    next();
  });
  app.use("/api", billingRouter, versatRouter, legalRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  mock.restoreAll();
  if (invoiceId) {
    await db.delete(invoiceSharesTable).where(eq(invoiceSharesTable.invoiceId, invoiceId));
    await db.delete(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  }
  if (customerId) await db.delete(customersTable).where(eq(customersTable.id, customerId));
  await db.delete(teamMembersTable).where(inArray(teamMembersTable.userId, ids));
  await db.delete(teamInvitationsTable).where(inArray(teamInvitationsTable.email, emails));
  if (commercialId) await db.delete(versatCatalogTable).where(eq(versatCatalogTable.id, commercialId));
  await pool.end();
});

async function request(path: string, userId = specialistId, method = "GET", body?: unknown) {
  return fetch(`${base}${path}`, {
    method, headers: { "x-synthetic-id": userId, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const access = (id: string, suspended: boolean, actor = ownerId) =>
  request(`/team/members/${encodeURIComponent(id)}/access`, actor, "PATCH", { suspended });

test("owner-only suspension blocks private routes, survives login/invites and restores access without changing history", async () => {
  assert.equal((await request("/customers")).status, 200);
  assert.equal((await request("/customers", "")).status, 401);
  assert.equal((await access(specialistId, true, specialistId)).status, 403);
  assert.equal((await access(ownerId, true)).status, 422);
  assert.equal((await access("does-not-exist", true)).status, 404);
  assert.equal((await request(`/team/members/${specialistId}/access`, ownerId, "PATCH", { suspended: "yes" })).status, 400);
  assert.equal((await access(specialistId, true)).status, 204);
  for (const [path, method] of [
    ["/customers", "GET"], ["/customers", "POST"], ["/invoices", "GET"], ["/invoices", "POST"],
    [`/customers/${customerId}`, "PATCH"], [`/customers/${customerId}`, "DELETE"],
    [`/invoices/${invoiceId}`, "GET"], [`/invoices/${invoiceId}/share`, "POST"],
    [`/invoices/${invoiceId}`, "PATCH"], [`/invoices/${invoiceId}/status`, "PATCH"],
    [`/invoices/${invoiceId}/legal-document`, "PUT"], [`/invoices/${invoiceId}/images/stamp`, "GET"],
    ["/billing/overview", "GET"], ["/versat/catalogs", "GET"], ["/issuer", "GET"],
    ["/issuer", "PUT"], ["/versat/export", "GET"], ["/versat/export-file", "GET"],
    [`/invoices/${invoiceId}/versat-file`, "GET"],
    ["/billing/series", "GET"], ["/team/members", "GET"], ["/team/invitations", "POST"],
    ["/billing/series", "POST"], ["/billing/series/1", "PATCH"],
    [`/team/members/${specialistId}/access`, "PATCH"],
  ]) {
    const response = await request(path, specialistId, method, method === "POST" ? {} : undefined);
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.equal((await response.json() as { code: string }).code, "TEAM_ACCESS_SUSPENDED", path);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  }
  const me = await request("/team/me");
  assert.equal(me.status, 200);
  assert.equal(GetCurrentTeamMemberResponse.parse(await me.json()).suspended, true);
  // Updating an assignment must not reactivate the account.
  assert.equal((await request("/team/invitations", ownerId, "POST", { email, commercialId })).status, 201);
  assert.equal((await request("/customers")).status, 403);
  assert.equal((await request("/customers", replacementId)).status, 403);
  const publicResponse = await fetch(`${base}/shared-invoices/${token}`);
  assert.equal(publicResponse.status, 200);
  assert.deepEqual((await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)))[0], initialInvoice);
  assert.equal((await access(specialistId, false)).status, 204);
  assert.equal((await request("/customers")).status, 200);
  assert.equal((await request("/customers", replacementId)).status, 200);
  assert.equal(GetCurrentTeamMemberResponse.parse(await (await request("/team/me")).json()).commercialId, commercialId);
  assert.deepEqual((await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)))[0], initialInvoice);
});

test("an invitation can be suspended before first login, and reactivated explicitly", async () => {
  assert.equal((await access(`invite:${inviteEmail}`, true)).status, 204);
  assert.equal((await request("/customers", pendingId)).status, 403);
  assert.equal(GetCurrentTeamMemberResponse.parse(await (await request("/team/me", pendingId)).json()).suspended, true);
  assert.equal((await access(`invite:${inviteEmail}`, false)).status, 204);
  assert.equal((await request("/customers", pendingId)).status, 200);
});

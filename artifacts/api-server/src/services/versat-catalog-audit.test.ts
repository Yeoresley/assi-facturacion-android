import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  teamMembersTable,
  versatCatalogAuditTable,
  versatCatalogTable,
} from "@workspace/db";
import versatRouter from "../routes/versat";

const tag = `catalog-audit-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const ownerId = `${tag}-owner`;
const ownerEmail = `${ownerId}@example.invalid`;
const catalogIds: number[] = [];
const triggerFunction = `fail_catalog_audit_${randomUUID().replaceAll("-", "")}`;
const triggerName = `fail_catalog_audit_${randomUUID().replaceAll("-", "")}`;
let server: Server;
let base: string;

before(async () => {
  mock.method(clerkClient.users, "getUser", async (id: string) => ({
    id,
    firstName: "Audit",
    lastName: "Owner",
    primaryEmailAddressId: "verified",
    emailAddresses: [{
      id: "verified",
      emailAddress: ownerEmail,
      verification: { status: "verified" },
    }],
  }));

  await db.insert(teamMembersTable).values({
    userId: ownerId,
    name: "Audit Owner",
    email: ownerEmail,
    role: "owner",
  });

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
  app.use("/api", versatRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "Request failed" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  mock.restoreAll();

  await pool.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON versat_catalog_audit`);
  await pool.query(`DROP FUNCTION IF EXISTS "${triggerFunction}"()`);

  if (catalogIds.length) {
    await db.delete(versatCatalogAuditTable)
      .where(inArray(versatCatalogAuditTable.catalogEntryId, catalogIds));
    await db.delete(versatCatalogTable).where(inArray(versatCatalogTable.id, catalogIds));
  }
  await db.delete(teamMembersTable).where(eq(teamMembersTable.userId, ownerId));
  await pool.end();
});

async function request(path: string, method: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "x-synthetic-id": ownerId, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function values(overrides: Partial<{
  kind: "service";
  sourceId: number;
  code: string;
  name: string;
  exportValue: string;
  unitCode: string | null;
  unitName: string | null;
  groupCode: string | null;
  position: string | null;
  active: boolean;
}> = {}) {
  return {
    kind: "service" as const,
    sourceId: 734_000_001,
    code: `${tag}-code`,
    name: "Original service",
    exportValue: "ORIGINAL SERVICE",
    unitCode: "EA",
    unitName: "Each",
    groupCode: "GROUP-A",
    position: "Position A",
    active: true,
    ...overrides,
  };
}

test("catalog mutations create one actor-attributed audit event with exact snapshots; failed audit writes roll back", async () => {
  const startedAt = Date.now();
  const initial = values({ sourceId: Math.floor(Math.random() * 1_000_000_000) + 1 });
  const createResponse = await request("/versat/catalogs", "POST", {
    kind: initial.kind,
    sourceId: initial.sourceId,
    code: initial.code,
    name: initial.name,
    exportValue: initial.exportValue,
    unitCode: initial.unitCode!,
    unitName: initial.unitName!,
    groupCode: initial.groupCode!,
    position: initial.position!,
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json() as { id: number };
  catalogIds.push(created.id);

  const changed = values({
    ...initial,
    code: `${tag}-changed`,
    name: "Updated service",
    exportValue: "UPDATED SERVICE",
    unitCode: "HUR",
    unitName: "Hour",
    groupCode: "GROUP-B",
    position: "Position B",
  });
  const updateResponse = await request(`/versat/catalogs/${created.id}`, "PATCH", {
    code: changed.code,
    name: changed.name,
    exportValue: changed.exportValue,
    unitCode: changed.unitCode,
    unitName: changed.unitName,
    groupCode: changed.groupCode,
    position: changed.position,
  });
  assert.equal(updateResponse.status, 200);

  const inactive = { ...changed, active: false };
  const deactivateResponse = await request(`/versat/catalogs/${created.id}`, "PATCH", { active: false });
  assert.equal(deactivateResponse.status, 200);

  const reactivated = { ...changed, active: true };
  const reactivateResponse = await request(`/versat/catalogs/${created.id}`, "PATCH", { active: true });
  assert.equal(reactivateResponse.status, 200);

  const unchangedResponse = await request(`/versat/catalogs/${created.id}`, "PATCH", {
    code: reactivated.code,
    name: reactivated.name,
    exportValue: reactivated.exportValue,
    unitCode: reactivated.unitCode,
    unitName: reactivated.unitName,
    groupCode: reactivated.groupCode,
    position: reactivated.position,
    active: reactivated.active,
  });
  assert.equal(unchangedResponse.status, 200);

  const history = await db.select().from(versatCatalogAuditTable)
    .where(eq(versatCatalogAuditTable.catalogEntryId, created.id))
    .orderBy(versatCatalogAuditTable.id);
  assert.equal(history.length, 4, "creation, update, deactivate, and reactivate each add exactly one event");

  const expected = [
    { action: "created", previousValues: null, newValues: initial },
    { action: "updated", previousValues: initial, newValues: changed },
    { action: "deactivated", previousValues: changed, newValues: inactive },
    { action: "reactivated", previousValues: inactive, newValues: reactivated },
  ] as const;
  for (const [index, event] of history.entries()) {
    assert.equal(event.action, expected[index].action);
    assert.equal(event.actorUserId, ownerId);
    assert.equal(event.actorName, "Audit Owner");
    assert.equal(event.actorEmail, ownerEmail);
    assert.deepEqual(event.previousValues, expected[index].previousValues);
    assert.deepEqual(event.newValues, expected[index].newValues);
    assert.ok(event.createdAt instanceof Date);
    assert.ok(event.createdAt.getTime() >= startedAt - 1_000);
    assert.ok(event.createdAt.getTime() <= Date.now() + 1_000);
  }

  const rollbackEntry = await db.insert(versatCatalogTable).values({
    kind: "service",
    sourceId: Math.floor(Math.random() * 1_000_000_000) + 1,
    code: `${tag}-rollback`,
    name: "Before failure",
    exportValue: "BEFORE FAILURE",
    metadata: { unitCode: "EA" },
  }).returning();
  const [original] = rollbackEntry;
  catalogIds.push(original.id);

  await pool.query(`
    CREATE FUNCTION "${triggerFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.source_id = ${original.sourceId} THEN
        RAISE EXCEPTION 'synthetic audit insert failure';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await pool.query(`
    CREATE TRIGGER "${triggerName}"
    BEFORE INSERT ON versat_catalog_audit
    FOR EACH ROW EXECUTE FUNCTION "${triggerFunction}"()
  `);

  const failedResponse = await request(`/versat/catalogs/${original.id}`, "PATCH", {
    name: "Must roll back",
    exportValue: "MUST ROLL BACK",
  });
  assert.equal(failedResponse.status, 500);

  const [afterFailure] = await db.select().from(versatCatalogTable)
    .where(eq(versatCatalogTable.id, original.id));
  assert.equal(afterFailure.name, original.name);
  assert.equal(afterFailure.exportValue, original.exportValue);
  const failedHistory = await db.select().from(versatCatalogAuditTable)
    .where(eq(versatCatalogAuditTable.catalogEntryId, original.id));
  assert.equal(failedHistory.length, 0, "a failed audit write must not leave an audit event");
});

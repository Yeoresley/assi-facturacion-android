import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { canAccessInvoice, invoiceScope } from "./invoice-access";

const specialist = { role: "specialist" as const, commercialId: 12 };

test("el comercial asignado, no el creador, determina el acceso", () => {
  const ownerCreated = { specialistId: "owner", versat: { commercialId: 12 } };
  assert.equal(canAccessInvoice(specialist, ownerCreated), true);
  assert.equal(canAccessInvoice(specialist, { versat: { commercialId: 13 } }), false);
  assert.equal(canAccessInvoice(specialist, { versat: null }), false);
});

test("sin asignación o sin autorización no se conceden facturas", () => {
  assert.equal(canAccessInvoice({ role: "specialist", commercialId: null }, { versat: { commercialId: 12 } }), false);
  assert.equal(canAccessInvoice({ role: "pending", commercialId: 12 }, { versat: { commercialId: 12 } }), false);
});

test("el propietario conserva acceso a todos los comerciales y borradores sin asignar", () => {
  assert.equal(canAccessInvoice({ role: "owner", commercialId: null }, { versat: { commercialId: 13 } }), true);
  assert.equal(canAccessInvoice({ role: "owner", commercialId: null }, { versat: null }), true);
});

test("el filtro SQL usa el identificador del comercial con parámetro, y deniega sin asignación", () => {
  const dialect = new PgDialect();
  const assigned = dialect.sqlToQuery(invoiceScope(specialist));
  assert.match(assigned.sql, /->>'commercialId'/);
  assert.deepEqual(assigned.params, ["12"]);
  assert.equal(dialect.sqlToQuery(invoiceScope({ role: "specialist", commercialId: null })).sql, "false");
  assert.equal(dialect.sqlToQuery(invoiceScope({ role: "owner", commercialId: null })).sql, "true");
});

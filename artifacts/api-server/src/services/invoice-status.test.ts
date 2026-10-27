import assert from "node:assert/strict";
import test from "node:test";
import { acceptanceFromWorkflowEvent, statusCodes, transitionIssue } from "./invoice-status";

test("conserva los siete códigos del catálogo de Versat", () => {
  assert.deepEqual(statusCodes, {
    draft: 1, finished: 2, confirmed: 3, voided: 4, cancelled: 5, error: 6, accepted: 7,
  });
});

test("un pago o una exportación aceptan una factura terminada sin reemplazar una aceptación previa", () => {
  const acceptedAt = new Date("2026-10-21T12:00:00Z");
  assert.deepEqual(acceptanceFromWorkflowEvent({
    status: "finished", acceptedBy: null, acceptedAt: null, acceptedSource: null,
  }, "owner-1", "payment", acceptedAt), {
    status: "accepted", acceptedBy: "owner-1", acceptedAt, acceptedSource: "payment",
  });
  assert.deepEqual(acceptanceFromWorkflowEvent({
    status: "accepted", acceptedBy: "specialist-1", acceptedAt, acceptedSource: "specialist",
  }, "owner-2", "payment", new Date()), {});
  assert.deepEqual(acceptanceFromWorkflowEvent({
    status: "accepted", acceptedBy: "owner-1", acceptedAt, acceptedSource: "payment",
  }, "owner-2", "versat_export", new Date()), {});
  assert.deepEqual(acceptanceFromWorkflowEvent({
    status: "confirmed", acceptedBy: "owner-1", acceptedAt, acceptedSource: "versat_import",
  }, "owner-2", "versat_export", new Date()), {});
  assert.deepEqual(acceptanceFromWorkflowEvent({
    status: "confirmed", acceptedBy: null, acceptedAt: null, acceptedSource: null,
  }, "owner-2", "versat_export", acceptedAt), {
    status: "confirmed", acceptedBy: "owner-2", acceptedAt,
  });
  assert.deepEqual(acceptanceFromWorkflowEvent({
    status: "paid", acceptedBy: null, acceptedAt: null, acceptedSource: null,
  }, "owner-2", "payment", acceptedAt), {
    status: "accepted", acceptedBy: "owner-2", acceptedAt, acceptedSource: "payment",
  });
  assert.deepEqual(acceptanceFromWorkflowEvent({
    status: "finished", acceptedBy: null, acceptedAt: null, acceptedSource: null,
  }, "owner-2", "versat_export", acceptedAt), {
    status: "accepted", acceptedBy: "owner-2", acceptedAt, acceptedSource: "versat_export",
  });
  assert.deepEqual(acceptanceFromWorkflowEvent({
    status: "accepted", acceptedBy: null, acceptedAt: null, acceptedSource: null,
  }, "owner-2", "payment", acceptedAt), {
    status: "accepted", acceptedBy: "owner-2", acceptedAt,
  });
});

test("el flujo exige terminar, aceptar como especialista y confirmar como administrador", () => {
  assert.equal(transitionIssue({ status: "draft", versatNumber: null }, "finished", "owner"), null);
  assert.match(transitionIssue({ status: "draft", versatNumber: null }, "accepted", "specialist")!, /no permitido/);
  assert.match(transitionIssue({ status: "finished", versatNumber: "TEST" }, "accepted", "owner")!, /especialista/);
  assert.equal(transitionIssue({ status: "finished", versatNumber: "TEST" }, "accepted", "specialist"), null);
  assert.match(transitionIssue({ status: "accepted", versatNumber: "TEST" }, "confirmed", "specialist")!, /administrador/);
  assert.equal(transitionIssue({ status: "accepted", versatNumber: "TEST" }, "confirmed", "owner"), null);
  assert.equal(transitionIssue({ status: "finished", versatNumber: "TEST" }, "confirmed", "owner"), null);
  assert.equal(transitionIssue({ status: "sent", versatNumber: "TEST" }, "confirmed", "owner"), null);
  assert.equal(transitionIssue({ status: "paid", versatNumber: "TEST" }, "confirmed", "owner"), null);
});

test("anuladas, canceladas e importadas no pueden reactivarse", () => {
  for (const status of ["confirmed", "voided", "cancelled"] as const) {
    assert.match(transitionIssue({ status, versatNumber: "TEST" }, "finished", "owner")!, /reactivarse/);
    assert.match(transitionIssue({ status, versatNumber: "TEST" }, "accepted", "specialist")!, /reactivarse/);
  }
});

test("el error bloquea la aceptación directa y nunca devuelve una numerada a edición", () => {
  assert.match(transitionIssue({ status: "error", versatNumber: "TEST" }, "draft", "specialist")!, /numerada/);
  assert.equal(transitionIssue({ status: "error", versatNumber: null }, "draft", "specialist"), null);
  assert.equal(transitionIssue({ status: "error", versatNumber: "TEST" }, "finished", "specialist"), null);
  assert.match(transitionIssue({ status: "error", versatNumber: "TEST" }, "accepted", "specialist")!, /no permitido/);
});

test("el propietario puede confirmar facturas enviadas o pagadas aunque falte la aceptación explícita", () => {
  for (const status of ["sent", "paid"] as const) {
    assert.equal(transitionIssue({ status, versatNumber: "TEST" }, "accepted", "specialist"), null);
    assert.equal(transitionIssue({ status, versatNumber: "TEST" }, "confirmed", "owner"), null);
  }
  assert.equal(transitionIssue({ status: "accepted", versatNumber: "TEST" }, "accepted", "specialist"), null);
});

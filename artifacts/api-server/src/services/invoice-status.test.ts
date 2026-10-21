import assert from "node:assert/strict";
import test from "node:test";
import { statusCodes, transitionIssue } from "./invoice-status";

test("conserva los siete códigos del catálogo de Versat", () => {
  assert.deepEqual(statusCodes, {
    draft: 1, finished: 2, confirmed: 3, voided: 4, cancelled: 5, error: 6, accepted: 7,
  });
});

test("el flujo exige terminar, aceptar como especialista y confirmar como administrador", () => {
  assert.equal(transitionIssue({ status: "draft", versatNumber: null }, "finished", "owner"), null);
  assert.match(transitionIssue({ status: "draft", versatNumber: null }, "accepted", "specialist")!, /no permitido/);
  assert.match(transitionIssue({ status: "finished", versatNumber: "TEST" }, "accepted", "owner")!, /especialista/);
  assert.equal(transitionIssue({ status: "finished", versatNumber: "TEST" }, "accepted", "specialist"), null);
  assert.match(transitionIssue({ status: "accepted", versatNumber: "TEST" }, "confirmed", "specialist")!, /administrador/);
  assert.equal(transitionIssue({ status: "accepted", versatNumber: "TEST" }, "confirmed", "owner"), null);
  assert.match(transitionIssue({ status: "finished", versatNumber: "TEST" }, "confirmed", "owner")!, /no permitido/);
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

test("enviadas y pagadas históricas requieren aceptación explícita; repetir no cambia estado", () => {
  for (const status of ["sent", "paid"] as const) {
    assert.equal(transitionIssue({ status, versatNumber: "TEST" }, "accepted", "specialist"), null);
    assert.match(transitionIssue({ status, versatNumber: "TEST" }, "confirmed", "owner")!, /no permitido/);
  }
  assert.equal(transitionIssue({ status: "accepted", versatNumber: "TEST" }, "accepted", "specialist"), null);
});

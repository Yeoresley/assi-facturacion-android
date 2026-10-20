import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildFac, encodeFac, getVersatIssues, serialVersatDate, type FacInvoice } from "./versat-file";

function fixture(): FacInvoice {
  return {
    number: "INTERNO-PRUEBA", issueDate: "2026-10-19", status: "sent", currency: "CUP",
    notes: "Primera línea\nSegunda línea",
    versat: {
      conceptId: 1, operationId: 2, commercialId: 3, paymentId: 4,
      number: "PRUEBA001", talon: "5", bankAccountMC: null, bankAccountOM: null, contract: null,
      currencyName: "CUBAN PESO", conceptCode: "002", operationName: "Servicios",
      commercialName: "Comercial de prueba", commercialPosition: "Especialista",
      paymentName: "Efectivo", customerCode: "PRUEBA", customerName: "Cliente de prueba",
      customerAddress: null, customerTaxId: null,
    },
    lines: [{ serviceCode: "4651.2.03.05", groupCode: "4651", unitCode: "Uno", quantity: 1.2345, unitPrice: 123.45678 }],
  };
}

test("fecha serial coincide con el ejemplo y no depende de la zona horaria", () => {
  assert.equal(serialVersatDate("2026-10-19"), 46314);
  assert.throws(() => serialVersatDate("2026-02-31"));
});

test("preserva las 14 posiciones, la precisión, los CRLF y la nota en una sola línea", () => {
  const value = buildFac(fixture());
  assert.ok(!/(?<!\r)\n/.test(value));
  const detail = value.split("[Detalle]\r\n")[1].split("\r\n")[0].split("|");
  assert.equal(detail.length, 14);
  assert.deepEqual(detail.slice(0, 5), ["S", "4651", "4651.2.03.05", "Uno", "1.2345"]);
  assert.equal(detail[10], "123.45678");
  assert.ok(value.includes("Observacion=Primera línea Segunda línea\r\n"));
  assert.ok(value.endsWith("[PieFirma]\r\n"));
});

test("no exporta borradores, anuladas, mercancías ni líneas sin correspondencia", () => {
  for (const status of ["draft", "cancelled"]) {
    const invoice = fixture(); invoice.status = status;
    assert.throws(() => buildFac(invoice));
  }
  const invoice = fixture();
  invoice.lines[0].groupCode = null;
  assert.ok(getVersatIssues(invoice).some((issue) => issue.includes("agrupador")));
  invoice.versat!.operationName = "VENTAS DE MERCANCIAS";
  assert.ok(getVersatIssues(invoice).some((issue) => issue.includes("mercancías")));
});

test("bloquea numeración peligrosa, campos multilínea y detalles con separadores", () => {
  const invoice = fixture();
  invoice.versat!.number = "../PRUEBA";
  assert.throws(() => buildFac(invoice));
  invoice.versat!.number = "PRUEBA001";
  invoice.lines[0].unitCode = "Uno|Inyección";
  assert.throws(() => buildFac(invoice));
  invoice.lines[0].unitCode = "Uno";
  invoice.versat!.commercialName = "Nombre\r\nNumero=otro";
  assert.throws(() => buildFac(invoice));
});

test("Windows-1252 mantiene ñ, acentos y euro; nunca sustituye caracteres en silencio", () => {
  const source = "Nómina, año y €";
  assert.equal(encodeFac(source, "windows-1252").toString("hex"), "4ef36d696e612c2061f16f20792080");
  assert.throws(() => encodeFac("漢字", "windows-1252"));
  assert.equal(encodeFac("漢字", "utf-8").toString("utf8"), "漢字");
});

test("las nueve filas del .Fac aportado se reproducen sin modificar códigos ni importes", () => {
  const source = readFileSync(new URL("./fixtures/versat-detail.fac", import.meta.url), "utf8");
  const rows = source.trimEnd().split(/\r?\n/);
  const invoice = fixture();
  invoice.lines = rows.map((row) => {
    const cells = row.split("|");
    return { groupCode: cells[1], serviceCode: cells[2], unitCode: cells[3], quantity: Number(cells[4]), unitPrice: Number(cells[10]) };
  });
  const actual = buildFac(invoice).split("[Detalle]\r\n")[1].split("\r\n").filter((line) => line.startsWith("S|"));
  assert.deepEqual(actual, rows);
});

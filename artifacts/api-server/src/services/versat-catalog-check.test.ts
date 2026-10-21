import assert from "node:assert/strict";
import test from "node:test";
import { CompareVersatCatalogsResponse } from "@workspace/api-zod";
import { compareCatalogCsv } from "./versat-catalog-check";

const active = [
  { kind: "service" as const, sourceId: 12, code: "SRV-12", exportValue: "SERVICIO 12" },
  { kind: "payment" as const, sourceId: 4, code: "PAY-4", exportValue: "TRANSFERENCIA" },
];

test("accepts matching CSV and TSV catalogs with quoted values", () => {
  const csv = 'kind,sourceId,code,exportValue\nservice,12,SRV-12,"SERVICIO, 12"\npayment,4,PAY-4,TRANSFERENCIA';
  const result = compareCatalogCsv(csv.replace("SERVICIO, 12", "SERVICIO 12"), active);
  assert.equal(result.compatible, true);
  assert.equal(result.activeEntryCount, 2);
  assert.equal(result.fileEntryCount, 2);
  assert.deepEqual(result.differences, []);

  const tsv = "tipo\tid de origen\tcódigo\tvalor exportado\nservicio\t12\tSRV-12\tSERVICIO 12\npago\t4\tPAY-4\tTRANSFERENCIA";
  assert.equal(compareCatalogCsv(tsv, active).compatible, true);
});

test("reports absent rows, unknown source IDs, and different code and export values", () => {
  const csv = [
    "kind;sourceId;code;exportValue",
    "service;12;SERVICE-CHANGED;SERVICIO DISTINTO",
    "unit;99;UNIT-99;UNIDAD 99",
  ].join("\n");
  const result = compareCatalogCsv(csv, active);
  assert.equal(result.compatible, false);
  assert.deepEqual(new Set(result.differences.map((difference) => difference.type)), new Set([
    "code_mismatch", "export_value_mismatch", "missing_in_file", "missing_in_system",
  ]));
});

test("reports invalid rows and repeated kind/source IDs without throwing away the report", () => {
  const csv = [
    "kind,sourceId,code,exportValue",
    "service,12,SRV-12,SERVICIO 12",
    "service,12,SRV-OTHER,OTRO",
    "unknown,,MISSING,VALUE",
  ].join("\n");
  const result = compareCatalogCsv(csv, active);
  assert.equal(result.compatible, false);
  assert.ok(result.differences.some(({ type }) => type === "duplicate_source_id"));
  assert.ok(result.differences.some(({ type }) => type === "invalid_row"));
  assert.ok(result.differences.some(({ type, kind }) => type === "missing_in_file" && kind === "payment"));
});

test("rejects empty, unsupported, and malformed CSV input", () => {
  assert.throws(() => compareCatalogCsv("", active), /no contiene filas/);
  assert.throws(() => compareCatalogCsv("kind,code\nservice,A", active), /debe incluir las columnas/);
  assert.throws(() => compareCatalogCsv('kind,sourceId,code,exportValue\nservice,1,"not closed,value', active), /sin cerrar/);
});

test("comparison result matches the generated API response contract", () => {
  const result = compareCatalogCsv("kind,sourceId,code,exportValue\nservice,12,SRV-12,SERVICIO 12", active);
  assert.doesNotThrow(() => CompareVersatCatalogsResponse.parse(result));
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildInvoiceImageAccessCsv } from "./invoice-image-access-export";

test("builds a readable CSV with invoice, internal link, image and exact timestamp", () => {
  const csv = buildInvoiceImageAccessCsv("ASSI-2026-0042", [{
    shareId: 17,
    kind: "stamp",
    openedAt: new Date("2026-10-25T14:32:18.000Z"),
  }, {
    shareId: 19,
    kind: "signature",
    openedAt: new Date("2026-10-26T09:05:00.000Z"),
  }]);

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /"Factura";"Enlace interno";"Imagen consultada";"Fecha y hora \(UTC\)"/);
  assert.match(csv, /"ASSI-2026-0042";"17";"Cuño";"2026-10-25T14:32:18\.000Z"/);
  assert.match(csv, /"ASSI-2026-0042";"19";"Firma";"2026-10-26T09:05:00\.000Z"/);
  assert.ok(!csv.includes("token"));
  assert.ok(!csv.includes("hash"));
  assert.ok(!csv.includes("visitor"));
});

test("neutralizes spreadsheet formulas in invoice numbers and exports an empty history header", () => {
  const csv = buildInvoiceImageAccessCsv("=HYPERLINK(\"https://example.test\")", [{
    shareId: 22,
    kind: "signature",
    openedAt: new Date("2026-10-26T09:05:00.000Z"),
  }]);

  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.test""\)"/);
  assert.equal(buildInvoiceImageAccessCsv("ASSI-2026-0042", []).split("\r\n").length, 1);
});

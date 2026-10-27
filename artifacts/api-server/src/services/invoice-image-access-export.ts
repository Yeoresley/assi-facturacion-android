type InvoiceImageAccessExportRow = {
  shareId: number;
  kind: "stamp" | "signature";
  openedAt: Date;
};

function csvCell(value: string | number): string {
  const text = String(value).replace(/^(\s*[=+\-@])/, "'$1");
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildInvoiceImageAccessCsv(
  invoiceNumber: string,
  accesses: InvoiceImageAccessExportRow[],
): string {
  const rows = [
    ["Factura", "Enlace interno", "Imagen consultada", "Fecha y hora (UTC)"],
    ...accesses.map(access => [
      invoiceNumber,
      access.shareId,
      access.kind === "stamp" ? "Cuño" : "Firma",
      access.openedAt.toISOString(),
    ]),
  ];
  return `\uFEFF${rows.map(row => row.map(csvCell).join(";")).join("\r\n")}`;
}

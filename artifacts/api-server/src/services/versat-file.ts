import iconv from "iconv-lite";
import type { VersatInvoiceSnapshot } from "@workspace/db";

export type FacInvoice = {
  number: string;
  issueDate: string;
  status: string;
  currency: string;
  notes: string | null;
  versat: VersatInvoiceSnapshot | null;
  lines: Array<{
    serviceCode: string | null; groupCode: string | null; unitCode: string | null;
    quantity: number; unitPrice: number;
  }>;
};
export const facWarnings = [
  "Archivo de prueba basado en el ejemplo recibido; pendiente validar una importación real en Versat.",
  "Solo servicios sin descuentos, recargos ni impuestos. No importar dos veces la misma numeración.",
  "La numeración se controla solo en esta app; no hay sincronización directa con Versat de escritorio.",
];

export function getVersatIssues(invoice: FacInvoice): string[] {
  const issues: string[] = [];
  if (!["sent", "paid"].includes(invoice.status)) issues.push("La factura debe estar emitida o pagada.");
  const snapshot = invoice.versat;
  if (!snapshot) issues.push("Faltan concepto, operación, comercial y forma de pago de Versat.");
  else {
    if (!snapshot.number) issues.push("Falta el número de factura para Versat.");
    else if (!/^[A-Za-z0-9_-]+$/.test(snapshot.number)) issues.push("El número de Versat contiene caracteres no admitidos.");
    if (!snapshot.talon) issues.push("Falta el talón de Versat.");
    if (!snapshot.customerCode) issues.push("El cliente no tiene código de entidad de Versat.");
    if (/mercanc[ií]as/i.test(snapshot.operationName)) issues.push("La venta de mercancías no está cubierta por el ejemplo de servicios recibido.");
    if (/transferencia/i.test(snapshot.paymentName) && !snapshot.bankAccountMC && !snapshot.bankAccountOM) {
      issues.push("Indica la cuenta bancaria MC u OM para el pago por transferencia.");
    }
  }
  if (!invoice.lines.length) issues.push("La factura no tiene líneas.");
  invoice.lines.forEach((line, index) => {
    if (!line.serviceCode || !line.unitCode) issues.push(`Línea ${index + 1}: falta seleccionar un servicio del catálogo con unidad.`);
    if (!line.groupCode) issues.push(`Línea ${index + 1}: falta confirmar el agrupador de Versat.`);
  });
  return issues;
}

export function serialVersatDate(date: string): number {
  const value = date.slice(0, 10);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Fecha inválida.");
  return Math.round((parsed.valueOf() - Date.UTC(1899, 11, 30)) / 86400000);
}

export function buildFac(invoice: FacInvoice): string {
  const issues = getVersatIssues(invoice);
  if (issues.length) throw new Error(issues.join("\n"));
  const s = invoice.versat!;
  const safe = (value: string | null | undefined) => {
    if (value && /[\r\n]/.test(value)) throw new Error("Un campo de catálogo contiene saltos de línea.");
    return value ?? "";
  };
  const header: Array<[string, string | number | null | undefined]> = [
    ["Numero", s.number], ["MC", s.currencyName], ["OM", s.currencyName],
    ["Fecha", serialVersatDate(invoice.issueDate)], ["Entidad", s.customerCode],
    ["Concepto", s.conceptCode], ["Comercial", s.commercialName],
    ["CtaBancoMC", s.bankAccountMC], ["CtaBancoOM", s.bankAccountOM],
    ["Forma", s.paymentName], ["Operacion", s.operationName],
    ["Observacion", (invoice.notes ?? "").replace(/[\r\n]+/g, " ")],
    ["MA", ""], ["CtoArancel", ""], ["PorcientoAra", 0], ["Talon", s.talon],
    ["Contrato", s.contract], ["VtaCadena", 0],
    ["NomHecho", s.commercialName], ["CargoHecho", s.commercialPosition],
    ["CIHecho", ""], ["NomJA", ""], ["CIJA", ""], ["NomTra", ""], ["Chapa", ""],
    ["LicTra", ""], ["CITra", ""], ["NomCliente", ""], ["CargoCliente", ""], ["CICliente", ""],
  ];
  const detail = invoice.lines.map((line) => {
    const values = ["S", line.groupCode, line.serviceCode, line.unitCode, line.quantity,
      0, 0, 0, 0, 0, line.unitPrice, "  ", 0, 0];
    if (values.some((value) => /[|\r\n]/.test(String(value)))) throw new Error("Detalle con separadores no válidos.");
    return values.join("|");
  });
  return [...header.map(([key, value]) => `${key}=${safe(String(value ?? ""))}`),
    "[Propiedades]", "", "[Detalle]", ...detail, "", "[PieFirma]", ""].join("\r\n");
}

export function encodeFac(content: string, encoding: "windows-1252" | "utf-8"): Buffer {
  const encoded = iconv.encode(content, encoding);
  if (iconv.decode(encoded, encoding) !== content) {
    throw new Error("Hay caracteres que Windows-1252 no puede representar. Elige UTF-8 y confirma su aceptación en Versat.");
  }
  return encoded;
}

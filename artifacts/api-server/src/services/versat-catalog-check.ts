import type { CatalogKind } from "@workspace/db";

const kinds: CatalogKind[] = ["service", "unit", "currency", "concept", "operation", "commercial", "payment"];
const kindLabels: Record<string, CatalogKind> = {
  service: "service", servicios: "service", servicio: "service",
  unit: "unit", unidades: "unit", unidad: "unit",
  currency: "currency", monedas: "currency", moneda: "currency",
  concept: "concept", conceptos: "concept", concepto: "concept",
  operation: "operation", operaciones: "operation", operacion: "operation",
  commercial: "commercial", comerciales: "commercial", comercial: "commercial",
  payment: "payment", pagos: "payment", pago: "payment", "forma de pago": "payment", "formas de pago": "payment",
};

export type ActiveCatalogEntry = {
  kind: CatalogKind;
  sourceId: number;
  code: string;
  exportValue: string;
};

export type CatalogDifference = {
  type: "missing_in_file" | "missing_in_system" | "code_mismatch" | "export_value_mismatch" | "invalid_row" | "duplicate_source_id";
  kind: CatalogKind | null;
  sourceId: number | null;
  systemCode: string | null;
  fileCode: string | null;
  systemExportValue: string | null;
  fileExportValue: string | null;
  detail: string;
};

type ParsedEntry = {
  rowNumber: number;
  kind: CatalogKind | null;
  sourceId: number | null;
  code: string | null;
  exportValue: string | null;
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, "");
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      if (char === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("El archivo tiene una celda entrecomillada sin cerrar.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function cell(row: string[], headers: Map<string, number>, ...names: string[]): string {
  for (const name of names) {
    const index = headers.get(name);
    if (index !== undefined) return (row[index] ?? "").trim();
  }
  return "";
}

function key(kind: CatalogKind, sourceId: number): string {
  return `${kind}:${sourceId}`;
}

export function compareCatalogCsv(csv: string, activeEntries: readonly ActiveCatalogEntry[]) {
  if (csv.length > 1_500_000) throw new Error("El archivo supera el límite de 1,5 MB.");
  const text = csv.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", ",", "\t"].sort((a, b) =>
    firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = parseDelimited(text, delimiter);
  if (rows.length < 2) throw new Error("El archivo no contiene filas de catálogo.");
  const headerRow = rows[0].map(normalizeHeader);
  const headers = new Map(headerRow.map((header, index) => [header, index]));
  const kindHeader = headers.get("kind") ?? headers.get("tipo");
  const sourceHeader = headers.get("sourceid") ?? headers.get("idorigen") ?? headers.get("iddeorigen") ?? headers.get("id");
  const codeHeader = headers.get("code") ?? headers.get("codigo");
  const exportHeader = headers.get("exportvalue") ?? headers.get("valorexportado") ?? headers.get("valor");
  if (kindHeader === undefined || sourceHeader === undefined || codeHeader === undefined || exportHeader === undefined) {
    throw new Error("El CSV/TSV debe incluir las columnas tipo (kind), id de origen (sourceId), código (code) y valor exportado (exportValue).");
  }

  const differences: CatalogDifference[] = [];
  const parsed: ParsedEntry[] = rows.slice(1).map((row, index) => {
    const rawKind = cell(row, headers, "kind", "tipo").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const kind = kindLabels[rawKind] ?? null;
    const rawId = cell(row, headers, "sourceid", "idorigen", "iddeorigen", "id");
    const sourceId = /^\d+$/.test(rawId) && Number(rawId) > 0 ? Number(rawId) : null;
    const code = cell(row, headers, "code", "codigo");
    const exportValue = cell(row, headers, "exportvalue", "valorexportado", "valor");
    const entry = { rowNumber: index + 2, kind, sourceId, code: code || null, exportValue: exportValue || null };
    if (!kind || !sourceId || !entry.code || !entry.exportValue) {
      differences.push({
        type: "invalid_row", kind, sourceId, systemCode: null, fileCode: entry.code,
        systemExportValue: null, fileExportValue: entry.exportValue,
        detail: `Fila ${entry.rowNumber}: revisa tipo, ID de origen, código y valor exportado.`,
      });
    }
    return entry;
  });

  if (parsed.length > 10_000) throw new Error("El archivo supera el máximo de 10.000 filas.");
  const fileEntries = new Map<string, ParsedEntry>();
  for (const entry of parsed) {
    if (!entry.kind || !entry.sourceId || !entry.code || !entry.exportValue) continue;
    const id = key(entry.kind, entry.sourceId);
    if (fileEntries.has(id)) {
      differences.push({
        type: "duplicate_source_id", kind: entry.kind, sourceId: entry.sourceId,
        systemCode: null, fileCode: entry.code, systemExportValue: null, fileExportValue: entry.exportValue,
        detail: `El tipo y el ID de origen aparecen más de una vez en la fila ${entry.rowNumber}.`,
      });
    } else {
      fileEntries.set(id, entry);
    }
  }

  const systemEntries = new Map(activeEntries.map((entry) => [key(entry.kind, entry.sourceId), entry]));
  for (const [id, system] of systemEntries) {
    const file = fileEntries.get(id);
    if (!file) {
      differences.push({
        type: "missing_in_file", kind: system.kind, sourceId: system.sourceId,
        systemCode: system.code, fileCode: null, systemExportValue: system.exportValue, fileExportValue: null,
        detail: `El catálogo activo ${system.kind} con ID ${system.sourceId} no aparece en el archivo.`,
      });
      continue;
    }
    if (system.code !== file.code) {
      differences.push({
        type: "code_mismatch", kind: system.kind, sourceId: system.sourceId,
        systemCode: system.code, fileCode: file.code,
        systemExportValue: system.exportValue, fileExportValue: file.exportValue,
        detail: `El código difiere para ${system.kind}, ID ${system.sourceId}.`,
      });
    }
    if (system.exportValue !== file.exportValue) {
      differences.push({
        type: "export_value_mismatch", kind: system.kind, sourceId: system.sourceId,
        systemCode: system.code, fileCode: file.code,
        systemExportValue: system.exportValue, fileExportValue: file.exportValue,
        detail: `El valor exportado difiere para ${system.kind}, ID ${system.sourceId}.`,
      });
    }
  }
  for (const [id, file] of fileEntries) {
    if (systemEntries.has(id)) continue;
    differences.push({
      type: "missing_in_system", kind: file.kind, sourceId: file.sourceId,
      systemCode: null, fileCode: file.code, systemExportValue: null, fileExportValue: file.exportValue,
      detail: `El archivo contiene ${file.kind}, ID ${file.sourceId}, que no está activo en el catálogo de la aplicación.`,
    });
  }

  return {
    compatible: differences.length === 0,
    activeEntryCount: activeEntries.length,
    fileEntryCount: parsed.length,
    differences,
  };
}

export const versatCatalogKinds = kinds;

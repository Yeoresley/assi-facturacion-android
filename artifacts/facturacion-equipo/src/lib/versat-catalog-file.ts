import ExcelJS from 'exceljs';

type CatalogKind =
  | 'service'
  | 'unit'
  | 'currency'
  | 'concept'
  | 'operation'
  | 'commercial'
  | 'payment';

type CatalogRow = {
  kind: CatalogKind;
  sourceId: string;
  code: string;
  exportValue: string;
};

type FileLike = Pick<File, 'name' | 'size' | 'arrayBuffer'>;

const workbookMappings: Array<{
  kind: CatalogKind;
  sourceId: string;
  code: string;
  exportValue: string;
}> = [
  { kind: 'service', sourceId: 'idservicio', code: 'codigo', exportValue: 'codigo' },
  { kind: 'unit', sourceId: 'idmedida', code: 'clave', exportValue: 'clave' },
  { kind: 'currency', sourceId: 'idmoneda', code: 'sigla', exportValue: 'nombre' },
  { kind: 'concept', sourceId: 'idconcepto', code: 'codigo', exportValue: 'codigo' },
  { kind: 'operation', sourceId: 'idoperacion', code: 'idoperacion', exportValue: 'descripcion' },
  { kind: 'commercial', sourceId: 'idcomercial', code: 'idcomercial', exportValue: 'nombre' },
  { kind: 'payment', sourceId: 'idformapago', code: 'idformapago', exportValue: 'forma' },
];

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '');
}

function valueText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('result' in value) return valueText(value.result as ExcelJS.CellValue | undefined);
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
    return '';
  }
  return String(value).trim();
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function decodeDelimitedFile(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function readWorksheetRows(worksheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      values[column - 1] = valueText(cell.value);
    });
    rows.push(values);
  });
  return rows;
}

async function parseWorkbook(buffer: ArrayBuffer, filename: string): Promise<{
  rows: CatalogRow[];
  containsEntitySheet: boolean;
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const output: CatalogRow[] = [];
  let recognizedCatalog = false;
  let containsEntitySheet = false;

  for (const worksheet of workbook.worksheets) {
    const rows = readWorksheetRows(worksheet);
    if (rows.length < 2) continue;
    const headers = new Map(rows[0].map((header, index) => [normalizeHeader(header), index]));
    if (headers.has('identidad') && headers.has('codigo') && headers.has('nombre') && headers.has('activo')) {
      containsEntitySheet = true;
      continue;
    }
    const mapping = workbookMappings.find((candidate) =>
      headers.has(candidate.sourceId) && headers.has(candidate.code) && headers.has(candidate.exportValue));
    if (!mapping) continue;
    recognizedCatalog = true;

    for (const [index, row] of rows.slice(1).entries()) {
      if (!row.some((value) => value.trim())) continue;
      const sourceId = row[headers.get(mapping.sourceId)!] ?? '';
      const code = row[headers.get(mapping.code)!] ?? '';
      const exportValue = row[headers.get(mapping.exportValue)!] ?? '';
      if (!/^\d+$/.test(sourceId) || Number(sourceId) < 1 || !code || !exportValue) {
        throw new Error(`${filename}, hoja ${worksheet.name}, fila ${index + 2}: faltan datos necesarios para comparar el catálogo.`);
      }
      output.push({ kind: mapping.kind, sourceId: String(Number(sourceId)), code, exportValue });
    }
  }

  if (!recognizedCatalog) {
    if (containsEntitySheet) {
      return { rows: [], containsEntitySheet: true };
    }
    throw new Error(`${filename}: no se reconoce como un libro de catálogo Versat compatible.`);
  }
  if (!output.length) throw new Error(`${filename}: el libro no contiene filas de catálogo.`);
  return { rows: output, containsEntitySheet };
}

export async function prepareVersatCatalogCsv(files: readonly FileLike[]): Promise<{
  csv: string;
  filenames: string[];
  rowCount: number;
  excludedEntityFiles: string[];
}> {
  if (!files.length) throw new Error('Selecciona al menos un archivo de catálogo.');
  const totalSize = files.reduce((size, file) => size + file.size, 0);
  if (totalSize > 1_500_000) throw new Error('Los archivos superan el límite total de 1,5 MB.');

  const areWorkbooks = files.map((file) => /\.xlsx$/i.test(file.name));
  const areDelimited = files.map((file) => /\.(csv|tsv|txt)$/i.test(file.name));
  if (areWorkbooks.some(Boolean) && (!areWorkbooks.every(Boolean) || areDelimited.some(Boolean))) {
    throw new Error('Selecciona varios libros .xlsx o un único CSV/TSV; no mezcles ambos formatos.');
  }
  if (!areWorkbooks.some(Boolean)) {
    if (files.length !== 1 || !areDelimited[0]) {
      throw new Error('Selecciona un CSV/TSV estándar o uno o varios libros .xlsx de catálogo Versat.');
    }
    const csv = decodeDelimitedFile(await files[0].arrayBuffer());
    if (csv.length > 1_500_000) throw new Error('El archivo supera el límite de 1,5 MB.');
    return { csv, filenames: [files[0].name], rowCount: 0, excludedEntityFiles: [] };
  }

  const entries: CatalogRow[] = [];
  const excludedEntityFiles: string[] = [];
  for (const file of files) {
    const workbook = await parseWorkbook(await file.arrayBuffer(), file.name);
    entries.push(...workbook.rows);
    if (workbook.containsEntitySheet) excludedEntityFiles.push(file.name);
  }
  if (!entries.length) {
    throw new Error('No hay libros de los siete catálogos admitidos. Las entidades/clientes no se comparan en este control.');
  }
  if (entries.length > 10_000) throw new Error('Los archivos superan el máximo de 10.000 filas.');

  const csv = [
    ['kind', 'sourceId', 'code', 'exportValue'].map(csvCell).join(','),
    ...entries.map((entry) =>
      [entry.kind, entry.sourceId, entry.code, entry.exportValue].map(csvCell).join(',')),
  ].join('\r\n');
  return { csv, filenames: files.map((file) => file.name), rowCount: entries.length, excludedEntityFiles };
}

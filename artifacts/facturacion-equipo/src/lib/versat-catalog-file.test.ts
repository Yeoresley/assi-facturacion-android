import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { prepareVersatCatalogCsv } from './versat-catalog-file';
import { compareCatalogCsv } from '../../../api-server/src/services/versat-catalog-check';

function workbookFile(name: string, headers: string[], values: Array<string | number>) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Catálogo');
  worksheet.addRow(headers);
  worksheet.addRow(values);
  return workbook.xlsx.writeBuffer().then((buffer) => ({
    name,
    size: buffer.byteLength,
    arrayBuffer: async () => buffer.slice(0),
  }));
}

test('maps recent Versat workbook layouts into the comparison format', async () => {
  const files = await Promise.all([
    workbookFile('services.xlsx', ['idservicio', 'codigo', 'Descripcion', 'idMedida'], [12, '6201.1.01.01', 'Servicio, con coma', 2]),
    workbookFile('units.xlsx', ['idmedida', 'clave', 'descripcion'], [2, 'Horas', 'Horas']),
    workbookFile('currency.xlsx', ['idmoneda', 'nombre', 'sigla'], [1, 'CUBAN PESO', 'CUP']),
    workbookFile('concept.xlsx', ['idconcepto', 'codigo', 'descripcion'], [3, '003', 'Personas naturales']),
    workbookFile('operation.xlsx', ['idoperacion', 'descripcion'], [2, 'Servicios']),
    workbookFile('commercial.xlsx', ['idcomercial', 'ci', 'nombre', 'cargo'], [8, 'omitted', 'Nombre de prueba', 'Gestor']),
    workbookFile('payment.xlsx', ['idformapago', 'Forma', 'idtipo'], [1, 'Transferencias', 4]),
  ]);

  const result = await prepareVersatCatalogCsv(files);
  assert.equal(result.rowCount, 7);
  assert.deepEqual(result.excludedEntityFiles, []);
  assert.deepEqual(result.filenames, files.map(({ name }) => name));
  assert.equal(result.csv.split('\r\n').length, 8);
  assert.match(result.csv, /"service","12","6201\.1\.01\.01","6201\.1\.01\.01"/);
  assert.match(result.csv, /"currency","1","CUP","CUBAN PESO"/);
  assert.match(result.csv, /"operation","2","2","Servicios"/);
  assert.match(result.csv, /"payment","1","1","Transferencias"/);
  assert.ok(!result.csv.includes('omitted'));
  assert.ok(result.csv.includes('"service","12","6201.1.01.01","6201.1.01.01"'));

  const active = [
    { kind: 'service' as const, sourceId: 12, code: '6201.1.01.01', exportValue: '6201.1.01.01' },
    { kind: 'unit' as const, sourceId: 2, code: 'Horas', exportValue: 'Horas' },
    { kind: 'currency' as const, sourceId: 1, code: 'CUP', exportValue: 'CUBAN PESO' },
    { kind: 'concept' as const, sourceId: 3, code: '003', exportValue: '003' },
    { kind: 'operation' as const, sourceId: 2, code: '2', exportValue: 'Servicios' },
    { kind: 'commercial' as const, sourceId: 8, code: '8', exportValue: 'Nombre de prueba' },
    { kind: 'payment' as const, sourceId: 1, code: '1', exportValue: 'Transferencias' },
  ];
  assert.equal(compareCatalogCsv(result.csv, active).compatible, true);
  const changedActive = active.map((entry) =>
    entry.kind === 'service' ? { ...entry, exportValue: '6201.1.01.02' } : entry);
  assert.ok(compareCatalogCsv(result.csv, changedActive).differences.some(({ type }) => type === 'export_value_mismatch'));
});

test('keeps support for a standard CSV/TSV without requiring a conversion', async () => {
  const input = new TextEncoder().encode('kind,sourceId,code,exportValue\nservice,1,A,A');
  const result = await prepareVersatCatalogCsv([{
    name: 'catalog.csv',
    size: input.byteLength,
    arrayBuffer: async () => input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength),
  }]);
  assert.equal(result.csv, 'kind,sourceId,code,exportValue\nservice,1,A,A');
});

test('decodes legacy Windows-1252 delimited exports automatically', async () => {
  const input = new Uint8Array([
    ...new TextEncoder().encode('kind,sourceId,code,exportValue\nservice,1,A,Caf'),
    0xe9,
  ]);
  const result = await prepareVersatCatalogCsv([{
    name: 'catalog.csv',
    size: input.byteLength,
    arrayBuffer: async () => input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength),
  }]);
  assert.equal(result.csv, 'kind,sourceId,code,exportValue\nservice,1,A,Café');
});

test('skips entity workbooks when selected with catalog exports and explains when only entities are selected', async () => {
  const entity = await workbookFile('gen_entidad.xlsx', ['identidad', 'codigo', 'nombre', 'activo'], [1, '001', 'Cliente', 1]);
  const workbook = await workbookFile('concept.xlsx', ['idconcepto', 'codigo', 'descripcion'], [1, '001', 'Concepto']);
  const result = await prepareVersatCatalogCsv([entity, workbook]);
  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.excludedEntityFiles, ['gen_entidad.xlsx']);
  await assert.rejects(() => prepareVersatCatalogCsv([entity]), /entidades\/clientes no se comparan/);
  await assert.rejects(
    () => prepareVersatCatalogCsv([entity, { name: 'catalog.csv', size: 1, arrayBuffer: async () => new ArrayBuffer(1) }]),
    /no mezcles ambos formatos/,
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountInWords } from './invoice-print';

test('total del PDF de referencia y centavos', () => {
  assert.equal(amountInWords(36120), 'TREINTA Y SEIS MIL CIENTO VEINTE CON 00/100');
  assert.equal(amountInWords(5906.25), 'CINCO MIL NOVECIENTOS SEIS CON 25/100');
  assert.equal(amountInWords(0), 'CERO CON 00/100');
});
test('apócopes, millones y límites del importe', () => {
  assert.equal(amountInWords(21000.01), 'VEINTIÚN MIL CON 01/100');
  assert.equal(amountInWords(100), 'CIEN CON 00/100');
  assert.equal(amountInWords(1_000_001), 'UN MILLÓN UNO CON 00/100');
  assert.equal(amountInWords(2_000_000), 'DOS MILLONES CON 00/100');
  assert.throws(() => amountInWords(NaN));
  assert.throws(() => amountInWords(-1));
});

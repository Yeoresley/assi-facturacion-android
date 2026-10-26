import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const component = readFileSync(new URL('./invoice-payment.tsx', import.meta.url), 'utf8');
const paymentRows = component.match(/visiblePayments\.map\(\(payment\) => \{([\s\S]*?)\n        \}\)\}/)?.[1] ?? '';

test('muestra la referencia del abono dentro de su propia fila', () => {
  assert.match(paymentRows, /data-testid=\{`row-invoice-payment-\$\{payment\.id\}`\}/);
  assert.match(paymentRows, /\{payment\.reference && <div[^>]*>Referencia · \{payment\.reference\}<\/div>\}/);
});

test('omite la etiqueta de referencia cuando el abono histórico no tiene referencia', () => {
  assert.match(paymentRows, /\{payment\.reference && <div[^>]*>Referencia · \{payment\.reference\}<\/div>\}/);
  assert.doesNotMatch(paymentRows, /Referencia ·\s*<\/div>/);
});

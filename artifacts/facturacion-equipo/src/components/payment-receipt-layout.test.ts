import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const component = readFileSync(new URL('./payment-receipt.tsx', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('./invoice-document.css', import.meta.url), 'utf8');
const sharedPage = readFileSync(new URL('../pages/shared-invoice.tsx', import.meta.url), 'utf8');

test('la referencia larga del recibo ocupa el ancho disponible y se parte sin desbordarse', () => {
  assert.match(component, /payment-receipt-customer payment-receipt-reference/);
  assert.match(stylesheet, /\.payment-receipt-reference\s*>\s*div\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(stylesheet, /\.payment-receipt-customer\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(stylesheet, /\.payment-receipt-customer strong\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/);
});

test('el enlace compartido imprime el mismo recibo con sus estilos de impresión', () => {
  assert.match(sharedPage, /<PaymentReceiptPaper receipt=\{receiptQuery\.data!\} \/>/);
  assert.match(sharedPage, /printInvoice\(\{ documentType: 'receipt' \}\)/);
  assert.match(stylesheet, /\.printing-payment-receipt\s+\.payment-receipt-paper\s*\{\s*break-inside:\s*avoid;\s*page-break-inside:\s*avoid;/);
});

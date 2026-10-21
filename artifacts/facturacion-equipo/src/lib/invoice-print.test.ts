import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountInWords, printInvoice } from './invoice-print';

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

test('la impresión del comprobante activa y limpia su modo aislado', async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const classes = new Set<string>();
  let afterPrint: (() => void) | undefined;
  let printCalled = false;

  const fakeDocument = {
    fonts: { ready: Promise.resolve() },
    querySelector: (selector: string) => selector === '.receipt-print-page .payment-receipt-paper' ? {} : null,
    body: { classList: { add: (value: string) => classes.add(value), remove: (value: string) => classes.delete(value) } },
  };
  const fakeWindow = {
    addEventListener: (event: string, listener: EventListenerOrEventListenerObject) => {
      if (event === 'afterprint' && typeof listener === 'function') afterPrint = listener as () => void;
    },
    print: () => {
      printCalled = true;
      assert.equal(classes.has('printing-payment-receipt'), true);
    },
  };

  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument as unknown as Document });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow as unknown as Window & typeof globalThis });
  try {
    await printInvoice({ documentType: 'receipt' });
    assert.equal(printCalled, true);
    assert.equal(classes.has('printing-payment-receipt'), true);
    afterPrint?.();
    assert.equal(classes.has('printing-payment-receipt'), false);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

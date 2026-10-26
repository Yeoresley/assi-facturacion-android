import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Invoice } from '@workspace/api-client-react';
import { getPaymentReceiptInfo, getPaymentReceiptInfos } from './payment-receipt-data';

const invoice = {
  total: 100,
  payments: [
    { id: 3, amount: 20, currency: 'CUP', paidOn: '2026-10-03', recordedAt: '2026-10-03T12:00:00.000Z', reference: 'TRANSFER-145', paymentMethod: 'transfer' },
    { id: 1, amount: 40, currency: 'CUP', paidOn: '2026-10-01', recordedAt: '2026-10-01T12:00:00.000Z', reference: null, paymentMethod: null },
    { id: 2, amount: 30, currency: 'CUP', paidOn: '2026-10-02', recordedAt: '2026-10-02T12:00:00.000Z', reference: null, paymentMethod: null },
  ],
  paymentCorrections: [
    { reversedPaymentId: 2 },
    { targetPaymentId: 1, beforePaymentAmount: 40, afterPaymentAmount: 25, beforePaidOn: '2026-10-01', afterPaidOn: '2026-09-30', beforePaymentMethod: 'cash', afterPaymentMethod: 'transfer' },
  ],
} as Invoice;

test('el comprobante refleja la corrección vigente y omite abonos reversados', () => {
  const originalReceipt = getPaymentReceiptInfo(invoice, 1);
  const transferReceipt = getPaymentReceiptInfo(invoice, 3);
  assert.equal(originalReceipt?.remainingBalance, 75);
  assert.equal(originalReceipt?.amount, 25);
  assert.equal(originalReceipt?.paidOn, '2026-09-30');
  assert.equal(originalReceipt?.corrected, true);
  assert.equal(transferReceipt?.remainingBalance, 55);
  assert.equal(transferReceipt?.reference, 'TRANSFER-145');
  assert.equal(transferReceipt?.paymentMethod, 'transfer');
  assert.equal(originalReceipt?.reference, null);
  assert.equal(originalReceipt?.paymentMethod, 'transfer');
  assert.equal(getPaymentReceiptInfo(invoice, 2), null);
});

test('la selección múltiple conserva el orden elegido y omite comprobantes no vigentes', () => {
  const selectedReceipts = getPaymentReceiptInfos(invoice, [3, 2, 1]);
  assert.deepEqual(selectedReceipts.map(({ paymentId }) => paymentId), [3, 1]);
  assert.equal(selectedReceipts[1]?.receipt.amount, 25);
  assert.equal(selectedReceipts[1]?.receipt.corrected, true);
});

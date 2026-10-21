import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Invoice } from '@workspace/api-client-react';
import { getPaymentReceiptInfo } from './payment-receipt-data';

const invoice = {
  total: 100,
  payments: [
    { id: 3, amount: 20, currency: 'CUP', paidOn: '2026-10-03', recordedAt: '2026-10-03T12:00:00.000Z', reference: 'TRANSFER-145', paymentMethod: 'transfer' },
    { id: 1, amount: 40, currency: 'CUP', paidOn: '2026-10-01', recordedAt: '2026-10-01T12:00:00.000Z', reference: null, paymentMethod: null },
    { id: 2, amount: 30, currency: 'CUP', paidOn: '2026-10-02', recordedAt: '2026-10-02T12:00:00.000Z', reference: null, paymentMethod: null },
  ],
  paymentCorrections: [
    { reversedPaymentId: 2 },
    { targetPaymentId: 1, beforePaymentAmount: 40, afterPaymentAmount: 25, beforePaidOn: '2026-10-01', afterPaidOn: '2026-09-30' },
  ],
} as Invoice;

test('mantiene los datos del recibo original tras una corrección y omite abonos reversados', () => {
  const originalReceipt = getPaymentReceiptInfo(invoice, 1);
  const transferReceipt = getPaymentReceiptInfo(invoice, 3);
  assert.equal(originalReceipt?.remainingBalance, 60);
  assert.equal(originalReceipt?.amount, 40);
  assert.equal(originalReceipt?.paidOn, '2026-10-01');
  assert.equal(transferReceipt?.remainingBalance, 40);
  assert.equal(transferReceipt?.reference, 'TRANSFER-145');
  assert.equal(transferReceipt?.paymentMethod, 'transfer');
  assert.equal(originalReceipt?.reference, null);
  assert.equal(originalReceipt?.paymentMethod, null);
  assert.equal(getPaymentReceiptInfo(invoice, 2), null);
});

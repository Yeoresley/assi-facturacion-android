import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Invoice } from '@workspace/api-client-react';
import { getPaymentReceiptInfo } from './payment-receipt-data';

const invoice = {
  total: 100,
  payments: [
    { id: 3, amount: 20, currency: 'CUP', paidOn: '2026-10-03', recordedAt: '2026-10-03T12:00:00.000Z' },
    { id: 1, amount: 40, currency: 'CUP', paidOn: '2026-10-01', recordedAt: '2026-10-01T12:00:00.000Z' },
    { id: 2, amount: 30, currency: 'CUP', paidOn: '2026-10-02', recordedAt: '2026-10-02T12:00:00.000Z' },
  ],
  paymentCorrections: [
    { reversedPaymentId: 2 },
    { targetPaymentId: 1, beforePaymentAmount: 40, afterPaymentAmount: 25, beforePaidOn: '2026-10-01', afterPaidOn: '2026-09-30' },
  ],
} as Invoice;

test('mantiene los datos del recibo original tras una corrección y omite abonos reversados', () => {
  assert.equal(getPaymentReceiptInfo(invoice, 1)?.remainingBalance, 60);
  assert.equal(getPaymentReceiptInfo(invoice, 1)?.payment.amount, 40);
  assert.equal(getPaymentReceiptInfo(invoice, 1)?.payment.paidOn, '2026-10-01');
  assert.equal(getPaymentReceiptInfo(invoice, 3)?.remainingBalance, 40);
  assert.equal(getPaymentReceiptInfo(invoice, 2), null);
});

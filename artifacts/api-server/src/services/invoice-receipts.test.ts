import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizePayments } from './invoice-payment';
import { activeInvoicePayments } from './invoice-receipts';

test('public receipt data excludes reversed payment rows', () => {
  const active = { id: 11, amount: 25, paidBy: 'private-user-a' };
  const reversed = { id: 12, amount: 10, paidBy: 'private-user-b' };
  assert.deepEqual(activeInvoicePayments([active, reversed], [{ reversedPaymentId: 12 }]), [active]);
});

test('payment serialization never includes the private payer identifier', () => {
  const payment = {
    id: 11, amount: 25, currency: 'CUP', paidOn: '2026-10-20',
    recordedAt: new Date('2026-10-20T12:00:00.000Z'), reference: null, paymentMethod: null, paidBy: 'private-user-id',
  };
  const summary = summarizePayments(
    { id: 1, status: 'sent', paymentStatus: 'pending', total: 100 },
    [payment],
  );
  assert.deepEqual(summary.payments, [{
    id: 11, amount: 25, currency: 'CUP', paidOn: '2026-10-20',
     recordedAt: '2026-10-20T12:00:00.000Z', reference: null, paymentMethod: null,
  }]);
});

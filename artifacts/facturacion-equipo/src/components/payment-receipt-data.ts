import type { Invoice } from '@workspace/api-client-react';

type ReceiptSource = Pick<Invoice, 'payments' | 'paymentCorrections' | 'total'>;

export function getPaymentReceiptInfo(invoice: ReceiptSource, paymentId: number) {
  const reversedIds = new Set((invoice.paymentCorrections ?? []).flatMap((entry) =>
    entry.reversedPaymentId == null ? [] : [entry.reversedPaymentId]));
  const payments = [...invoice.payments]
    .filter((payment) => !reversedIds.has(payment.id))
    .sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.id - b.id);
  const index = payments.findIndex((payment) => payment.id === paymentId);
  if (index < 0) return null;
  const paidThroughCents = payments.slice(0, index + 1)
    .reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0);
  const remainingCents = Math.max(0, Math.round(invoice.total * 100) - paidThroughCents);
  return { payment: payments[index], remainingBalance: remainingCents / 100 };
}

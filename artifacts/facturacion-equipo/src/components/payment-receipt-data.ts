import type { Invoice, SharedInvoiceReceipt } from '@workspace/api-client-react';

type ReceiptSource = Pick<Invoice, 'payments' | 'paymentCorrections' | 'total' | 'currency' | 'number' | 'customerName' | 'versat'>;

export function getPaymentReceiptInfo(invoice: ReceiptSource, paymentId: number): SharedInvoiceReceipt | null {
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
  const payment = payments[index];
  return {
    invoiceNumber: invoice.versat?.number || invoice.number,
    customerName: invoice.versat?.customerName || invoice.customerName,
    currency: invoice.currency,
    amount: payment.amount,
    paidOn: payment.paidOn,
    paymentCurrency: payment.currency,
    reference: payment.reference,
    remainingBalance: remainingCents / 100,
  };
}

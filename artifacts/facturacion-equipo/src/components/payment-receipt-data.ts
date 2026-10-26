import type { Invoice, SharedInvoiceReceipt } from '@workspace/api-client-react';

type ReceiptSource = Pick<Invoice, 'payments' | 'paymentCorrections' | 'total' | 'currency' | 'number' | 'customerName' | 'versat'>;

export function getPaymentReceiptInfo(invoice: ReceiptSource, paymentId: number): SharedInvoiceReceipt | null {
  const corrections = invoice.paymentCorrections ?? [];
  const reversedIds = new Set(corrections.flatMap((entry) =>
    entry.reversedPaymentId == null ? [] : [entry.reversedPaymentId]));
  const payments = invoice.payments.map((payment) => {
    const targetCorrections = corrections
      .filter((entry) => entry.targetPaymentId === payment.id)
      .sort((a, b) => a.id - b.id);
    const latestValue = <K extends 'afterPaymentAmount' | 'afterPaidOn' | 'afterPaymentMethod'>(field: K) =>
      [...targetCorrections].reverse().find((entry) => entry[field] != null)?.[field];
    return {
      ...payment,
      amount: latestValue('afterPaymentAmount') ?? payment.amount,
      paidOn: latestValue('afterPaidOn') ?? payment.paidOn,
      paymentMethod: latestValue('afterPaymentMethod') ?? payment.paymentMethod,
    };
  }).filter((payment) => !reversedIds.has(payment.id))
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
    paymentMethod: payment.paymentMethod,
    remainingBalance: remainingCents / 100,
    corrected: corrections.some((entry) => entry.targetPaymentId === payment.id),
  };
}

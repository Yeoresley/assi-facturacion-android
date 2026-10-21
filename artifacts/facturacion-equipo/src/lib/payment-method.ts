import type { InvoicePayment } from '@workspace/api-client-react';

export type PaymentMethod = NonNullable<InvoicePayment['paymentMethod']>;

const labels: Record<PaymentMethod, string> = {
  transfer: 'Transferencia',
  cash: 'Efectivo',
  other: 'Otro medio',
};

export function paymentMethodLabel(method: PaymentMethod): string {
  return labels[method];
}

type PaymentWithId = { id: number };
type Reversal = { reversedPaymentId: number | null };

export function activeInvoicePayments<T extends PaymentWithId>(
  payments: T[],
  corrections: Reversal[],
): T[] {
  const reversedIds = new Set(corrections.flatMap(({ reversedPaymentId }) =>
    reversedPaymentId === null ? [] : [reversedPaymentId]));
  return payments.filter(({ id }) => !reversedIds.has(id));
}

import Decimal from "decimal.js";
import { collectibleStatuses } from "./invoice-payment";

export function outstandingByCurrency(
  invoices: Array<{ currency: string; status: string; balanceDue: number }>,
) {
  const totals = new Map<string, Decimal>();
  for (const invoice of invoices) {
    if (!(collectibleStatuses as readonly string[]).includes(invoice.status) || invoice.balanceDue <= 0) continue;
    const balance = new Decimal(invoice.balanceDue.toFixed(2));
    totals.set(invoice.currency, (totals.get(invoice.currency) ?? new Decimal(0)).plus(balance));
  }

  return [...totals.entries()]
    .sort(([currencyA], [currencyB]) => currencyA.localeCompare(currencyB))
    .map(([currency, amount]) => ({ currency, amount: amount.toDecimalPlaces(2).toNumber() }));
}

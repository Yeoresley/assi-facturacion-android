import type { Invoice } from '@workspace/api-client-react';
import { date, money } from '@/lib/shared';
import { getPaymentReceiptInfo } from './payment-receipt-data';
import './invoice-document.css';

export function PaymentReceiptPaper({ invoice, paymentId }: { invoice: Invoice; paymentId: number }) {
  const receipt = getPaymentReceiptInfo(invoice, paymentId);
  if (!receipt) return null;
  const invoiceNumber = invoice.versat?.number || invoice.number;
  const customerName = invoice.versat?.customerName || invoice.customerName;

  return <article className="payment-receipt-paper" data-testid="payment-receipt">
    <header className="payment-receipt-heading">
      <div><div className="payment-receipt-brand">Cuenta Clara desk</div><p>Comprobante de cobro</p></div>
      <div className="payment-receipt-title"><p>Factura {invoiceNumber}</p><h1>COMPROBANTE<br />DE ABONO</h1></div>
    </header>
    <section className="payment-receipt-customer">
      <div><span>Cliente</span><strong>{customerName}</strong></div>
      <div><span>Fecha de pago</span><strong>{date(receipt.payment.paidOn)}</strong></div>
    </section>
    {receipt.payment.reference && <section className="payment-receipt-customer">
      <div><span>Referencia del cobro</span><strong>{receipt.payment.reference}</strong></div>
    </section>}
    <section className="payment-receipt-amount">
      <span>Importe recibido</span>
      <strong>{money(receipt.payment.amount, receipt.payment.currency || invoice.currency)}</strong>
    </section>
    <section className="payment-receipt-balance">
      <span>Saldo restante después de este abono</span>
      <strong>{money(receipt.remainingBalance, invoice.currency)}</strong>
    </section>
    <p className="payment-receipt-note">Comprobante del abono indicado para la factura {invoiceNumber}. Este documento no sustituye ni modifica la factura.</p>
  </article>;
}

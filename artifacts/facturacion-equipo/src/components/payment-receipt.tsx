import type { SharedInvoiceReceipt } from '@workspace/api-client-react';
import { date, money } from '@/lib/shared';
import { paymentMethodLabel } from '@/lib/payment-method';
import './invoice-document.css';

export function PaymentReceiptPaper({ receipt }: { receipt: SharedInvoiceReceipt }) {
  return <article className="payment-receipt-paper" data-testid="payment-receipt">
    <header className="payment-receipt-heading">
      <div>
        <div className="payment-receipt-brand">
          <img src={`${import.meta.env.BASE_URL}brand/assi-mark.png`} alt="" aria-hidden="true" />
          <span><strong>ASSI</strong><small>Tu visión. Nuestro futuro.</small></span>
        </div>
        <p>Comprobante de cobro</p>
      </div>
      <div className="payment-receipt-title"><p>Factura {receipt.invoiceNumber}</p><h1>COMPROBANTE<br />DE ABONO</h1></div>
    </header>
    <section className="payment-receipt-customer">
      <div><span>Cliente</span><strong>{receipt.customerName}</strong></div>
      <div><span>Fecha de pago</span><strong>{date(receipt.paidOn)}</strong></div>
    </section>
    {receipt.paymentMethod && <section className="payment-receipt-customer">
      <div><span>Medio de pago</span><strong>{paymentMethodLabel(receipt.paymentMethod)}</strong></div>
    </section>}
    {receipt.reference && <section className="payment-receipt-customer">
      <div><span>Referencia del cobro</span><strong>{receipt.reference}</strong></div>
    </section>}
    <section className="payment-receipt-amount">
      <span>Importe recibido</span>
      <strong>{money(receipt.amount, receipt.paymentCurrency || receipt.currency)}</strong>
    </section>
    <section className="payment-receipt-balance">
      <span>Saldo restante después de este abono</span>
      <strong>{money(receipt.remainingBalance, receipt.currency)}</strong>
    </section>
    <p className="payment-receipt-note">Comprobante del abono indicado para la factura {receipt.invoiceNumber}. Este documento no sustituye ni modifica la factura.</p>
  </article>;
}

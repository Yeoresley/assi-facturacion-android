import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getInvoiceImage, getSharedInvoiceImage, type Invoice } from '@workspace/api-client-react';
import { date } from '@/lib/shared';
import { amountInWords } from '@/lib/invoice-print';
import './invoice-document.css';

function AuthorizedImage({ invoiceId, token, kind }: { invoiceId: number; token?: string; kind: 'stamp' | 'signature' }) {
  const query = useQuery({
    queryKey: ['authorized-image', invoiceId, token, kind],
    queryFn: () => token ? getSharedInvoiceImage(token, kind) : getInvoiceImage(invoiceId, kind),
    staleTime: 0, retry: false,
  });
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!query.data) return;
    const objectUrl = URL.createObjectURL(query.data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [query.data]);
  if (!url || query.isError) return <div data-image-pending={!query.isError || undefined} data-image-error={query.isError || undefined} className="legal-image-error" role={query.isError ? 'alert' : 'status'}>
    {query.isError ? 'No se pudo cargar la imagen autorizada.' : 'Cargando imagen autorizada…'}
    {query.isError && <button className="no-print" onClick={() => query.refetch()}>Reintentar</button>}
  </div>;
  return <img data-authorized-image src={url} className={`legal-${kind}`} alt={kind === 'stamp' ? 'Cuño escaneado autorizado' : 'Firma manuscrita escaneada autorizada de quien contabiliza'} />;
}

const blank = (value?: string | null) => value || '____________________';

export function InvoiceDocument({ invoice: inv, shareToken }: { invoice: Invoice; shareToken?: string }) {
  const v = inv.versat;
  const legal = inv.legalDocument;
  const issuer = legal?.issuer;
  const issued = ['finished', 'accepted', 'confirmed', 'sent', 'paid'].includes(inv.status);
  const dead = inv.status === 'cancelled' || inv.status === 'voided' || inv.status === 'error';
  const deadMark = inv.status === 'voided' ? 'ANULADA' : inv.status === 'cancelled' ? 'CANCELADA' : 'CON ERROR · NO VÁLIDA';
  const issueDate = date(inv.issueDate);
  const accountedDate = inv.confirmedAt
    ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Havana' }).format(new Date(inv.confirmedAt))
    : issueDate;
  return <article className="invoice-paper legal-invoice" data-testid="invoice-document">
    <header className="legal-header-cell">
      {(!legal || !issued || dead) && <div className="legal-watermark" style={dead ? { color: '#b3402f', borderColor: '#b3402f', opacity: .55 } : undefined}>{dead ? deadMark : inv.status === 'draft' ? 'BORRADOR · NO EMITIDA' : 'DOCUMENTO PRELIMINAR · EMISOR SIN CONFIRMAR'}</div>}
      <div className="legal-heading">
        <div className="legal-issuer-details">
          <div className="legal-brand" aria-label="ASSI · Tu visión. Nuestro futuro.">
            <img src={`${import.meta.env.BASE_URL}brand/assi-mark.png`} alt="" aria-hidden="true" />
            <span><strong>ASSI</strong><small>Tu visión. Nuestro futuro.</small></span>
          </div>
          <strong className="legal-company">{issuer?.name || 'Emisor pendiente de configurar'}</strong>
          <p>Organismo: {blank(issuer?.organization)}</p><p>IRCC: {blank(issuer?.ircc)}</p><p>Dirección: {blank(issuer?.address)}</p>
        </div>
        <div className="legal-invoice-title"><p>Fecha emisión: {date(inv.issueDate)}</p><h1>FACTURA</h1><p>Número: <strong>{v?.number || inv.number}</strong></p><p>NIT: {blank(issuer?.nit)}</p><p>Contrato: {blank(v?.contract)}</p></div>
      </div>
      <h2>Ventas en {inv.currency}</h2>
      <div className="legal-customer"><p>Código: {blank(v?.customerCode)} · Cliente: <strong>{v?.customerName || inv.customerName}</strong></p>
        <p>Dirección: {blank(v?.customerAddress)}</p><p>NIT: {blank(v?.customerTaxId)} · Número Ins. RCC: {blank(legal?.customerIrcc)}</p>
        <p>Cuenta bancaria: {blank(legal?.customerBankAccount)}</p>
        <div className="legal-pair"><p>Forma de pago: {blank(v?.paymentName)}</p><p>Operación: {blank(v?.operationName)}</p></div>
        {inv.dueDate && <p>Vencimiento: {date(inv.dueDate)}</p>}
      </div>
    </header>
    <table className="legal-lines">
      <colgroup><col style={{ width: '21%' }} /><col style={{ width: '31%' }} /><col style={{ width: '8%' }} /><col style={{ width: '12%' }} /><col style={{ width: '15%' }} /><col style={{ width: '13%' }} /></colgroup>
      <thead>
        <tr className="legal-running-header"><td colSpan={6}><strong>{issuer?.name || 'Emisor pendiente'}</strong> · NIT {blank(issuer?.nit)} · Factura {v?.number || inv.number} · {date(inv.issueDate)}</td></tr>
        <tr className="legal-column-head"><th>Código</th><th>Descripción del servicio</th><th>UM</th><th className="numeric">Cantidad</th><th className="numeric">Precio</th><th className="numeric">Importe</th></tr>
      </thead>
      <tbody>{inv.lines.map(line => <tr key={line.id}>
        <td>{line.serviceCode || '—'}</td><td className="legal-description">{line.description}</td><td>{line.unitCode || '—'}</td>
        <td className="numeric">{line.quantity.toFixed(4)}</td><td className="numeric">{line.unitPrice.toFixed(5)}</td><td className="numeric">{line.amount.toFixed(2)}</td>
      </tr>)}</tbody>
    </table>
    <section className="legal-totals" aria-label="Totales">
      <div><span>Subtotal servicios</span><strong>{inv.subtotal.toFixed(2)}</strong></div>
      <div><span>Subtotal</span><span>{inv.subtotal.toFixed(2)}</span></div>
      <div><span>Rec./Desc.</span><span>0.00</span></div>
      <div className="legal-total"><strong>Total Factura {inv.currency}</strong><strong>{inv.total.toFixed(2)}</strong></div>
    </section>
    {inv.notes && <section className="legal-notes"><strong>Comentario:</strong><p>{inv.notes}</p></section>}
    <section className="legal-closing">
      <p className="legal-reference">Factura {v?.number || inv.number} · {date(inv.issueDate)}</p>
      <p className="legal-words">Total en {inv.currency}: {amountInWords(inv.total)}</p>
      <p className="legal-payment"><strong>Páguese {inv.currency} a {blank(issuer?.paymentBeneficiary)}. Cuenta: {blank(issuer?.bankAccount)}. Sucursal: {blank(issuer?.bankBranch)} del {blank(issuer?.bankName)}.</strong></p>
      <div className="legal-responsibilities">
        <div><strong>Realizada por:</strong><p>{blank(legal?.preparedBy)}</p><p>{blank(legal?.preparedPosition)}</p><p>Firma: __________</p><p>Fecha: {issueDate}</p></div>
        <div><strong>Transportado por:</strong><p>{blank(legal?.transportedBy)}</p><p>CH: {blank(legal?.vehiclePlate)}</p><p>Lic.: {blank(legal?.drivingLicense)}</p><p>CI: {blank(legal?.transportId)}</p><p>Firma: __________ Fecha: ________</p></div>
        <div><strong>Contabilizada por:</strong><p>{blank(legal?.accountedBy)}</p>
          {issued && legal?.signaturePath ? <AuthorizedImage invoiceId={inv.id} token={shareToken} kind="signature" /> : <p>Firma: ________________</p>}<p>Fecha: {accountedDate}</p>
        </div>
        <div><strong>Recibido por:</strong><p>Nombre: {blank(legal?.receivedBy)}</p><p>Cargo: {blank(legal?.receivedPosition)}</p><p>CI: {blank(legal?.receivedId)}</p><p>Firma: __________ Fecha: ________</p></div>
        <div><strong>Entregada por:</strong><p>{blank(legal?.deliveredBy)}</p><p>Firma: __________</p><p>Fecha: {issueDate}</p></div>
        <div className="legal-stamp-placeholder" aria-label={issued && legal?.stampPath ? 'Cuño ASSI autorizado' : 'Cuño ASSI'}>
          <strong>Cuño ASSI</strong>
          {issued && legal?.stampPath ? <AuthorizedImage invoiceId={inv.id} token={shareToken} kind="stamp" /> : <span>Se incorpora al emitir</span>}
        </div>
      </div>
      {issued && (legal?.signaturePath || legal?.stampPath) && <p className="legal-scan-notice">Cuño y/o firma manuscrita escaneados, reproducidos con autorización. No constituyen firma digital criptográfica.</p>}
    </section>
  </article>;
}

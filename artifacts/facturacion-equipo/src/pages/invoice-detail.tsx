import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBillingOverviewQueryKey, getGetCurrentTeamMemberQueryKey, getGetInvoiceQueryKey,
  getListInvoicesQueryKey, getExportVersatInvoicesQueryKey, getListInvoiceSeriesQueryKey,
  useCreateInvoiceShare, useDownloadInvoiceVersatFile, useGetCurrentTeamMember, useGetInvoice, useUpdateInvoiceStatus,
  getListInvoiceSharesQueryKey, useListInvoiceShares,
} from '@workspace/api-client-react';
import type { InvoiceStatusInputStatus } from '@workspace/api-client-react';
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, Clipboard, Mail, Pencil, Printer } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { QueryError, Status, TestFileNotice, date, downloadBase64File, errorDetail, money } from '@/lib/shared';
import { InvoiceDocument } from '@/components/invoice-document';
import { DocumentAuthorizationForm } from '@/components/document-authorization';
import { printInvoice } from '@/lib/invoice-print';
import { CorrectPaidButton, InvoicePaymentHistory, MarkPaidButton, PaymentBadge } from '@/components/invoice-payment';
import { InvoiceShareList } from '@/components/invoice-share-list';
import { PaymentReceiptPaper } from '@/components/payment-receipt';
import { getPaymentReceiptInfo } from '@/components/payment-receipt-data';

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const valid = Number.isFinite(id) && id > 0;
  const invoice = useGetInvoice(id, { query: { queryKey: getGetInvoiceQueryKey(id), enabled: valid, refetchInterval: 15000 } });
  const member = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false, refetchInterval: 30000 } });
  const file = useDownloadInvoiceVersatFile();
  const updateStatus = useUpdateInvoiceStatus();
  const createShare = useCreateInvoiceShare();
  const shares = useListInvoiceShares(id, { query: { queryKey: getListInvoiceSharesQueryKey(id), enabled: valid, staleTime: 0, refetchInterval: 15000, retry: false } });
  const client = useQueryClient();
  const [share, setShare] = useState<{ id: number; url: string; expiresAt: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState<null | { status: InvoiceStatusInputStatus; title: string; body: string; danger?: boolean }>(null);
  const [fileError, setFileError] = useState('');
  const [fileInfo, setFileInfo] = useState<string[]>([]);
  const [receiptShare, setReceiptShare] = useState<{ paymentId: number; url: string; expiresAt: string } | null>(null);

  function changeStatus(status: InvoiceStatusInputStatus) {
    setActionError('');
    setNotice('');
    updateStatus.mutate({ id, data: { status } }, {
      onSuccess: async (updated) => {
        await client.cancelQueries({ queryKey: getGetInvoiceQueryKey(id) });
        client.setQueryData(getGetInvoiceQueryKey(id), updated);
        client.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
        client.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        client.invalidateQueries({ queryKey: getGetBillingOverviewQueryKey() });
        client.invalidateQueries({ queryKey: getListInvoiceSeriesQueryKey() });
        client.invalidateQueries({ queryKey: getExportVersatInvoicesQueryKey() });
        setNotice(updated.versat?.number ? `Estado actualizado. Número de Versat: ${updated.versat.number} · Talón: ${updated.versat.talon}.` : 'Estado actualizado.');
      },
      onError: (err) => setActionError(`No se pudo completar la acción. ${errorDetail(err, 'Revisa los datos requeridos y vuelve a intentarlo.')}`),
    });
  }
  function makeShare() {
    createShare.mutate({ id }, { onSuccess: (value) => { setShare(value); client.invalidateQueries({ queryKey: getListInvoiceSharesQueryKey(id) }); setNotice(`Enlace #${value.id} listo para compartir.`); }, onError: () => setNotice('No se pudo crear el enlace público.') });
  }
  function makeReceiptShare(paymentId: number) {
    createShare.mutate({ id }, { onSuccess: (value) => {
      const url = new URL(value.url, window.location.origin);
      url.searchParams.set('receipt', String(paymentId));
      setReceiptShare({ paymentId, url: url.toString(), expiresAt: value.expiresAt });
      client.invalidateQueries({ queryKey: getListInvoiceSharesQueryKey(id) });
      setNotice('Enlace del comprobante listo para compartir. No se ha enviado ningún mensaje.');
    }, onError: () => setNotice('No se pudo crear el enlace del comprobante.') });
  }
  async function downloadFac() {
    setFileError('');
    setFileInfo([]);
    try {
      const result = await file.mutateAsync({ id });
      downloadBase64File(result.base64, result.filename, result.contentType);
      setFileInfo(result.warnings || []);
      setNotice(`Archivo ${result.filename} descargado; la factura quedó Aceptada.`);
      await Promise.all([
        client.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) }),
        client.invalidateQueries({ queryKey: getListInvoicesQueryKey() }),
        client.invalidateQueries({ queryKey: getExportVersatInvoicesQueryKey() }),
        client.invalidateQueries({ queryKey: getGetBillingOverviewQueryKey() }),
      ]);
    } catch (error) {
      setFileError(errorDetail(error, 'No se pudo generar el archivo.'));
    }
  }

  if (invoice.isLoading) return <div className="mx-auto max-w-[800px] space-y-4"><div className="skeleton h-6 w-32" /><div className="panel space-y-5 p-8"><div className="skeleton h-8 w-56" /><div className="skeleton h-24" /><div className="skeleton h-40" /></div></div>;
  if (invoice.isError || !invoice.data) return <QueryError retry={() => invoice.refetch()} message="No pudimos abrir esta factura." detail={errorDetail(invoice.error, '')} />;
  const inv = invoice.data;
  const receiptParam = new URLSearchParams(window.location.search).get('receipt');
  const receiptId = receiptParam && /^\d+$/.test(receiptParam) ? Number(receiptParam) : null;
  const receiptInfo = receiptId ? getPaymentReceiptInfo(inv, receiptId) : null;
  const v = inv.versat;
  const issued = ['finished', 'accepted', 'confirmed', 'sent', 'paid'].includes(inv.status);
  const isOwner = member.data?.role === 'owner';
  const isMyCommercial = member.data?.role === 'specialist' && member.data.commercialId != null && member.data.commercialId === v?.commercialId;
  const st = inv.status as string;
  type A = { status: InvoiceStatusInputStatus; label: string; title: string; body: string; danger?: boolean };
  const actions: A[] = [];
  const hasLegal = !!inv.legalDocument;
  if (st === 'draft' || (st === 'error' && !v?.number) ) {
    if (st === 'error') actions.push({ status: 'draft', label: 'Volver a edición', title: 'Volver a edición', body: 'La factura vuelve a Edición. Solo es posible porque aún no tiene número de Versat.' });
  }
  if ((st === 'draft' && (isOwner || isMyCommercial)) || (st === 'error' && !!v?.number && (isOwner || isMyCommercial))) actions.push({ status: 'finished', label: 'Terminar factura', title: 'Terminar factura', body: 'Se asignará el número definitivo y la factura dejará de poder editarse. Confirmas el modelo legal imprimible (emisor y responsables).' });
   if ((st === 'finished' || st === 'sent' || st === 'paid') && isMyCommercial) actions.push({ status: 'accepted', label: 'Marcar Aceptada', title: 'Cliente aceptó la factura', body: 'El cliente aceptó y va a pagar. Esto no significa que la factura esté pagada.' });
  if (st === 'accepted' && isOwner) actions.push({ status: 'confirmed', label: 'Confirmar importada en Versat', title: 'Confirmar importación real', body: 'Confirma solo si ya verificaste e importaste esta factura manualmente en Versat de escritorio. Confirmada es un estado final: no admite más cambios.' });
  if (['draft', 'finished', 'accepted', 'sent', 'paid', 'error'].includes(st) && (isOwner || isMyCommercial || member.data?.role === 'specialist')) {
    if (st !== 'draft') actions.push({ status: 'voided', label: 'Anular', title: 'Anular factura', body: 'Anulada es un estado final: no admite más transiciones y su número no se reutilizará.', danger: true });
    actions.push({ status: 'cancelled', label: 'Cancelar', title: 'Cancelar factura', body: 'Cancelada es un estado final: no admite más transiciones. Si tiene número reservado, no se reutilizará.', danger: true });
    if (st !== 'error') actions.push({ status: 'error', label: 'Marcar con error', title: 'Marcar con error', body: 'Se bloquea la exportación. Para recuperarla deberá terminarse y aceptarse de nuevo.', danger: true });
  }
  const terminal = ['confirmed', 'voided', 'cancelled'].includes(st);
  const canFinishHint = st === 'draft' && !hasLegal;
  const shareUrl = share?.url && !shares.isError && shares.data?.some(link => link.id === share.id && Date.parse(link.expiresAt) > Date.now()) ? new URL(share.url, window.location.origin).toString() : '';

  if (receiptParam) {
    if (!isOwner || !receiptInfo) return <div className="mx-auto max-w-[620px]"><div className="panel p-7"><Link href={`/invoices/${inv.id}`} className="button button-plain !min-h-9"><ArrowLeft size={14} />Volver a la factura</Link><h1 className="font-display mt-5 text-xl font-bold">{isOwner ? 'Comprobante no disponible' : 'Acceso no permitido'}</h1><p className="mt-2 text-sm leading-6 text-[#71817b]">{isOwner ? 'El abono no existe o fue corregido. Actualiza la factura antes de generar un comprobante.' : 'Solo el administrador puede generar comprobantes de abono.'}</p></div></div>;
    const receiptUrl = receiptShare?.paymentId === receiptId ? receiptShare.url : '';
    return <div className="receipt-print-page fade-in mx-auto max-w-[980px]">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3"><Link href={`/invoices/${inv.id}`} className="button button-plain"><ArrowLeft size={14} />Volver a la factura</Link><div className="flex flex-wrap gap-2"><button className="button button-primary" onClick={() => printInvoice({ documentType: 'receipt' }).catch(err => setNotice(err.message))}><Printer size={15} />Imprimir / Guardar PDF</button><button className="button button-soft" onClick={() => makeReceiptShare(receiptId!)} disabled={createShare.isPending}><ArrowUpRight size={15} />{createShare.isPending ? 'Creando enlace…' : 'Crear enlace para compartir'}</button></div></div>
      {notice && <p className="no-print mb-3 text-xs text-[#377668]" role="status">{notice}</p>}
      {receiptUrl && <div className="no-print panel mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="text-[12px] font-bold text-[#315b52]">Enlace temporal del comprobante</div><input className="field mt-2 !h-9 font-mono text-[11px]" readOnly value={receiptUrl} onClick={(event) => event.currentTarget.select()} /><div className="mt-1 text-[10px] text-[#818c85]">Caduca: {date(receiptShare?.expiresAt)}</div><p className="mt-1 text-[10px] text-[#818c85]">El mensaje no se envía automáticamente.</p></div><div className="flex gap-2"><button className="button button-soft !min-h-9" onClick={() => { navigator.clipboard?.writeText(receiptUrl); setNotice('Enlace del comprobante copiado.'); }}><Clipboard size={14} />Copiar</button><a className="button button-plain !min-h-9" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Comprobante del abono de la factura ${inv.number}: ${receiptUrl}`)}`}><ArrowUpRight size={14} />WhatsApp</a><a className="button button-plain !min-h-9" href={`mailto:?subject=${encodeURIComponent(`Comprobante de abono · ${inv.number}`)}&body=${encodeURIComponent(`Hola, aquí tienes el comprobante del abono de la factura ${inv.number}: ${receiptUrl}`)}`}><Mail size={14} />Correo</a></div></div>}
      <PaymentReceiptPaper invoice={inv} paymentId={receiptId!} />
    </div>;
  }

  return <div className="fade-in mx-auto max-w-[980px]">
    <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3"><Link href="/invoices" className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#71817b]"><ArrowLeft size={14} />Todas las facturas</Link><div className="flex flex-wrap gap-2">
      {inv.status === 'draft' && <Link href={`/invoices/${inv.id}/edit`} className="button button-soft" data-testid="link-edit-invoice"><Pencil size={15} />Editar borrador</Link>}
      <button className="button button-plain" onClick={() => printInvoice().catch(err => setNotice(err.message))} data-testid="button-print-invoice"><Printer size={15} />Imprimir / Guardar PDF</button>
      <button className="button button-primary" onClick={makeShare} disabled={createShare.isPending} data-testid="button-create-share"><ArrowUpRight size={15} />{createShare.isPending ? 'Creando enlace…' : 'Compartir'}</button></div></div>
     {shareUrl && <div className="no-print panel mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="text-[12px] font-bold text-[#315b52]">Enlace público creado</div><input className="field mt-2 !h-9 font-mono text-[11px]" readOnly value={shareUrl} onClick={(e) => e.currentTarget.select()} data-testid="input-share-url" /><div className="mt-1 text-[10px] text-[#818c85]">Caduca: {date(share?.expiresAt)}</div></div><div className="flex gap-2"><button className="button button-soft !min-h-9" onClick={() => { navigator.clipboard?.writeText(shareUrl); setNotice('Enlace copiado.'); }}><Clipboard size={14} />Copiar</button><a className="button button-plain !min-h-9" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Factura ${inv.number}: ${shareUrl}`)}`}><ArrowUpRight size={14} />WhatsApp</a><a className="button button-plain !min-h-9" href={`mailto:?subject=${encodeURIComponent(`Factura ${inv.number}`)}&body=${encodeURIComponent(`Hola, aquí tienes tu factura: ${shareUrl}`)}`}><Mail size={14} />Email</a></div></div>}
    <InvoiceShareList key={id} invoiceId={id} />
     {actionError && <div className="no-print mb-4 rounded-xl border border-[#efd2cc] bg-[#fbefeb] px-4 py-3 text-[12px] font-semibold leading-5 text-[#9a453a]" role="alert" data-testid="invoice-status-error">{actionError}</div>}
     {notice && <div className="no-print mb-4 rounded-xl bg-[#e6f2e9] px-4 py-3 text-[12px] font-semibold text-[#377668]" role="status">{notice}</div>}
    <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e4e1d5] bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-3"><span className="text-xs font-semibold">Pago</span><PaymentBadge invoice={inv} />{inv.paidAt && <span className="text-xs text-[#738079]">Registrado: {new Date(inv.paidAt).toLocaleString('es-ES')}</span>}</div>
      <MarkPaidButton invoice={inv} />
      <CorrectPaidButton invoice={inv} />
    </div>
    <InvoicePaymentHistory invoice={inv} canGenerateReceipts={isOwner} canExportCorrections={isOwner} />
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e4e1d5] bg-[#efeee5] px-4 py-3"><div className="flex flex-wrap items-center gap-3"><Status status={inv.status} /><span className="text-[11px] text-[#738079]">{terminal ? 'Estado final: sin más transiciones.' : canFinishHint ? 'Completa y guarda el pie de factura para poder terminar.' : st === 'finished' && isMyCommercial ? 'Si el cliente aceptó, márcala Aceptada con un clic.' : st === 'accepted' && !isOwner ? 'Aceptada: el propietario confirma tras importar en Versat.' : 'Acciones permitidas para tu rol'}</span>{inv.acceptedAt && <span className="text-[10px] text-[#85918a]">Aceptada {date(inv.acceptedAt)}</span>}{inv.confirmedAt && <span className="text-[10px] text-[#85918a]">Confirmada {date(inv.confirmedAt)}</span>}</div><div className="flex flex-wrap gap-2">{!terminal && actions.map((a) => <button key={a.status} className={`button ${a.danger ? 'button-danger' : a.status === 'accepted' ? 'button-primary' : 'button-soft'} !min-h-8 !px-3 text-[11px]`} disabled={updateStatus.isPending} onClick={() => { if (a.status === 'finished' && !hasLegal) { setActionError('Antes de terminar, completa y guarda el pie de factura de este borrador.'); document.getElementById('invoice-document-authorization')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; } setActionError(''); if (a.status === 'accepted') { changeStatus('accepted'); return; } setPending(a); }} data-testid={`button-status-${a.status}`}>{updateStatus.isPending && a.status === 'accepted' ? 'Guardando…' : a.label}</button>)}</div></div>
    {(inv.acceptedAt || inv.confirmedAt) && <div className="no-print mb-4 space-y-1 text-xs text-[#5f736c]">
      {inv.acceptedAt && <p>Aceptación del cliente registrada: {new Date(inv.acceptedAt).toLocaleString('es-ES')}</p>}
      {inv.confirmedAt && <p>Importación en Versat confirmada: {new Date(inv.confirmedAt).toLocaleString('es-ES')}</p>}
    </div>}
    {pending && <div className="no-print fixed inset-0 z-50 grid place-items-center bg-[#1b2f2c]/50 px-4" role="alertdialog" aria-modal="true" aria-labelledby="status-dialog-title" aria-describedby="status-dialog-description"><div className="panel max-w-[440px] p-6"><h3 id="status-dialog-title" className="font-display text-lg font-bold">{pending.title}</h3><p id="status-dialog-description" className="mt-3 text-[13px] leading-6 text-[#5f736c]">{pending.body}</p><div className="mt-5 flex justify-end gap-2"><button autoFocus className="button button-plain" onClick={() => setPending(null)}>Volver</button><button className={`button ${pending.danger ? 'button-danger' : 'button-primary'}`} disabled={updateStatus.isPending} onClick={() => { const s2 = pending.status; setPending(null); changeStatus(s2); }} data-testid="button-confirm-status">Confirmar</button></div></div></div>}

    {issued && isOwner && st !== 'error' && <section className="no-print panel mb-5 p-4 md:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="eyebrow">Versat · propietario</div><h2 className="font-display mt-1 text-base font-bold">Archivo .Fac de prueba</h2></div><button className="button button-soft" onClick={downloadFac} disabled={file.isPending || !['finished', 'accepted'].includes(st)} title={['finished', 'accepted'].includes(st) ? undefined : 'Disponible para facturas Terminadas o Aceptadas'} data-testid="button-download-fac"><ArrowDownToLine size={15} />{file.isPending ? 'Generando…' : st === 'confirmed' ? 'Ya importada' : 'Descargar .Fac (prueba)'}</button></div>
      {st === 'confirmed' && <p className="mt-3 text-[12px] text-[#5f736c]">Esta factura ya fue importada y no se puede descargar de nuevo.</p>}{st === 'finished' && <p className="mt-3 text-[12px] text-[#5f736c]">Al generar el .Fac, la factura quedará marcada como Aceptada. Después de importarla, confírmala aquí.</p>}{st === 'accepted' && <p className="mt-3 text-[12px] text-[#5f736c]">La factura está Aceptada. Descargarla no confirma su importación en Versat.</p>}
      <div className="mt-3"><TestFileNotice>Codificación Windows-1252. No es un archivo certificado ni final.</TestFileNotice></div>
      {fileError && <div className="mt-3 rounded-lg bg-[#fbefeb] px-4 py-3 text-[12px] leading-5 text-[#a04539]" role="alert"><div className="font-bold">No se pudo generar el archivo</div>{fileError}</div>}
      {fileInfo.length > 0 && <ul className="mt-3 list-disc pl-5 text-[11px] leading-5 text-[#8a6a25]">{fileInfo.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    </section>}

    {inv.status === 'draft' && <DocumentAuthorizationForm key={`${inv.id}-${inv.legalDocument?.authorizedAt || 'new'}`} invoice={inv} />}
    {inv.status === 'draft' && !inv.legalDocument && <p className="no-print mb-4 text-xs">Debes confirmar el modelo imprimible (emisor y responsables) antes de emitir esta factura.</p>}
    {inv.status === 'draft' && inv.seriesId && <p className="no-print mb-4 text-xs" data-testid="automatic-number-notice">Serie automática seleccionada. Al terminar la factura se asignarán el número de Versat y el talón definitivos. No hay sincronización directa con Versat de escritorio.</p>}
    {v?.number && <div className="no-print panel mb-4 px-4 py-3 text-xs" data-testid="invoice-versat-numbering"><span className="font-semibold">Numeración de Versat</span><span className="ml-3 font-mono">{v.number}</span><span className="ml-3">Talón: <span className="font-mono">{v.talon || 'Pendiente'}</span></span><p className="mt-2 text-[#738079]">Datos guardados en esta factura. No hay sincronización directa con Versat de escritorio.</p></div>}
    <InvoiceDocument invoice={inv} />
    {!v && <p className="no-print mx-auto mt-4 max-w-[780px] text-[11px] text-[#85918a]">Esta factura aún no tiene datos de Versat. {inv.status === 'draft' ? 'Edita el borrador para completarlos.' : ''}</p>}
  </div>;
}

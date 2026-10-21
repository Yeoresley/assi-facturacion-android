import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBillingOverviewQueryKey, getGetCurrentTeamMemberQueryKey, getGetInvoiceQueryKey, getGetInvoiceVersatFileQueryKey,
  getListInvoicesQueryKey, getListInvoiceSeriesQueryKey, useCreateInvoiceShare, useGetCurrentTeamMember, useGetInvoice, useGetInvoiceVersatFile, useUpdateInvoiceStatus,
} from '@workspace/api-client-react';
import type { InvoiceStatusInputStatus } from '@workspace/api-client-react';
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, Clipboard, Mail, Pencil, Printer } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { QueryError, Status, TestFileNotice, date, downloadBase64File, errorDetail } from '@/lib/shared';
import { InvoiceDocument } from '@/components/invoice-document';
import { DocumentAuthorizationForm } from '@/components/document-authorization';
import { printInvoice } from '@/lib/invoice-print';

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const valid = Number.isFinite(id) && id > 0;
  const invoice = useGetInvoice(id, { query: { queryKey: getGetInvoiceQueryKey(id), enabled: valid } });
  const member = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false } });
  const file = useGetInvoiceVersatFile(id, { query: { queryKey: getGetInvoiceVersatFileQueryKey(id), enabled: false, retry: false } });
  const updateStatus = useUpdateInvoiceStatus();
  const createShare = useCreateInvoiceShare();
  const client = useQueryClient();
  const [share, setShare] = useState<{ url: string; expiresAt: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [fileError, setFileError] = useState('');
  const [fileInfo, setFileInfo] = useState<string[]>([]);

  function changeStatus(status: InvoiceStatusInputStatus) {
    updateStatus.mutate({ id, data: { status } }, {
      onSuccess: async (updated) => {
        await client.cancelQueries({ queryKey: getGetInvoiceQueryKey(id) });
        client.setQueryData(getGetInvoiceQueryKey(id), updated);
        client.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
        client.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        client.invalidateQueries({ queryKey: getGetBillingOverviewQueryKey() });
        client.invalidateQueries({ queryKey: getListInvoiceSeriesQueryKey() });
        setNotice(updated.versat?.number ? `Estado actualizado. Número de Versat: ${updated.versat.number} · Talón: ${updated.versat.talon}.` : 'Estado actualizado.');
      },
      onError: (err) => setNotice(`No se pudo actualizar el estado. ${errorDetail(err, '')}`),
    });
  }
  function makeShare() {
    createShare.mutate({ id }, { onSuccess: (value) => { setShare(value); setNotice('Enlace listo para compartir.'); }, onError: () => setNotice('No se pudo crear el enlace público.') });
  }
  async function downloadFac() {
    setFileError('');
    setFileInfo([]);
    const result = await file.refetch();
    if (result.error || !result.data) {
      setFileError(errorDetail(result.error, 'No se pudo generar el archivo.'));
      return;
    }
    downloadBase64File(result.data.base64, result.data.filename, result.data.contentType);
    setFileInfo(result.data.warnings || []);
    setNotice(`Archivo ${result.data.filename} descargado como prueba.`);
  }

  if (invoice.isLoading) return <div className="mx-auto max-w-[800px] space-y-4"><div className="skeleton h-6 w-32" /><div className="panel space-y-5 p-8"><div className="skeleton h-8 w-56" /><div className="skeleton h-24" /><div className="skeleton h-40" /></div></div>;
  if (invoice.isError || !invoice.data) return <QueryError retry={() => invoice.refetch()} message="No pudimos abrir esta factura." detail={errorDetail(invoice.error, '')} />;
  const inv = invoice.data;
  const v = inv.versat;
  const issued = inv.status === 'sent' || inv.status === 'paid';
  const isOwner = member.data?.role === 'owner';
  const shareUrl = share?.url ? new URL(share.url, window.location.origin).toString() : '';

  return <div className="fade-in mx-auto max-w-[980px]">
    <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3"><Link href="/invoices" className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#71817b]"><ArrowLeft size={14} />Todas las facturas</Link><div className="flex flex-wrap gap-2">
      {inv.status === 'draft' && <Link href={`/invoices/${inv.id}/edit`} className="button button-soft" data-testid="link-edit-invoice"><Pencil size={15} />Editar borrador</Link>}
      <button className="button button-plain" onClick={() => printInvoice().catch(err => setNotice(err.message))} data-testid="button-print-invoice"><Printer size={15} />Imprimir / Guardar PDF</button>
      <button className="button button-primary" onClick={makeShare} disabled={createShare.isPending} data-testid="button-create-share"><ArrowUpRight size={15} />{createShare.isPending ? 'Creando enlace…' : 'Compartir'}</button></div></div>
    {shareUrl && <div className="no-print panel mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="text-[12px] font-bold text-[#315b52]">Enlace público creado</div><input className="field mt-2 !h-9 font-mono text-[11px]" readOnly value={shareUrl} onClick={(e) => e.currentTarget.select()} data-testid="input-share-url" /><div className="mt-1 text-[10px] text-[#818c85]">Caduca: {date(share?.expiresAt)}</div></div><div className="flex gap-2"><button className="button button-soft !min-h-9" onClick={() => { navigator.clipboard?.writeText(shareUrl); setNotice('Enlace copiado.'); }}><Clipboard size={14} />Copiar</button><a className="button button-plain !min-h-9" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Factura ${inv.number}: ${shareUrl}`)}`}><ArrowUpRight size={14} />WhatsApp</a><a className="button button-plain !min-h-9" href={`mailto:?subject=${encodeURIComponent(`Factura ${inv.number}`)}&body=${encodeURIComponent(`Hola, aquí tienes tu factura: ${shareUrl}`)}`}><Mail size={14} />Email</a></div></div>}
    {notice && <div className="no-print mb-4 text-[12px] font-semibold text-[#377668]" role="status">{notice}</div>}
    <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e4e1d5] bg-[#efeee5] px-4 py-3"><div className="flex items-center gap-3"><Status status={inv.status} /><span className="text-[11px] text-[#738079]">Actualiza el estado de la factura</span></div><div className="flex gap-2">{inv.status === 'draft' && <button className="button button-soft !min-h-8 !px-3 text-[11px]" disabled={updateStatus.isPending} onClick={() => changeStatus('sent')}>Marcar enviada</button>}{inv.status === 'sent' && <button className="button button-soft !min-h-8 !px-3 text-[11px]" disabled={updateStatus.isPending} onClick={() => changeStatus('paid')}>Marcar pagada</button>}{inv.status !== 'cancelled' && inv.status !== 'paid' && <button className="button button-danger !min-h-8 !px-3 text-[11px]" disabled={updateStatus.isPending} onClick={() => changeStatus('cancelled')}>Cancelar factura</button>}</div></div>

    {issued && isOwner && <section className="no-print panel mb-5 p-4 md:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="eyebrow">Versat · propietario</div><h2 className="font-display mt-1 text-base font-bold">Archivo .Fac de prueba</h2></div><button className="button button-soft" onClick={downloadFac} disabled={file.isFetching} data-testid="button-download-fac"><ArrowDownToLine size={15} />{file.isFetching ? 'Generando…' : 'Descargar .Fac (prueba)'}</button></div>
      <div className="mt-3"><TestFileNotice>Codificación Windows-1252. No es un archivo certificado ni final.</TestFileNotice></div>
      {fileError && <div className="mt-3 rounded-lg bg-[#fbefeb] px-4 py-3 text-[12px] leading-5 text-[#a04539]" role="alert"><div className="font-bold">No se pudo generar el archivo</div>{fileError}</div>}
      {fileInfo.length > 0 && <ul className="mt-3 list-disc pl-5 text-[11px] leading-5 text-[#8a6a25]">{fileInfo.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    </section>}

    {inv.status === 'draft' && <DocumentAuthorizationForm key={`${inv.id}-${inv.legalDocument?.authorizedAt || 'new'}`} invoice={inv} />}
    {inv.status === 'draft' && !inv.legalDocument && <p className="no-print mb-4 text-xs">Debes confirmar el modelo imprimible (emisor y responsables) antes de emitir esta factura.</p>}
    {inv.status === 'draft' && inv.seriesId && <p className="no-print mb-4 text-xs" data-testid="automatic-number-notice">Serie automática seleccionada. Al marcar enviada se asignarán el número de Versat y el talón definitivos. No hay sincronización directa con Versat de escritorio.</p>}
    {v?.number && <div className="no-print panel mb-4 px-4 py-3 text-xs" data-testid="invoice-versat-numbering"><span className="font-semibold">Numeración de Versat</span><span className="ml-3 font-mono">{v.number}</span><span className="ml-3">Talón: <span className="font-mono">{v.talon || 'Pendiente'}</span></span><p className="mt-2 text-[#738079]">Datos guardados en esta factura. No hay sincronización directa con Versat de escritorio.</p></div>}
    <InvoiceDocument invoice={inv} />
    {!v && <p className="no-print mx-auto mt-4 max-w-[780px] text-[11px] text-[#85918a]">Esta factura aún no tiene datos de Versat. {inv.status === 'draft' ? 'Edita el borrador para completarlos.' : ''}</p>}
  </div>;
}

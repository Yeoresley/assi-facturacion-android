import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBillingOverviewQueryKey, getGetCurrentTeamMemberQueryKey, getGetInvoiceQueryKey, getGetInvoiceVersatFileQueryKey,
  getListInvoicesQueryKey, useCreateInvoiceShare, useGetCurrentTeamMember, useGetInvoice, useGetInvoiceVersatFile, useUpdateInvoiceStatus,
} from '@workspace/api-client-react';
import type { InvoiceStatusInputStatus } from '@workspace/api-client-react';
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, Clipboard, Mail, Pencil, Printer } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { BrandMark, QueryError, Status, TestFileNotice, date, downloadBase64File, errorDetail, money } from '@/lib/shared';

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
        setNotice('Estado actualizado.');
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
      <button className="button button-plain" onClick={() => window.print()} data-testid="button-print-invoice"><Printer size={15} />Imprimir</button>
      <button className="button button-primary" onClick={makeShare} disabled={createShare.isPending} data-testid="button-create-share"><ArrowUpRight size={15} />{createShare.isPending ? 'Creando enlace…' : 'Compartir'}</button></div></div>
    {shareUrl && <div className="no-print panel mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="text-[12px] font-bold text-[#315b52]">Enlace público creado</div><input className="field mt-2 !h-9 font-mono text-[11px]" readOnly value={shareUrl} onClick={(e) => e.currentTarget.select()} data-testid="input-share-url" /><div className="mt-1 text-[10px] text-[#818c85]">Caduca: {date(share?.expiresAt)}</div></div><div className="flex gap-2"><button className="button button-soft !min-h-9" onClick={() => { navigator.clipboard?.writeText(shareUrl); setNotice('Enlace copiado.'); }}><Clipboard size={14} />Copiar</button><a className="button button-plain !min-h-9" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Factura ${inv.number}: ${shareUrl}`)}`}><ArrowUpRight size={14} />WhatsApp</a><a className="button button-plain !min-h-9" href={`mailto:?subject=${encodeURIComponent(`Factura ${inv.number}`)}&body=${encodeURIComponent(`Hola, aquí tienes tu factura: ${shareUrl}`)}`}><Mail size={14} />Email</a></div></div>}
    {notice && <div className="no-print mb-4 text-[12px] font-semibold text-[#377668]" role="status">{notice}</div>}
    <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e4e1d5] bg-[#efeee5] px-4 py-3"><div className="flex items-center gap-3"><Status status={inv.status} /><span className="text-[11px] text-[#738079]">Actualiza el estado de la factura</span></div><div className="flex gap-2">{inv.status === 'draft' && <button className="button button-soft !min-h-8 !px-3 text-[11px]" disabled={updateStatus.isPending} onClick={() => changeStatus('sent')}>Marcar enviada</button>}{inv.status === 'sent' && <button className="button button-soft !min-h-8 !px-3 text-[11px]" disabled={updateStatus.isPending} onClick={() => changeStatus('paid')}>Marcar pagada</button>}{inv.status !== 'cancelled' && inv.status !== 'paid' && <button className="button button-danger !min-h-8 !px-3 text-[11px]" disabled={updateStatus.isPending} onClick={() => changeStatus('cancelled')}>Cancelar factura</button>}</div></div>

    {issued && isOwner && <section className="no-print panel mb-5 p-4 md:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="eyebrow">Versat · propietario</div><h2 className="font-display mt-1 text-base font-bold">Archivo .Fac de prueba</h2></div><button className="button button-soft" onClick={downloadFac} disabled={file.isFetching} data-testid="button-download-fac"><ArrowDownToLine size={15} />{file.isFetching ? 'Generando…' : 'Descargar .Fac (prueba)'}</button></div>
      <div className="mt-3"><TestFileNotice>Codificación Windows-1252. No es un archivo certificado ni final.</TestFileNotice></div>
      {fileError && <div className="mt-3 rounded-lg bg-[#fbefeb] px-4 py-3 text-[12px] leading-5 text-[#a04539]" role="alert"><div className="font-bold">No se pudo generar el archivo</div>{fileError}</div>}
      {fileInfo.length > 0 && <ul className="mt-3 list-disc pl-5 text-[11px] leading-5 text-[#8a6a25]">{fileInfo.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    </section>}

    <article className="invoice-paper mx-auto max-w-[780px] border border-[#e8e5dc] px-7 py-8 md:px-14 md:py-12">
      <div className="flex flex-wrap justify-between gap-8 border-b border-[#e8e5dc] pb-8"><div><BrandMark /><div className="mt-5 text-[11px] text-[#8a948e]">Documento emitido por el equipo</div></div><div className="text-right"><div className="eyebrow">Factura</div><h1 className="font-display mt-1 text-[25px] font-bold tracking-[-.05em]">{inv.number}</h1>{v?.number && <div className="mt-1 font-mono text-[11px] text-[#71817b]">Versat Nº {v.number}</div>}<div className="mt-2"><Status status={inv.status} /></div></div></div>
      <div className="grid gap-8 py-8 sm:grid-cols-2"><div><div className="eyebrow">Facturar a</div><div className="mt-3 text-[15px] font-bold">{v?.customerName || inv.customerName}</div>{v?.customerCode && <div className="mt-1 font-mono text-[11px] text-[#5f736c]">Código Versat: {v.customerCode}</div>}{v?.customerTaxId && <div className="mt-1 font-mono text-[11px] text-[#5f736c]">NIT: {v.customerTaxId}</div>}{v?.customerAddress && <div className="mt-1 text-[11px] text-[#78857f]">{v.customerAddress}</div>}</div><div className="grid grid-cols-2 gap-4"><div><div className="eyebrow">Fecha de emisión</div><div className="mt-3 text-[13px] font-semibold">{date(inv.issueDate)}</div></div><div><div className="eyebrow">Vencimiento</div><div className="mt-3 text-[13px] font-semibold">{date(inv.dueDate)}</div></div></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[520px]"><thead><tr className="border-y border-[#e8e5dc] text-left"><th className="py-3 pr-3 eyebrow">Servicio</th><th className="px-2 py-3 eyebrow">UM</th><th className="px-2 py-3 text-right eyebrow">Cant.</th><th className="px-2 py-3 text-right eyebrow">Precio</th><th className="py-3 pl-2 text-right eyebrow">Importe</th></tr></thead><tbody>{inv.lines.map((line) => <tr key={line.id} className="border-b border-[#f0eee7]"><td className="py-4 pr-3"><div className="text-[13px] font-medium">{line.description}</div><div className="mt-1 font-mono text-[10px] text-[#7d8a84]">{line.serviceCode ? `Servicio ${line.serviceCode}` : 'Sin servicio de catálogo'}{line.groupCode ? ` · Grupo ${line.groupCode}` : ' · Sin grupo'}</div></td><td className="px-2 py-4 font-mono text-[11px] text-[#71817b]">{line.unitCode || '—'}</td><td className="px-2 py-4 text-right text-[12px] text-[#71817b]">{line.quantity}</td><td className="px-2 py-4 text-right text-[12px] text-[#71817b]">{money(line.unitPrice, inv.currency, 5)}</td><td className="py-4 pl-2 text-right text-[13px] font-bold">{money(line.amount, inv.currency)}</td></tr>)}</tbody></table></div>
      <div className="ml-auto mt-5 max-w-[280px] space-y-2"><div className="flex justify-between text-[12px] text-[#71817b]"><span>Subtotal</span><span>{money(inv.subtotal, inv.currency)}</span></div><div className="flex justify-between border-t border-[#e8e5dc] pt-3 font-display text-[17px] font-bold"><span>Total</span><span>{money(inv.total, inv.currency)}</span></div></div>
      {v && <div className="mt-8 border-t border-[#e8e5dc] pt-5"><div className="eyebrow">Datos de Versat</div><dl className="mt-3 grid gap-x-6 gap-y-3 text-[12px] sm:grid-cols-2">
        {[['Moneda', `${inv.currency} · ${v.currencyName}`], ['Concepto', v.conceptCode], ['Operación', v.operationName], ['Comercial', `${v.commercialName}${v.commercialPosition ? ` (${v.commercialPosition})` : ''}`], ['Forma de pago', v.paymentName], ['Talón', v.talon], ['Cuenta MC', v.bankAccountMC], ['Cuenta OM', v.bankAccountOM], ['Contrato', v.contract]].map(([k, val]) => val ? <div key={k}><dt className="text-[10px] text-[#85918a]">{k}</dt><dd className="mt-0.5 font-semibold">{val}</dd></div> : null)}
      </dl></div>}
      {inv.notes && <div className="mt-8 border-t border-[#e8e5dc] pt-5"><div className="eyebrow">Nota</div><p className="mt-2 whitespace-pre-line text-[12px] leading-5 text-[#63736d]">{inv.notes}</p></div>}
      <div className="mt-12 border-t border-[#e8e5dc] pt-4 text-[10px] text-[#89948d]">Preparada por {inv.specialistName} <span className="mx-2">·</span> Cuenta Clara desk</div>
    </article>
    {!v && <p className="no-print mx-auto mt-4 max-w-[780px] text-[11px] text-[#85918a]">Esta factura aún no tiene datos de Versat. {inv.status === 'draft' ? 'Edita el borrador para completarlos.' : ''}</p>}
  </div>;
}

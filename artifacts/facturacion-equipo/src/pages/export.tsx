import { useState, type FormEvent } from 'react';
import {
  getExportVersatInvoicesQueryKey, getGetVersatExportFileQueryKey, useExportVersatInvoices, useGetVersatExportFile,
} from '@workspace/api-client-react';
import type { GetVersatExportFileParams } from '@workspace/api-client-react';
import { ArrowDownToLine, ArrowRight, CalendarDays, CircleHelp, TriangleAlert } from 'lucide-react';
import { Link } from 'wouter';
import { EmptyState, PageHeading, QueryError, Status, TestFileNotice, date, downloadBase64File, errorDetail, money } from '@/lib/shared';

type Encoding = 'windows-1252' | 'utf-8';

export default function ExportPage() {
  const now = new Date();
  const [from, setFrom] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => now.toISOString().slice(0, 10));
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
  const [encoding, setEncoding] = useState<Encoding>('windows-1252');
  const [downloadError, setDownloadError] = useState('');
  const [downloadNote, setDownloadNote] = useState<string[]>([]);

  const previewParams = applied ?? { from, to };
  const preview = useExportVersatInvoices(previewParams, { query: { queryKey: getExportVersatInvoicesQueryKey(previewParams), enabled: !!applied, retry: false, refetchInterval: applied ? 20000 : false } });
  const fileParams: GetVersatExportFileParams = { from: previewParams.from, to: previewParams.to, encoding };
  const zip = useGetVersatExportFile(fileParams, { query: { queryKey: getGetVersatExportFileQueryKey(fileParams), enabled: false, retry: false } });

  function run(event: FormEvent) {
    event.preventDefault();
    if (from > to) return;
    setDownloadError('');
    setDownloadNote([]);
    if (applied && applied.from === from && applied.to === to) preview.refetch();
    else setApplied({ from, to });
  }

  const rows = preview.data || [];
  const blocked = rows.filter((row) => row.canExport === false || (row.issues && row.issues.length > 0));
  const canDownload = !!applied && !preview.isFetching && !preview.isError && rows.length > 0 && blocked.length === 0;

  async function download() {
    setDownloadError('');
    setDownloadNote([]);
    const result = await zip.refetch();
    if (result.error || !result.data) {
      setDownloadError(errorDetail(result.error, 'No se pudo generar el archivo.'));
      return;
    }
    downloadBase64File(result.data.base64, result.data.filename, result.data.contentType);
    setDownloadNote([`${result.data.filename}: ${result.data.invoiceCount} ${result.data.invoiceCount === 1 ? 'factura' : 'facturas'}.`, ...(result.data.warnings || [])]);
  }

  return <div className="fade-in mx-auto max-w-[1040px]">
    <PageHeading eyebrow="Cierre de período" title="Exportar a Versat" description="Solo aparecen facturas Aceptadas pendientes de importar. Terminadas, en edición, con error, confirmadas, anuladas y canceladas no se incluyen. La descarga se habilita si ninguna tiene bloqueos." />
    <div className="mb-5"><TestFileNotice>Solo facturas Aceptadas. La descarga no confirma nada: tras importar, márcala Confirmada desde su detalle. Cada factura se genera como un archivo .Fac dentro de un ZIP. Hay que descomprimirlo antes de importar en Versat de escritorio. No es un archivo certificado ni final.</TestFileNotice></div>
    <div className="grid gap-5 lg:grid-cols-[1fr_310px]">
      <section className="panel p-5 md:p-7"><div className="mb-5 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f7edd9] text-[#9d7739]"><CalendarDays size={17} /></span><div><h2 className="font-display text-base font-bold">Rango de fechas</h2><p className="mt-1 text-[11px] text-[#78857f]">Por fecha de emisión</p></div></div>
        <form className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={run}><label><span className="field-label">Desde</span><input className="field" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required data-testid="input-export-from" /></label><label><span className="field-label">Hasta</span><input className="field" type="date" value={to} onChange={(e) => setTo(e.target.value)} required min={from} data-testid="input-export-to" /></label><button className="button button-primary" type="submit" disabled={preview.isFetching || from > to} data-testid="button-export-preview">{preview.isFetching ? 'Preparando…' : 'Revisar período'}<ArrowRight size={14} /></button></form>
        {from > to && <p className="mt-3 text-[11px] text-[#a04539]">La fecha final debe ser igual o posterior a la inicial.</p>}
        <div className="mt-5 border-t border-[#eeece4] pt-5"><span className="field-label">Codificación del archivo</span>
          <div className="grid gap-2 sm:grid-cols-2">{([['windows-1252', 'Windows-1252', 'Codificación heredada esperada por Versat de escritorio.'], ['utf-8', 'UTF-8', 'Alternativa para comparar si hay caracteres rotos.']] as const).map(([value, name, hint]) => <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${encoding === value ? 'border-[#49867c] bg-[#f1f6f2]' : 'border-[#e4e1d5]'}`}><input type="radio" name="encoding" className="mt-1" checked={encoding === value} onChange={() => setEncoding(value)} data-testid={`radio-encoding-${value}`} /><span><span className="block text-[12px] font-bold">{name}</span><span className="block text-[10px] leading-4 text-[#78857f]">{hint}</span></span></label>)}</div>
          <p className="mt-2 flex items-start gap-2 text-[10px] leading-4 text-[#8a6a25]"><TriangleAlert size={12} className="mt-0.5 shrink-0" />Conserva Windows-1252 para el formato probado. Valida otras variantes antes de importarlas.</p>
        </div>
      </section>
      <aside className="rounded-[14px] bg-[#244a44] p-5 text-[#f4f2e8]"><div className="eyebrow !text-[#d1b678]">Antes de exportar</div><h3 className="font-display mt-3 text-lg font-bold">Sin sorpresas.</h3><p className="mt-2 text-[12px] leading-5 text-[#c6d1c9]">Entre las facturas Aceptadas del período, ninguna se omite en silencio: si una tiene problemas, aparece aquí con su motivo y el ZIP no se genera hasta resolverlos.</p><div className="mt-4 flex items-start gap-2 border-t border-white/15 pt-4 text-[11px] leading-5 text-[#e5d2a7]"><CircleHelp className="mt-0.5 shrink-0" size={15} />Importación de servicios probada por el usuario. El número se exporta sin guiones; el talón corregido es 5.</div></aside>
    </div>

    {applied && <section className="panel mt-5 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eeece4] px-5 py-4"><div><div className="eyebrow">Vista previa · {date(applied.from)} a {date(applied.to)}</div><h2 className="font-display mt-1 text-base font-bold">{preview.isLoading || preview.isFetching ? 'Consultando período…' : preview.isError ? 'No se pudo preparar' : `${rows.length} ${rows.length === 1 ? 'factura' : 'facturas'}${blocked.length ? ` · ${blocked.length} con bloqueos` : ''}`}</h2></div>
      <button className="button button-soft !min-h-9" disabled={!canDownload || zip.isFetching} onClick={download} data-testid="button-download-zip"><ArrowDownToLine size={15} />{zip.isFetching ? 'Generando ZIP…' : 'Descargar ZIP de prueba'}</button></div>
      {!canDownload && !preview.isFetching && !preview.isError && rows.length > 0 && <div className="border-b border-[#f0e2c3] bg-[#fbf1d9] px-5 py-3 text-[11px] font-semibold text-[#7d5e1f]">Resuelve los bloqueos de abajo para habilitar la descarga.</div>}
      {downloadError && <div className="border-b border-[#efd2cc] bg-[#fbefeb] px-5 py-3 text-[12px] leading-5 text-[#a04539]" role="alert"><span className="font-bold">El servidor no generó el archivo. </span>{downloadError}</div>}
      {downloadNote.length > 0 && <ul className="border-b border-[#eeece4] bg-[#f4f8f4] px-5 py-3 text-[11px] leading-5 text-[#356d60]" role="status">{downloadNote.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      {preview.isLoading || preview.isFetching ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-9" />)}</div> : preview.isError ? <div className="p-5"><QueryError retry={() => preview.refetch()} message="No se pudo preparar este período." detail={errorDetail(preview.error, '')} /></div> : !rows.length ? <EmptyState title="No hay facturas aceptadas pendientes de importar" text="Prueba con otras fechas. Las facturas en otros estados no se incluyen. No se ha generado ningún archivo." /> :
        <div className="overflow-x-auto"><table className="w-full min-w-[820px]"><thead><tr className="eyebrow text-left"><th className="px-5 py-3 font-medium">Factura</th><th className="px-4 py-3 font-medium">Nº Versat</th><th className="px-4 py-3 font-medium">Fecha</th><th className="px-4 py-3 font-medium">Cliente / NIT</th><th className="px-4 py-3 font-medium">Estado</th><th className="px-4 py-3 font-medium">Exportable</th><th className="px-5 py-3 text-right font-medium">Total</th></tr></thead><tbody>{rows.map((row, i) => {
          const bad = row.canExport === false || (row.issues?.length ?? 0) > 0;
          return <tr className="table-row align-top" key={`${row.id ?? row.invoiceNumber}-${i}`} data-testid={`row-export-${row.id ?? i}`}>
            <td className="px-5 py-3 font-mono text-[11px] text-[#39746a]">{row.id ? <Link href={`/invoices/${row.id}`}>{row.invoiceNumber}</Link> : row.invoiceNumber}</td>
            <td className="px-4 py-3 font-mono text-[11px] text-[#5f736c]">{row.versatNumber || <span className="text-[#a97c2c]">sin número</span>}</td>
            <td className="px-4 py-3 text-[11px] text-[#77847e]">{date(row.issueDate)}</td>
            <td className="px-4 py-3 text-[12px] font-semibold">{row.customerName}<div className="mt-0.5 font-mono text-[10px] font-normal text-[#77847e]">{row.taxId || 'sin NIT'}</div></td>
            <td className="px-4 py-3"><Status status={row.status} /></td>
            <td className="px-4 py-3">{bad ? <div><span className="status-pill status-cancelled">Con bloqueos</span><ul className="mt-2 list-disc space-y-1 pl-4 text-[10px] leading-4 text-[#9a4a3e]">{(row.issues || []).map((issue, k) => <li key={k}>{issue}</li>)}</ul></div> : <span className="status-pill status-paid">Listo</span>}</td>
            <td className="px-5 py-3 text-right text-[12px] font-bold">{money(row.total, row.currency)}</td></tr>;
        })}</tbody></table></div>}
    </section>}
  </div>;
}

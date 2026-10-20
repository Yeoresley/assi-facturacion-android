import { getGetSharedInvoiceQueryKey, useGetSharedInvoice } from '@workspace/api-client-react';
import { Printer } from 'lucide-react';
import { useParams } from 'wouter';
import { BrandMark, Status, date, money } from '@/lib/shared';

export default function SharedInvoicePage() {
  const params = useParams<{ token: string }>();
  const token = params.token || '';
  const invoice = useGetSharedInvoice(token, { query: { queryKey: getGetSharedInvoiceQueryKey(token), enabled: !!token } });
  if (invoice.isLoading) return <div className="min-h-[100dvh] bg-[#f6f4eb] p-6"><div className="mx-auto max-w-[760px] space-y-4"><div className="skeleton h-10 w-40" /><div className="panel space-y-5 p-10"><div className="skeleton h-8 w-52" /><div className="skeleton h-20" /><div className="skeleton h-40" /></div></div></div>;
  if (invoice.isError || !invoice.data) return <div className="grid min-h-[100dvh] place-items-center bg-[#f6f4eb] px-5"><div className="panel max-w-[430px] p-8 text-center"><div className="eyebrow">Cuenta Clara</div><h1 className="font-display mt-4 text-2xl font-bold">Este enlace no está disponible</h1><p className="mt-2 text-[13px] leading-6 text-[#77847e]">Puede haber caducado o ya no estar activo. Pide al equipo que te comparta un enlace nuevo.</p><button className="button button-plain mt-5" onClick={() => invoice.refetch()}>Intentar de nuevo</button></div></div>;
  const inv = invoice.data;
  const v = inv.versat;
  const customerName = v?.customerName || inv.customerName;
  return <div className="min-h-[100dvh] bg-[#f6f4eb] px-4 py-8 md:px-8 md:py-12"><div className="mx-auto max-w-[780px]">
    <div className="mb-5 flex items-center justify-between"><BrandMark /><button onClick={() => window.print()} className="no-print button button-primary"><Printer size={15} />Imprimir factura</button></div>
    <article className="invoice-paper border border-[#e8e5dc] px-7 py-8 md:px-14 md:py-12">
      <div className="flex flex-wrap justify-between gap-8 border-b border-[#e8e5dc] pb-8"><div><div className="eyebrow">Factura para</div><div className="mt-3 text-[16px] font-bold">{customerName}</div>{v?.customerCode && <div className="mt-1 font-mono text-[11px] text-[#5f736c]">Código: {v.customerCode}</div>}{v?.customerTaxId && <div className="mt-1 font-mono text-[11px] text-[#5f736c]">NIT: {v.customerTaxId}</div>}{v?.customerAddress && <div className="mt-1 text-[11px] text-[#78857f]">{v.customerAddress}</div>}</div><div className="text-right"><div className="eyebrow">Factura</div><h1 className="font-display mt-1 text-[24px] font-bold">{inv.number}</h1>{v?.number && <div className="mt-1 font-mono text-[11px] text-[#71817b]">Nº {v.number}</div>}<div className="mt-2"><Status status={inv.status} /></div></div></div>
      <div className="grid gap-6 py-7 sm:grid-cols-2"><div><div className="eyebrow">Fecha de emisión</div><div className="mt-2 text-[13px] font-semibold">{date(inv.issueDate)}</div></div><div><div className="eyebrow">Vencimiento</div><div className="mt-2 text-[13px] font-semibold">{date(inv.dueDate)}</div></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[480px]"><thead><tr className="border-y border-[#e8e5dc] text-left"><th className="py-3 pr-3 eyebrow">Descripción</th><th className="px-2 py-3 eyebrow">UM</th><th className="px-2 py-3 text-right eyebrow">Cantidad</th><th className="px-2 py-3 text-right eyebrow">Precio</th><th className="py-3 pl-2 text-right eyebrow">Importe</th></tr></thead><tbody>{inv.lines.map((line) => <tr key={line.id} className="border-b border-[#f0eee7]"><td className="py-4 pr-3 text-[13px]">{line.description}{line.serviceCode && <div className="mt-1 font-mono text-[10px] text-[#7d8a84]">Servicio {line.serviceCode}</div>}</td><td className="px-2 py-4 font-mono text-[11px] text-[#71817b]">{line.unitCode || '—'}</td><td className="px-2 py-4 text-right text-[12px]">{line.quantity}</td><td className="px-2 py-4 text-right text-[12px]">{money(line.unitPrice, inv.currency, 5)}</td><td className="py-4 pl-2 text-right text-[13px] font-bold">{money(line.amount, inv.currency)}</td></tr>)}</tbody></table></div>
      <div className="ml-auto mt-5 max-w-[260px] space-y-2"><div className="flex justify-between text-[12px] text-[#71817b]"><span>Subtotal</span><span>{money(inv.subtotal, inv.currency)}</span></div><div className="flex justify-between border-t border-[#e8e5dc] pt-3 font-display text-[18px] font-bold"><span>Total</span><span>{money(inv.total, inv.currency)}</span></div></div>
      {inv.notes && <div className="mt-8 border-t border-[#e8e5dc] pt-5"><div className="eyebrow">Nota</div><p className="mt-2 whitespace-pre-line text-[12px] leading-5 text-[#63736d]">{inv.notes}</p></div>}
      <div className="mt-12 border-t border-[#e8e5dc] pt-4 text-[10px] text-[#89948d]">Documento compartido por Cuenta Clara desk</div>
    </article>
    <footer className="mt-5 text-center text-[10px] text-[#87928b]">Enlace seguro de factura <span className="mx-2">·</span> Cuenta Clara desk</footer></div></div>;
}

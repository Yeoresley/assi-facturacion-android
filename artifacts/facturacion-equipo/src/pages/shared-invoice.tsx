import { useState } from 'react';
import { getGetSharedInvoiceQueryKey, useGetSharedInvoice } from '@workspace/api-client-react';
import { Printer } from 'lucide-react';
import { useParams } from 'wouter';
import { BrandMark } from '@/lib/shared';
import { InvoiceDocument } from '@/components/invoice-document';
import { printInvoice } from '@/lib/invoice-print';

export default function SharedInvoicePage() {
  const params = useParams<{ token: string }>();
  const token = params.token || '';
  const [notice, setNotice] = useState('');
  const invoice = useGetSharedInvoice(token, { query: { queryKey: getGetSharedInvoiceQueryKey(token), enabled: !!token, staleTime: 0 } });
  if (invoice.isLoading) return <div className="min-h-[100dvh] bg-[#f6f4eb] p-6"><div className="mx-auto max-w-[760px] space-y-4"><div className="skeleton h-10 w-40" /><div className="panel space-y-5 p-10"><div className="skeleton h-8 w-52" /><div className="skeleton h-20" /><div className="skeleton h-40" /></div></div></div>;
  if (invoice.isError || !invoice.data) return <div className="grid min-h-[100dvh] place-items-center bg-[#f6f4eb] px-5"><div className="panel max-w-[430px] p-8 text-center"><div className="eyebrow">Cuenta Clara</div><h1 className="font-display mt-4 text-2xl font-bold">Este enlace no está disponible</h1><p className="mt-2 text-[13px] leading-6 text-[#77847e]">Puede haber caducado o ya no estar activo. Pide al equipo que te comparta un enlace nuevo.</p><button className="button button-plain mt-5" onClick={() => invoice.refetch()}>Intentar de nuevo</button></div></div>;
  return <div className="shared-invoice-page min-h-[100dvh] bg-[#f6f4eb] px-4 py-8 md:px-8 md:py-12"><div className="mx-auto max-w-[820px]">
    <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3"><BrandMark /><button onClick={() => printInvoice().catch(err => setNotice(err.message))} className="button button-primary"><Printer size={15} />Imprimir / Guardar PDF</button></div>
    {notice && <p className="no-print mb-4 text-xs" role="alert">{notice}</p>}
    <InvoiceDocument invoice={invoice.data} shareToken={token} />
    <footer className="no-print mt-5 text-center text-[10px] text-[#87928b]">Enlace temporal de factura · Cuenta Clara desk</footer>
  </div></div>;
}

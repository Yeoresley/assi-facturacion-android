import { useState } from 'react';
import {
  getGetSharedInvoiceQueryKey, getGetSharedInvoiceReceiptQueryKey,
  useGetSharedInvoice, useGetSharedInvoiceReceipt,
} from '@workspace/api-client-react';
import { Printer } from 'lucide-react';
import { useParams } from 'wouter';
import { BrandMark } from '@/lib/shared';
import { InvoiceDocument } from '@/components/invoice-document';
import { PaymentReceiptPaper } from '@/components/payment-receipt';
import { getPaymentReceiptInfo } from '@/components/payment-receipt-data';
import { printInvoice } from '@/lib/invoice-print';

export default function SharedInvoicePage() {
  const params = useParams<{ token: string }>();
  const token = params.token || '';
  const receiptParam = new URLSearchParams(window.location.search).get('receipt');
  const receiptId = receiptParam && /^\d+$/.test(receiptParam) ? Number(receiptParam) : null;
  const [notice, setNotice] = useState('');
  const isReceiptLink = receiptParam !== null;
  const invoice = useGetSharedInvoice(token, { query: {
    queryKey: getGetSharedInvoiceQueryKey(token), enabled: !!token && !isReceiptLink, staleTime: 0, gcTime: 0,
    refetchInterval: 15000, refetchOnMount: 'always', refetchOnWindowFocus: 'always', retry: false,
  }, request: { cache: 'no-store' } });
  const receiptQuery = useGetSharedInvoiceReceipt(token, receiptId ?? 0, { query: {
    queryKey: getGetSharedInvoiceReceiptQueryKey(token, receiptId ?? 0),
    enabled: !!token && receiptId !== null && receiptId > 0,
    staleTime: 0, gcTime: 0, refetchInterval: 15000,
    refetchOnMount: 'always', refetchOnWindowFocus: 'always', retry: false,
  }, request: { cache: 'no-store' } });
  const isLoading = isReceiptLink ? receiptId !== null && receiptQuery.isLoading : invoice.isLoading;
  if (isLoading) return <div className="min-h-[100dvh] bg-[#f6f4eb] p-6"><div className="mx-auto max-w-[760px] space-y-4"><div className="skeleton h-10 w-40" /><div className="panel space-y-5 p-10"><div className="skeleton h-8 w-52" /><div className="skeleton h-20" /><div className="skeleton h-40" /></div></div></div>;
  const unavailableMessage = isReceiptLink
    ? 'El abono no existe o ya no está vigente. Pide al equipo que te comparta un comprobante actualizado.'
    : 'Puede haber caducado o ya no estar activo. Pide al equipo que te comparta un enlace nuevo.';
  if (isReceiptLink && (receiptId === null || receiptId <= 0 || receiptQuery.isError || !receiptQuery.data)) return <div className="grid min-h-[100dvh] place-items-center bg-[#f6f4eb] px-5"><div className="panel max-w-[430px] p-8 text-center"><div className="mb-3 flex justify-center"><BrandMark /></div><div className="eyebrow">ASSI · Facturación de equipo</div><h1 className="font-display mt-4 text-2xl font-bold">Este comprobante no está disponible</h1><p className="mt-2 text-[13px] leading-6 text-[#77847e]">{unavailableMessage}</p>{receiptId !== null && receiptId > 0 && <button className="button button-plain mt-5" onClick={() => receiptQuery.refetch()}>Intentar de nuevo</button>}</div></div>;
  if (!isReceiptLink && (invoice.isError || !invoice.data)) return <div className="grid min-h-[100dvh] place-items-center bg-[#f6f4eb] px-5"><div className="panel max-w-[430px] p-8 text-center"><div className="mb-3 flex justify-center"><BrandMark /></div><div className="eyebrow">ASSI · Facturación de equipo</div><h1 className="font-display mt-4 text-2xl font-bold">Este enlace no está disponible</h1><p className="mt-2 text-[13px] leading-6 text-[#77847e]">{unavailableMessage}</p><button className="button button-plain mt-5" onClick={() => invoice.refetch()}>Intentar de nuevo</button></div></div>;
  if (isReceiptLink) return <div className="shared-invoice-page min-h-[100dvh] bg-[#f6f4eb] px-4 py-8 md:px-8 md:py-12"><div className="mx-auto max-w-[820px] receipt-print-page">
    <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3"><BrandMark /><button onClick={() => printInvoice({ documentType: 'receipt' }).catch(err => setNotice(err.message))} className="button button-primary"><Printer size={15} />Imprimir / Guardar PDF</button></div>
    {notice && <p className="no-print mb-4 text-xs" role="alert">{notice}</p>}
    <PaymentReceiptPaper receipt={receiptQuery.data!} />
    <footer className="no-print mt-5 text-center text-[10px] text-[#87928b]">Enlace temporal de comprobante · ASSI</footer>
  </div></div>;
  if (!invoice.data) return null;
  return <div className="shared-invoice-page min-h-[100dvh] bg-[#f6f4eb] px-4 py-8 md:px-8 md:py-12"><div className="mx-auto max-w-[820px]">
    <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3"><BrandMark /><button onClick={() => printInvoice().catch(err => setNotice(err.message))} className="button button-primary"><Printer size={15} />Imprimir / Guardar PDF</button></div>
    {notice && <p className="no-print mb-4 text-xs" role="alert">{notice}</p>}
    <InvoiceDocument invoice={invoice.data} shareToken={token} />
     <footer className="no-print mt-5 text-center text-[10px] text-[#87928b]">Enlace temporal de factura · ASSI</footer>
  </div></div>;
}

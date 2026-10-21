import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBillingOverviewQueryKey, getGetCurrentTeamMemberQueryKey, getGetInvoiceQueryKey, getListInvoicesQueryKey,
  useGetCurrentTeamMember, useMarkInvoicePaid,
} from '@workspace/api-client-react';
import type { Invoice } from '@workspace/api-client-react';
import { HandCoins } from 'lucide-react';
import { date, errorDetail, money } from '@/lib/shared';

type PayInfo = Pick<Invoice, 'status' | 'paymentStatus' | 'paidAt'>;
const eligible = ['finished', 'accepted', 'confirmed', 'sent'];
const excluded = ['error', 'voided', 'cancelled'];

export function PaymentBadge({ invoice }: { invoice: PayInfo }) {
  const paid = invoice.paymentStatus === 'paid';
  if (!paid && invoice.status === 'draft') return <span className="status-pill status-draft" data-testid="badge-payment-none">No emitida</span>;
  if (!paid && excluded.includes(invoice.status)) return <span className="status-pill status-draft" data-testid="badge-payment-none">No aplica</span>;
  return <span className={`status-pill ${paid ? 'status-paid' : 'status-sent'}`} title={paid && invoice.paidAt ? `Pagada el ${date(invoice.paidAt)}` : undefined} data-testid={`badge-payment-${invoice.paymentStatus}`}>{paid ? 'Pagada' : 'Pendiente de pago'}</span>;
}

export function MarkPaidButton({ invoice }: { invoice: Invoice }) {
  const member = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false } });
  const client = useQueryClient();
  const mark = useMarkInvoicePaid();
  const [open, setOpen] = useState(false);
  if (member.data?.role !== 'owner' || invoice.paymentStatus !== 'pending' || !eligible.includes(invoice.status)) return null;
  const confirm = () => mark.mutate({ id: invoice.id, data: { paymentStatus: 'paid' } }, {
    onSuccess: () => {
      setOpen(false);
      client.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      client.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoice.id) });
      client.invalidateQueries({ queryKey: getGetBillingOverviewQueryKey() });
    },
  });
  return <>
    <button className="button button-soft !min-h-8 !px-3 !text-[12px]" onClick={() => { mark.reset(); setOpen(true); }} data-testid={`button-mark-paid-${invoice.id}`}><HandCoins size={14} />Marcar pagada</button>
    {open && createPortal(<div className="no-print fixed inset-0 z-50 grid place-items-center bg-[#1b2f2c]/50 px-4" role="alertdialog" aria-modal="true" aria-labelledby={`pay-title-${invoice.id}`}>
      <div className="panel w-full max-w-[440px] p-6 text-left">
        <h2 id={`pay-title-${invoice.id}`} className="font-display text-lg font-bold">Registrar pago completo</h2>
        <p className="mt-3 text-[13px] leading-6 text-[#5f716b]">Vas a marcar la factura <span className="font-mono font-semibold">{invoice.number}</span> de {invoice.customerName} como <b>pagada en su totalidad</b>: {money(invoice.total, invoice.currency)}. No se registran pagos parciales y el estado de la factura no cambia.</p>
        {mark.isError && <div className="mt-3 rounded-lg bg-[#fbe3dd] px-3 py-2 text-[12px] text-[#9a3b2e]" role="alert">{errorDetail(mark.error, 'No se pudo registrar el pago.')}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button autoFocus className="button button-plain" disabled={mark.isPending} onClick={() => setOpen(false)}>Cancelar</button>
          <button className="button button-primary" disabled={mark.isPending} onClick={confirm} data-testid={`button-confirm-paid-${invoice.id}`}>{mark.isPending ? 'Registrando…' : 'Confirmar pago completo'}</button>
        </div>
      </div>
    </div>, document.body)}
  </>;
}

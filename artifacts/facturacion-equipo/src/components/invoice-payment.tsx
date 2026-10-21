import { useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBillingOverviewQueryKey, getGetCurrentTeamMemberQueryKey, getGetInvoiceQueryKey,
  getListInvoicesQueryKey, useCorrectInvoicePayment, useCreateInvoicePayment, useGetCurrentTeamMember,
} from '@workspace/api-client-react';
import type { Invoice } from '@workspace/api-client-react';
import { HandCoins, ReceiptText, RotateCcw } from 'lucide-react';
import { date, errorDetail, money } from '@/lib/shared';

type PayInfo = Pick<Invoice, 'status' | 'paymentStatus' | 'paidAt' | 'totalPaid' | 'balanceDue' | 'currency'>;
const eligible = ['finished', 'accepted', 'confirmed', 'sent'];
const excluded = ['error', 'voided', 'cancelled'];

function localToday() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

export function PaymentBadge({ invoice }: { invoice: PayInfo }) {
  if (invoice.status === 'draft') return <span className="status-pill status-draft" data-testid="badge-payment-none">No emitida</span>;
  if (excluded.includes(invoice.status)) return <span className="status-pill status-draft" data-testid="badge-payment-none">No aplica</span>;
  const paid = invoice.paymentStatus === 'paid';
  const partial = !paid && invoice.totalPaid > 0;
  const title = paid && invoice.paidAt
    ? `Pagada el ${date(invoice.paidAt)}`
    : partial ? `Abonos registrados · saldo restante ${money(invoice.balanceDue, invoice.currency)}` : undefined;
  return <span className={`status-pill ${paid ? 'status-paid' : 'status-sent'}`} title={title} data-testid={`badge-payment-${partial ? 'partial' : invoice.paymentStatus}`}>{paid ? 'Pagada' : partial ? 'Pago parcial' : 'Pendiente de pago'}</span>;
}

export function MarkPaidButton({ invoice }: { invoice: Invoice }) {
  const member = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false } });
  const client = useQueryClient();
  const payment = useCreateInvoicePayment();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(() => String(invoice.balanceDue));
  const [paidOn, setPaidOn] = useState(localToday);
  const [validationError, setValidationError] = useState('');
  const requestRef = useRef<{ signature: string; key: string } | null>(null);
  const isOwner = member.data?.role === 'owner';
  const canPay = isOwner && invoice.paymentStatus === 'pending' && invoice.balanceDue > 0 && eligible.includes(invoice.status);

  const amountNumber = Number(amount);
  const amountCents = Math.round(amountNumber * 100);
  const balanceCents = Math.round(invoice.balanceDue * 100);
  const validAmount = Number.isFinite(amountNumber) && amountCents >= 1 && amountCents <= balanceCents;
  const signature = `${amountCents}|${paidOn}`;

  const openDialog = () => {
    setAmount(String(invoice.balanceDue));
    setPaidOn(localToday());
    setValidationError('');
    payment.reset();
    requestRef.current = null;
    setOpen(true);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError('');
    if (!validAmount) {
      setValidationError('Introduce un importe mayor que 0 y no superior al saldo pendiente.');
      return;
    }
    if (!paidOn) {
      setValidationError('Selecciona la fecha en que se recibió el pago.');
      return;
    }
    if (!requestRef.current || requestRef.current.signature !== signature) {
      requestRef.current = { signature, key: crypto.randomUUID() };
    }
    payment.mutate({
      id: invoice.id,
      data: { amount: amountCents / 100, paidOn, idempotencyKey: requestRef.current.key },
    }, {
      onSuccess: async () => {
        setOpen(false);
        requestRef.current = null;
        await Promise.all([
          client.invalidateQueries({ queryKey: getListInvoicesQueryKey() }),
          client.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoice.id) }),
          client.invalidateQueries({ queryKey: getGetBillingOverviewQueryKey() }),
        ]);
      },
    });
  };

  if (!canPay) return null;

  return <>
    <button className="button button-soft !min-h-8 !px-3 !text-[12px]" onClick={openDialog} data-testid={`button-mark-paid-${invoice.id}`} aria-label={`Registrar abono para la factura ${invoice.number}`}>
      <HandCoins size={14} />Registrar abono
    </button>
    {open && createPortal(<div className="no-print fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1b2f2c]/50 px-4 py-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !payment.isPending) setOpen(false); }} onKeyDown={(event) => { if (event.key === 'Escape' && !payment.isPending) setOpen(false); }}>
      <section className="panel w-full max-w-[480px] p-5 text-left sm:p-6" role="dialog" aria-modal="true" aria-labelledby={`pay-title-${invoice.id}`} aria-describedby={`pay-description-${invoice.id}`}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e7f1e9] text-[#347765]"><ReceiptText size={18} /></span>
          <div><h2 id={`pay-title-${invoice.id}`} className="font-display text-lg font-bold">Registrar un abono</h2>
            <p id={`pay-description-${invoice.id}`} className="mt-1 text-[12px] leading-5 text-[#71817b]"><span className="font-mono font-semibold text-[#315b52]">{invoice.number}</span> · {invoice.customerName}</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl bg-[#f4f3eb] p-3">
          <div><div className="eyebrow">Total</div><div className="mt-1 text-[12px] font-bold">{money(invoice.total, invoice.currency)}</div></div>
          <div><div className="eyebrow">Abonado</div><div className="mt-1 text-[12px] font-bold">{money(invoice.totalPaid, invoice.currency)}</div></div>
          <div><div className="eyebrow">Pendiente</div><div className="mt-1 text-[12px] font-bold text-[#9a712d]">{money(invoice.balanceDue, invoice.currency)}</div></div>
        </div>
        <form className="mt-5" onSubmit={submit} noValidate>
          <label htmlFor={`payment-amount-${invoice.id}`} className="field-label">Importe del abono ({invoice.currency})</label>
          <input id={`payment-amount-${invoice.id}`} className="field tabular-nums" type="number" inputMode="decimal" min="0.01" max={invoice.balanceDue} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} aria-describedby={`amount-hint-${invoice.id}`} aria-invalid={!validAmount} autoFocus data-testid={`input-payment-amount-${invoice.id}`} />
          <p id={`amount-hint-${invoice.id}`} className="mt-1.5 text-[11px] text-[#7c8881]">Máximo disponible: {money(invoice.balanceDue, invoice.currency)}. El saldo restante seguirá pendiente.</p>
          <label htmlFor={`payment-date-${invoice.id}`} className="field-label mt-4">Fecha de recepción</label>
          <input id={`payment-date-${invoice.id}`} className="field" type="date" value={paidOn} max={localToday()} onChange={(event) => setPaidOn(event.target.value)} data-testid={`input-payment-date-${invoice.id}`} />
          {(validationError || payment.isError) && <div className="mt-3 rounded-lg bg-[#fbefeb] px-3 py-2.5 text-[12px] leading-5 text-[#9a3b2e]" role="alert">{validationError || errorDetail(payment.error, 'No se pudo registrar el abono. Puedes volver a intentarlo; el mismo envío conserva su identificador seguro.')}</div>}
          <div className="mt-5 flex flex-col-reverse justify-end gap-2 sm:flex-row">
            <button type="button" className="button button-plain" disabled={payment.isPending} onClick={() => setOpen(false)}>Cancelar</button>
            <button type="submit" className="button button-primary" disabled={payment.isPending || !validAmount || !paidOn} data-testid={`button-confirm-paid-${invoice.id}`}>{payment.isPending ? 'Registrando…' : 'Registrar abono'}</button>
          </div>
        </form>
      </section>
    </div>, document.body)}
  </>;
}

export function CorrectPaidButton({ invoice }: { invoice: Invoice }) {
  const member = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false } });
  const client = useQueryClient();
  const correction = useCorrectInvoicePayment();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [validationError, setValidationError] = useState('');
  const requestRef = useRef<{ reason: string; key: string } | null>(null);
  const isOwner = member.data?.role === 'owner';
  const canCorrect = isOwner && invoice.paymentStatus === 'paid' && invoice.totalPaid > 0;
  const normalizedReason = reason.trim();
  const validReason = normalizedReason.length >= 5 && normalizedReason.length <= 1000;

  const openDialog = () => {
    setReason('');
    setConfirmed(false);
    setValidationError('');
    correction.reset();
    requestRef.current = null;
    setOpen(true);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError('');
    if (!validReason) {
      setValidationError('Escribe un motivo de al menos 5 caracteres.');
      return;
    }
    if (!confirmed) {
      setValidationError('Marca la confirmación antes de continuar.');
      return;
    }
    if (!requestRef.current || requestRef.current.reason !== normalizedReason) {
      requestRef.current = { reason: normalizedReason, key: crypto.randomUUID() };
    }
    correction.mutate({
      id: invoice.id,
      data: { reason: normalizedReason, confirmed: true, idempotencyKey: requestRef.current.key },
    }, {
      onSuccess: async () => {
        setOpen(false);
        requestRef.current = null;
        await Promise.all([
          client.invalidateQueries({ queryKey: getListInvoicesQueryKey() }),
          client.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoice.id) }),
          client.invalidateQueries({ queryKey: getGetBillingOverviewQueryKey() }),
        ]);
      },
    });
  };

  if (!canCorrect) return null;

  return <>
    <button className="button button-plain !min-h-8 !px-3 !text-[12px]" onClick={openDialog} data-testid={`button-correct-paid-${invoice.id}`} aria-label={`Corregir pago de la factura ${invoice.number}`}>
      <RotateCcw size={14} />Corregir pago
    </button>
    {open && createPortal(<div className="no-print fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1b2f2c]/50 px-4 py-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !correction.isPending) setOpen(false); }} onKeyDown={(event) => { if (event.key === 'Escape' && !correction.isPending) setOpen(false); }}>
      <section className="panel w-full max-w-[500px] p-5 text-left sm:p-6" role="alertdialog" aria-modal="true" aria-labelledby={`correct-payment-title-${invoice.id}`} aria-describedby={`correct-payment-description-${invoice.id}`}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#fbefeb] text-[#a04539]"><RotateCcw size={18} /></span>
          <div><h2 id={`correct-payment-title-${invoice.id}`} className="font-display text-lg font-bold">Corregir pago marcado por error</h2>
            <p id={`correct-payment-description-${invoice.id}`} className="mt-1 text-[12px] leading-5 text-[#71817b]"><span className="font-mono font-semibold text-[#315b52]">{invoice.number}</span> · {invoice.customerName}</p>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-[#ead9d1] bg-[#fbf4ef] p-3 text-[12px] leading-5 text-[#795448]">
          El saldo volverá a estar pendiente. El registro original no se borrará y quedarán guardados el motivo, el autor y los importes antes y después.
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-[#f4f3eb] p-3">
          <div><div className="eyebrow">Importe que figura pagado</div><div className="mt-1 text-[12px] font-bold">{money(invoice.totalPaid, invoice.currency)}</div></div>
          <div><div className="eyebrow">Saldo después</div><div className="mt-1 text-[12px] font-bold text-[#9a712d]">{money(invoice.totalPaid, invoice.currency)}</div></div>
        </div>
        <form className="mt-4" onSubmit={submit} noValidate>
          <label htmlFor={`payment-correction-reason-${invoice.id}`} className="field-label">Motivo de la corrección</label>
          <textarea id={`payment-correction-reason-${invoice.id}`} className="field min-h-24 resize-y py-2" maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} aria-invalid={!validReason && reason.length > 0} placeholder="Explica por qué se registró el pago por error" data-testid={`input-payment-correction-reason-${invoice.id}`} />
          <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#e8e5da] p-3 text-[11px] leading-5 text-[#5f736c]">
            <input className="mt-1 accent-[#347765]" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} data-testid={`checkbox-confirm-payment-correction-${invoice.id}`} />
            <span>Confirmo que este pago se marcó por error y autorizo reabrir el saldo pendiente. La evidencia original se conservará.</span>
          </label>
          {(validationError || correction.isError) && <div className="mt-3 rounded-lg bg-[#fbefeb] px-3 py-2.5 text-[12px] leading-5 text-[#9a3b2e]" role="alert">{validationError || errorDetail(correction.error, 'No se pudo corregir el pago. El registro no se ha cambiado; puedes volver a intentarlo.')}</div>}
          <div className="mt-5 flex flex-col-reverse justify-end gap-2 sm:flex-row">
            <button type="button" className="button button-plain" disabled={correction.isPending} onClick={() => setOpen(false)}>Cancelar</button>
            <button type="submit" className="button button-danger" disabled={correction.isPending || !validReason || !confirmed} data-testid={`button-confirm-payment-correction-${invoice.id}`}>{correction.isPending ? 'Guardando corrección…' : 'Confirmar corrección'}</button>
          </div>
        </form>
      </section>
    </div>, document.body)}
  </>;
}

export function InvoicePaymentHistory({ invoice }: { invoice: Invoice }) {
  const [period, setPeriod] = useState<'all' | '30' | '90'>('all');
  const corrections = invoice.paymentCorrections ?? [];
  const sortedPayments = useMemo(() => [...invoice.payments].sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.recordedAt.localeCompare(a.recordedAt)), [invoice.payments]);
  const cutoff = period === 'all' ? null : new Date(Date.now() - Number(period) * 86400000).toISOString().slice(0, 10);
  const visiblePayments = cutoff ? sortedPayments.filter((payment) => payment.paidOn >= cutoff) : sortedPayments;
  const reversedPaymentIds = new Set(corrections.flatMap((entry) =>
    entry.reversedPaymentId === null ? [] : [entry.reversedPaymentId]));

  if (invoice.status === 'draft' || excluded.includes(invoice.status)) return null;

  return <section className="no-print panel mb-5 overflow-hidden" aria-labelledby="payment-history-title">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eeece4] px-4 py-4 sm:px-5">
      <div><div className="eyebrow">Seguimiento de cobros</div><h2 id="payment-history-title" className="font-display mt-1 text-base font-bold">Abonos y saldo</h2></div>
      <label className="flex items-center gap-2 text-[11px] font-semibold text-[#71817b]">Ver
        <select className="field !h-9 !w-auto min-w-[130px] text-[11px]" value={period} onChange={(event) => setPeriod(event.target.value as 'all' | '30' | '90')} aria-label="Filtrar historial de abonos" data-testid="select-payment-history-period">
          <option value="all">Todo el historial</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option>
        </select>
      </label>
    </div>
    <div className="grid grid-cols-3 divide-x divide-[#e8e5da] bg-[#f7f6ef] px-2 py-4 sm:px-5">
      <div className="px-2 sm:px-3"><div className="eyebrow">Total factura</div><div className="mt-1 font-display text-[14px] font-bold sm:text-[17px]">{money(invoice.total, invoice.currency)}</div></div>
      <div className="px-2 sm:px-3"><div className="eyebrow">Total abonado</div><div className="mt-1 font-display text-[14px] font-bold text-[#347765] sm:text-[17px]">{money(invoice.totalPaid, invoice.currency)}</div></div>
      <div className="px-2 sm:px-3"><div className="eyebrow">Saldo pendiente</div><div className="mt-1 font-display text-[14px] font-bold text-[#986821] sm:text-[17px]">{money(invoice.balanceDue, invoice.currency)}</div></div>
    </div>
    <div className="px-4 py-4 sm:px-5">
      <div className="mb-2 flex items-center justify-between"><h3 className="text-[12px] font-bold">Historial de pagos</h3><span className="text-[10px] text-[#87918a]">{visiblePayments.length} {visiblePayments.length === 1 ? 'abono' : 'abonos'}</span></div>
      {visiblePayments.length ? <ul className="divide-y divide-[#eeece4]" data-testid="list-invoice-payments">
        {visiblePayments.map((payment) => <li key={payment.id} className="flex items-center justify-between gap-3 py-3" data-testid={`row-invoice-payment-${payment.id}`}>
          <div><div className={`text-[12px] font-semibold ${reversedPaymentIds.has(payment.id) ? 'text-[#9a3b2e] line-through' : ''}`}>{reversedPaymentIds.has(payment.id) ? 'Pago recibido · reversado' : 'Pago recibido'}</div><div className="mt-1 text-[11px] text-[#75827c]">Fecha de pago · {date(payment.paidOn)}</div></div>
          <div className="shrink-0 text-right"><div className="font-display text-[13px] font-bold">{money(payment.amount, payment.currency || invoice.currency)}</div><div className="mt-1 text-[10px] text-[#87918a]">Registrado · {date(payment.recordedAt)}</div></div>
        </li>)}
      </ul> : <div className="rounded-lg border border-dashed border-[#dedfd4] bg-[#fbfaf5] px-4 py-5 text-center text-[12px] text-[#7b8780]" data-testid="empty-payment-history">{invoice.payments.length ? 'No hay abonos en este período.' : 'Todavía no se han registrado abonos.'}</div>}
      {corrections.length > 0 && <section className="mt-5 border-t border-[#eeece4] pt-4" aria-labelledby="payment-corrections-title">
        <div className="mb-2 flex items-center justify-between"><h3 id="payment-corrections-title" className="text-[12px] font-bold">Correcciones de pago</h3><span className="text-[10px] text-[#87918a]">{corrections.length}</span></div>
        <ul className="divide-y divide-[#eeece4]" data-testid="list-payment-corrections">
          {corrections.map((entry) => <li key={entry.id} className="py-3" data-testid={`row-payment-correction-${entry.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-[12px] font-semibold text-[#9a3b2e]">Pago corregido</div><p className="mt-1 text-[11px] leading-5 text-[#64756e]">{entry.reason}</p></div><div className="text-right text-[10px] text-[#87918a]">{new Date(entry.createdAt).toLocaleString('es-ES')}<div className="mt-1">Por {entry.correctedBy}</div></div></div>
            <div className="mt-2 text-[10px] text-[#71817b]">Antes: {money(entry.beforeTotalPaid, invoice.currency)} · Después: {money(entry.afterTotalPaid, invoice.currency)}{entry.reversedPaymentId !== null ? ` · Abono #${entry.reversedPaymentId} conservado y reversado` : ' · Marca histórica corregida; sin recibo original'}</div>
          </li>)}
        </ul>
      </section>}
    </div>
  </section>;
}

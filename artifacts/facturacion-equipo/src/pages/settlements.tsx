import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCurrentTeamMemberQueryKey, getGetMonthlySettlementQueryKey, useCreateSettlementClassification,
  useCreateSettlementClosure, useCorrectSettlementClosure, useCreateSettlementExpense,
  useCreateSettlementInvoiceInclusion, useGetCurrentTeamMember,
  useCreateSettlementPayment, useGetMonthlySettlement, useRevokeSettlementInvoiceInclusion, useUpdateSettlementExchangeRate,
  useVoidSettlementExpense,
} from '@workspace/api-client-react';
import type { SettlementExpense, SettlementSalesType } from '@workspace/api-client-react';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarDays, Check, CircleDollarSign,
  FileText, LockKeyhole, RefreshCw, ShieldCheck, WalletCards, X,
} from 'lucide-react';
import { EmptyState, PageHeading, QueryError, date, errorDetail, money } from '@/lib/shared';
import { buildPayrollCsv } from '@/lib/payroll-report';

const currentPeriod = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const monthLabel = (period: string) => {
  const [year, month] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
};

const amount = (value: number) => money(value, 'CUP');
const todayISO = () => new Date().toISOString().slice(0, 10);
const salesLabels: Record<SettlementSalesType, string> = { license: 'Licencia', service: 'Servicio' };
const expenseLabels: Record<SettlementExpense['expenseType'], string> = {
  license_cost: 'Costo de licencia',
  operating_expense: 'Gasto operativo',
};

function Metric({ label, value, note, emphasis = false }: { label: string; value: number; note?: string; emphasis?: boolean }) {
  return <div className={`rounded-xl border p-4 ${emphasis ? 'border-[#315e55] bg-[#244a44] text-[#f5f3e9]' : 'border-[#e4e1d5] bg-[#fffefa]'}`}>
    <div className={`eyebrow ${emphasis ? '!text-[#d6bd84]' : ''}`}>{label}</div>
    <div className="font-display mt-3 text-[23px] font-bold tracking-[-.055em]">{amount(value)}</div>
    {note && <div className={`mt-1 text-[10px] ${emphasis ? 'text-[#c3d0c6]' : 'text-[#7a8780]'}`}>{note}</div>}
  </div>;
}

function ReasonDialog({ title, description, busy, onCancel, onConfirm }: {
  title: string; description: string; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim().length >= 5) onConfirm(reason.trim());
  }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#18322f]/45 p-4" role="presentation">
    <form onSubmit={submit} className="w-full max-w-[440px] rounded-2xl border border-[#dedbce] bg-[#fffefa] p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="reason-title">
      <div className="flex items-start justify-between gap-4"><div><div className="eyebrow">Acción con registro de auditoría</div><h2 id="reason-title" className="font-display mt-2 text-xl font-bold">{title}</h2></div><button type="button" className="button button-plain !min-h-8 !w-8 !p-0" onClick={onCancel} aria-label="Cerrar" data-testid="button-close-reason"><X size={15} /></button></div>
      <p className="mt-3 text-[12px] leading-5 text-[#73817a]">{description}</p>
      <label className="mt-5 block"><span className="field-label">Motivo requerido</span><textarea autoFocus className="field" rows={3} minLength={5} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} required aria-label="Motivo de auditoría" data-testid="input-audit-reason" /></label>
      <div className="mt-5 flex justify-end gap-2"><button type="button" className="button button-plain" onClick={onCancel}>Volver</button><button className="button button-danger" type="submit" disabled={busy || reason.trim().length < 5} data-testid="button-confirm-audit">{busy ? 'Guardando…' : 'Confirmar acción'}</button></div>
    </form>
  </div>;
}

function ErrorNotice({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex items-start gap-2 rounded-xl border border-[#efcfc7] bg-[#fbefeb] px-4 py-3 text-[11px] leading-5 text-[#984b40]" role="alert"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{children}</div>;
}

export default function SettlementsPage() {
  const [period, setPeriod] = useState(currentPeriod);
  const [selectedSpecialist, setSelectedSpecialist] = useState('');
  const [auditAction, setAuditAction] = useState<{ kind: 'expense' | 'inclusion' | 'closure'; id: number } | null>(null);
  const [mutationError, setMutationError] = useState('');
  const queryClient = useQueryClient();
  const member = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false } });
  const owner = member.data?.role === 'owner';
  const params = { period };
  const settlement = useGetMonthlySettlement(params, { query: { queryKey: getGetMonthlySettlementQueryKey(params), retry: false } });
  const classify = useCreateSettlementClassification();
  const createExpense = useCreateSettlementExpense();
  const voidExpense = useVoidSettlementExpense();
  const createInclusion = useCreateSettlementInvoiceInclusion();
  const revokeInclusion = useRevokeSettlementInvoiceInclusion();
  const updateRate = useUpdateSettlementExchangeRate();
  const createPayment = useCreateSettlementPayment();
  const createClosure = useCreateSettlementClosure();
  const correctClosure = useCorrectSettlementClosure();
  const busy = classify.isPending || createExpense.isPending || voidExpense.isPending || createInclusion.isPending || revokeInclusion.isPending || updateRate.isPending || createPayment.isPending || createClosure.isPending || correctClosure.isPending;
  const data = settlement.data;
  const results = data?.results ?? [];
  const activeResult = useMemo(() => results.find((result) => result.specialistId === selectedSpecialist) ?? results[0], [results, selectedSpecialist]);

  function refreshPeriod() {
    void queryClient.invalidateQueries({ queryKey: getGetMonthlySettlementQueryKey({ period }) });
  }
  function runMutation(action: () => void) {
    setMutationError('');
    action();
  }
  function handleMutationError(error: unknown) {
    setMutationError(errorDetail(error, 'No se pudo guardar el cambio. Comprueba tus permisos y vuelve a intentarlo.'));
  }
  function onClassify(invoiceLineId: number, salesType: SettlementSalesType, serviceCode?: string | null) {
    runMutation(() => classify.mutate({
      data: serviceCode ? { serviceCode, salesType } : { invoiceLineId, salesType },
    }, { onSuccess: refreshPeriod, onError: handleMutationError }));
  }
  function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    runMutation(() => createExpense.mutate({
      data: {
        period, specialistId: String(form.get('specialistId') || ''),
        expenseType: String(form.get('expenseType')) as 'license_cost' | 'operating_expense',
        amount: Number(form.get('amount')), currency: String(form.get('currency') || 'CUP').trim().toUpperCase(),
        description: String(form.get('description') || '').trim(),
      },
    }, { onSuccess: () => { formElement.reset(); refreshPeriod(); }, onError: handleMutationError }));
  }
  function addRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (String(form.get('currency') || '').trim().toUpperCase() === 'CUP') {
      setMutationError('La tasa CUP es fija en 1 y no se puede modificar.');
      return;
    }
    runMutation(() => updateRate.mutate({ data: { period, currency: String(form.get('currency') || '').trim().toUpperCase(), rateToCup: Number(form.get('rateToCup')) } }, {
      onSuccess: () => { formElement.reset(); refreshPeriod(); }, onError: handleMutationError,
    }));
  }
  function includeInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    runMutation(() => createInclusion.mutate({ data: { invoiceId: Number(form.get('invoiceId')), period, reason: String(form.get('reason') || '').trim() } }, {
      onSuccess: () => { formElement.reset(); refreshPeriod(); }, onError: handleMutationError,
    }));
  }
  function addSettlementPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeResult) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    runMutation(() => createPayment.mutate({
      data: {
        period,
        specialistId: activeResult.specialistId,
        amount: Number(form.get('amount')),
        paidOn: String(form.get('paidOn') || ''),
        reference: String(form.get('reference') || '').trim(),
        confirmReview: form.get('confirmReview') === 'on',
      },
    }, { onSuccess: () => { formElement.reset(); refreshPeriod(); }, onError: handleMutationError }));
  }
  function closeSettlement() {
    if (!owner || !activeResult || blockers > 0) return;
    if (!window.confirm(`¿Aprobar y cerrar la liquidación de ${activeResult.specialistName} por ${amount(activeResult.totals.netPayable)}? El desglose quedará guardado como versión 1.`)) return;
    runMutation(() => createClosure.mutate({
      data: { period, specialistId: activeResult.specialistId },
    }, { onSuccess: refreshPeriod, onError: handleMutationError }));
  }
  function correctSettlement(reason: string) {
    if (!activeResult?.closure) return;
    const closureId = activeResult.closure.id;
    runMutation(() => correctClosure.mutate({
      id: closureId,
      data: { reason },
    }, {
      onSuccess: () => { setAuditAction(null); refreshPeriod(); },
      onError: handleMutationError,
    }));
  }
  const currencies = useMemo(() => {
    const values = new Set<string>(['CUP']);
    for (const result of results) {
      result.invoices.forEach((invoice) => values.add(invoice.currency.toUpperCase()));
      result.expenses.forEach((expense) => values.add(expense.currency.toUpperCase()));
    }
    data?.unpaidCandidates.forEach((invoice) => values.add(invoice.currency.toUpperCase()));
    data?.exchangeRates.forEach((rate) => values.add(rate.currency.toUpperCase()));
    return [...values].sort((a, b) => a === 'CUP' ? -1 : b === 'CUP' ? 1 : a.localeCompare(b));
  }, [data, results]);
  const rateFor = (currency: string) => currency.toUpperCase() === 'CUP' ? 1 : data?.exchangeRates.find((rate) => rate.currency.toUpperCase() === currency.toUpperCase())?.rateToCup;
  const blockers = (activeResult?.missingServiceCount ?? 0) + (activeResult?.missingCurrencies.length ?? 0);
  const inclusionCandidates = useMemo(() => data?.unpaidCandidates.filter((candidate) => !results.some((result) => result.invoices.some((invoice) => invoice.invoiceId === candidate.invoiceId && invoice.inclusionType === 'manual'))) ?? [], [data, results]);
  const salesResults = useMemo(
    () => results.filter((result) => (result.closure?.snapshot.invoices ?? result.invoices).length > 0),
    [results],
  );
  const reportBlockers = salesResults.filter((result) => !result.closure && (result.missingServiceCount > 0 || result.missingCurrencies.length > 0));
  const displayedTotals = activeResult?.closure?.snapshot.totals ?? activeResult?.totals;
  const displayedInvoices = activeResult?.closure?.snapshot.invoices ?? activeResult?.invoices ?? [];
  const displayedExpenses = activeResult?.closure?.snapshot.expenses ?? activeResult?.expenses ?? [];
  const paymentBlockers = activeResult?.closure ? 0 : blockers;

  function downloadPayrollReport() {
    if (!owner || salesResults.length === 0 || reportBlockers.length > 0) return;
    const csv = buildPayrollCsv(period, salesResults.map((result) => ({
      specialistName: result.specialistName,
      includedInvoiceCount: (result.closure?.snapshot.invoices ?? result.invoices).length,
      manualInclusionCount: (result.closure?.snapshot.invoices ?? result.invoices).filter((invoice) => invoice.inclusionType === 'manual').length,
      ...(result.closure?.snapshot.totals ?? result.totals),
    })));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nomina-${period}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="fade-in mx-auto max-w-[1180px]">
    <PageHeading eyebrow="Cierre y transparencia" title="Liquidación mensual" description="Misma plantilla para todos. Cada especialista ve solo su cálculo; el administrador puede consultar todo el equipo y descargar la nómina del mes." action={<label className="flex items-center gap-2 rounded-xl border border-[#e1ded2] bg-[#fffefa] px-3 py-2"><CalendarDays size={15} className="text-[#688078]" /><span className="sr-only">Período mensual</span><input type="month" className="border-0 bg-transparent text-[12px] font-semibold text-[#29443e] outline-none" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Período mensual" data-testid="input-settlement-period" /></label>} />
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#e8d8b2] bg-[#fbf2df] px-4 py-3.5 text-[#725b2c]" role="note">
      <ShieldCheck size={17} className="mt-0.5 shrink-0" /><p className="text-[11px] leading-5"><strong className="font-bold">Importante:</strong> el neto estimado no se considera pagado hasta que el propietario registre la transferencia. Si el cálculo tiene bloqueos, el saldo aún no está listo para pagar.</p>
    </div>

    {mutationError && <ErrorNotice>{mutationError}{mutationError.includes('403') || mutationError.toLowerCase().includes('forbidden') ? ' Tu cuenta no tiene permiso para esta acción.' : ''}</ErrorNotice>}
    {member.isError && <ErrorNotice>No pudimos comprobar el rol de tu cuenta. Los controles de propietario permanecerán ocultos. {errorDetail(member.error, '')}</ErrorNotice>}
    {settlement.isLoading ? <div className="space-y-5" aria-label="Cargando liquidación"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0,1,2,3].map((item) => <div className="panel p-5" key={item}><div className="skeleton h-3 w-24" /><div className="skeleton mt-4 h-8 w-32" /></div>)}</div><div className="panel space-y-3 p-5">{[0,1,2,3].map((item) => <div key={item} className="skeleton h-10" />)}</div></div> :
      settlement.isError || !data ? <QueryError retry={() => settlement.refetch()} message="No se pudo cargar la liquidación." detail={errorDetail(settlement.error, 'Comprueba la conexión e inténtalo otra vez. Si recibes un error 403, el servidor no autorizó la consulta.')} /> :
      <>
         {owner && results.length > 1 && <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e4e1d5] bg-[#efeee5] p-3.5"><div><div className="eyebrow">Vista del propietario</div><div className="mt-1 text-[11px] text-[#74817b]">Selecciona un registro para revisar su detalle.</div></div><label className="min-w-[220px]"><span className="sr-only">Especialista</span><select className="field !h-10" value={activeResult?.specialistId ?? ''} onChange={(event) => setSelectedSpecialist(event.target.value)} aria-label="Seleccionar especialista" data-testid="select-settlement-specialist">{results.map((result) => <option key={result.specialistId} value={result.specialistId}>{result.specialistName}</option>)}</select></label></div>}
         {owner && <section className="panel mb-5 overflow-hidden" aria-labelledby="payroll-roster-title">
           <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eeece4] px-5 py-4">
             <div><div className="eyebrow">{monthLabel(period)} · Nóminas</div><h2 id="payroll-roster-title" className="font-display mt-1 text-lg font-bold">Especialistas con ventas</h2><p className="mt-1 text-[10px] text-[#78847d]">Incluye especialistas con facturas participantes en el cálculo del mes.</p></div>
             <button type="button" className="button button-primary" onClick={downloadPayrollReport} disabled={!salesResults.length || reportBlockers.length > 0} title={reportBlockers.length ? 'Completa las clasificaciones y tasas antes de descargar.' : undefined} data-testid="button-export-payroll"><FileText size={15} />Descargar nómina CSV</button>
           </div>
           {reportBlockers.length > 0 && <div className="border-b border-[#e6c69f] bg-[#fbf0df] px-5 py-3 text-[10px] leading-5 text-[#77551d]" role="alert">No se puede descargar todavía: faltan clasificaciones o tasas para {reportBlockers.map((result) => result.specialistName).join(', ')}.</div>}
           {!salesResults.length ? <EmptyState title="Sin ventas incluidas" text="No hay facturas participantes en el cálculo de este período." /> :
             <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left">
               <thead><tr className="eyebrow"><th className="px-5 py-3 font-medium">Especialista</th><th className="px-4 py-3 text-right font-medium">Facturas</th><th className="px-4 py-3 text-right font-medium">Base de distribución</th><th className="px-4 py-3 text-right font-medium">Salario devengado</th><th className="px-4 py-3 text-right font-medium">CESS</th><th className="px-4 py-3 text-right font-medium">Impuesto personal</th><th className="px-4 py-3 text-right font-medium">Neto estimado</th><th className="px-5 py-3 font-medium">Detalle</th></tr></thead>
               <tbody>{salesResults.map((result) => {
                  const incomplete = !result.closure && (result.missingServiceCount > 0 || result.missingCurrencies.length > 0);
                  const payrollTotals = result.closure?.snapshot.totals ?? result.totals;
                 return <tr key={result.specialistId} className="table-row" data-testid={`payroll-row-${result.specialistId}`}>
                   <td className="px-5 py-3 text-[11px] font-semibold">{result.specialistName}<div className="mt-1 text-[9px] font-normal text-[#7c8982]">{result.invoices.filter((invoice) => invoice.inclusionType === 'manual').length} excepción(es) manual(es)</div></td>
                   <td className="px-4 py-3 text-right font-mono text-[11px]">{result.invoices.length}</td>
                    <td className="px-4 py-3 text-right font-mono text-[10px]">{amount(payrollTotals.distributionBase)}</td>
                    <td className="px-4 py-3 text-right font-mono text-[10px]">{amount(payrollTotals.salaryAccrued)}</td>
                    <td className="px-4 py-3 text-right font-mono text-[10px]">{amount(payrollTotals.cess)}</td>
                    <td className="px-4 py-3 text-right font-mono text-[10px]">{amount(payrollTotals.incomeTax)}</td>
                    <td className="px-4 py-3 text-right font-mono text-[10px]">{incomplete ? <span className="font-sans text-[#9c6a27]">Incompleto</span> : amount(payrollTotals.netPayable)}</td>
                   <td className="px-5 py-3"><button type="button" className="button button-soft !min-h-8 !px-3 text-[10px]" onClick={() => setSelectedSpecialist(result.specialistId)} aria-label={`Ver cálculo de ${result.specialistName}`}>Ver cálculo</button></td>
                 </tr>;
               })}</tbody>
             </table></div>}
         </section>}
        {!activeResult ? <div className="panel"><EmptyState title="Sin liquidaciones para este período" text="Cuando haya facturas incluidas en el mes, el resumen de compensación aparecerá aquí." /></div> : <>
          <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={`Resumen de ${activeResult.specialistName}`}>
            <Metric label="Licencias brutas" value={displayedTotals?.grossLicenses ?? 0} note="Ingresos clasificados como licencia" />
            <Metric label="Servicios brutos" value={displayedTotals?.grossServices ?? 0} note="Ingresos clasificados como servicio" />
            <Metric label="Base de distribución" value={displayedTotals?.distributionBase ?? 0} note="Tras impuestos y costos aplicables" />
            <Metric label={activeResult.closure ? "Neto aprobado" : "Neto estimado"} value={displayedTotals?.netPayable ?? 0} note={activeResult.closure ? `Cierre aprobado · versión ${activeResult.closure.version}` : "Preliminar · no es un pago registrado"} emphasis />
          </section>
          <section className="panel mb-5 overflow-hidden" aria-labelledby="settlement-payment-title">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eeece4] px-5 py-4">
              <div><div className="eyebrow">{monthLabel(period)} · Pago al especialista</div><h2 id="settlement-payment-title" className="font-display mt-1 text-lg font-bold">Estado de la liquidación</h2></div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`status-pill ${activeResult.closure ? 'status-paid' : 'status-draft'}`}>{activeResult.closure ? `Cerrada · v${activeResult.closure.version}` : 'Preliminar'}</span>
                <span className={`status-pill ${activeResult.paymentStatus === 'paid' ? 'status-paid' : activeResult.paymentStatus === 'partial' ? 'status-sent' : 'status-draft'}`}>
                  {activeResult.paymentStatus === 'paid' ? 'Pagada' : activeResult.paymentStatus === 'partial' ? 'Pago parcial' : 'Pendiente'}
                </span>
                {owner && (activeResult.closure
                  ? <button type="button" className="button button-soft !min-h-8 !px-3 text-[10px]" onClick={() => setAuditAction({ kind: 'closure', id: activeResult.closure!.id })} disabled={busy} data-testid="button-correct-settlement-closure">Registrar corrección</button>
                  : <button type="button" className="button button-primary !min-h-8 !px-3 text-[10px]" onClick={closeSettlement} disabled={busy || blockers > 0} title={blockers ? 'Resuelve las clasificaciones y tasas pendientes antes de cerrar.' : undefined} data-testid="button-close-settlement">{createClosure.isPending ? 'Cerrando…' : 'Aprobar y cerrar'}</button>)}
              </div>
            </div>
            <div className="grid gap-3 border-b border-[#eeece4] p-5 sm:grid-cols-3">
              <Metric label={activeResult.closure ? "Neto aprobado" : "Neto estimado"} value={displayedTotals?.netPayable ?? 0} note={activeResult.closure ? "Importe congelado en el cierre" : "El cálculo sigue siendo preliminar"} />
              <Metric label="Pagado" value={activeResult.paidAmount} note={activeResult.payments.length ? `${activeResult.payments.length} transferencia(s) registrada(s)` : 'Sin transferencias registradas'} />
              <Metric label={activeResult.closure ? "Saldo aprobado" : "Pendiente estimado"} value={activeResult.pendingAmount} note={paymentBlockers ? 'Estimación incompleta; revisa los bloqueos antes de usarla' : 'Saldo calculado después de los pagos registrados'} emphasis />
            </div>
            {activeResult.payments.length > 0 && <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left">
                <thead><tr className="eyebrow"><th className="px-5 py-3 font-medium">Fecha de pago</th><th className="px-4 py-3 font-medium">Referencia</th><th className="px-4 py-3 text-right font-medium">Importe</th><th className="px-5 py-3 font-medium">Registrado</th></tr></thead>
                <tbody>{activeResult.payments.map((payment) => <tr key={payment.id} className="table-row" data-testid={`settlement-payment-${payment.id}`}>
                  <td className="px-5 py-3 text-[11px]">{date(payment.paidOn)}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">{payment.reference}</td>
                  <td className="px-4 py-3 text-right font-mono text-[11px]">{amount(payment.amount)}</td>
                  <td className="px-5 py-3 text-[10px] text-[#78847d]">{date(payment.recordedAt)}</td>
                </tr>)}</tbody>
              </table>
            </div>}
            {owner && <form key={`${activeResult.specialistId}-${activeResult.pendingAmount}`} className="grid gap-3 border-t border-[#eeece4] bg-[#fbfaf5] p-5 md:grid-cols-[1fr_1fr_1.4fr_auto]" onSubmit={addSettlementPayment}>
              <label><span className="field-label">Importe transferido (CUP)</span><input name="amount" className="field" type="number" min="0.01" max={activeResult.pendingAmount} step="0.01" required defaultValue={activeResult.pendingAmount > 0 ? activeResult.pendingAmount.toFixed(2) : ''} disabled={busy || paymentBlockers > 0 || activeResult.pendingAmount <= 0} data-testid="input-settlement-payment-amount" /></label>
              <label><span className="field-label">Fecha del pago</span><input name="paidOn" className="field" type="date" required max={todayISO()} defaultValue={todayISO()} disabled={busy || paymentBlockers > 0 || activeResult.pendingAmount <= 0} data-testid="input-settlement-payment-date" /></label>
              <label><span className="field-label">Referencia de transferencia</span><input name="reference" className="field" required maxLength={200} placeholder="Número de operación o comprobante" disabled={busy || paymentBlockers > 0 || activeResult.pendingAmount <= 0} data-testid="input-settlement-payment-reference" /></label>
              <div className="flex items-end"><button className="button button-primary w-full" type="submit" disabled={busy || paymentBlockers > 0 || activeResult.pendingAmount <= 0} data-testid="button-record-settlement-payment">{createPayment.isPending ? 'Registrando…' : 'Registrar pago'}</button></div>
              <label className="flex items-start gap-2 text-[10px] leading-4 text-[#68776f] md:col-span-4"><input name="confirmReview" type="checkbox" required disabled={busy || paymentBlockers > 0 || activeResult.pendingAmount <= 0} className="mt-0.5 accent-[#28665e]" data-testid="checkbox-confirm-settlement-review" /><span>Confirmo que revisé este cálculo antes de registrar el pago.</span></label>
              {blockers > 0 && <p className="text-[10px] leading-4 text-[#9c6a27] md:col-span-4">Completa las clasificaciones y tasas pendientes antes de registrar el pago.</p>}
            </form>}
          </section>
          {activeResult.closure && <section className="panel mb-5 overflow-hidden" aria-labelledby="closure-history-title">
            <div className="border-b border-[#eeece4] px-5 py-4"><div className="eyebrow">Importe aprobado · {amount(activeResult.closure.snapshot.totals.netPayable)}</div><h2 id="closure-history-title" className="font-display mt-1 text-lg font-bold">Cierre y correcciones</h2><p className="mt-1 text-[11px] leading-5 text-[#77847e]">El desglose aprobado no cambia si se editan después las facturas, gastos o tasas. Una corrección crea una versión nueva y conserva las anteriores.</p></div>
            <div className="grid gap-4 p-5 lg:grid-cols-[1fr_1fr]">
              <div><div className="eyebrow mb-2">Versiones conservadas</div><ol className="space-y-2">{activeResult.closureHistory.map((closure) => <li key={closure.id} className="rounded-lg border border-[#e9e6dc] bg-[#fbfaf5] px-3 py-2.5 text-[10px] leading-5" data-testid={`settlement-closure-version-${closure.version}`}><strong className="text-[#29443e]">Versión {closure.version}</strong><span className="ml-2 text-[#78847d]">{amount(closure.snapshot.totals.netPayable)} · {date(closure.approvedAt)}</span><div className="text-[#78847d]">Aprobó: {closure.approvedBy}</div>{closure.correctionReason && <div className="mt-1 text-[#766747]">Motivo: {closure.correctionReason}</div>}</li>)}</ol></div>
              <div><div className="eyebrow mb-2">Tasas y reglas guardadas</div><div className="rounded-lg border border-[#e9e6dc] bg-[#fbfaf5] px-3 py-2.5 text-[10px] leading-5 text-[#68776f]"><div>{activeResult.closure.snapshot.exchangeRates.length ? activeResult.closure.snapshot.exchangeRates.map((rate) => `${rate.currency}: ${Number(rate.rateToCup).toLocaleString('es')} CUP (actualizada ${date(rate.updatedAt)} por ${rate.updatedBy})`).join(' · ') : 'Solo CUP; tasa fija 1:1.'}</div><div className="mt-1">Modelo {activeResult.closure.snapshot.rules.calculationVersion} · Impuesto sobre ventas: {activeResult.closure.snapshot.rules.salesTaxRate * 100}% · Licencias: {activeResult.closure.snapshot.rules.licenseShare * 100}% · Servicios: {activeResult.closure.snapshot.rules.serviceShare * 100}% · Coeficiente salarial: {activeResult.closure.snapshot.rules.salaryCoefficient}</div><div className="mt-1">CESS: {activeResult.closure.snapshot.rules.cessBrackets.map((bracket) => `${bracket.rate * 100}%${bracket.limit ? ` hasta ${amount(bracket.limit)}` : ' sobre el excedente'}`).join(' y ')}</div><div className="mt-1">Escala de impuesto personal: {activeResult.closure.snapshot.rules.incomeTaxBrackets.map((bracket) => `${bracket.rate * 100}%${bracket.limit ? ` hasta ${amount(bracket.limit)}` : ' sobre el excedente'}`).join(' · ')}</div><ol className="mt-2 list-decimal space-y-1 pl-4">{activeResult.closure.snapshot.rules.calculationSteps.map((step) => <li key={step}>{step}</li>)}</ol></div></div>
            </div>
          </section>}
          {blockers > 0 && <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#e6c69f] bg-[#fbf0df] px-4 py-3 text-[#77551d]" role="alert"><LockKeyhole size={16} className="mt-0.5 shrink-0" /><div className="text-[11px] leading-5"><strong className="font-bold">Cálculo incompleto: hay bloqueos que no se excluyen en silencio.</strong><br />{activeResult.missingServiceCount > 0 && `${activeResult.missingServiceCount} línea(s) sin clasificación.`} {activeResult.missingCurrencies.length > 0 && `Falta la tasa de cambio para ${activeResult.missingCurrencies.join(', ')}.`} Revisa las alertas del detalle antes de usar esta estimación.</div></div>}
          <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
            <section className="panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eeece4] px-5 py-4"><div><div className="eyebrow">{monthLabel(period)} · {data.baseCurrency}</div><h2 className="font-display mt-1 text-lg font-bold">{activeResult.closure ? 'Desglose guardado del cierre' : 'Desglose de la estimación'}</h2></div><span className={`status-pill ${blockers && !activeResult.closure ? 'status-sent' : 'status-paid'}`}>{blockers && !activeResult.closure ? `${blockers} bloqueos` : activeResult.closure ? `Versión aprobada ${activeResult.closure.version}` : 'Sin bloqueos'}</span></div>
              <div className="divide-y divide-[#eeece4]">
                {([
                   { label: 'Ingresos por licencias', value: displayedTotals?.grossLicenses ?? 0, icon: ArrowUpRight },
                   { label: 'Ingresos por servicios', value: displayedTotals?.grossServices ?? 0, icon: ArrowUpRight },
                   { label: 'Impuesto sobre ventas', value: -(displayedTotals?.salesTax ?? 0), icon: ArrowDownRight },
                   { label: 'Costos de licencias', value: -(displayedTotals?.licenseCosts ?? 0), icon: ArrowDownRight },
                   { label: 'Gastos operativos', value: -(displayedTotals?.operatingExpenses ?? 0), icon: ArrowDownRight },
                   { label: 'Neto de licencias', value: displayedTotals?.netLicenses ?? 0, icon: null },
                   { label: 'Neto de servicios', value: displayedTotals?.netServices ?? 0, icon: null },
                   { label: 'Salario devengado', value: displayedTotals?.salaryAccrued ?? 0, icon: null },
                   { label: 'CESS', value: -(displayedTotals?.cess ?? 0), icon: ArrowDownRight },
                   { label: 'Impuesto sobre ingresos', value: -(displayedTotals?.incomeTax ?? 0), icon: ArrowDownRight },
                ] as const).map(({ label, value, icon: Icon }) => <div key={label} className="flex items-center justify-between gap-4 px-5 py-3"><span className="flex items-center gap-2 text-[12px] text-[#62736c]">{Icon && <Icon size={13} className={value < 0 ? 'text-[#aa6b4f]' : 'text-[#528274]'} />}{label}</span><span className="font-mono text-[12px] font-semibold tabular-nums">{amount(Math.abs(value))}{value < 0 ? ' −' : ''}</span></div>)}
                 <div className="flex items-center justify-between gap-4 bg-[#f3f3e9] px-5 py-4"><span className="font-display text-[13px] font-bold">{activeResult.closure ? 'Neto aprobado · congelado' : 'Neto estimado · preliminar'}</span><span className="font-display text-[19px] font-extrabold tracking-[-.04em] text-[#28665e]">{amount(displayedTotals?.netPayable ?? 0)}</span></div>
              </div>
               <div className="border-t border-[#eeece4] bg-[#fbfaf5] px-5 py-3 text-[10px] leading-5 text-[#78847d]">{activeResult.closure ? 'El total conserva las tasas y reglas guardadas al aprobar; cada línea incluye su conversión original a CUP.' : 'Todos los valores del cálculo se convierten a CUP. La tasa CUP es fija en 1; las demás tasas corresponden a este período.'}</div>
            </section>
            <section className="panel overflow-hidden">
              <div className="border-b border-[#eeece4] px-5 py-4"><div className="eyebrow">Actividad incluida</div><h2 className="font-display mt-1 text-lg font-bold">Facturas del período</h2></div>
               {!displayedInvoices.length ? <EmptyState title="No hay facturas incluidas" text="No se han registrado cobros del período ni inclusiones excepcionales para este especialista." /> :
                 <div className="divide-y divide-[#eeece4]">{displayedInvoices.map((invoice) => <article key={`${invoice.invoiceId}-${'inclusionId' in invoice ? invoice.inclusionId ?? 'paid' : 'closed'}`} className="px-5 py-4" data-testid={`settlement-invoice-${invoice.invoiceId}`}>
                  <div className="flex items-start justify-between gap-3"><div><div className="font-mono text-[11px] font-semibold text-[#39746a]">{invoice.invoiceNumber}</div><div className="mt-1 text-[12px] font-bold">{invoice.customerName}</div></div><div className="text-right"><div className="text-[12px] font-bold">{money(invoice.total, invoice.currency)}</div><div className="mt-1 text-[10px] text-[#829087]">Importe original · {invoice.inclusionType === 'manual' ? 'Excepción' : 'Cobro del mes'}</div></div></div>
                  <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-[#7b8780]"><span>Emisión {date(invoice.issueDate)}{invoice.paidOn ? ` · Cobro ${date(invoice.paidOn)}` : ''}</span><span>Saldo pendiente: {money(invoice.balanceDue, invoice.currency)}</span></div>
                  {invoice.inclusionReason && <div className="mt-2 rounded-lg bg-[#f4f2e9] px-3 py-2 text-[10px] leading-4 text-[#766747]">Motivo de inclusión: {invoice.inclusionReason}</div>}
                  {invoice.lines.map((line) => <div key={line.invoiceLineId} className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#f0eee7] pt-2 text-[10px]">
                    <span className="min-w-[120px] flex-1 text-[#64746d]">{line.description}<span className="ml-1 text-[#98a098]">× {line.quantity}</span></span>
                     <span className="font-mono text-[10px]">{line.salesType ? salesLabels[line.salesType] : 'Sin clasificar'} · {('amountInCup' in line) ? amount(line.amountInCup) : rateFor(invoice.currency) === undefined ? 'Tasa pendiente' : amount(line.amount * (rateFor(invoice.currency) ?? 0))}</span>
                     {owner && !activeResult.closure && <select className="field !h-8 !w-[128px] !px-2 text-[10px]" value={line.salesType ?? ''} aria-label={`Clasificar ${line.description}`} disabled={busy} onChange={(event) => event.target.value && onClassify(line.invoiceLineId, event.target.value as SettlementSalesType)} data-testid={`select-line-classification-${line.invoiceLineId}`}><option value="" disabled>Clasificar como…</option><option value="license">Licencia</option><option value="service">Servicio</option></select>}
                  </div>)}
                   {owner && !activeResult.closure && 'inclusionId' in invoice && invoice.inclusionType === 'manual' && invoice.inclusionId && <button className="mt-3 text-[10px] font-bold text-[#a04e42] underline decoration-[#e6c4bd] underline-offset-2" onClick={() => setAuditAction({ kind: 'inclusion', id: invoice.inclusionId! })} data-testid={`button-revoke-inclusion-${invoice.inclusionId}`}>Revocar inclusión</button>}
                </article>)}</div>}
            </section>
          </div>

          <section className="panel mt-5 overflow-hidden">
             <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eeece4] px-5 py-4"><div><div className="eyebrow">Rastreo de datos</div><h2 className="font-display mt-1 text-lg font-bold">{activeResult.closure ? 'Gastos guardados en el cierre' : 'Gastos del mes'}</h2></div><span className="text-[11px] text-[#79867f]">{displayedExpenses.filter((expense) => !expense.voidedAt).length} activos</span></div>
             {!displayedExpenses.length ? <EmptyState title="Sin gastos registrados" text="Los costos de licencia y gastos operativos asociados a este especialista se mostrarán aquí." /> : <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left"><thead><tr className="eyebrow"><th className="px-5 py-3 font-medium">Concepto</th><th className="px-4 py-3 font-medium">Tipo</th><th className="px-4 py-3 font-medium">Registrado</th><th className="px-5 py-3 text-right font-medium">Importe</th><th className="px-5 py-3" /></tr></thead><tbody>{displayedExpenses.map((expense) => <tr key={expense.id} className={`table-row ${expense.voidedAt ? 'opacity-55' : ''}`}><td className="px-5 py-3 text-[12px] font-semibold">{expense.description}{expense.voidedAt && <div className="mt-1 text-[10px] text-[#a04e42]">Anulado: {expense.voidReason}</div>}</td><td className="px-4 py-3 text-[11px] text-[#718078]">{expenseLabels[expense.expenseType]}</td><td className="px-4 py-3 text-[10px] text-[#849089]">{date(expense.createdAt)}</td><td className="px-5 py-3 text-right font-mono text-[11px]">{'amountInCup' in expense ? amount(expense.amountInCup) : rateFor(expense.currency) === undefined ? <span className="text-[#9c632d]">Tasa pendiente</span> : amount(expense.amount * (rateFor(expense.currency) ?? 0))}</td><td className="px-5 py-3 text-right">{owner && !activeResult.closure && !expense.voidedAt && <button className="text-[10px] font-bold text-[#a04e42] underline decoration-[#e6c4bd] underline-offset-2" onClick={() => setAuditAction({ kind: 'expense', id: expense.id })} data-testid={`button-void-expense-${expense.id}`}>Anular</button>}</td></tr>)}</tbody></table></div>}
          </section>

          {owner && <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <section className="panel p-5 md:p-6">
              <div className="mb-4 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e6f0e9] text-[#367565]"><CircleDollarSign size={17} /></span><div><div className="eyebrow">Ajustes del período</div><h2 className="font-display text-base font-bold">Registrar un gasto</h2></div></div>
              {results.length ? <form key={activeResult.specialistId} className="grid gap-3 sm:grid-cols-2" onSubmit={addExpense}>
                <label><span className="field-label">Especialista</span><select name="specialistId" className="field" required defaultValue={activeResult.specialistId} data-testid="select-expense-specialist">{results.map((result) => <option key={result.specialistId} value={result.specialistId}>{result.specialistName}</option>)}</select></label>
                <label><span className="field-label">Tipo de gasto</span><select name="expenseType" className="field" required defaultValue="operating_expense" data-testid="select-expense-type"><option value="license_cost">Costo de licencia</option><option value="operating_expense">Gasto operativo</option></select></label>
                <label><span className="field-label">Importe original</span><input name="amount" type="number" step="0.01" min="0.01" className="field" required placeholder="0,00" data-testid="input-expense-amount" /></label>
                <label><span className="field-label">Moneda</span><input name="currency" className="field" list="settlement-currencies" defaultValue="CUP" required maxLength={40} aria-label="Moneda del gasto" data-testid="input-expense-currency" /></label>
                <label className="sm:col-span-2"><span className="field-label">Descripción</span><input name="description" className="field" required maxLength={200} placeholder="Motivo o referencia del gasto" data-testid="input-expense-description" /></label>
                <button className="button button-primary sm:col-span-2 sm:justify-self-end" type="submit" disabled={busy} data-testid="button-create-expense">{createExpense.isPending ? 'Registrando…' : 'Añadir gasto'}</button>
              </form> : <p className="text-[12px] text-[#77847e]">No hay especialistas disponibles para este período.</p>}
            </section>
            <section className="panel p-5 md:p-6">
              <div className="mb-4 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f7edd9] text-[#9d7739]"><RefreshCw size={16} /></span><div><div className="eyebrow">Conversión a CUP</div><h2 className="font-display text-base font-bold">Tasas de cambio</h2></div></div>
              <div className="mb-4 divide-y divide-[#eeece4] rounded-lg border border-[#ece9df]">{currencies.map((currency) => {
                const rate = rateFor(currency);
                const entry = data.exchangeRates.find((item) => item.currency.toUpperCase() === currency);
                return <div key={currency} className="flex items-center justify-between gap-3 px-3 py-2.5"><span className="font-mono text-[11px] font-semibold">{currency}</span><span className="text-right text-[10px] text-[#77847e]">{currency === 'CUP' ? '1 CUP = 1 CUP · fija' : rate === undefined ? 'Falta tasa para el período' : `1 ${currency} = ${Number(rate).toLocaleString('es')} CUP`}{entry && <span className="block mt-0.5 text-[9px]">Actualizada {date(entry.updatedAt)}</span>}</span></div>;
              })}</div>
              <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={addRate}><label><span className="field-label">Moneda</span><input name="currency" className="field" list="settlement-currencies" required maxLength={40} placeholder="USD" aria-label="Moneda para tasa" data-testid="input-rate-currency" /></label><label><span className="field-label">Unidades CUP por moneda</span><input name="rateToCup" className="field" type="number" min="0.000001" step="any" required data-testid="input-rate-value" /></label><button className="button button-primary" type="submit" disabled={busy} data-testid="button-save-rate">{updateRate.isPending ? 'Guardando…' : 'Guardar tasa'}</button></form>
            </section>
            <section className="panel p-5 md:p-6 xl:col-span-2">
              <div className="mb-4 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f7edd9] text-[#9d7739]"><FileText size={16} /></span><div><div className="eyebrow">Excepción auditable</div><h2 className="font-display text-base font-bold">Incluir factura confirmada sin cobrar</h2></div></div>
              {inclusionCandidates.length ? <form onSubmit={includeInvoice} className="grid gap-3 md:grid-cols-[1.2fr_1.8fr_auto] md:items-end">
                <label><span className="field-label">Factura confirmada</span><select name="invoiceId" className="field" required defaultValue="" data-testid="select-unpaid-invoice"><option value="" disabled>Seleccionar factura…</option>{inclusionCandidates.map((candidate) => <option key={candidate.invoiceId} value={candidate.invoiceId}>{candidate.invoiceNumber} · {candidate.customerName} · {money(candidate.balanceDue, candidate.currency)} pendiente</option>)}</select></label>
                <label><span className="field-label">Motivo de la excepción</span><input name="reason" className="field" required minLength={5} maxLength={1000} placeholder="Por qué se incluye antes del cobro" data-testid="input-inclusion-reason" /></label>
                <button className="button button-primary" type="submit" disabled={busy} data-testid="button-include-invoice">{createInclusion.isPending ? 'Incluyendo…' : 'Incluir en el cálculo'}</button>
              </form> : <div className="rounded-lg bg-[#f3f3e9] px-4 py-3 text-[11px] leading-5 text-[#708078]">No hay facturas confirmadas pendientes de cobro para incluir como excepción.</div>}
            </section>
          </div>}

          {owner && data.unclassifiedLines.length > 0 && <section className="panel mt-5 overflow-hidden">
            <div className="flex items-start gap-3 border-b border-[#eeece4] px-5 py-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#fbf0df] text-[#9c6a27]"><AlertTriangle size={16} /></span><div><div className="eyebrow">Bloqueo de cálculo</div><h2 className="font-display mt-1 text-base font-bold">Líneas sin clasificar</h2><p className="mt-1 text-[11px] text-[#77847e]">Clasifica cada línea como licencia o servicio; ninguna se omite del cálculo en silencio.</p></div></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="eyebrow"><th className="px-5 py-3 font-medium">Factura / cliente</th><th className="px-4 py-3 font-medium">Especialista</th><th className="px-4 py-3 font-medium">Concepto / código</th><th className="px-4 py-3 text-right font-medium">Importe original</th><th className="px-5 py-3 font-medium">Clasificación</th></tr></thead><tbody>{data.unclassifiedLines.map((line) => <tr key={line.invoiceLineId} className="table-row"><td className="px-5 py-3 text-[11px] font-semibold">{line.invoiceNumber}<div className="mt-1 font-normal text-[#7c8982]">{line.customerName}</div></td><td className="px-4 py-3 text-[11px] text-[#738078]">{line.specialistName}</td><td className="px-4 py-3 text-[11px]">{line.description}<div className="mt-1 font-mono text-[9px] text-[#87928b]">{line.serviceCode || 'Sin código'}</div></td><td className="px-4 py-3 text-right font-mono text-[10px]">{money(line.amount, line.currency)}</td><td className="px-5 py-3"><div className="flex gap-1.5"><button className="button button-soft !min-h-8 !px-2.5 text-[10px]" disabled={busy} onClick={() => onClassify(line.invoiceLineId, 'license', line.serviceCode)} data-testid={`button-classify-license-${line.invoiceLineId}`}>Licencia</button><button className="button button-soft !min-h-8 !px-2.5 text-[10px]" disabled={busy} onClick={() => onClassify(line.invoiceLineId, 'service', line.serviceCode)} data-testid={`button-classify-service-${line.invoiceLineId}`}>Servicio</button></div></td></tr>)}</tbody></table></div>
          </section>}
        </>}
        <div className="mt-5 flex items-start gap-2 border-t border-[#e6e2d7] pt-4 text-[10px] leading-5 text-[#7c8881]"><Check size={13} className="mt-0.5 shrink-0 text-[#548477]" />Cada cifra deriva de facturas, tasas y ajustes del período seleccionado. Las excepciones y anulaciones requieren motivo y quedan asociadas a la auditoría.</div>
      </>}

    {owner && <div className="sr-only" aria-live="polite">{busy ? 'Guardando cambios de liquidación' : ''}</div>}
    {owner && auditAction && <ReasonDialog title={auditAction.kind === 'expense' ? 'Anular este gasto' : auditAction.kind === 'inclusion' ? 'Revocar esta inclusión' : 'Corregir el cierre aprobado'} description={auditAction.kind === 'expense' ? 'El gasto dejará de formar parte de la estimación. Esta acción no se puede deshacer desde esta pantalla.' : auditAction.kind === 'inclusion' ? 'La factura dejará de formar parte de la estimación de este período. La factura original no se modifica.' : 'Se guardará una nueva versión con el cálculo y desglose vigentes. El cierre anterior seguirá disponible en el historial.'} busy={voidExpense.isPending || revokeInclusion.isPending || correctClosure.isPending} onCancel={() => setAuditAction(null)} onConfirm={(reason) => {
      setMutationError('');
      const done = () => { setAuditAction(null); refreshPeriod(); };
      if (auditAction.kind === 'closure') { correctSettlement(reason); return; }
      if (auditAction.kind === 'expense') voidExpense.mutate({ id: auditAction.id, data: { reason } }, { onSuccess: done, onError: handleMutationError });
      else revokeInclusion.mutate({ id: auditAction.id, data: { reason } }, { onSuccess: done, onError: handleMutationError });
    }} />}
    <datalist id="settlement-currencies">{currencies.map((currency) => <option key={currency} value={currency} />)}</datalist>
  </div>;
}

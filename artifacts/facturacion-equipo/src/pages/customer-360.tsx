import { useMemo } from 'react';
import { useListCustomers, useListInvoices, getListCustomersQueryKey, getListInvoicesQueryKey } from '@workspace/api-client-react';
import type { Customer, Invoice } from '@workspace/api-client-react';
import { ArrowLeft, ArrowUpRight, CalendarClock, FileText, Mail, MapPin, Phone, ReceiptText, Sparkles } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { PaymentBadge } from '@/components/invoice-payment';
import { EmptyState, PageHeading, QueryError, Status, date, money } from '@/lib/shared';

const ISSUED = new Set(['finished', 'accepted', 'confirmed', 'sent', 'paid']);
const dayToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const normalized = (value: string) => value.trim().toLocaleLowerCase('es').replace(/\s+/g, ' ');
const validAmount = (value: number) => Number.isFinite(value) ? value : 0;
const groupedMoney = (invoices: Invoice[], amount: (invoice: Invoice) => number) => {
  const totals = new Map<string, number>();
  invoices.forEach((invoice) => totals.set(invoice.currency || 'CUP', (totals.get(invoice.currency || 'CUP') || 0) + validAmount(amount(invoice))));
  return [...totals.entries()].map(([currency, total]) => money(total, currency)).join(' · ') || '—';
};

function LoadingProfile() {
  return <div className="mx-auto max-w-[1240px] space-y-5" aria-label="Cargando ficha del cliente" aria-busy="true">
    <div className="skeleton h-3 w-32" />
    <div className="panel space-y-4 p-6"><div className="skeleton h-3 w-28" /><div className="skeleton h-9 w-64 max-w-full" /><div className="skeleton h-4 w-80 max-w-full" /></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((item) => <div className="panel p-5" key={item}><div className="skeleton h-3 w-24" /><div className="skeleton mt-4 h-7 w-32" /></div>)}</div>
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]"><div className="panel h-64" /><div className="panel h-64" /></div>
  </div>;
}

function Fact({ label, value, note, tint }: { label: string; value: string | number; note: string; tint: string }) {
  return <div className="panel min-w-0 p-4 md:p-5"><div className="flex items-start justify-between gap-3"><div className="eyebrow leading-4">{label}</div><span aria-hidden="true" className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${tint}`} /></div><div className="font-display mt-3 break-words text-[21px] font-bold leading-tight tracking-[-.05em] md:text-[24px]" data-testid={`metric-${label.toLocaleLowerCase('es').replace(/\s+/g, '-')}`}>{value}</div><p className="mt-1.5 text-[10px] leading-4 text-[#7d8982]">{note}</p></div>;
}

function CustomerDetails({ customer }: { customer: Customer }) {
  const fields = [
    { label: 'Correo', value: customer.email, icon: Mail, href: customer.email ? `mailto:${customer.email}` : undefined },
    { label: 'Teléfono', value: customer.phone, icon: Phone, href: customer.phone ? `tel:${customer.phone}` : undefined },
    { label: 'Dirección', value: customer.address, icon: MapPin },
  ];
  return <section className="panel p-5 md:p-6">
    <div className="eyebrow">Datos de contacto</div>
    <div className="mt-4 space-y-4">{fields.map(({ label, value, icon: Icon, href }) => <div key={label} className="flex items-start gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#edf1e9] text-[#4d7569]"><Icon size={15} /></span>
      <div className="min-w-0"><div className="eyebrow !text-[9px]">{label}</div>{value ? href ? <a className="mt-1 block break-words text-[12px] font-semibold text-[#326b61] hover:underline" href={href}>{value}</a> : <p className="mt-1 break-words text-[12px] font-semibold">{value}</p> : <p className="mt-1 text-[12px] text-[#8a948d]">No indicado</p>}</div>
    </div>)}</div>
    <div className="mt-5 grid gap-3 border-t border-[#eeece4] pt-4 sm:grid-cols-2">
      <div><div className="eyebrow !text-[9px]">NIT</div><div className="mt-1 font-mono text-[11px]">{customer.taxId || '—'}</div></div>
      <div><div className="eyebrow !text-[9px]">IRCC</div><div className="mt-1 font-mono text-[11px]">{customer.ircc || '—'}</div></div>
      <div><div className="eyebrow !text-[9px]">Código Versat</div><div className="mt-1 font-mono text-[11px]">{customer.versatCode || '—'}</div></div>
    </div>
    {customer.notes && <div className="mt-5 rounded-xl bg-[#f4f3eb] p-4"><div className="eyebrow">Notas internas</div><p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-[#657770]">{customer.notes}</p></div>}
  </section>;
}

export default function Customer360Page() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const customersQuery = useListCustomers(undefined, { query: { queryKey: getListCustomersQueryKey(), retry: false } });
  const invoicesQuery = useListInvoices(undefined, { query: { queryKey: getListInvoicesQueryKey(), retry: false, refetchInterval: 20000 } });
  const customer = validId ? (customersQuery.data || []).find((record) => record.id === id) : undefined;
  const invoices = useMemo(() => (invoicesQuery.data || []).filter((invoice) => invoice.customerId === id)
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.id - a.id), [invoicesQuery.data, id]);
  const issued = useMemo(() => invoices.filter((invoice) => ISSUED.has(invoice.status)), [invoices]);
  const services = useMemo(() => {
    const grouped = new Map<string, { label: string; serviceCode: string; invoices: Set<number>; quantity: number; amounts: Map<string, number> }>();
    issued.forEach((invoice) => invoice.lines.forEach((line) => {
      const key = line.serviceId != null ? `service:${line.serviceId}` : `description:${normalized(line.description)}`;
      const item = grouped.get(key) || { label: line.description.trim() || 'Servicio sin descripción', serviceCode: line.serviceCode || '', invoices: new Set<number>(), quantity: 0, amounts: new Map<string, number>() };
      item.invoices.add(invoice.id);
      item.quantity += validAmount(line.quantity);
      const currency = invoice.currency || 'CUP';
      item.amounts.set(currency, (item.amounts.get(currency) || 0) + validAmount(line.amount));
      if (!item.serviceCode && line.serviceCode) item.serviceCode = line.serviceCode;
      grouped.set(key, item);
    }));
    return [...grouped.values()].sort((a, b) => {
      const frequency = b.invoices.size - a.invoices.size;
      if (frequency) return frequency;
      if (a.amounts.size === 1 && b.amounts.size === 1 && a.amounts.keys().next().value === b.amounts.keys().next().value) {
        return (b.amounts.values().next().value || 0) - (a.amounts.values().next().value || 0);
      }
      return a.label.localeCompare(b.label, 'es');
    }).slice(0, 5);
  }, [issued]);
  const today = dayToday();
  const overdue = issued.filter((invoice) => !!invoice.dueDate && invoice.dueDate.slice(0, 10) < today && invoice.balanceDue > 0);
  const pending = issued.filter((invoice) => invoice.balanceDue > 0);
  const lastIssued = issued[0];
  const lastIssueOld = !!lastIssued && (() => {
    const parsed = new Date(`${lastIssued.issueDate.slice(0, 10)}T00:00:00`);
    return !Number.isNaN(parsed.getTime()) && Math.floor((new Date(`${today}T00:00:00`).getTime() - parsed.getTime()) / 86400000) > 90;
  })();
  const billed = groupedMoney(issued, (invoice) => invoice.total);
  const collected = groupedMoney(issued, (invoice) => invoice.totalPaid);
  const outstanding = groupedMoney(issued, (invoice) => invoice.balanceDue);

  if (customersQuery.isLoading || invoicesQuery.isLoading) return <LoadingProfile />;
  if (customersQuery.isError) return <div className="mx-auto max-w-[780px]"><QueryError retry={() => customersQuery.refetch()} message="No pudimos cargar la agenda de clientes." /></div>;
  if (!validId || !customer) return <div className="mx-auto max-w-[720px] fade-in"><Link href="/customers" className="mb-5 inline-flex items-center gap-2 text-[12px] font-semibold text-[#647970]"><ArrowLeft size={15} />Volver a clientes</Link><div className="panel"><EmptyState title="Cliente no encontrado" text="No encontramos una ficha activa con este identificador. Vuelve a la agenda para elegir otro cliente." action={<Link href="/customers" className="button button-primary">Ir a clientes</Link>} /></div></div>;
  if (invoicesQuery.isError) return <div className="mx-auto max-w-[900px] fade-in"><Link href="/customers" className="mb-5 inline-flex items-center gap-2 text-[12px] font-semibold text-[#647970]"><ArrowLeft size={15} />Clientes</Link><div className="panel mb-5 p-6"><div className="eyebrow">Ficha del cliente</div><h1 className="font-display mt-2 text-3xl font-bold">{customer.name}</h1></div><QueryError retry={() => invoicesQuery.refetch()} message="No pudimos cargar el historial de facturas." /></div>;

  return <div className="fade-in mx-auto max-w-[1240px]">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><Link href="/customers" className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#647970] transition-colors hover:text-[#28665e]"><ArrowLeft size={15} />Agenda de clientes</Link><span className="status-pill status-paid">Cliente activo</span></div>
    <section className="panel relative mb-5 overflow-hidden p-5 md:p-7">
      <div aria-hidden="true" className="absolute -right-10 -top-20 h-56 w-56 rounded-full bg-[#e6c889]/20 blur-3xl" />
      <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div className="min-w-0"><div className="eyebrow flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#d7a64f]" /> Relación comercial · ficha 360°</div><h1 className="font-display mt-3 break-words text-[32px] font-extrabold leading-tight tracking-[-.065em] md:text-[42px]" data-testid={`customer-name-${customer.id}`}>{customer.name}</h1>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-[#71817b]"><span className="font-mono">Código {customer.versatCode || 'sin código Versat'}</span><span>{customer.taxId ? `NIT ${customer.taxId}` : 'Sin NIT registrado'}</span></div>
        </div><div className="max-w-[350px] rounded-xl border border-[#e8e5d9] bg-[#f8f7f0]/80 px-4 py-3 text-[11px] leading-5 text-[#687a73]" role="note">Vista basada únicamente en las facturas que tienes asignadas dentro de tu alcance comercial.</div>
      </div>
    </section>

    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Fact label="Facturas emitidas" value={issued.length} note="Estados emitidos; borradores y estados finales excluidos" tint="bg-[#4e8a78]" />
      <Fact label="Importe facturado" value={billed} note="Suma de facturas emitidas" tint="bg-[#4e8a78]" />
      <Fact label="Importe cobrado" value={collected} note="Cobros registrados en facturas emitidas" tint="bg-[#d5aa58]" />
      <Fact label="Saldo pendiente" value={outstanding} note={`${pending.length} factura${pending.length === 1 ? '' : 's'} con saldo abierto`} tint="bg-[#d5aa58]" />
      <Fact label="Vencidas" value={overdue.length} note={overdue.length ? groupedMoney(overdue, (invoice) => invoice.balanceDue) : 'Sin facturas vencidas'} tint={overdue.length ? 'bg-[#bb6451]' : 'bg-[#9aa69c]'} />
    </div>

    <div className="mb-5 rounded-lg border border-[#e4e2d7] bg-[#efeee6] px-4 py-3 text-[10px] leading-5 text-[#718079]" role="note"><strong className="text-[#52665e]">Alcance de los datos:</strong> estas cifras corresponden solo a las facturas visibles para tu comercial asignado; no representan la actividad de otros comerciales.</div>

    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <section className="panel overflow-hidden" aria-labelledby="history-heading">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#eeece4] px-5 py-4 md:px-6"><div><div className="eyebrow">Actividad documentada</div><h2 id="history-heading" className="font-display mt-1 text-lg font-bold tracking-[-.04em]">Historial de facturas</h2></div><span className="font-mono text-[10px] text-[#829087]">{invoices.length} registro{invoices.length === 1 ? '' : 's'}</span></div>
          {!invoices.length ? <EmptyState title="Todavía no hay facturas" text="Cuando exista actividad de facturación visible para tu comercial, aparecerá aquí." /> :
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left"><thead><tr className="eyebrow"><th className="px-5 py-3 font-medium">Fecha / factura</th><th className="px-4 py-3 font-medium">Estado</th><th className="px-4 py-3 font-medium">Pago</th><th className="px-4 py-3 text-right font-medium">Cobrado</th><th className="px-5 py-3 text-right font-medium">Pendiente</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id} className="table-row" data-testid={`customer-invoice-${invoice.id}`}>
              <td className="px-5 py-3.5"><div className="text-[10px] text-[#7f8b84]">{date(invoice.issueDate)}</div><Link href={`/invoices/${invoice.id}`} className="mt-1 inline-flex items-center gap-1 font-mono text-[12px] font-semibold text-[#2e6960] hover:underline">{invoice.number}<ArrowUpRight size={12} /></Link></td>
               <td className="px-4 py-3.5"><Status status={invoice.status} /></td>
               <td className="px-4 py-3.5"><PaymentBadge invoice={invoice} /></td>
              <td className="px-4 py-3.5 text-right text-[11px] font-semibold">{money(invoice.totalPaid, invoice.currency)}</td><td className="px-5 py-3.5 text-right text-[11px] font-bold">{money(invoice.balanceDue, invoice.currency)}</td>
            </tr>)}</tbody></table></div>}
        </section>
        <section className="panel overflow-hidden" aria-labelledby="services-heading">
          <div className="border-b border-[#eeece4] px-5 py-4 md:px-6"><div className="eyebrow">Frecuencia histórica</div><h2 id="services-heading" className="font-display mt-1 text-lg font-bold tracking-[-.04em]">Servicios más facturados</h2></div>
          {!services.length ? <EmptyState title="Sin servicios registrados" text="Los servicios aparecerán al existir líneas en facturas emitidas." /> :
            <div className="divide-y divide-[#eeece4]">{services.map((service, index) => <div key={`${service.label}-${index}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-6" data-testid={`top-service-${index}`}>
              <div className="flex min-w-0 items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#edf1e9] font-mono text-[10px] text-[#54766b]">{String(index + 1).padStart(2, '0')}</span><div className="min-w-0"><div className="truncate text-[12px] font-bold">{service.label}</div><div className="mt-1 text-[10px] text-[#849088]">{service.serviceCode ? `Código ${service.serviceCode} · ` : ''}{service.invoices.size} factura{service.invoices.size === 1 ? '' : 's'} · Cantidad {service.quantity.toLocaleString('es-ES')}</div></div></div><div className="text-right"><div className="text-[12px] font-bold">{[...service.amounts.entries()].map(([currency, amount]) => money(amount, currency)).join(' · ') || '—'}</div><div className="eyebrow mt-1 !text-[9px]">Importe por moneda</div></div>
            </div>)}</div>}
        </section>
      </div>
      <aside className="space-y-5">
        <CustomerDetails customer={customer} />
        <section className="panel overflow-hidden" aria-labelledby="suggestions-heading">
          <div className="border-b border-[#eeece4] px-5 py-4"><div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-[#f7edda] text-[#9d7837]"><Sparkles size={14} /></span><div><div className="eyebrow">Según el historial visible</div><h2 id="suggestions-heading" className="font-display mt-0.5 text-base font-bold">Puntos a revisar</h2></div></div></div>
          <div className="space-y-3 p-4">
            {overdue.length ? overdue.map((invoice) => <Link key={invoice.id} href={`/invoices/${invoice.id}`} className="block rounded-xl border border-[#f0d6cb] bg-[#fff5ef] p-4 transition-colors hover:bg-[#fdf0e8]" data-testid={`suggestion-overdue-${invoice.id}`}>
              <div className="flex items-center gap-2 text-[11px] font-bold text-[#9b4d3c]"><CalendarClock size={14} />Saldo vencido · {customer.name}</div><p className="mt-2 text-[11px] leading-5 text-[#735f58]">Factura <span className="font-mono font-semibold">{invoice.number}</span> · venció {date(invoice.dueDate)}</p><div className="mt-2 flex items-center justify-between text-[12px] font-bold text-[#6c453c]"><span>{money(invoice.balanceDue, invoice.currency)}</span><span className="inline-flex items-center gap-1">Revisar <ArrowUpRight size={12} /></span></div>
            </Link>) : pending.length ? (() => {
              const oldest = [...pending].sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.id - b.id)[0];
              return <Link href={`/invoices/${oldest.id}`} className="block rounded-xl border border-[#eadfbe] bg-[#fbf5e7] p-4 transition-colors hover:bg-[#f8f0dd]" data-testid="suggestion-oldest-pending"><div className="flex items-center gap-2 text-[11px] font-bold text-[#80652d]"><ReceiptText size={14} />Saldo pendiente</div><p className="mt-2 text-[11px] leading-5 text-[#756b53]">La factura pendiente más antigua es <span className="font-mono font-semibold">{oldest.number}</span>, emitida el {date(oldest.issueDate)}.</p><div className="mt-2 flex items-center justify-between text-[12px] font-bold"><span>{money(oldest.balanceDue, oldest.currency)}</span><span className="inline-flex items-center gap-1">Abrir factura <ArrowUpRight size={12} /></span></div></Link>;
            })() : lastIssueOld && lastIssued ? <div className="rounded-xl border border-[#e3e7dc] bg-[#f3f5ed] p-4" data-testid="suggestion-check-needs"><div className="flex items-center gap-2 text-[11px] font-bold text-[#547064]"><CalendarClock size={14} />Sugerencia · comprobar necesidades</div><p className="mt-2 text-[11px] leading-5 text-[#697b72]">La última factura emitida, {lastIssued.number}, es de {date(lastIssued.issueDate)}. Puede ser buen momento para comprobar si hay nuevas necesidades.</p><Link href={`/invoices/${lastIssued.id}`} className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-[#397568]">Ver última factura <ArrowUpRight size={12} /></Link></div> : null}
            {!overdue.length && !pending.length && !(lastIssueOld && lastIssued) && !services.some((service) => service.invoices.size > 1) && <div className="rounded-xl border border-dashed border-[#dcded2] px-4 py-5 text-center" data-testid="suggestion-empty"><span className="mx-auto grid h-9 w-9 place-items-center rounded-xl bg-[#edf1e9] text-[#668276]"><FileText size={16} /></span><div className="mt-3 text-[12px] font-bold">Sin prioridades por ahora</div><p className="mt-1 text-[10px] leading-4 text-[#818c85]">No hay hechos del historial que requieran una revisión prioritaria.</p></div>}
            {services.filter((service) => service.invoices.size > 1).slice(0, 1).map((service) => <div key={`recurring-${service.label}`} className="rounded-xl border border-[#e4e7dc] bg-[#f5f5ed] p-4" data-testid="suggestion-recurring-service"><div className="flex items-center gap-2 text-[11px] font-bold text-[#547064]"><FileText size={14} />Patrón observado</div><p className="mt-2 text-[11px] leading-5 text-[#687970]"><strong>{service.label}</strong> figura en {service.invoices.size} facturas del historial visible. Es una referencia basada en facturación previa.</p></div>)}
          </div>
        </section>
      </aside>
    </div>
  </div>;
}

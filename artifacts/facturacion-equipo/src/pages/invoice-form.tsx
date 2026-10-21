import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBillingOverviewQueryKey, getGetCurrentTeamMemberQueryKey, getGetInvoiceQueryKey, getGetVersatCatalogsQueryKey, useGetCurrentTeamMember, getListCustomersQueryKey,
  getListInvoicesQueryKey, useCreateInvoice, useGetInvoice, useGetVersatCatalogs, useListCustomers, useUpdateInvoice, useListInvoiceSeries, getListInvoiceSeriesQueryKey,
} from '@workspace/api-client-react';
import type { InvoiceInput, VersatCatalogEntry } from '@workspace/api-client-react';
import { ArrowLeft, ArrowRight, FilePlus2, Users, X } from 'lucide-react';
import { Link, useLocation, useParams } from 'wouter';
import { PageHeading, QueryError, errorDetail, money } from '@/lib/shared';

type LineState = { serviceId: string; description: string; unit: string; quantity: string; unitPrice: string; groupCode: string };
const emptyLine = (): LineState => ({ serviceId: '', description: '', unit: '', quantity: '1', unitPrice: '', groupCode: '' });
const todayIso = () => new Date().toISOString().slice(0, 10);
const label = (entry: VersatCatalogEntry) => `${entry.code} · ${entry.name}`;

export default function InvoiceFormPage() {
  const params = useParams<{ id?: string }>();
  const editId = params.id ? Number(params.id) : null;
  const isEdit = editId !== null && Number.isFinite(editId);
  const [, navigate] = useLocation();
  const client = useQueryClient();

  const member = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false } });
  const isOwner = member.data?.role === 'owner';
  const assignedId = member.data?.commercialId ?? null;
  const locked = !!member.data && !isOwner;
  const customers = useListCustomers();
  const series = useListInvoiceSeries({ query: { queryKey: getListInvoiceSeriesQueryKey(), refetchInterval: 15000 } });
  const catalogs = useGetVersatCatalogs({ query: { queryKey: getGetVersatCatalogsQueryKey() } });
  const invoice = useGetInvoice(editId ?? 0, { query: { queryKey: getGetInvoiceQueryKey(editId ?? 0), enabled: isEdit } });
  const create = useCreateInvoice();
  const update = useUpdateInvoice();

  const [customerId, setCustomerId] = useState('');
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [currency, setCurrency] = useState('');
  const [notes, setNotes] = useState('');
  const [conceptId, setConceptId] = useState('');
  const [operationId, setOperationId] = useState('');
  const [commercialId, setCommercialId] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [versatNumber, setVersatNumber] = useState('');
  const [talon, setTalon] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [bankMC, setBankMC] = useState('');
  const [bankOM, setBankOM] = useState('');
  const [contract, setContract] = useState('');
  const [lines, setLines] = useState<LineState[]>([emptyLine()]);
  const [error, setError] = useState('');

  const entries = useMemo(() => catalogs.data?.entries ?? [], [catalogs.data]);
  const byKind = useMemo(() => {
    const groups: Record<string, VersatCatalogEntry[]> = { service: [], currency: [], concept: [], operation: [], commercial: [], payment: [], unit: [] };
    for (const entry of entries) (groups[entry.kind] ||= []).push(entry);
    return groups;
  }, [entries]);
  const services = byKind.service;
  const serviceById = useMemo(() => new Map(services.map((service) => [String(service.id), service])), [services]);

  useEffect(() => {
    if (locked && assignedId != null) setCommercialId(String(assignedId));
  }, [locked, assignedId]);

  // Default the currency to the first imported currency once catalogs arrive (new invoices only).
  useEffect(() => {
    if (!isEdit && !currency && byKind.currency.length) setCurrency(byKind.currency[0].code);
  }, [isEdit, currency, byKind.currency]);

  // Initialise form from the stored draft exactly once per invoice id.
  const initializedFor = useRef<number | null>(null);
  useEffect(() => {
    const inv = invoice.data;
    if (!isEdit || !inv || initializedFor.current === inv.id) return;
    initializedFor.current = inv.id;
    setCustomerId(String(inv.customerId));
    setIssueDate(inv.issueDate.slice(0, 10));
    setDueDate(inv.dueDate ? inv.dueDate.slice(0, 10) : '');
    setCurrency(inv.currency);
    setNotes(inv.notes || '');
    setSeriesId(inv.seriesId ? String(inv.seriesId) : '');
    const v = inv.versat;
    if (v) {
      setConceptId(String(v.conceptId));
      setOperationId(String(v.operationId));
      setCommercialId(locked && assignedId != null ? String(assignedId) : String(v.commercialId));
      setPaymentId(String(v.paymentId));
      setVersatNumber(v.number || '');
      setTalon(v.talon || '');
      setBankMC(v.bankAccountMC || '');
      setBankOM(v.bankAccountOM || '');
      setContract(v.contract || '');
    }
    setLines(inv.lines.map((line) => ({
      serviceId: line.serviceId ? String(line.serviceId) : '',
      description: line.description,
      unit: line.unitCode || '',
      quantity: String(line.quantity),
      unitPrice: String(line.unitPrice),
      groupCode: line.groupCode || '',
    })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.data, isEdit]);

  const currencyOptions = byKind.currency;
  const subtotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0);
  const saving = create.isPending || update.isPending;

  function patchLine(index: number, patch: Partial<LineState>) {
    setLines((previous) => previous.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function pickService(index: number, text: string) {
    const match = services.find((service) => label(service) === text);
    if (!match) {
      patchLine(index, { serviceId: '' });
      return;
    }
    patchLine(index, {
      serviceId: String(match.id),
      description: match.name,
      unit: match.unitCode || '',
      groupCode: match.groupCode || '',
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!member.data) return setError('Aún se está comprobando tu acceso.');
    if (locked && assignedId == null) return setError('No tienes un comercial asignado. Pide al propietario que te asigne uno.');
    if (!customerId) return setError('Elige un cliente.');
    if (!currency) return setError('Elige una moneda del catálogo importado.');
    for (const line of lines) {
      if (!line.description.trim()) return setError('Cada línea necesita una descripción.');
      if (!(Number(line.quantity) > 0)) return setError('Cada línea necesita una cantidad mayor que cero.');
      if (line.unitPrice === '' || Number(line.unitPrice) < 0) return setError('Escribe el precio unitario de cada línea (el catálogo no trae precios).');
      if (line.groupCode && !/^[A-Za-z0-9.-]*$/.test(line.groupCode)) return setError('El grupo solo admite letras, números, punto y guion.');
    }
    const effectiveCommercial = locked ? String(assignedId) : commercialId;
    const refs = [conceptId, operationId, effectiveCommercial, paymentId];
    const anyRef = [conceptId, operationId, commercialId, paymentId].some(Boolean);
    const anyExtra = [versatNumber, talon, bankMC, bankOM, contract].some((value) => value.trim());
    if (locked && !refs.every(Boolean)) return setError('Como especialista debes elegir concepto, operación y forma de pago; tu comercial se aplica automáticamente.');
    if ((anyRef || anyExtra) && !refs.every(Boolean)) return setError('Si completas datos de Versat, elige también concepto, operación, comercial y forma de pago.');
    if (talon.trim() && !/^[0-9]*$/.test(talon.trim())) return setError('El talón solo admite dígitos.');
    if (versatNumber.trim() && !/^[A-Za-z0-9_-]*$/.test(versatNumber.trim())) return setError('El número de Versat solo admite letras, números, guion y guion bajo.');
    const optional = (value: string) => value.trim() || null;
    const payload: InvoiceInput = {
      seriesId: seriesId ? Number(seriesId) : null,
      customerId: Number(customerId),
      issueDate,
      dueDate: dueDate || null,
      currency,
      notes: optional(notes),
      lines: lines.map((line) => ({
        description: line.description.trim(),
        serviceId: line.serviceId ? Number(line.serviceId) : null,
        groupCode: optional(line.groupCode),
        quantity: Number(Number(line.quantity).toFixed(4)),
        unitPrice: Number(Number(line.unitPrice).toFixed(5)),
      })),
      ...(refs.every(Boolean) ? {
        versat: {
          conceptId: Number(conceptId), operationId: Number(operationId), commercialId: Number(effectiveCommercial), paymentId: Number(paymentId),
          number: seriesId ? null : optional(versatNumber), talon: seriesId ? null : optional(talon), bankAccountMC: optional(bankMC), bankAccountOM: optional(bankOM), contract: optional(contract),
        },
      } : {}),
    };
    setError('');
    const finish = (id: number) => {
      client.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      client.invalidateQueries({ queryKey: getGetBillingOverviewQueryKey() });
      client.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
      client.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      navigate(`/invoices/${id}`);
    };
    const onError = (err: unknown) => setError(`No se pudo guardar. ${errorDetail(err, 'Revisa los datos e inténtalo de nuevo.')}`);
    if (isEdit && editId !== null) update.mutate({ id: editId, data: payload }, { onSuccess: (saved) => finish(saved.id), onError });
    else create.mutate({ data: payload }, { onSuccess: (saved) => finish(saved.id), onError });
  }

  const backHref = isEdit ? `/invoices/${editId}` : '/invoices';
  if (isEdit && invoice.isLoading) return <div className="mx-auto max-w-[930px] space-y-4"><div className="skeleton h-6 w-40" /><div className="panel space-y-4 p-8"><div className="skeleton h-8 w-56" /><div className="skeleton h-24" /><div className="skeleton h-40" /></div></div>;
  if (isEdit && (invoice.isError || !invoice.data)) return <QueryError retry={() => invoice.refetch()} message="No pudimos abrir este borrador." detail={errorDetail(invoice.error, '')} />;
  if (isEdit && invoice.data && invoice.data.status !== 'draft') {
    return <div className="panel mx-auto max-w-[560px] p-8 text-center"><h1 className="font-display text-xl font-bold">Solo se pueden editar borradores</h1><p className="mt-2 text-[13px] text-[#77847e]">La factura {invoice.data.number} ya fue emitida y no admite cambios.</p><Link href={`/invoices/${invoice.data.id}`} className="button button-primary mt-5">Volver a la factura</Link></div>;
  }

  if (member.isLoading) return <div className="mx-auto max-w-[930px] space-y-4"><div className="skeleton h-6 w-40" /><div className="panel space-y-4 p-8"><div className="skeleton h-8 w-56" /><div className="skeleton h-24" /></div></div>;
  if (member.isError || !member.data) return <QueryError retry={() => member.refetch()} message="No pudimos comprobar tu acceso." />;
  if (locked && assignedId == null) return <div className="panel mx-auto max-w-[560px] p-8 text-center" data-testid="invoice-no-commercial"><h1 className="font-display text-xl font-bold">Sin comercial asignado</h1><p className="mt-2 text-[13px] text-[#77847e]">Tu cuenta aún no tiene un comercial. El propietario debe asignártelo para que puedas crear o editar facturas.</p><Link href="/invoices" className="button button-primary mt-5">Volver a facturas</Link></div>;

  const select = (value: string, onChange: (value: string) => void, kind: string, testId: string, placeholder: string) => (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
      <option value="">{placeholder}</option>
      {(byKind[kind] || []).map((entry) => <option key={entry.id} value={entry.id}>{label(entry)}</option>)}
    </select>
  );

  return <div className="fade-in mx-auto max-w-[980px]">
    <Link href={backHref} className="mb-6 inline-flex items-center gap-2 text-[12px] font-semibold text-[#71817b]"><ArrowLeft size={14} />{isEdit ? 'Volver a la factura' : 'Volver a facturas'}</Link>
    <PageHeading eyebrow={isEdit ? 'Editar borrador' : 'Nuevo documento'} title={isEdit ? 'Editar factura' : 'Preparar factura'} description="Puedes guardar un borrador incompleto. Elige numeración manual o una serie declarada por el propietario; la serie asigna número y talón al emitir." />
    {catalogs.isError && <div className="mb-5"><QueryError retry={() => catalogs.refetch()} message="No pudimos cargar los catálogos de Versat." detail={errorDetail(catalogs.error, '')} /></div>}
    <form onSubmit={submit} className="space-y-5">
      <section className="panel p-5 md:p-7"><div className="mb-5 flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e6f0e9] text-[#38776b]"><Users size={16} /></span><h2 className="font-display text-base font-bold">Cliente y fechas</h2></div>
        {customers.isLoading || catalogs.isLoading ? <div className="skeleton h-10 w-full" /> : customers.isError ? <QueryError retry={() => customers.refetch()} message="No pudimos cargar los clientes." /> :
          <div className="grid gap-4 md:grid-cols-2">
            <label className="md:col-span-2"><span className="field-label">Cliente *</span><select className="field" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required data-testid="select-invoice-customer"><option value="">Selecciona cliente</option>{(customers.data || []).filter((c) => c.active || String(c.id) === customerId).map((customer) => <option value={customer.id} key={customer.id}>{customer.versatCode ? `${customer.versatCode} · ` : ''}{customer.name}{customer.taxId ? ` — NIT ${customer.taxId}` : ''}</option>)}</select></label>
            <label><span className="field-label">Fecha de emisión *</span><input className="field" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required data-testid="input-issue-date" /></label>
            <label><span className="field-label">Vencimiento</span><input className="field" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="input-due-date" /></label>
          </div>}
      </section>

      <section className="panel p-5 md:p-7"><div className="mb-5"><div className="eyebrow">Versat de escritorio</div><h2 className="font-display mt-1 text-base font-bold">Datos de la factura en Versat</h2><p className="mt-1 text-[12px] leading-5 text-[#77847e]">Todos los valores salen de los catálogos importados. Puedes guardar el borrador sin ellos, pero no se podrá exportar hasta completarlos.</p></div>
        <div className="grid gap-4 md:grid-cols-2">
          <label><span className="field-label">Moneda *</span><select className="field" value={currency} onChange={(e) => setCurrency(e.target.value)} data-testid="select-currency">{!currencyOptions.length && currency && <option value={currency}>{currency}</option>}{!currencyOptions.length && !currency && <option value="">Sin monedas importadas</option>}{currencyOptions.map((entry) => <option key={entry.id} value={entry.code}>{entry.code} · {entry.name}</option>)}{currencyOptions.length > 0 && currency && !currencyOptions.some((entry) => entry.code === currency) && <option value={currency}>{currency}</option>}</select></label>
          <label><span className="field-label">Concepto</span>{select(conceptId, setConceptId, 'concept', 'select-concept', 'Selecciona concepto')}</label>
          <label><span className="field-label">Operación</span>{select(operationId, setOperationId, 'operation', 'select-operation', 'Selecciona operación')}</label>
          <label><span className="field-label">Comercial{locked ? ' (asignado)' : ''}</span>{locked ? <div className="field flex items-center bg-[#f1f0e8] text-[#5d716b]" data-testid="select-commercial">{(() => { const c = byKind.commercial.find((e) => e.id === assignedId); return c ? label(c) : catalogs.isLoading ? 'Cargando…' : `Comercial ${assignedId}`; })()}</div> : select(commercialId, setCommercialId, 'commercial', 'select-commercial', 'Selecciona comercial')}</label>
          <label className="md:col-span-2"><span className="field-label">Forma de pago</span>{select(paymentId, setPaymentId, 'payment', 'select-payment', 'Selecciona forma de pago')}</label>
          <label className="md:col-span-2"><span className="field-label">Numeración de Versat</span><select className="field" value={seriesId} onChange={(e) => { setSeriesId(e.target.value); setVersatNumber(''); setTalon(''); }} data-testid="select-invoice-series"><option value="">Manual controlada</option>{series.data?.filter((s) => s.active || String(s.id) === seriesId).map((s) => <option key={s.id} value={s.id}>{s.name} · Talón {s.talon}{!s.active ? ' (inactiva)' : ''}</option>)}{seriesId && !series.data?.some((s) => String(s.id) === seriesId) && <option value={seriesId}>Serie guardada #{seriesId}</option>}</select>{series.isError && <span className="block text-xs" role="alert">No se pudieron cargar las series. <button type="button" onClick={() => series.refetch()}>Reintentar</button></span>}<span className="mt-2 block text-xs">{seriesId ? 'El número y talón definitivos se reservan al emitir; guardar el borrador no consume el contador.' : 'El número manual se reserva al guardar y no podrá utilizarlo otra factura, aunque se cambie este borrador o se anule.'} No hay sincronización directa con Versat de escritorio.</span></label>
          {!seriesId && <><label><span className="field-label">Número de Versat</span><input className="field font-mono" value={versatNumber} onChange={(e) => setVersatNumber(e.target.value)} maxLength={50} autoComplete="off" data-testid="input-versat-number" /><span className="mt-1 block text-[10px] text-[#85918a]">Contrasta el número libre con tu Versat de escritorio.</span></label>
          <label><span className="field-label">Talón (solo dígitos)</span><input className="field font-mono" inputMode="numeric" value={talon} onChange={(e) => setTalon(e.target.value.replace(/[^0-9]/g, ''))} maxLength={20} autoComplete="off" data-testid="input-talon" /></label></>}
          <label><span className="field-label">Cuenta bancaria MC</span><input className="field font-mono" value={bankMC} onChange={(e) => setBankMC(e.target.value)} maxLength={100} autoComplete="off" /></label>
          <label><span className="field-label">Cuenta bancaria OM</span><input className="field font-mono" value={bankOM} onChange={(e) => setBankOM(e.target.value)} maxLength={100} autoComplete="off" /></label>
          <label className="md:col-span-2"><span className="field-label">Contrato</span><input className="field" value={contract} onChange={(e) => setContract(e.target.value)} maxLength={100} autoComplete="off" /></label>
        </div>
      </section>

      <section className="panel overflow-hidden"><div className="px-5 py-5 md:px-7"><div className="eyebrow">Detalle</div><h2 className="font-display mt-1 text-base font-bold">Servicios y honorarios</h2><p className="mt-1 text-[12px] leading-5 text-[#77847e]">Cantidad con hasta 4 decimales y precio con hasta 5, escritos a mano: los catálogos no traen precios. El grupo solo se rellena si el catálogo lo conoce; si no, confírmalo tú.</p></div>
        <datalist id="service-options">{services.map((service) => <option key={service.id} value={label(service)} />)}</datalist>
        <div className="space-y-3 border-t border-[#eeece4] px-5 py-4 md:px-7">{lines.map((line, i) => {
          const service = serviceById.get(line.serviceId);
          return <div key={i} className="rounded-xl border border-[#eeece4] p-4" data-testid={`line-${i}`}>
            <div className="grid gap-3 md:grid-cols-[1.3fr_1fr]">
              <label><span className="field-label">Servicio del catálogo</span><input className="field" list="service-options" defaultValue={service ? label(service) : ''} key={`svc-${i}-${line.serviceId}`} onChange={(e) => pickService(i, e.target.value)} onBlur={(e) => { if (!serviceById.has(line.serviceId)) e.currentTarget.value = ''; }} placeholder={services.length ? 'Busca por código o nombre' : 'Sin servicios importados'} data-testid={`input-line-service-${i}`} /></label>
              <label><span className="field-label">Descripción *</span><input className={`field ${service ? 'bg-[#f1f0e8] text-[#5d716b]' : ''}`} value={line.description} readOnly={!!service} onChange={(e) => patchLine(i, { description: e.target.value })} data-testid={`input-line-description-${i}`} />{service && <span className="mt-1 block text-[10px] text-[#85918a]">El nombre viene del catálogo. Para texto personalizado usa la nota de la factura.</span>}</label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-[90px_110px_150px_1fr_auto] md:items-end">
              <div><span className="field-label">UM</span><div className="field flex items-center font-mono text-[12px] text-[#5d716b]" aria-label="Unidad de medida">{line.unit || (service ? '—' : 'según servicio')}</div></div>
              <label><span className="field-label">Cantidad *</span><input className="field" type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(e) => patchLine(i, { quantity: e.target.value })} /></label>
              <label><span className="field-label">Precio unitario *</span><input className="field" type="number" min="0" step="0.00001" placeholder="0,00000" value={line.unitPrice} onChange={(e) => patchLine(i, { unitPrice: e.target.value })} /></label>
              <label><span className="field-label">Grupo {service && !service.groupCode ? '(confirma)' : ''}</span><input className="field font-mono" value={line.groupCode} onChange={(e) => patchLine(i, { groupCode: e.target.value })} maxLength={40} placeholder={service && !service.groupCode ? 'Sin grupo conocido' : 'Código de grupo'} data-testid={`input-line-group-${i}`} /></label>
              <div className="flex items-center justify-between gap-3 text-[13px] font-bold md:justify-end md:pb-2.5">{money(Number(line.quantity || 0) * Number(line.unitPrice || 0), currency || 'CUP')}{lines.length > 1 && <button type="button" className="text-[#9a6960]" onClick={() => setLines((old) => old.filter((_, index) => index !== i))} aria-label="Eliminar línea"><X size={15} /></button>}</div>
            </div>
          </div>;
        })}
          <button type="button" className="button button-plain !min-h-9 !px-3 text-[12px]" onClick={() => setLines((old) => [...old, emptyLine()])}><FilePlus2 size={14} />Añadir línea</button>
        </div>
        <div className="flex justify-end border-t border-[#eeece4] bg-[#faf9f3] px-5 py-4 md:px-7"><div className="w-full max-w-[290px]"><div className="flex justify-between text-[12px] text-[#71817b]"><span>Subtotal</span><span>{money(subtotal, currency || 'CUP')}</span></div><div className="mt-2 flex justify-between text-[14px] font-bold"><span>Total</span><span>{money(subtotal, currency || 'CUP')}</span></div></div></div>
      </section>

      <section className="panel p-5 md:p-7"><label><span className="field-label">Nota <span className="font-normal text-[#8a948e]">(opcional)</span></span><textarea className="field" value={notes} onChange={(e) => setNotes(e.target.value)} /></label></section>
      {error && <p className="rounded-lg bg-[#fbefeb] px-4 py-3 text-[12px] font-semibold text-[#a04539]" role="alert">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Link href={backHref} className="button button-plain">Cancelar</Link><button disabled={saving || customers.isLoading || catalogs.isLoading} className="button button-primary" type="submit" data-testid="button-save-invoice">{saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Guardar como borrador'}<ArrowRight size={15} /></button></div>
    </form>
  </div>;
}

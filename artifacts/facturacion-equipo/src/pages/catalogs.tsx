import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetVersatCatalogHistoryQueryKey, getGetVersatCatalogsQueryKey,
  useCreateVersatCatalogEntry, useGetVersatCatalogHistory, useGetVersatCatalogs,
  useUpdateVersatCatalogEntry,
} from '@workspace/api-client-react';
import type { VersatCatalogAuditValues, VersatCatalogEntry, VersatCatalogEntryKind } from '@workspace/api-client-react';
import { ArrowRight, BookOpen, Check, Clock3, Pencil, Plus, RotateCcw, Search, Users, X } from 'lucide-react';
import { Link } from 'wouter';
import { EmptyState, PageHeading, QueryError, errorDetail } from '@/lib/shared';

const kinds: { kind: VersatCatalogEntryKind; label: string; hint: string }[] = [
  { kind: 'service', label: 'Servicios', hint: 'Con unidad de medida y grupo cuando se conoce.' },
  { kind: 'unit', label: 'Unidades', hint: 'Unidades de medida.' },
  { kind: 'currency', label: 'Monedas', hint: 'Las únicas monedas que acepta el formulario.' },
  { kind: 'concept', label: 'Conceptos', hint: 'Concepto de la factura.' },
  { kind: 'operation', label: 'Operaciones', hint: 'Tipo de operación.' },
  { kind: 'commercial', label: 'Comerciales', hint: 'Con su cargo.' },
  { kind: 'payment', label: 'Formas de pago', hint: 'Forma de pago.' },
];

const auditFields: { key: keyof VersatCatalogAuditValues; label: string }[] = [
  { key: 'kind', label: 'Catálogo' },
  { key: 'sourceId', label: 'ID de origen' },
  { key: 'code', label: 'Código' },
  { key: 'name', label: 'Nombre' },
  { key: 'exportValue', label: 'Valor exportado' },
  { key: 'unitCode', label: 'Código UM' },
  { key: 'unitName', label: 'Nombre UM' },
  { key: 'groupCode', label: 'Grupo' },
  { key: 'position', label: 'Cargo' },
  { key: 'active', label: 'Estado' },
];

export default function CatalogsPage() {
  const client = useQueryClient();
  const query = useGetVersatCatalogs({ query: { queryKey: getGetVersatCatalogsQueryKey() } });
  const [kind, setKind] = useState<VersatCatalogEntryKind>('service');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<VersatCatalogEntry | null>(null);
  const [historyEntry, setHistoryEntry] = useState<VersatCatalogEntry | null>(null);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const create = useCreateVersatCatalogEntry();
  const update = useUpdateVersatCatalogEntry();
  const historyQuery = useGetVersatCatalogHistory(historyEntry?.id ?? 0, {
    query: {
      queryKey: getGetVersatCatalogHistoryQueryKey(historyEntry?.id ?? 0),
      enabled: Boolean(historyEntry),
    },
  });
  const entries = useMemo(() => query.data?.entries ?? [], [query.data]);
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const entry of entries) map[entry.kind] = (map[entry.kind] || 0) + 1;
    return map;
  }, [entries]);
  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => entries
    .filter((entry) => entry.kind === kind)
    .filter((entry) => !needle || [entry.code, entry.name, entry.exportValue, entry.unitCode, entry.unitName, entry.groupCode, entry.position].some((value) => value && value.toLowerCase().includes(needle)))
    .sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true })), [entries, kind, needle]);
  const current = kinds.find((item) => item.kind === kind)!;
  const kindName = (value: VersatCatalogEntryKind) => kinds.find((item) => item.kind === value)?.label ?? value;
  const pending = create.isPending || update.isPending;
  const actionLabel = (action: string) => ({
    created: 'Alta',
    updated: 'Modificación',
    deactivated: 'Desactivación',
    reactivated: 'Reactivación',
  }[action] ?? action);
  const auditValue = (key: keyof VersatCatalogAuditValues, value: unknown) => {
    if (key === 'active') return value ? 'Activo' : 'Desactivado';
    if (key === 'kind' && typeof value === 'string') return kindName(value as VersatCatalogEntryKind);
    if (value == null || value === '') return '—';
    return String(value);
  };

  function openNew() {
    setEditing(null);
    setError('');
    setDialog(true);
  }
  function openEdit(entry: VersatCatalogEntry) {
    setKind(entry.kind);
    setEditing(entry);
    setError('');
    setDialog(true);
  }
  function finishSave(message: string) {
    client.invalidateQueries({ queryKey: getGetVersatCatalogsQueryKey() });
    setDialog(false);
    setSuccess(message);
    setError('');
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const values = new FormData(event.currentTarget);
    const read = (key: string) => String(values.get(key) ?? '').trim();
    const code = read('code');
    const name = read('name');
    const exportValue = read('exportValue');
    const metadata = kind === 'service'
      ? { unitCode: read('unitCode'), unitName: read('unitName'), groupCode: read('groupCode') }
      : kind === 'commercial' ? { position: read('position') } : {};
    const data = { code, name, exportValue, ...metadata };
    const options = {
      onSuccess: () => finishSave(editing ? 'Catálogo actualizado.' : 'Registro añadido al catálogo.'),
      onError: (err: unknown) => setError(`No se pudo guardar. ${errorDetail(err, '')}`),
    };
    if (editing) {
      update.mutate({ id: editing.id, data }, options);
      return;
    }
    const sourceId = Number(read('sourceId'));
    if (!Number.isInteger(sourceId) || sourceId < 1) {
      setError('Escribe el ID de origen positivo que tiene este registro en Versat.');
      return;
    }
    create.mutate({ data: { kind, sourceId, ...data } }, options);
  }
  function setActive(entry: VersatCatalogEntry) {
    const nextActive = !entry.active;
    if (!window.confirm(nextActive
      ? `¿Reactivar «${entry.name}» en el catálogo de ${kindName(entry.kind)}?`
      : `¿Desactivar «${entry.name}»? Dejará de poder seleccionarse en facturas nuevas; el historial se conservará.`)) return;
    update.mutate({ id: entry.id, data: { active: nextActive } }, {
      onSuccess: () => {
        client.invalidateQueries({ queryKey: getGetVersatCatalogsQueryKey() });
        setSuccess(nextActive ? 'Registro reactivado.' : 'Registro desactivado. El historial de facturas se conserva.');
        setError('');
      },
      onError: (err: unknown) => setError(`No se pudo cambiar el estado. ${errorDetail(err, '')}`),
    });
  }

  return <div className="fade-in">
    <PageHeading eyebrow="Solo administrador" title="Catálogos de Versat" description="Gestiona los códigos que el equipo puede usar al preparar facturas." action={<div className="flex flex-wrap gap-2"><Link href="/export" className="button button-plain">Comparar con Versat<ArrowRight size={14} /></Link><Link href="/customers" className="button button-plain"><Users size={15} />Ver clientes<ArrowRight size={14} /></Link><button className="button button-primary" onClick={openNew} data-testid="button-new-catalog-entry"><Plus size={15} />Añadir registro</button></div>} />
    <div className="mb-5 flex gap-3 rounded-xl border border-[#ead9b6] bg-[#fcf5e6] px-4 py-3 text-[12px] leading-5 text-[#775d2d]"><BookOpen size={16} className="mt-0.5 shrink-0" /><p>Este catálogo no se sincroniza automáticamente con Versat de escritorio. Antes de exportar, compara aquí los registros activos con un CSV o TSV reciente de Versat; las diferencias se avisan y no se aplican automáticamente. Crea o actualiza allí el registro y replica aquí el ID, código y valor de exportación. Desactivar conserva el historial y lo quita de las opciones para facturas nuevas.</p></div>
    {success && <div className="mb-4 flex items-center justify-between rounded-lg bg-[#e6f2e9] px-4 py-2.5 text-[12px] font-semibold text-[#317060]" role="status">{success}<button onClick={() => setSuccess('')} aria-label="Cerrar aviso"><X size={14} /></button></div>}
    {error && !dialog && <div className="mb-4 rounded-lg bg-[#fbefeb] px-4 py-2.5 text-[12px] text-[#a04539]" role="alert">{error}</div>}
    {query.isLoading ? <div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="panel p-4"><div className="skeleton h-3 w-20" /><div className="skeleton mt-3 h-7 w-12" /></div>)}</div> : query.isError || !query.data ? <QueryError retry={() => query.refetch()} message="No pudimos cargar los catálogos." detail={errorDetail(query.error, '')} /> : <>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {kinds.map((item) => <button key={item.kind} onClick={() => setKind(item.kind)} className={`panel p-4 text-left transition-transform hover:-translate-y-0.5 ${kind === item.kind ? '!border-[#49867c] !bg-[#f1f6f2]' : ''}`} data-testid={`tab-catalog-${item.kind}`}><div className="eyebrow">{item.label}</div><div className="font-display mt-2 text-[24px] font-bold tracking-[-.05em]">{counts[item.kind] || 0}</div></button>)}
        <Link href="/customers" className="panel p-4 text-left transition-transform hover:-translate-y-0.5" data-testid="link-catalog-customers"><div className="eyebrow">Clientes</div><div className="font-display mt-2 text-[24px] font-bold tracking-[-.05em]">{query.data.customerCount}</div></Link>
      </div>
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eeece4] px-4 py-4 md:px-5"><div><div className="eyebrow">{current.label} · {counts[kind] || 0}</div><p className="mt-1 text-[11px] text-[#78857f]">{current.hint}</p></div>
          <label className="relative min-w-[240px] flex-1 sm:max-w-[340px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9690]" size={16} /><input className="field !h-10 !pl-9" type="search" placeholder="Buscar código o nombre" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-catalog-search" /></label></div>
        {visible.length === 0 ? <EmptyState title={needle ? 'Sin coincidencias' : 'Catálogo vacío'} text={needle ? 'Prueba con otro código o nombre.' : 'No hay entradas importadas de este tipo.'} /> :
          <div className="max-h-[640px] overflow-auto"><table className="w-full min-w-[920px]"><thead className="sticky top-0 bg-[#faf9f3]"><tr className="eyebrow text-left"><th className="px-5 py-3 font-medium">Código</th><th className="px-4 py-3 font-medium">Nombre</th><th className="px-4 py-3 font-medium">Valor exportado</th>{kind === 'service' && <><th className="px-4 py-3 font-medium">UM</th><th className="px-4 py-3 font-medium">Grupo</th></>}{kind === 'commercial' && <th className="px-4 py-3 font-medium">Cargo</th>}<th className="px-4 py-3 font-medium">Estado</th><th className="px-4 py-3 font-medium">ID origen</th><th className="px-5 py-3 text-right font-medium">Acciones</th></tr></thead><tbody>{visible.map((entry) => <tr key={entry.id} className={`table-row ${!entry.active ? 'opacity-65' : ''}`} data-testid={`row-catalog-${entry.id}`}><td className="px-5 py-3 font-mono text-[12px] font-medium text-[#2e6960]">{entry.code}</td><td className="px-4 py-3 text-[12px] font-semibold">{entry.name}</td><td className="px-4 py-3 font-mono text-[11px] text-[#5f736c]">{entry.exportValue}</td>{kind === 'service' && <><td className="px-4 py-3 font-mono text-[11px] text-[#5f736c]">{entry.unitCode ? `${entry.unitCode}${entry.unitName ? ` · ${entry.unitName}` : ''}` : '—'}</td><td className="px-4 py-3 font-mono text-[11px] text-[#5f736c]">{entry.groupCode || '—'}</td></>}{kind === 'commercial' && <td className="px-4 py-3 text-[11px] text-[#71817b]">{entry.position || '—'}</td>}<td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${entry.active ? 'bg-[#e6f2e9] text-[#317060]' : 'bg-[#f1e7e4] text-[#9a6960]'}`}>{entry.active ? 'Activo' : 'Desactivado'}</span></td><td className="px-4 py-3 font-mono text-[10px] text-[#8a958f]">{entry.sourceId}</td><td className="px-5 py-3"><div className="flex justify-end gap-2"><button className="button button-plain !min-h-8 !px-2.5 text-[11px]" onClick={() => setHistoryEntry(entry)} data-testid={`button-history-catalog-${entry.id}`}><Clock3 size={13} />Historial</button><button className="button button-plain !min-h-8 !px-2.5 text-[11px]" onClick={() => openEdit(entry)} disabled={pending} data-testid={`button-edit-catalog-${entry.id}`}><Pencil size={13} />Editar</button><button className="button button-plain !min-h-8 !px-2.5 text-[11px]" onClick={() => setActive(entry)} disabled={pending} data-testid={`button-toggle-catalog-${entry.id}`}>{entry.active ? <X size={13} /> : <RotateCcw size={13} />}{entry.active ? 'Desactivar' : 'Reactivar'}</button></div></td></tr>)}</tbody></table></div>}
      </section>
    </>}
    {dialog && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1d302e]/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setDialog(false); }}>
      <section className="panel w-full max-w-[620px] p-5 shadow-xl md:p-7" role="dialog" aria-modal="true" aria-labelledby="catalog-editor-title">
        <div className="mb-5 flex items-start justify-between gap-4"><div><div className="eyebrow">Catálogo de Versat</div><h2 id="catalog-editor-title" className="font-display mt-1 text-xl font-bold">{editing ? 'Modificar registro' : `Añadir a ${current.label.toLowerCase()}`}</h2><p className="mt-2 text-[12px] leading-5 text-[#78857f]">El valor exportado debe coincidir con el que reconoce Versat de escritorio.</p></div><button className="button button-plain !min-h-8 !px-2" type="button" aria-label="Cerrar" onClick={() => setDialog(false)} disabled={pending}><X size={16} /></button></div>
        {error && <div className="mb-4 rounded-lg bg-[#fbefeb] px-4 py-2.5 text-[12px] text-[#a04539]" role="alert">{error}</div>}
        <form onSubmit={save} className="space-y-4">
          {!editing && <label className="block"><span className="field-label">ID de origen en Versat *</span><input className="field" type="number" name="sourceId" min="1" step="1" required data-testid="input-catalog-source-id" /><span className="mt-1 block text-[10px] text-[#85918a]">Crea primero el registro en Versat y escribe aquí su ID.</span></label>}
          {editing && <p className="rounded-lg bg-[#f5f4ed] px-3 py-2 text-[11px] text-[#6d7b75]">ID de origen: <span className="font-mono font-semibold">{editing.sourceId}</span> · no se modifica desde esta pantalla.</p>}
          <div className="grid gap-4 sm:grid-cols-2"><label><span className="field-label">Código *</span><input className="field" name="code" defaultValue={editing?.code ?? ''} maxLength={100} required /></label><label><span className="field-label">Nombre *</span><input className="field" name="name" defaultValue={editing?.name ?? ''} maxLength={200} required /></label></div>
          <label className="block"><span className="field-label">Valor exportado a Versat *</span><input className="field font-mono" name="exportValue" defaultValue={editing?.exportValue ?? ''} maxLength={200} required /><span className="mt-1 block text-[10px] text-[#85918a]">Es el dato que se escribirá en el fichero .Fac.</span></label>
          {kind === 'service' && <div className="grid gap-4 sm:grid-cols-3"><label><span className="field-label">Código UM</span><input className="field" name="unitCode" defaultValue={editing?.unitCode ?? ''} maxLength={60} /></label><label><span className="field-label">Nombre UM</span><input className="field" name="unitName" defaultValue={editing?.unitName ?? ''} maxLength={100} /></label><label><span className="field-label">Grupo</span><input className="field" name="groupCode" defaultValue={editing?.groupCode ?? ''} maxLength={60} /></label></div>}
          {kind === 'commercial' && <label className="block"><span className="field-label">Cargo</span><input className="field" name="position" defaultValue={editing?.position ?? ''} maxLength={120} /></label>}
          <div className="flex flex-wrap justify-end gap-2 pt-2"><button type="button" className="button button-plain" onClick={() => setDialog(false)} disabled={pending}>Cancelar</button><button type="submit" className="button button-primary" disabled={pending} data-testid="button-save-catalog-entry">{pending ? 'Guardando…' : <><Check size={15} />{editing ? 'Guardar cambios' : 'Añadir registro'}</>}</button></div>
        </form>
      </section>
    </div>}
    {historyEntry && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1d302e]/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryEntry(null); }}>
      <section className="panel max-h-[90dvh] w-full max-w-[780px] overflow-y-auto p-5 shadow-xl md:p-7" role="dialog" aria-modal="true" aria-labelledby="catalog-history-title">
        <div className="mb-5 flex items-start justify-between gap-4"><div><div className="eyebrow">Registro de auditoría · {kindName(historyEntry.kind)}</div><h2 id="catalog-history-title" className="font-display mt-1 text-xl font-bold">Historial de «{historyEntry.code}»</h2><p className="mt-2 text-[12px] leading-5 text-[#78857f]">Los eventos son de solo lectura. Se conserva quién realizó cada cambio y sus valores antes y después.</p></div><button className="button button-plain !min-h-8 !px-2" type="button" aria-label="Cerrar historial" onClick={() => setHistoryEntry(null)}><X size={16} /></button></div>
        {historyQuery.isLoading ? <div className="py-8 text-center text-sm text-[#78857f]">Cargando historial…</div>
          : historyQuery.isError ? <QueryError retry={() => historyQuery.refetch()} message="No pudimos cargar el historial." detail={errorDetail(historyQuery.error, '')} />
            : !historyQuery.data?.length ? <EmptyState title="Aún no hay cambios registrados" text="Las altas y modificaciones realizadas a partir del registro de auditoría aparecerán aquí." />
              : <ol className="space-y-3">{historyQuery.data.map((event) => {
                const fields = auditFields.filter(({ key }) => !event.previousValues
                  || event.previousValues[key] !== event.newValues[key]);
                return <li key={event.id} className="rounded-xl border border-[#eeece4] bg-[#fffefa] p-4" data-testid={`catalog-history-event-${event.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#eeece4] pb-3"><div><span className="rounded-full bg-[#e9f1ed] px-2.5 py-1 text-[10px] font-bold text-[#317060]">{actionLabel(event.action)}</span><div className="mt-2 text-[12px] font-semibold text-[#334943]">{event.actorName}{event.actorEmail ? <span className="ml-2 font-normal text-[#78857f]">{event.actorEmail}</span> : null}</div></div><time className="text-[11px] text-[#78857f]" dateTime={event.createdAt}>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt))}</time></div>
                  <div className="mt-3 space-y-2">{fields.map(({ key, label }) => <div key={key} className="grid gap-1 text-[11px] sm:grid-cols-[120px_1fr_1fr] sm:gap-3"><span className="font-semibold text-[#64736d]">{label}</span><span className="text-[#8a958f]"><span className="sm:hidden">Antes: </span>{auditValue(key, event.previousValues?.[key])}</span><span className="font-medium text-[#334943]"><span className="sm:hidden">Después: </span>{auditValue(key, event.newValues[key])}</span></div>)}</div>
                </li>;
              })}</ol>}
        <div className="mt-5 flex justify-end"><button type="button" className="button button-plain" onClick={() => setHistoryEntry(null)}>Cerrar</button></div>
      </section>
    </div>}
  </div>;
}

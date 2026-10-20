import { useMemo, useState } from 'react';
import { getGetVersatCatalogsQueryKey, useGetVersatCatalogs } from '@workspace/api-client-react';
import type { VersatCatalogEntryKind } from '@workspace/api-client-react';
import { ArrowRight, Search, Users } from 'lucide-react';
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

export default function CatalogsPage() {
  const query = useGetVersatCatalogs({ query: { queryKey: getGetVersatCatalogsQueryKey() } });
  const [kind, setKind] = useState<VersatCatalogEntryKind>('service');
  const [search, setSearch] = useState('');
  const entries = useMemo(() => query.data?.entries ?? [], [query.data]);
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const entry of entries) map[entry.kind] = (map[entry.kind] || 0) + 1;
    return map;
  }, [entries]);
  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => entries
    .filter((entry) => entry.kind === kind)
    .filter((entry) => !needle || [entry.code, entry.name, entry.unitCode, entry.unitName, entry.groupCode, entry.position].some((value) => value && value.toLowerCase().includes(needle)))
    .sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true })), [entries, kind, needle]);
  const current = kinds.find((item) => item.kind === kind)!;

  return <div className="fade-in">
    <PageHeading eyebrow="Versat de escritorio" title="Catálogos" description="Referencia de solo lectura con los códigos exactos importados de Versat." action={<Link href="/customers" className="button button-plain"><Users size={15} />Ver clientes<ArrowRight size={14} /></Link>} />
    {query.isLoading ? <div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="panel p-4"><div className="skeleton h-3 w-20" /><div className="skeleton mt-3 h-7 w-12" /></div>)}</div> : query.isError || !query.data ? <QueryError retry={() => query.refetch()} message="No pudimos cargar los catálogos." detail={errorDetail(query.error, '')} /> : <>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {kinds.map((item) => <button key={item.kind} onClick={() => setKind(item.kind)} className={`panel p-4 text-left transition-transform hover:-translate-y-0.5 ${kind === item.kind ? '!border-[#49867c] !bg-[#f1f6f2]' : ''}`} data-testid={`tab-catalog-${item.kind}`}><div className="eyebrow">{item.label}</div><div className="font-display mt-2 text-[24px] font-bold tracking-[-.05em]">{counts[item.kind] || 0}</div></button>)}
        <Link href="/customers" className="panel p-4 text-left transition-transform hover:-translate-y-0.5" data-testid="link-catalog-customers"><div className="eyebrow">Clientes</div><div className="font-display mt-2 text-[24px] font-bold tracking-[-.05em]">{query.data.customerCount}</div></Link>
      </div>
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eeece4] px-4 py-4 md:px-5"><div><div className="eyebrow">{current.label} · {counts[kind] || 0}</div><p className="mt-1 text-[11px] text-[#78857f]">{current.hint}</p></div>
          <label className="relative min-w-[240px] flex-1 sm:max-w-[340px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9690]" size={16} /><input className="field !h-10 !pl-9" type="search" placeholder="Buscar código o nombre" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-catalog-search" /></label></div>
        {visible.length === 0 ? <EmptyState title={needle ? 'Sin coincidencias' : 'Catálogo vacío'} text={needle ? 'Prueba con otro código o nombre.' : 'No hay entradas importadas de este tipo.'} /> :
          <div className="max-h-[640px] overflow-auto"><table className="w-full min-w-[640px]"><thead className="sticky top-0 bg-[#faf9f3]"><tr className="eyebrow text-left"><th className="px-5 py-3 font-medium">Código</th><th className="px-4 py-3 font-medium">Nombre</th>{kind === 'service' && <><th className="px-4 py-3 font-medium">UM</th><th className="px-4 py-3 font-medium">Grupo</th></>}{kind === 'commercial' && <th className="px-4 py-3 font-medium">Cargo</th>}<th className="px-5 py-3 text-right font-medium">ID origen</th></tr></thead><tbody>{visible.map((entry) => <tr key={entry.id} className="table-row" data-testid={`row-catalog-${entry.id}`}><td className="px-5 py-3 font-mono text-[12px] font-medium text-[#2e6960]">{entry.code}</td><td className="px-4 py-3 text-[12px] font-semibold">{entry.name}</td>{kind === 'service' && <><td className="px-4 py-3 font-mono text-[11px] text-[#5f736c]">{entry.unitCode ? `${entry.unitCode}${entry.unitName ? ` · ${entry.unitName}` : ''}` : '—'}</td><td className="px-4 py-3 font-mono text-[11px] text-[#5f736c]">{entry.groupCode || <span className="text-[#a97c2c]">sin grupo</span>}</td></>}{kind === 'commercial' && <td className="px-4 py-3 text-[11px] text-[#71817b]">{entry.position || '—'}</td>}<td className="px-5 py-3 text-right font-mono text-[10px] text-[#8a958f]">{entry.sourceId}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </div>;
}

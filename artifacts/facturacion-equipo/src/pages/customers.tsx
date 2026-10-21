import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetCurrentTeamMemberQueryKey, getListCustomersQueryKey, useCreateCustomer, useDeleteCustomer, useGetCurrentTeamMember, useListCustomers, useUpdateCustomer } from '@workspace/api-client-react';
import type { Customer, CustomerInput } from '@workspace/api-client-react';
import { BookOpen, Lock, Search, Users, X } from 'lucide-react';
import { Link } from 'wouter';
import { EmptyState, PageHeading, QueryError, errorDetail } from '@/lib/shared';

export default function CustomersPage() {
  const member = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false } });
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [dialog, setDialog] = useState(false);
  const query = useListCustomers(search.trim() ? { search: search.trim() } : undefined);
  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  const remove = useDeleteCustomer();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const locked = !!editing && editing.versatSourceId != null;

  function open(customer?: Customer) { setEditing(customer || null); setError(''); setDialog(true); }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) || '').trim() || null;
    const payload: CustomerInput = {
      name: String(data.get('name') || '').trim(),
      ircc: text('ircc'), email: text('email'), phone: text('phone'), taxId: text('taxId'), address: text('address'), notes: text('notes'),
      ...(locked ? {} : { versatCode: text('versatCode') }),
    };
    const options = {
      onSuccess: () => { client.invalidateQueries({ queryKey: getListCustomersQueryKey() }); setDialog(false); setSuccess(editing ? 'Cliente actualizado.' : 'Cliente creado.'); },
      onError: (err: unknown) => setError(`No se pudo guardar el cliente. ${errorDetail(err, '')}`),
    };
    if (editing) update.mutate({ id: editing.id, data: payload }, options);
    else create.mutate({ data: payload }, options);
  }
  function archive(customer: Customer) {
    if (!window.confirm(`¿Archivar a ${customer.name}?`)) return;
    remove.mutate({ id: customer.id }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListCustomersQueryKey() }); setSuccess('Cliente archivado.'); }, onError: () => setError('No se pudo archivar el cliente.') });
  }
  const records = (query.data || []).filter((c) => showInactive || c.active);

  return <div className="fade-in">
    <PageHeading eyebrow="Agenda compartida" title="Clientes" description="Los códigos y NIT se conservan tal como existen en Versat." action={<div className="flex flex-wrap gap-2">{member.data?.role === 'owner' && <Link href="/catalogs" className="button button-plain"><BookOpen size={15} />Ver catálogos</Link>}<button className="button button-primary" onClick={() => open()} data-testid="button-new-customer"><Users size={15} />Añadir cliente</button></div>} />
    {success && <div className="mb-4 flex items-center justify-between rounded-lg bg-[#e6f2e9] px-4 py-2.5 text-[12px] font-semibold text-[#317060]" role="status">{success}<button onClick={() => setSuccess('')} aria-label="Cerrar aviso"><X size={14} /></button></div>}
    {error && !dialog && <div className="mb-4 rounded-lg bg-[#fbefeb] px-4 py-2.5 text-[12px] text-[#a04539]" role="alert">{error}</div>}
    <section className="panel overflow-hidden"><div className="flex flex-wrap items-center gap-3 border-b border-[#eeece4] p-4 md:px-5"><label className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9690]" size={16} /><input className="field !h-10 !pl-9" placeholder="Buscar por nombre, código, email o NIT" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-customer-search" /></label><label className="flex items-center gap-2 text-[11px] font-semibold text-[#71817b]"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Mostrar archivados</label></div>
      {query.isLoading ? <div className="space-y-4 p-5">{[0, 1, 2, 3].map((i) => <div className="skeleton h-11" key={i} />)}</div> : query.isError ? <div className="p-5"><QueryError retry={() => query.refetch()} /></div> : records.length === 0 ? <EmptyState title={search ? 'Sin coincidencias' : 'Añade el primer cliente'} text={search ? 'Prueba con otro término de búsqueda.' : 'Crea una ficha para poder preparar facturas.'} action={!search && <button className="button button-primary" onClick={() => open()}>Añadir cliente</button>} /> :
        <div className="overflow-x-auto"><table className="w-full min-w-[820px]"><thead><tr className="eyebrow text-left"><th className="px-5 py-3 font-medium">Código Versat</th><th className="px-4 py-3 font-medium">Cliente</th><th className="px-4 py-3 font-medium">NIT</th><th className="px-4 py-3 font-medium">Contacto</th><th className="px-4 py-3 font-medium">Estado</th><th className="px-5 py-3 text-right font-medium">Acciones</th></tr></thead><tbody>{records.map((c) => <tr key={c.id} className="table-row" data-testid={`row-customer-${c.id}`}>
          <td className="px-5 py-4 font-mono text-[12px] font-medium text-[#2e6960]"><span className="inline-flex items-center gap-1.5">{c.versatSourceId != null && <Lock size={11} className="text-[#9aa59f]" aria-label="Importado de Versat" />}{c.versatCode || '—'}</span></td>
          <td className="px-4 py-4"><div className="text-[13px] font-bold">{c.name}</div><div className="mt-1 text-[10px] text-[#849089]">{c.address || 'Sin dirección'}</div>{c.active && <Link href={`/customers/${c.id}`} className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-[#347568] hover:underline" data-testid={`link-customer-360-${c.id}`}>Ver ficha 360° <span aria-hidden="true">→</span></Link>}</td>
          <td className="px-4 py-4 font-mono text-[11px] text-[#5f736c]">{c.taxId || '—'}{c.ircc && <div className="mt-1 text-[10px] text-[#85918a]">IRCC {c.ircc}</div>}</td>
          <td className="px-4 py-4 text-[12px] text-[#657871]">{c.email || '—'}<div className="mt-1 text-[10px]">{c.phone || ''}</div></td>
          <td className="px-4 py-4"><span className={`status-pill ${c.active ? 'status-paid' : 'status-cancelled'}`}>{c.active ? 'Activo' : 'Archivado'}</span></td>
          <td className="px-5 py-4 text-right"><button className="button button-plain !min-h-8 !px-3 text-[11px]" onClick={() => open(c)} data-testid={`button-edit-customer-${c.id}`}>Editar</button>{c.active && <button className="ml-2 button button-danger !min-h-8 !px-3 text-[11px]" onClick={() => archive(c)} disabled={remove.isPending} data-testid={`button-archive-customer-${c.id}`}>Archivar</button>}</td></tr>)}</tbody></table></div>}
    </section>
    {dialog && <div className="fixed inset-0 z-50 grid place-items-center bg-[#1c3531]/45 p-4" role="dialog" aria-modal="true" aria-labelledby="customer-dialog-title"><div className="panel max-h-[90dvh] w-full max-w-[600px] overflow-y-auto p-5 md:p-7"><div className="mb-5 flex items-start justify-between"><div><div className="eyebrow">Ficha de cliente</div><h2 id="customer-dialog-title" className="font-display mt-1 text-xl font-bold">{editing ? 'Editar cliente' : 'Nuevo cliente'}</h2></div><button className="grid h-8 w-8 place-items-center rounded-lg text-[#76847d] hover:bg-[#f0eee5]" onClick={() => setDialog(false)} aria-label="Cerrar"><X size={17} /></button></div>
      <form className="space-y-4" onSubmit={save}>
        <label><span className="field-label">Nombre o razón social *</span><input className="field" name="name" defaultValue={editing?.name || ''} required autoFocus data-testid="input-customer-name" /></label>
        <div className="rounded-xl border border-[#e8e5d9] bg-[#f6f5ee] p-4">
          <label><span className="field-label">Código Versat</span><input className="field font-mono" name="versatCode" defaultValue={editing?.versatCode || ''} readOnly={locked} maxLength={40} autoComplete="off" data-testid="input-customer-versat-code" /></label>
          <p className="mt-2 flex items-start gap-2 text-[11px] leading-5 text-[#6e7f78]">{locked && <Lock size={12} className="mt-1 shrink-0" />}<span>{locked ? 'Este código viene importado de Versat y no se puede cambiar.' : 'Un código nuevo debe existir ya en Versat de escritorio; aquí no se crea ningún cliente allí. Déjalo vacío si aún no tiene.'}</span></p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2"><label><span className="field-label">NIT</span><input className="field font-mono" name="taxId" defaultValue={editing?.taxId || ''} /></label><label><span className="field-label">IRCC</span><input className="field font-mono" name="ircc" defaultValue={editing?.ircc || ''} /></label></div>
        <div className="grid gap-4 sm:grid-cols-2"><label><span className="field-label">Email</span><input className="field" name="email" type="email" defaultValue={editing?.email || ''} /></label><label><span className="field-label">Teléfono</span><input className="field" name="phone" defaultValue={editing?.phone || ''} /></label></div>
        <label><span className="field-label">Dirección</span><input className="field" name="address" defaultValue={editing?.address || ''} /></label>
        <label><span className="field-label">Notas internas</span><textarea className="field" name="notes" defaultValue={editing?.notes || ''} /></label>
        {error && <p className="text-[12px] text-[#a04539]" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="button button-plain" onClick={() => setDialog(false)}>Cancelar</button><button className="button button-primary" type="submit" disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? 'Guardando…' : 'Guardar cliente'}</button></div>
      </form></div></div>}
  </div>;
}

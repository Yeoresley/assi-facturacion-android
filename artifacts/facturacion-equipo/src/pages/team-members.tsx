import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCurrentTeamMemberQueryKey, getGetVersatCatalogsQueryKey, getListTeamMembersQueryKey,
  useGetCurrentTeamMember, useGetVersatCatalogs, useInviteTeamMember, useListTeamMembers,
} from '@workspace/api-client-react';
import { ArrowLeft, ArrowRight, Pencil, ShieldAlert } from 'lucide-react';
import { Link } from 'wouter';
import { EmptyState, PageHeading, QueryError, errorDetail } from '@/lib/shared';

const roleLabel = (role: string) => (role === 'owner' ? 'Propietario' : role === 'specialist' ? 'Especialista' : 'Pendiente');

export default function TeamMembersPage() {
  const current = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false } });
  const isOwner = current.data?.role === 'owner';
  if (current.isLoading) return <div className="mx-auto max-w-[1000px] space-y-4"><div className="skeleton h-6 w-40" /><div className="panel space-y-3 p-6"><div className="skeleton h-8 w-56" /><div className="skeleton h-24" /></div></div>;
  if (current.isError || !current.data) return <QueryError retry={() => current.refetch()} message="No pudimos comprobar tu acceso." />;
  if (!isOwner) return <div className="fade-in mx-auto max-w-[520px]"><div className="panel p-8 text-center" data-testid="team-access-denied"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#f7edda] text-[#9a742e]"><ShieldAlert size={22} /></span><h1 className="font-display mt-5 text-xl font-bold">Acceso denegado</h1><p className="mt-2 text-[13px] leading-6 text-[#71817b]">Solo el propietario puede gestionar qué comercial tiene asignado cada especialista.</p><Link href="/dashboard" className="button button-primary mt-5">Volver al resumen</Link></div></div>;
  return <OwnerTeam />;
}

function OwnerTeam() {
  const team = useListTeamMembers({ query: { queryKey: getListTeamMembersQueryKey(), retry: false } });
  const catalogs = useGetVersatCatalogs({ query: { queryKey: getGetVersatCatalogsQueryKey() } });
  const invite = useInviteTeamMember();
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [commercial, setCommercial] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const commercials = (catalogs.data?.entries ?? []).filter((e) => e.kind === 'commercial');
  const byId = new Map(commercials.map((c) => [c.id, c]));
  const selected = commercial ? byId.get(Number(commercial)) : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    setNotice('');
    setError('');
    const commercialId = commercial ? Number(commercial) : null;
    invite.mutate({ data: { email: email.trim().toLowerCase(), commercialId } }, {
      onSuccess: (result) => {
        setEmail('');
        setCommercial('');
        setNotice(result.commercialId == null
          ? `Acceso guardado para ${result.email} sin comercial: no verá facturas hasta que se le asigne uno.`
          : `Asignación guardada para ${result.email}. Se aplica al iniciar sesión con esa dirección verificada.`);
        client.invalidateQueries({ queryKey: getListTeamMembersQueryKey() });
      },
      onError: (err) => setError(`No se pudo guardar la asignación. ${errorDetail(err, 'Revisa el email e inténtalo de nuevo.')}`),
    });
  }
  function edit(memberEmail: string | null, commercialId: number | null) {
    if (!memberEmail) return;
    setEmail(memberEmail);
    setCommercial(commercialId == null ? '' : String(commercialId));
    setNotice('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const name = (id: number | null) => { const c = id == null ? undefined : byId.get(id); return c ? `${c.code} · ${c.name}` : id == null ? null : `Comercial ${id}`; };

  return <div className="fade-in mx-auto max-w-[1000px]">
    <Link href="/settings" className="mb-6 inline-flex items-center gap-2 text-[12px] font-semibold text-[#71817b]"><ArrowLeft size={14} />Volver a ajustes</Link>
    <PageHeading eyebrow="Acceso compartido" title="Equipo y permisos" description="Cada especialista ve y prepara las facturas de su comercial. Quienes comparten comercial comparten facturas." />
    <section className="panel mb-5 p-5 md:p-6"><div className="mb-4"><div className="eyebrow">Asignación</div><h2 className="font-display mt-1 text-lg font-bold">Conceder o cambiar acceso</h2><p className="mt-1 text-[12px] leading-5 text-[#77847e]">Usa el email verificado de Clerk. Si la persona ya existe, se actualiza su comercial.</p></div>
      <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end" onSubmit={submit}>
        <label><span className="field-label">Email del especialista</span><input className="field" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="especialista@equipo.com" data-testid="input-team-email" /></label>
        <label><span className="field-label">Comercial asignado</span><select className="field" value={commercial} onChange={(e) => setCommercial(e.target.value)} disabled={catalogs.isLoading} data-testid="select-team-commercial"><option value="">Sin comercial (sin acceso a facturas)</option>{commercials.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
        <button className="button button-primary" type="submit" disabled={invite.isPending} data-testid="button-team-save">{invite.isPending ? 'Guardando…' : 'Guardar'}<ArrowRight size={14} /></button>
      </form>
      {catalogs.isError && <div className="mt-3"><QueryError retry={() => catalogs.refetch()} message="No pudimos cargar los comerciales de Versat." /></div>}
      {!catalogs.isLoading && !catalogs.isError && !commercials.length && <p className="mt-3 text-[11px] text-[#8a6a25]">No hay comerciales importados en los catálogos de Versat.</p>}
      {selected && <p className="mt-3 text-[12px] text-[#4d6a63]" data-testid="text-selected-commercial">Comercial seleccionado: <strong>{selected.name}</strong> <span className="font-mono">({selected.code})</span></p>}
      {!commercial && email && <p className="mt-3 rounded-lg bg-[#f7edda] px-4 py-3 text-[12px] leading-5 text-[#7e5f22]" role="alert">Sin comercial asignado, esta cuenta no podrá ver ni crear facturas.</p>}
      {notice && <div className="mt-3 rounded-lg bg-[#e6f2e9] px-4 py-3 text-[12px] leading-5 text-[#317060]" role="status">{notice}</div>}
      {error && <div className="mt-3 rounded-lg bg-[#fbefeb] px-4 py-3 text-[12px] text-[#a04539]" role="alert">{error}</div>}
    </section>
    <section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-[#eeece4] px-5 py-4"><div><div className="eyebrow">Acceso actual</div><h2 className="font-display mt-1 text-base font-bold">Personas del equipo</h2></div><span className="rounded-full bg-[#edf0e7] px-2.5 py-1 font-mono text-[10px] text-[#61736b]">{team.data?.length ?? '—'} miembros</span></div>
      {team.isLoading ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12" />)}</div> : team.isError ? <div className="p-5"><QueryError retry={() => team.refetch()} message="No pudimos cargar los accesos del equipo." /></div> : !team.data?.length ? <EmptyState title="Aún no hay accesos visibles" text="Las personas autorizadas aparecerán aquí cuando las añadas." /> :
        <div className="overflow-x-auto"><table className="w-full min-w-[640px]"><thead><tr className="eyebrow text-left"><th className="px-5 py-3 font-medium">Miembro</th><th className="px-4 py-3 font-medium">Rol</th><th className="px-4 py-3 font-medium">Comercial</th><th className="px-5 py-3 text-right font-medium">Acción</th></tr></thead><tbody>{team.data.map((m, i) => <tr key={`${m.userId}-${m.email || i}`} className="table-row" data-testid={`row-team-member-${m.userId}`}>
          <td className="px-5 py-4"><div className="text-[13px] font-semibold">{m.name || 'Sin nombre'}</div><div className="text-[11px] text-[#78857f]">{m.email || 'Sin correo'}</div></td>
          <td className="px-4 py-4 text-[12px]">{roleLabel(m.role)}</td>
          <td className="px-4 py-4 text-[12px]">{m.role === 'owner' ? <span className="text-[#71817b]">Todas las facturas</span> : name(m.commercialId) ?? <span className="font-semibold text-[#9a742e]">Sin asignar</span>}</td>
          <td className="px-5 py-4 text-right">{m.role !== 'owner' && m.email && <button className="button button-plain !min-h-8 !px-3 text-[11px]" onClick={() => edit(m.email, m.commercialId)} data-testid={`button-edit-member-${m.userId}`}><Pencil size={13} />Editar</button>}</td>
        </tr>)}</tbody></table></div>}
    </section>
  </div>;
}

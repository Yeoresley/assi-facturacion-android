import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetIssuerQueryKey, useGetIssuer, useUpdateIssuer, type IssuerProfile } from '@workspace/api-client-react';
import { errorDetail } from '@/lib/shared';

const labels: Record<keyof IssuerProfile, string> = {
  name: 'Razón social', nit: 'NIT', ircc: 'IRCC', address: 'Dirección',
  organization: 'Organismo', paymentBeneficiary: 'Beneficiario del pago',
  bankAccount: 'Cuenta bancaria', bankBranch: 'Sucursal', bankName: 'Banco',
};

export function IssuerSettings() {
  const query = useGetIssuer({ query: { queryKey: getGetIssuerQueryKey(), retry: false, staleTime: 0 } });
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const update = useUpdateIssuer();
  const client = useQueryClient();
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    const profile = Object.fromEntries(Object.keys(labels).map(key => [key, String(fields.get(key) || '').trim()])) as unknown as IssuerProfile;
    update.mutate({ data: profile }, {
      onSuccess: () => { client.invalidateQueries({ queryKey: getGetIssuerQueryKey() }); setEditing(false); setNotice('Emisor guardado. Las facturas emitidas conservan su instantánea original.'); },
      onError: err => setNotice(errorDetail(err, 'No se pudo guardar el emisor.')),
    });
  }
  return <section className="panel mt-5 p-6 no-print" data-testid="issuer-settings">
    <h2 className="font-display text-lg font-bold">Emisor y datos de pago</h2>
    <p className="my-3 text-xs leading-5">Solo el propietario puede cambiarlos. Revisa los datos transcritos del PDF antes de autorizar una factura. En los PDF nuevos, el cuño y las firmas permanecen en blanco.</p>
    {query.isPending ? <p>Cargando…</p> : query.isError ? <button className="button button-soft" onClick={() => query.refetch()}>Reintentar carga del emisor</button> : <>
      {editing || !query.data.profile ? <form onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">{Object.entries(labels).map(([key, label]) => <label key={key} className="text-xs font-semibold">{label}<input className="field mt-1" name={key} required maxLength={key === 'address' ? 400 : 200} defaultValue={query.data.profile?.[key as keyof IssuerProfile] || ''} /></label>)}</div>
        <button className="button button-primary" disabled={update.isPending}>Guardar emisor</button>
        {query.data.profile && <button className="button button-plain ml-2" type="button" onClick={() => setEditing(false)}>Cancelar</button>}
      </form> : <><dl className="grid gap-3 text-xs sm:grid-cols-2">{Object.entries(labels).map(([key, label]) => <div key={key}><dt className="text-[#71817b]">{label}</dt><dd className="mt-1 break-words font-semibold">{query.data.profile?.[key as keyof IssuerProfile]}</dd></div>)}</dl><button className="button button-soft mt-5" onClick={() => setEditing(true)}>Editar emisor</button></>}
    </>}
    {notice && <p className="mt-3 text-xs" role="status">{notice}</p>}
  </section>;
}

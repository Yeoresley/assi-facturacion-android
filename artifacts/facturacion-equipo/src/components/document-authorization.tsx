import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAuthorizeInvoiceDocument, useGetCurrentTeamMember, useGetIssuer, getGetCurrentTeamMemberQueryKey,
  getGetIssuerQueryKey, getGetInvoiceQueryKey, getListInvoicesQueryKey,
  type DocumentAuthorization, type Invoice,
} from '@workspace/api-client-react';
import { errorDetail } from '@/lib/shared';

const fields = {
  preparedBy: 'Realizada por (nombre)', preparedPosition: 'Cargo de quien la realiza',
  deliveredBy: 'Entregada por', accountedBy: 'Contabilizada por (titular de la firma)',
  transportedBy: 'Transportado por', transportId: 'CI del transportista', vehiclePlate: 'Chapa (CH)', drivingLicense: 'Licencia',
  receivedBy: 'Recibido por', receivedPosition: 'Cargo del receptor', receivedId: 'CI del receptor',
  customerIrcc: 'Inscripción RCC del cliente', customerBankAccount: 'Cuenta bancaria del cliente',
};

export function DocumentAuthorizationForm({ invoice }: { invoice: Invoice }) {
  const member = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false } });
  const settings = useGetIssuer({ query: { queryKey: getGetIssuerQueryKey(), retry: false, staleTime: 0 } });
  const mutation = useAuthorizeInvoiceDocument();
  const client = useQueryClient();
  const [editing, setEditing] = useState(!invoice.legalDocument);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const data = {
      ...Object.fromEntries(Object.keys(fields).map(key => [key, String(form.get(key) || '').trim()])),
      useStamp: false, useSignature: false, confirm: true,
    } as DocumentAuthorization;
    setError('');
    setNotice('');
    mutation.mutate({ id: invoice.id, data }, {
      onSuccess: (saved) => {
        client.setQueryData(getGetInvoiceQueryKey(invoice.id), saved);
        client.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoice.id) });
        client.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        setEditing(false);
        setNotice(`Pie de factura guardado en ${saved.number}. La sección se ha plegado; los datos siguen asociados a esta factura.`);
      },
      onError: err => setError(errorDetail(err, 'No se pudo guardar el pie de factura.')),
    });
  }
  const document = invoice.legalDocument;
  return <section id="invoice-document-authorization" className="no-print panel mb-5 p-5">
    {document && !editing ? <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Datos guardados para esta factura</div>
          <h2 className="font-display mt-1 font-bold">Pie de factura completado</h2>
          <p className="mt-2 text-xs text-[#5f736c]">{invoice.number} · {document.preparedBy} · {document.preparedPosition}</p>
          <p className="mt-1 text-[11px] text-[#85918a]">El emisor y estos datos están guardados en esta factura. El cuño y las firmas permanecen en blanco.</p>
        </div>
        <button className="button button-plain !min-h-9" onClick={() => { setError(''); setNotice(''); setEditing(true); }} data-testid="button-edit-invoice-footer">Editar datos del pie</button>
      </div>
    </> : <>
      <h2 className="font-display font-bold">{document ? 'Editar pie de factura' : 'Completar pie de factura'}</h2>
      <p className="my-3 text-xs leading-5">Estos datos se guardan solo en esta factura. Completa los responsables reales; el cuño y las firmas se dejan en blanco para completar después de imprimir.</p>
      {member.data?.role === 'owner' && <Link href="/settings" className="text-xs underline">Ver emisor y datos de pago</Link>}
      {settings.isError ? <p className="mt-3 text-xs" role="alert">No se pudo cargar el emisor. <button onClick={() => settings.refetch()}>Reintentar</button></p> : settings.isPending ? <p>Cargando emisor…</p> : !settings.data.profile ? <p className="mt-3 text-xs">El propietario aún no ha configurado el emisor. Pídele que lo complete en Ajustes.</p> : <form onSubmit={save} className="mt-4 space-y-4">
        <p className="text-xs">Emisor: <strong>{settings.data.profile.name}</strong> · NIT {settings.data.profile.nit}</p>
        <div className="grid gap-3 sm:grid-cols-2">{Object.entries(fields).map(([key, label]) => <label className="text-xs font-semibold" key={key}>{label}{['preparedBy', 'preparedPosition'].includes(key) ? ' *' : ''}
          <input name={key} className="field mt-1" maxLength={key.endsWith('Id') || ['vehiclePlate', 'drivingLicense'].includes(key) ? 40 : key.startsWith('customer') ? 80 : 160} required={['preparedBy', 'preparedPosition'].includes(key)} defaultValue={document?.[key as keyof typeof fields] || ''} />
        </label>)}</div>
        <label className="flex items-start gap-2 text-xs leading-5"><input className="mt-1" type="checkbox" required name="confirm" />Confirmo el emisor y los responsables. El cuño y las firmas quedarán en blanco en el PDF.</label>
        <div className="flex flex-wrap gap-2"><button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Guardando…' : 'Guardar y plegar el pie'}</button>{document && <button type="button" className="button button-plain" onClick={() => { setError(''); setEditing(false); }}>Cancelar edición</button>}</div>
      </form>}
    </>}
    {error && <p className="mt-3 rounded-lg bg-[#fbefeb] px-3 py-2 text-xs text-[#a04539]" role="alert">{error}</p>}
    {notice && <p className="mt-3 rounded-lg bg-[#e6f2e9] px-3 py-2 text-xs text-[#317060]" role="status">{notice}</p>}
  </section>;
}

import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAuthorizeInvoiceDocument, useGetIssuer, getGetIssuerQueryKey, getGetInvoiceQueryKey, getListInvoicesQueryKey,
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
  const settings = useGetIssuer({ query: { queryKey: getGetIssuerQueryKey(), retry: false, staleTime: 0 } });
  const mutation = useAuthorizeInvoiceDocument();
  const client = useQueryClient();
  const [notice, setNotice] = useState('');
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const data = {
      ...Object.fromEntries(Object.keys(fields).map(key => [key, String(form.get(key) || '').trim()])),
      useStamp: form.get('useStamp') === 'on', useSignature: form.get('useSignature') === 'on', confirm: true,
    } as DocumentAuthorization;
    mutation.mutate({ id: invoice.id, data }, {
      onSuccess: () => {
        client.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoice.id) });
        client.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        setNotice('Modelo autorizado. Se conservará al emitir. Cualquier edición del borrador exige confirmarlo de nuevo.');
      },
      onError: err => setNotice(errorDetail(err, 'No se pudo autorizar el documento.')),
    });
  }
  return <section className="no-print panel mb-5 p-5">
    <h2 className="font-display font-bold">Modelo imprimible · autorización del propietario</h2>
    <p className="my-3 text-xs leading-5">No se asignan responsables a partir del PDF de ejemplo. Completa los nombres reales; los campos pendientes se imprimen en blanco. La firma escaneada se ubica exclusivamente en «Contabilizada por».</p>
    <Link href="/settings" className="text-xs underline">Revisar emisor y datos de pago</Link>
    {settings.isError ? <p className="mt-3 text-xs" role="alert">No se pudo cargar el emisor. <button onClick={() => settings.refetch()}>Reintentar</button></p> : settings.isPending ? <p>Cargando emisor…</p> : !settings.data.profile ? <p className="mt-3 text-xs">Configura el emisor en Ajustes para continuar.</p> : <form onSubmit={save} className="mt-4 space-y-4">
      <p className="text-xs">Emisor: <strong>{settings.data.profile.name}</strong> · NIT {settings.data.profile.nit}</p>
      <div className="grid gap-3 sm:grid-cols-2">{Object.entries(fields).map(([key, label]) => <label className="text-xs font-semibold" key={key}>{label}{['preparedBy', 'preparedPosition'].includes(key) ? ' *' : ''}
        <input name={key} className="field mt-1" maxLength={key.endsWith('Id') || ['vehiclePlate', 'drivingLicense'].includes(key) ? 40 : key.startsWith('customer') ? 80 : 160} required={['preparedBy', 'preparedPosition'].includes(key)} defaultValue={invoice.legalDocument?.[key as keyof typeof fields] || ''} />
      </label>)}</div>
      <label className="flex gap-2 text-xs"><input type="checkbox" name="useStamp" disabled={!settings.data.hasStamp} defaultChecked={invoice.legalDocument?.useStamp ?? false} />Incluir cuño escaneado autorizado</label>
      <label className="flex gap-2 text-xs"><input type="checkbox" name="useSignature" disabled={!settings.data.hasSignature} defaultChecked={invoice.legalDocument?.useSignature ?? false} />Incluir firma escaneada autorizada de «Contabilizada por»</label>
      <label className="flex items-start gap-2 text-xs leading-5"><input className="mt-1" type="checkbox" required name="confirm" />Confirmo el emisor, los responsables y, si se seleccionan, el permiso para aplicar estas imágenes a esta factura. No son firmas digitales criptográficas.</label>
      <button className="button button-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Guardando…' : 'Confirmar modelo y autorización'}</button>
    </form>}
    {notice && <p className="mt-3 text-xs" role="status">{notice}</p>}
  </section>;
}

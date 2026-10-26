import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListInvoiceImageAccessesQueryKey, getListInvoiceSharesQueryKey, useListInvoiceImageAccesses, useListInvoiceShares, useRevokeInvoiceShare,
} from '@workspace/api-client-react';
import { errorDetail } from '@/lib/shared';

export function InvoiceShareList({ invoiceId, isOwner }: { invoiceId: number; isOwner: boolean }) {
  const links = useListInvoiceShares(invoiceId, { query: {
    queryKey: getListInvoiceSharesQueryKey(invoiceId), staleTime: 0, refetchInterval: 15000, retry: false,
  } });
  const accesses = useListInvoiceImageAccesses(invoiceId, { query: {
    queryKey: getListInvoiceImageAccessesQueryKey(invoiceId), enabled: isOwner, staleTime: 0, refetchInterval: 15000, retry: false,
  } });
  const revoke = useRevokeInvoiceShare();
  const client = useQueryClient();
  const [notice, setNotice] = useState('');
  const timestamp = (value: Date | string) => (value instanceof Date ? value : new Date(value)).toLocaleString('es-ES');

  function closeLink(shareId: number) {
    if (!window.confirm(`¿Revocar el enlace #${shareId}? Dejará de mostrar los datos y las imágenes. La factura y los demás enlaces no cambiarán.`)) return;
    setNotice('');
    revoke.mutate({ id: invoiceId, shareId }, {
      onSuccess: async () => {
        await client.cancelQueries({ queryKey: getListInvoiceSharesQueryKey(invoiceId) });
        client.setQueryData(getListInvoiceSharesQueryKey(invoiceId), links.data?.filter(link => link.id !== shareId));
        await client.invalidateQueries({ queryKey: getListInvoiceSharesQueryKey(invoiceId) });
        setNotice(`Enlace #${shareId} revocado. La factura no se ha modificado.`);
      },
      onError: error => setNotice(errorDetail(error, 'No se pudo revocar el enlace. Inténtalo de nuevo.')),
    });
  }

  return <section className="no-print panel mb-5 p-4" aria-label="Enlaces compartidos">
    <h2 className="text-sm font-bold">Enlaces activos</h2>
    <p className="mt-1 text-xs text-[#71817b]">Revoca solo el enlace que ya no deba usarse. Las direcciones completas se muestran únicamente al crearlas.</p>
    {links.isLoading ? <p className="mt-3 text-xs">Cargando enlaces…</p> : links.isError ?
      <p className="mt-3 text-xs" role="alert">No se pudieron cargar los enlaces. <button className="underline" onClick={() => links.refetch()}>Reintentar</button></p> :
      links.data?.length ? <ul className="mt-3 divide-y divide-[#e4e1d5]">{links.data.map(link =>
        <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`share-${link.id}`}>
          <div className="text-xs"><strong>Enlace #{link.id}</strong><p>Creado: {link.createdAt ? timestamp(link.createdAt) : 'Fecha no registrada (enlace anterior)'}</p><p>Caduca: {timestamp(link.expiresAt)}</p></div>
          <button className="button button-danger !min-h-8" disabled={revoke.isPending} onClick={() => closeLink(link.id)} data-testid={`revoke-share-${link.id}`}>
            {revoke.isPending && revoke.variables?.shareId === link.id ? 'Revocando…' : 'Revocar enlace'}
          </button>
        </li>)}</ul> : <p className="mt-3 text-xs">No hay enlaces activos.</p>}
    {isOwner && <div className="mt-5 border-t border-[#e4e1d5] pt-4" aria-label="Historial de aperturas">
      <h3 className="text-sm font-bold">Aperturas de cuño y firma</h3>
      <p className="mt-1 text-xs text-[#71817b]">Se registra cada imagen servida desde un enlace público. No se identifica a quien lo abrió.</p>
      {accesses.isLoading ? <p className="mt-3 text-xs">Cargando historial…</p> : accesses.isError ?
        <p className="mt-3 text-xs" role="alert">No se pudo cargar el historial. <button className="underline" onClick={() => accesses.refetch()}>Reintentar</button></p> :
        accesses.data?.length ? <ul className="mt-3 divide-y divide-[#e4e1d5]">{accesses.data.map((access, index) =>
          <li key={`${access.shareId}-${access.openedAt}-${index}`} className="py-2 text-xs">
            <strong>{access.kind === 'stamp' ? 'Cuño' : 'Firma'}</strong>
            <span className="ml-2">Enlace #{access.shareId}</span>
            <span className="ml-2 text-[#71817b]">{timestamp(access.openedAt)}</span>
          </li>)}</ul> : <p className="mt-3 text-xs">Todavía no hay aperturas registradas.</p>}
    </div>}
    {notice && <p className="mt-3 text-xs" role="status">{notice}</p>}
  </section>;
}

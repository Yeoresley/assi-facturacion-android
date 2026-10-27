import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetImageAccessNotificationSettingsQueryKey, getListImageAccessNotificationsQueryKey,
  getListInvoiceImageAccessesQueryKey, getListInvoiceSharesQueryKey,
  useGetImageAccessNotificationSettings, useListInvoiceImageAccesses, useListInvoiceShares,
  useRevokeInvoiceShare, useUpdateImageAccessNotificationSettings,
} from '@workspace/api-client-react';
import { errorDetail } from '@/lib/shared';

export function InvoiceShareList({ invoiceId, isOwner }: { invoiceId: number; isOwner: boolean }) {
  const links = useListInvoiceShares(invoiceId, { query: {
    queryKey: getListInvoiceSharesQueryKey(invoiceId), staleTime: 0, refetchInterval: 15000, retry: false,
  } });
  const accesses = useListInvoiceImageAccesses(invoiceId, { query: {
    queryKey: getListInvoiceImageAccessesQueryKey(invoiceId), enabled: isOwner, staleTime: 0, refetchInterval: 15000, retry: false,
  } });
  const notificationSettings = useGetImageAccessNotificationSettings({ query: {
    queryKey: getGetImageAccessNotificationSettingsQueryKey(), enabled: isOwner, staleTime: 0, retry: false,
  } });
  const revoke = useRevokeInvoiceShare();
  const updateNotificationSettings = useUpdateImageAccessNotificationSettings();
  const client = useQueryClient();
  const [notice, setNotice] = useState('');
  const [exportingHistory, setExportingHistory] = useState(false);
  const timestamp = (value: Date | string) => (value instanceof Date ? value : new Date(value)).toLocaleString('es-ES');

  async function downloadAccessHistory() {
    setNotice('');
    setExportingHistory(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/image-accesses/export`, {
        credentials: 'same-origin',
        headers: { Accept: 'text/csv' },
      });
      if (!response.ok) {
        let message = 'No se pudo descargar el historial de aperturas.';
        try {
          const body: unknown = await response.json();
          if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') message = body.error;
        } catch {
          // Keep the safe, user-facing fallback for non-JSON errors.
        }
        throw new Error(message);
      }
      const file = await response.blob();
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `historial-aperturas-factura-${invoiceId}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Historial descargado.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo descargar el historial de aperturas.');
    } finally {
      setExportingHistory(false);
    }
  }

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

  function toggleImageAccessNotifications(enabled: boolean) {
    setNotice('');
    updateNotificationSettings.mutate({ data: { enabled } }, {
      onSuccess: async () => {
        await Promise.all([
          client.invalidateQueries({ queryKey: getGetImageAccessNotificationSettingsQueryKey() }),
          client.invalidateQueries({ queryKey: getListImageAccessNotificationsQueryKey() }),
        ]);
        setNotice(enabled ? 'Avisos de nuevas aperturas activados.' : 'Avisos de nuevas aperturas desactivados.');
      },
      onError: error => setNotice(errorDetail(error, 'No se pudo guardar la preferencia de avisos.')),
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Aperturas de cuño y firma</h3>
        <button
          className="button button-soft !min-h-8"
          onClick={downloadAccessHistory}
          disabled={exportingHistory}
          data-testid="download-image-access-history"
        >
          {exportingHistory ? 'Preparando…' : 'Descargar CSV'}
        </button>
      </div>
      <p className="mt-1 text-xs text-[#71817b]">Se registra cada imagen servida desde un enlace público. No se identifica a quien lo abrió.</p>
      <div className="mt-4 rounded-lg border border-[#e4e1d5] bg-white/70 p-3">
        {notificationSettings.isLoading ? <p className="text-xs">Cargando preferencia de avisos…</p> : notificationSettings.isError ?
          <p className="text-xs text-[#9a453a]" role="alert">No se pudo cargar la preferencia de avisos. <button className="underline" onClick={() => notificationSettings.refetch()}>Reintentar</button></p> :
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5 accent-[#087eaf]"
              checked={notificationSettings.data?.enabled ?? false}
              disabled={updateNotificationSettings.isPending}
              onChange={event => toggleImageAccessNotifications(event.currentTarget.checked)}
              data-testid="toggle-image-access-notifications"
            />
            <span><strong>Avisarme de nuevas aperturas</strong><span className="block text-[#71817b]">El aviso aparecerá en el escritorio del propietario. Las aperturas anteriores no generarán avisos.</span></span>
          </label>}
      </div>
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

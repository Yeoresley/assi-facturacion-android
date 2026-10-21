import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListInvoiceSeriesQueryKey, useCreateInvoiceSeries, useListInvoiceSeries, useUpdateInvoiceSeries } from '@workspace/api-client-react';
import type { InvoiceSeries } from '@workspace/api-client-react';
import { QueryError, errorDetail } from '@/lib/shared';

function SeriesEditor({ series }: { series: InvoiceSeries }) {
  const client = useQueryClient();
  const update = useUpdateInvoiceSeries();
  const [next, setNext] = useState(String(series.nextNumber));
  const [active, setActive] = useState(series.active);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  return <form className="space-y-3 border-t border-[#eeece4] py-4" onSubmit={(e) => {
    e.preventDefault();
    setMessage('');
    update.mutate({ id: series.id, data: { nextNumber: Number(next), active, confirmedWithVersat: true } }, {
      onSuccess: () => {
        client.invalidateQueries({ queryKey: getListInvoiceSeriesQueryKey() });
        setConfirmed(false);
        setMessage('Serie actualizada.');
      },
      onError: (err) => setMessage(errorDetail(err, 'No se pudo actualizar.')),
    });
  }}>
    <h3 className="text-sm font-bold">{series.name} · Talón {series.talon} · {series.active ? 'Activa' : 'Inactiva'}</h3>
    <p className="text-xs">Formato: <code>{series.prefix}{'#'.repeat(series.width)}{series.suffix}</code>. Siguiente contador guardado: {series.nextNumber}. No es una reserva.</p>
    <label className="block"><span className="field-label">Siguiente contador (solo puede avanzar)</span><input className="field" type="number" min={series.nextNumber} max={2147483647} required value={next} onChange={(e) => setNext(e.target.value)} /></label>
    <label className="mr-4 inline-flex gap-2 text-xs"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Serie activa</label>
    <label className="flex gap-2 text-xs"><input required type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />He contrastado este cambio con mi Versat de escritorio.</label>
    <button className="button button-soft" disabled={!confirmed || update.isPending}>Guardar cambios de serie</button>
    {message && <p className="text-xs" role="status">{message}</p>}
  </form>;
}

export function NumberingSettings() {
  const series = useListInvoiceSeries({ query: { queryKey: getListInvoiceSeriesQueryKey(), refetchInterval: 15000 } });
  const create = useCreateInvoiceSeries();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [width, setWidth] = useState('');
  const [talon, setTalon] = useState('');
  const [start, setStart] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    setMessage('');
    create.mutate({ data: { name: name.trim(), prefix, suffix, width: Number(width), talon, nextNumber: Number(start), confirmedWithVersat: true } }, {
      onSuccess: () => {
        client.invalidateQueries({ queryKey: getListInvoiceSeriesQueryKey() });
        setName(''); setPrefix(''); setSuffix(''); setWidth(''); setTalon(''); setStart(''); setConfirmed(false);
        setMessage('Serie creada. Los especialistas ya pueden seleccionarla.');
      },
      onError: (err) => setMessage(errorDetail(err, 'No se pudo crear la serie.')),
    });
  }
  const preview = width && start ? `${prefix}${start.padStart(Math.min(10, Math.max(1, Number(width) || 1)), '0')}${suffix}` : 'Completa el ancho y el punto de inicio';
  return <section className="panel mt-5 space-y-4 p-5 md:p-7" data-testid="numbering-settings">
    <div><div className="eyebrow">Solo propietario</div><h2 className="font-display mt-1 text-lg font-bold">Series y talones de Versat</h2></div>
    <p className="text-xs leading-5">No hay sincronización directa con Versat de escritorio. Declara una serie y talón contrastados y un punto de inicio libre. Coordina el uso con quienes facturen en el escritorio. No se deducen valores de facturas históricas.</p>
    <p className="text-xs leading-5">El formato no se puede cambiar después de crear la serie. Puedes desactivarla y crear otra o avanzar el contador. Nunca se renumeran documentos históricos ni se liberan números reservados o anulados. El modo manual sigue disponible con reserva única al guardar.</p>
    {series.isError ? <QueryError retry={() => series.refetch()} message="No se pudieron cargar las series." /> : series.isLoading ? <p>Cargando series…</p> : <>
      {!series.data?.length && <p className="text-xs">No hay series configuradas. Se mantiene el modo manual.</p>}
      {series.data?.map((s) => <SeriesEditor key={`${s.id}-${s.nextNumber}-${s.active}`} series={s} />)}
    </>}
    <form onSubmit={submit} className="space-y-4 border-t border-[#eeece4] pt-4">
      <h3 className="text-sm font-bold">Declarar nueva serie</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <label><span className="field-label">Nombre de la serie *</span><input className="field" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label><span className="field-label">Talón (dígitos) *</span><input className="field" required pattern="[0-9]+" maxLength={20} value={talon} onChange={(e) => setTalon(e.target.value)} /></label>
        <label><span className="field-label">Prefijo (vacío si no aplica)</span><input className="field" pattern={'[A-Za-z0-9_\\-]*'} maxLength={20} value={prefix} onChange={(e) => setPrefix(e.target.value)} /></label>
        <label><span className="field-label">Sufijo (vacío si no aplica)</span><input className="field" pattern={'[A-Za-z0-9_\\-]*'} maxLength={10} value={suffix} onChange={(e) => setSuffix(e.target.value)} /></label>
        <label><span className="field-label">Ancho de la parte numérica *</span><input className="field" required type="number" min={1} max={10} value={width} onChange={(e) => setWidth(e.target.value)} /></label>
        <label><span className="field-label">Punto de inicio: siguiente contador libre *</span><input className="field" required type="number" min={0} max={2147483646} value={start} onChange={(e) => setStart(e.target.value)} /></label>
      </div>
      <p className="text-xs">Vista previa (no reservado): <code>{preview}</code></p>
      <label className="flex gap-2 text-xs"><input required type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />He contrastado el formato, talón y punto de inicio libre con mi Versat.</label>
      <button className="button button-primary" disabled={!confirmed || create.isPending}>Crear serie confirmada</button>
      {message && <p className="text-xs" role="status">{message}</p>}
    </form>
  </section>;
}

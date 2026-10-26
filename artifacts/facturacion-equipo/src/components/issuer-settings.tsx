import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetIssuerQueryKey, useGetIssuer, useUpdateIssuer, useUpdateIssuerImages, type IssuerProfile } from '@workspace/api-client-react';
import { errorDetail } from '@/lib/shared';

const maxImageBytes = 1024 * 1024;

const labels: Record<keyof IssuerProfile, string> = {
  name: 'Razón social', nit: 'NIT', ircc: 'IRCC', address: 'Dirección',
  organization: 'Organismo', paymentBeneficiary: 'Beneficiario del pago',
  bankAccount: 'Cuenta bancaria', bankBranch: 'Sucursal', bankName: 'Banco',
};

export function IssuerSettings() {
  const query = useGetIssuer({ query: { queryKey: getGetIssuerQueryKey(), retry: false, staleTime: 0 } });
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedStamp, setSelectedStamp] = useState<File | null>(null);
  const [selectedSignature, setSelectedSignature] = useState<File | null>(null);
  const [stampPreview, setStampPreview] = useState('');
  const [signaturePreview, setSignaturePreview] = useState('');
  const update = useUpdateIssuer();
  const updateImages = useUpdateIssuerImages();
  const client = useQueryClient();

  useEffect(() => {
    if (!selectedStamp) { setStampPreview(''); return; }
    const url = URL.createObjectURL(selectedStamp);
    setStampPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedStamp]);

  useEffect(() => {
    if (!selectedSignature) { setSignaturePreview(''); return; }
    const url = URL.createObjectURL(selectedSignature);
    setSignaturePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedSignature]);

  function selectImage(kind: 'stamp' | 'signature', event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    if (!file) return;
    if (file.type !== 'image/png' || file.size > maxImageBytes) {
      setNotice('Elige un archivo PNG de hasta 1 MB.');
      return;
    }
    setNotice('');
    if (kind === 'stamp') setSelectedStamp(file);
    else setSelectedSignature(file);
  }

  function asDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
      reader.onload = () => typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('No se pudo leer el archivo seleccionado.'));
      reader.readAsDataURL(file);
    });
  }

  async function saveImages() {
    if (!selectedStamp && !selectedSignature) return;
    setNotice('Guardando las imágenes privadas…');
    try {
      const data: { stamp?: string; signature?: string } = {};
      if (selectedStamp) data.stamp = await asDataUrl(selectedStamp);
      if (selectedSignature) data.signature = await asDataUrl(selectedSignature);
      updateImages.mutate({ data }, {
        onSuccess: () => {
          client.invalidateQueries({ queryKey: getGetIssuerQueryKey() });
          setSelectedStamp(null);
          setSelectedSignature(null);
          setNotice('Cambio guardado. Cada factura conserva la versión asociada al momento de su creación.');
        },
        onError: err => setNotice(errorDetail(err, 'No se pudieron guardar las imágenes.')),
      });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'No se pudieron leer las imágenes.');
    }
  }

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
    <p className="my-3 text-xs leading-5">Solo el propietario puede cambiarlos. Revisa los datos transcritos del PDF antes de autorizar una factura. Los PDF nuevos incorporan el cuño ASSI y la firma autorizada en «Contabilizada por»; las demás firmas quedan en blanco.</p>
    {query.isPending ? <p>Cargando…</p> : query.isError ? <button className="button button-soft" onClick={() => query.refetch()}>Reintentar carga del emisor</button> : <>
      {editing || !query.data.profile ? <form onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">{Object.entries(labels).map(([key, label]) => <label key={key} className="text-xs font-semibold">{label}<input className="field mt-1" name={key} required maxLength={key === 'address' ? 400 : 200} defaultValue={query.data.profile?.[key as keyof IssuerProfile] || ''} /></label>)}</div>
        <button className="button button-primary" disabled={update.isPending}>Guardar emisor</button>
        {query.data.profile && <button className="button button-plain ml-2" type="button" onClick={() => setEditing(false)}>Cancelar</button>}
      </form> : <><dl className="grid gap-3 text-xs sm:grid-cols-2">{Object.entries(labels).map(([key, label]) => <div key={key}><dt className="text-[#71817b]">{label}</dt><dd className="mt-1 break-words font-semibold">{query.data.profile?.[key as keyof IssuerProfile]}</dd></div>)}</dl><button className="button button-soft mt-5" onClick={() => setEditing(true)}>Editar emisor</button></>}
    </>}
    {notice && <p className="mt-3 text-xs" role="status">{notice}</p>}
    <div className="mt-6 border-t border-[#e5e2d8] pt-5">
      <h3 className="font-display font-bold">Cuño y firma autorizados</h3>
      <p className="my-2 text-xs leading-5">Selecciona PNG de hasta 1 MB y revisa la vista previa antes de guardar. Las facturas nuevas usarán estas imágenes; los borradores y documentos anteriores conservarán su versión.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {([
          { kind: 'stamp', label: 'Cuño ASSI', selected: selectedStamp, preview: stampPreview, current: query.data?.hasStamp },
          { kind: 'signature', label: 'Firma de Contabilizado', selected: selectedSignature, preview: signaturePreview, current: query.data?.hasSignature },
        ] as const).map(({ kind, label, selected, preview, current }) => (
          <div key={kind} className="rounded-xl border border-[#e5e2d8] bg-white/70 p-4">
            <label className="text-xs font-semibold">{label}
              <input className="field mt-2" type="file" accept="image/png,.png" onChange={event => selectImage(kind, event)} />
            </label>
            <div className="mt-3 flex min-h-32 items-center justify-center rounded-lg border border-dashed border-[#d8d6ca] bg-[#fbfaf6] p-3">
              {(preview || current) ? <img className="max-h-40 max-w-full object-contain" src={preview || `/api/issuer/images/${kind}`} alt={`Vista previa: ${label}`} onError={() => {
                if (preview) {
                  setNotice('No se pudo previsualizar el PNG seleccionado; no se guardó.');
                  if (kind === 'stamp') setSelectedStamp(null);
                  else setSelectedSignature(null);
                } else {
                  setNotice(`No se pudo cargar la imagen privada de ${label}.`);
                }
              }} /> : <span className="text-xs text-[#71817b]">Aún no hay imagen guardada</span>}
            </div>
            <p className="mt-2 text-[11px] text-[#71817b]">{selected ? `${selected.name} · vista previa sin guardar` : current ? 'Imagen privada activa' : 'Selecciona una imagen PNG'}</p>
          </div>
        ))}
      </div>
      <button className="button button-primary mt-4" type="button" disabled={(!selectedStamp && !selectedSignature) || updateImages.isPending} onClick={saveImages}>
        {updateImages.isPending ? 'Guardando…' : 'Guardar cuño y firma'}
      </button>
    </div>
  </section>;
}

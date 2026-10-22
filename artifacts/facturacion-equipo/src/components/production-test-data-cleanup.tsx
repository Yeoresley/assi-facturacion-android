import { useEffect, useState } from "react";
import { CheckCircle2, ShieldAlert, Trash2 } from "lucide-react";

type CleanupPreview = {
  ready: boolean;
  alreadyCleaned: boolean;
  reason: string | null;
  invoices: Array<{ number: string; versatNumber: string | null; status: string }>;
  expenses: Array<{ period: string }>;
  counts: {
    invoices: number;
    lines: number;
    payments: number;
    corrections: number;
    shares: number;
    settlementInclusions: number;
    expenses: number;
  };
  reservationsToPreserve: string[];
};

const confirmationPhrase = "ELIMINAR DATOS DE PRUEBA";
const endpoint = "/api/admin/production-test-cleanup";

async function errorMessage(response: Response) {
  try {
    const body = await response.json() as { error?: string };
    return body.error || "No se pudo completar la operación.";
  } catch {
    return "No se pudo completar la operación.";
  }
}

export function ProductionTestDataCleanup() {
  const [available, setAvailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function loadPreview() {
    try {
      const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 404) {
        setAvailable(false);
        setPreview(null);
        return;
      }
      setAvailable(true);
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setPreview(await response.json() as CleanupPreview);
      setError(null);
    } catch {
      setAvailable(true);
      setError("No se pudo consultar el estado de los datos de prueba.");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void loadPreview();
  }, []);

  async function cleanTestData() {
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(true);
      setConfirmation("");
      await loadPreview();
    } catch {
      setError("No se pudo completar la limpieza. Comprueba el estado antes de volver a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded || !available) return null;

  return <section className={`panel mt-5 border p-5 ${preview?.alreadyCleaned ? "border-[#b8d6c5]" : "border-[#e5c8a4]"}`} aria-live="polite">
    <div className="flex items-start gap-3">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${preview?.alreadyCleaned ? "bg-[#e5f0e8] text-[#39776a]" : "bg-[#fbefdf] text-[#a66f28]"}`}>
        {preview?.alreadyCleaned ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="eyebrow">Herramienta temporal del propietario</div>
        <h2 className="mt-1 font-display text-lg font-bold">
          {preview?.alreadyCleaned ? "Limpieza de datos de prueba completada" : "Preparar la limpieza de datos de prueba"}
        </h2>
        <p className="mt-2 text-xs leading-5 text-[#66756e]">
          Esta acción elimina únicamente los registros autorizados que aparecen abajo. No borra clientes, catálogos,
          configuración ni el contador de la serie. Los números seguirán reservados en la aplicación.
          Las facturas ya importadas en Versat no se eliminan de Versat.
        </p>
      </div>
    </div>

    {preview && <div className="mt-4 grid gap-4 border-t border-[#eeece4] pt-4 md:grid-cols-[1fr_260px]">
      <div>
        <div className="eyebrow">Facturas incluidas</div>
        {preview.invoices.length ? <ul className="mt-2 space-y-2">
          {preview.invoices.map((invoice) => <li key={invoice.number} className="rounded-lg bg-[#f8f7f1] px-3 py-2 text-xs">
            <span className="font-semibold">{invoice.number}</span>
            <span className="text-[#77847e]"> · Versat {invoice.versatNumber || "sin número"}</span>
          </li>)}
        </ul> : <p className="mt-2 text-xs text-[#77847e]">No quedan facturas objetivo.</p>}
        {preview.expenses.length > 0 && <p className="mt-3 text-xs text-[#66756e]">
          Gasto de liquidación de prueba del período {preview.expenses.map(({ period }) => period).join(", ")}.
        </p>}
        <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1 text-[11px] text-[#66756e] sm:grid-cols-3">
          <div><dt>Facturas</dt><dd className="font-semibold text-[#34443d]">{preview.counts.invoices}</dd></div>
          <div><dt>Renglones</dt><dd className="font-semibold text-[#34443d]">{preview.counts.lines}</dd></div>
          <div><dt>Abonos</dt><dd className="font-semibold text-[#34443d]">{preview.counts.payments}</dd></div>
          <div><dt>Correcciones</dt><dd className="font-semibold text-[#34443d]">{preview.counts.corrections}</dd></div>
          <div><dt>Enlaces compartidos</dt><dd className="font-semibold text-[#34443d]">{preview.counts.shares}</dd></div>
          <div><dt>Inclusiones en liquidación</dt><dd className="font-semibold text-[#34443d]">{preview.counts.settlementInclusions}</dd></div>
          <div><dt>Gastos de liquidación</dt><dd className="font-semibold text-[#34443d]">{preview.counts.expenses}</dd></div>
        </dl>
        <p className="mt-3 text-[11px] text-[#77847e]">
          Reservas que se conservarán: {preview.reservationsToPreserve.join(", ")}.
        </p>
      </div>

      <div className="rounded-xl bg-[#f8f7f1] p-4">
        {preview.alreadyCleaned ? <p className="text-xs font-semibold text-[#39776a]">Los registros autorizados ya no están en la aplicación.</p> : <>
          <label className="block text-xs font-semibold text-[#34443d]" htmlFor="test-cleanup-confirmation">
            Para confirmar, escribe: <span className="font-mono">{confirmationPhrase}</span>
          </label>
          <input
            id="test-cleanup-confirmation"
            className="field mt-2 !h-10"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            disabled={!preview.ready || busy}
          />
          <button
            type="button"
            className="button button-danger mt-3 w-full"
            onClick={() => void cleanTestData()}
            disabled={!preview.ready || confirmation !== confirmationPhrase || busy}
          >
            <Trash2 size={15} />{busy ? "Limpiando…" : "Eliminar datos autorizados"}
          </button>
          {!preview.ready && <p className="mt-2 text-[11px] leading-4 text-[#9e583b]">{preview.reason || "No se puede confirmar esta limpieza."}</p>}
        </>}
      </div>
    </div>}

    {error && <p className="mt-4 rounded-lg bg-[#fbefeb] px-3 py-2 text-xs text-[#a04539]" role="alert">{error}</p>}
    {success && <p className="mt-4 rounded-lg bg-[#e5f0e8] px-3 py-2 text-xs text-[#39776a]" role="status">La limpieza se completó y las reservas de numeración se conservaron.</p>}
    <button type="button" className="mt-3 text-xs font-semibold text-[#39776a] underline" onClick={() => void loadPreview()} disabled={busy}>
      Actualizar vista previa
    </button>
  </section>;
}

import type { ReactNode } from 'react';
import { CircleHelp, FileText, TriangleAlert } from 'lucide-react';

export function BrandMark({ compact = false, tone = 'light' }: { compact?: boolean; tone?: 'light' | 'dark' }) {
  if (compact) {
    return <img src={`${import.meta.env.BASE_URL}brand/assi-mark.png`} alt="ASSI" className="brand-emblem" data-testid="brand-assi" />;
  }
  return <div className={`brand-mark brand-mark-${tone}`} data-testid="brand-assi">
    <img src={`${import.meta.env.BASE_URL}brand/assi-mark.png`} alt="" aria-hidden="true" className="brand-emblem" />
    <span className="brand-copy">
      <strong className="brand-name">ASSI</strong>
      <span className="brand-slogan">Tu visión. Nuestro futuro.</span>
    </span>
  </div>;
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><div className="eyebrow">{eyebrow}</div><h1 className="font-display mt-2 text-[32px] font-bold leading-tight tracking-[-.06em] md:text-[37px]">{title}</h1>{description && <p className="mt-2 text-[13px] text-[#77847e]">{description}</p>}</div>{action}</div>;
}

export function QueryError({ retry, message = 'No se pudo cargar la información.', detail }: { retry: () => void; message?: string; detail?: string }) {
  return <div className="panel flex flex-col items-start gap-3 p-6"><div className="flex items-center gap-2 text-sm font-bold text-[#934e42]"><CircleHelp size={17} />{message}</div><p className="text-[12px] text-[#79847e]">{detail || 'Revisa la conexión e inténtalo otra vez.'}</p><button className="button button-plain !min-h-9" onClick={retry}>Reintentar</button></div>;
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="flex min-h-[230px] flex-col items-center justify-center px-6 text-center"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#edf0e7] text-[#53786c]"><FileText size={21} /></span><h3 className="font-display mt-4 text-base font-bold">{title}</h3><p className="mt-1 max-w-sm text-[12px] leading-5 text-[#7b8780]">{text}</p>{action && <div className="mt-4">{action}</div>}</div>;
}

export function money(value: number, currency = 'CUP', maxDecimals = 2) {
  try { return new Intl.NumberFormat('es-ES', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: Math.max(2, maxDecimals) }).format(value); }
  catch { return `${value.toFixed(2)} ${currency}`; }
}

export function date(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
}

export const statusLabels: Record<string, string> = {
  draft: 'Edición', finished: 'Terminada', confirmed: 'Confirmada', voided: 'Anulada', cancelled: 'Cancelada',
  error: 'Con Error', accepted: 'Aceptada', sent: 'Enviada · anterior', paid: 'Pagada · anterior',
};

export function Status({ status }: { status: string }) {
  const labels = statusLabels;
  return <span className={`status-pill status-${status}`}>{labels[status] || status}</span>;
}

/** Extracts the backend's reason (422 blockers, validation issues) from an API error. */
export function errorDetail(error: unknown, fallback = 'Error desconocido.'): string {
  if (error && typeof error === 'object' && 'data' in error && 'status' in error) {
    const apiError = error as { data: unknown; message?: string };
    const data = apiError.data;
    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of ['error', 'message', 'detail']) {
        if (typeof record[key] === 'string') parts.push(record[key] as string);
      }
      for (const key of ['issues', 'errors', 'blockers']) {
        const value = record[key];
        if (Array.isArray(value)) {
          for (const item of value) parts.push(typeof item === 'string' ? item : JSON.stringify(item));
        }
      }
      if (parts.length) return parts.join(' · ');
    }
    return apiError.message || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

/** Decodes base64 into bytes (never via a UTF-8 text blob) and triggers a download. */
export function downloadBase64File(base64: string, filename: string, contentType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType || 'application/octet-stream' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TestFileNotice({ children }: { children?: ReactNode }) {
  return <div className="flex items-start gap-3 rounded-xl border border-[#ecd9a8] bg-[#fbf1d9] px-4 py-3 text-[#7d5e1f]" role="note">
    <TriangleAlert size={16} className="mt-0.5 shrink-0" />
    <div className="text-[11px] leading-5"><div className="text-[12px] font-bold">Formato probado para servicios; otras variantes requieren validación</div>{children}</div>
  </div>;
}

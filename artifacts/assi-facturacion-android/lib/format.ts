import type { InvoiceStatus } from '@workspace/api-client-react';

export function money(value: number, currency = 'CUP') {
  try {
    return new Intl.NumberFormat('es-CU', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat('es-CU', { maximumFractionDigits: 2 }).format(value)} ${currency}`;
  }
}

export function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-CU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function isoToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function statusLabel(status: InvoiceStatus | string) {
  const labels: Record<string, string> = {
    draft: 'Edición',
    finished: 'Terminada',
    accepted: 'Aceptada',
    confirmed: 'Confirmada',
    sent: 'Enviada',
    paid: 'Pagada',
    voided: 'Anulada',
    cancelled: 'Cancelada',
    error: 'Con error',
  };
  return labels[status] ?? status;
}

export function paymentLabel(balanceDue: number, totalPaid: number) {
  if (balanceDue <= 0) return 'Pagada';
  if (totalPaid > 0) return 'Abono parcial';
  return 'Pendiente';
}

export function errorText(error: unknown, fallback = 'No se pudo completar la operación.') {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function monthPeriod(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function periodLabel(period: string) {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat('es-CU', { month: 'long', year: 'numeric' }).format(date);
}

export function changePeriod(period: string, offset: number) {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return monthPeriod(date);
}

const small = ['CERO', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const tens = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const hundreds = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
const apocopate = (s: string) => s.replace(/VEINTIUNO$/, 'VEINTIÚN').replace(/UNO$/, 'UN');

function integerWords(n: number): string {
  if (n < 30) return small[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ` Y ${small[n % 10]}` : '');
  if (n === 100) return 'CIEN';
  if (n < 1000) return hundreds[Math.floor(n / 100)] + (n % 100 ? ` ${integerWords(n % 100)}` : '');
  if (n < 1_000_000) return (n < 2000 ? 'MIL' : `${apocopate(integerWords(Math.floor(n / 1000)))} MIL`) + (n % 1000 ? ` ${integerWords(n % 1000)}` : '');
  if (n < 1_000_000_000_000) return (n < 2_000_000 ? 'UN MILLÓN' : `${apocopate(integerWords(Math.floor(n / 1_000_000)))} MILLONES`) + (n % 1_000_000 ? ` ${integerWords(n % 1_000_000)}` : '');
  return (n < 2_000_000_000_000 ? 'UN BILLÓN' : `${apocopate(integerWords(Math.floor(n / 1_000_000_000_000)))} BILLONES`) + (n % 1_000_000_000_000 ? ` ${integerWords(n % 1_000_000_000_000)}` : '');
}

export function amountInWords(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value >= 1e15) throw new Error('Importe fuera del rango imprimible.');
  const [whole, cents] = value.toFixed(2).split('.');
  return `${integerWords(Number(whole))} CON ${cents}/100`;
}

export async function printInvoice(options: { documentType?: 'invoice' | 'receipt' } = {}) {
  const documentType = options.documentType ?? 'invoice';
  await document.fonts.ready;
  if (documentType === 'receipt') {
    if (!document.querySelector('.receipt-print-page .payment-receipt-paper')) {
      throw new Error('No se encontró el comprobante que quieres imprimir.');
    }
  } else {
    const images = [...document.querySelectorAll<HTMLImageElement>('[data-authorized-image]')];
    if (document.querySelector('[data-image-pending]') || images.some(img => !img.complete || !img.naturalWidth)) {
      throw new Error('El cuño o la firma aún no se han cargado. Reintenta la carga antes de imprimir.');
    }
  }

  const cleanup = () => document.body.classList.remove('printing-payment-receipt');
  if (documentType === 'receipt') {
    document.body.classList.add('printing-payment-receipt');
    window.addEventListener('afterprint', cleanup, { once: true });
  }
  try {
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}

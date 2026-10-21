import { AlertCircle, ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';
import { BrandMark } from '@/lib/shared';

export default function NotFound() {
  return (
    <div className="grain grid min-h-[100dvh] w-full place-items-center bg-[#f1f6f8] px-5">
      <section className="panel w-full max-w-md p-8 text-center">
        <div className="mb-5 flex justify-center"><BrandMark /></div>
        <AlertCircle className="mx-auto h-9 w-9 text-[#087eaf]" />
        <p className="eyebrow mt-4">404 · ASSI</p>
        <h1 className="font-display mt-2 text-2xl font-bold text-[#12365a]">Esta página no está disponible</h1>
        <p className="mt-3 text-sm leading-6 text-[#617887]">La dirección puede haber cambiado. Regresa al inicio del escritorio.</p>
        <Link href="/" className="button button-primary mt-6"><ArrowLeft size={15} />Volver al inicio</Link>
      </section>
    </div>
  );
}

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBillingOverviewQueryKey,
  getGetCurrentTeamMemberQueryKey,
  getListInvoicesQueryKey,
  getListOwnerInvoiceAssignmentReviewsQueryKey,
  useAssignOwnerInvoiceToSpecialist,
  useGetCurrentTeamMember,
  useListOwnerInvoiceAssignmentReviews,
} from '@workspace/api-client-react';
import { ArrowRightLeft, UserRoundCheck } from 'lucide-react';
import { Link } from 'wouter';
import { date, EmptyState, errorDetail, QueryError } from '@/lib/shared';

export function HistoricalInvoiceAssignmentReview() {
  const client = useQueryClient();
  const member = useGetCurrentTeamMember({
    query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false },
  });
  const isOwner = member.data?.role === 'owner';
  const reviews = useListOwnerInvoiceAssignmentReviews({
    query: {
      queryKey: getListOwnerInvoiceAssignmentReviewsQueryKey(),
      enabled: isOwner,
      retry: false,
      refetchInterval: 30000,
    },
  });
  const assign = useAssignOwnerInvoiceToSpecialist();
  const [selectedByInvoice, setSelectedByInvoice] = useState<Record<number, string>>({});
  const [successMessage, setSuccessMessage] = useState('');

  if (!isOwner) return null;

  const confirmAssignment = (review: NonNullable<typeof reviews.data>[number]) => {
    const selected = review.matchingSpecialists.find(
      (specialist) => specialist.specialistId === selectedByInvoice[review.id],
    );
    if (!selected) return;
    const confirmed = window.confirm(
      `¿Confirmas reasignar únicamente la factura ${review.number} de ${review.currentSpecialistName} a ${selected.specialistName}? El comercial de Versat (${review.versatCommercialName}) coincide.`,
    );
    if (!confirmed) return;

    setSuccessMessage('');
    assign.mutate({ id: review.id, data: { specialistId: selected.specialistId } }, {
      onSuccess: async () => {
        setSelectedByInvoice((current) => {
          const next = { ...current };
          delete next[review.id];
          return next;
        });
        setSuccessMessage(`La factura ${review.number} ahora está asignada a ${selected.specialistName}.`);
        await Promise.all([
          client.invalidateQueries({ queryKey: getListOwnerInvoiceAssignmentReviewsQueryKey() }),
          client.invalidateQueries({ queryKey: getListInvoicesQueryKey() }),
          client.invalidateQueries({ queryKey: getGetBillingOverviewQueryKey() }),
          client.invalidateQueries({
            predicate: (query) => String(query.queryKey[0] ?? '').startsWith('/api/settlements'),
          }),
        ]);
      },
    });
  };

  return <section className="panel mb-5 overflow-hidden" aria-labelledby="historical-assignment-title" data-testid="historical-assignment-review">
    <div className="border-b border-[#eeece4] px-5 py-5">
      <div className="eyebrow">Revisión del propietario</div>
      <h2 id="historical-assignment-title" className="font-display mt-1 text-lg font-bold tracking-[-.04em]">
        Facturas históricas con comercial de Versat
      </h2>
      <p className="mt-1 text-[12px] leading-5 text-[#77847e]">
        Solo aparecen facturas aún asignadas a tu cuenta. La asignación guardada y el comercial de Versat se muestran por separado; nada se cambia automáticamente.
      </p>
    </div>
    {reviews.isLoading ? <div className="space-y-3 p-5" aria-label="Cargando revisión de facturas">
      {[0, 1].map((index) => <div className="skeleton h-12" key={index} />)}
    </div> : reviews.isError || !reviews.data
      ? <div className="p-5"><QueryError retry={() => reviews.refetch()} message="No se pudieron consultar las facturas históricas." /></div>
      : reviews.data.length === 0
        ? <EmptyState title="No hay facturas históricas por revisar" text="No encontramos facturas asignadas al propietario que tengan datos comerciales de Versat." />
        : <div className="divide-y divide-[#eeece4]">
          {reviews.data.map((review) => {
            const selected = selectedByInvoice[review.id] ?? '';
            const hasCandidates = review.matchingSpecialists.length > 0;
            return <article key={review.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(210px,0.8fr)_minmax(240px,0.9fr)] lg:items-center" data-testid={`historical-assignment-${review.id}`}>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/invoices/${review.id}`} className="font-mono text-[12px] font-bold text-[#2e6960] hover:underline" data-testid={`link-historical-invoice-${review.id}`}>{review.number}</Link>
                  <span className="text-[10px] text-[#8b958f]">{date(review.issueDate)}</span>
                </div>
                <div className="mt-1 text-[12px] font-semibold">{review.customerName}</div>
                <div className="mt-2 text-[10px] uppercase tracking-wide text-[#8b958f]">Asignación actual</div>
                <div className="text-[12px] font-medium" data-testid={`current-assignment-${review.id}`}>{review.currentSpecialistName} · propietario</div>
              </div>
              <div className="rounded-lg bg-[#f6f4eb] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[#8b958f]">Comercial en Versat</div>
                <div className="mt-1 text-[12px] font-semibold" data-testid={`versat-commercial-${review.id}`}>{review.versatCommercialName}</div>
                <div className="font-mono text-[10px] text-[#77847e]">Código {review.versatCommercialId}</div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
                {hasCandidates ? <label className="min-w-0 flex-1">
                  <span className="sr-only">Especialista para {review.number}</span>
                  <select
                    className="field !h-10 w-full text-[12px]"
                    value={selected}
                    onChange={(event) => setSelectedByInvoice((current) => ({ ...current, [review.id]: event.target.value }))}
                    disabled={assign.isPending}
                    data-testid={`select-historical-specialist-${review.id}`}
                  >
                    <option value="">Elegir especialista compatible</option>
                    {review.matchingSpecialists.map((specialist) => <option key={specialist.specialistId} value={specialist.specialistId}>{specialist.specialistName}</option>)}
                  </select>
                </label> : <p className="flex-1 self-center text-[11px] leading-4 text-[#8a6c34]">No hay un especialista del equipo asignado a este comercial.</p>}
                <button
                  type="button"
                  className="button button-plain !min-h-10 !px-3 text-[11px]"
                  onClick={() => confirmAssignment(review)}
                  disabled={!selected || assign.isPending}
                  data-testid={`button-confirm-historical-assignment-${review.id}`}
                >
                  {assign.isPending ? <ArrowRightLeft size={14} className="animate-pulse" /> : <UserRoundCheck size={14} />}
                  Confirmar
                </button>
              </div>
            </article>;
          })}
        </div>}
    {assign.isError && <p className="border-t border-[#eeece4] px-5 py-3 text-[12px] text-[#934e42]" role="alert" data-testid="historical-assignment-error">{errorDetail(assign.error, 'No se pudo cambiar la asignación.')}</p>}
    {successMessage && <p className="border-t border-[#eeece4] px-5 py-3 text-[12px] font-medium text-[#39776a]" role="status" data-testid="historical-assignment-success">{successMessage}</p>}
  </section>;
}

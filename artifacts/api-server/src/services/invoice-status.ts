import type { Invoice } from "@workspace/db";

export type InvoiceStatus = Invoice["status"];
export type WorkflowStatus = Exclude<InvoiceStatus, "sent" | "paid">;
export const statusCodes: Record<WorkflowStatus, number> = {
  draft: 1, finished: 2, confirmed: 3, voided: 4, cancelled: 5, error: 6, accepted: 7,
};

// New payments and successful Versat exports are acceptance signals; legacy statuses stay unchanged.
const transitions: Record<InvoiceStatus, readonly WorkflowStatus[]> = {
  draft: ["finished", "cancelled", "error"],
  finished: ["accepted", "voided", "cancelled", "error"],
  accepted: ["confirmed", "voided", "cancelled", "error"],
  confirmed: [],
  voided: [],
  cancelled: [],
  error: ["draft", "finished", "voided", "cancelled"],
  sent: ["accepted", "voided", "cancelled", "error"],
  paid: ["accepted", "voided", "cancelled", "error"],
};

export function acceptanceFromWorkflowEvent(
  current: Pick<Invoice, "status" | "acceptedBy" | "acceptedAt">,
  actorUserId: string,
  acceptedAt = new Date(),
): Partial<Pick<Invoice, "status" | "acceptedBy" | "acceptedAt">> {
  if (current.status !== "finished" && current.status !== "sent") return {};
  return {
    status: "accepted",
    acceptedBy: current.acceptedBy ?? actorUserId,
    acceptedAt: current.acceptedAt ?? acceptedAt,
  };
}

export function transitionIssue(
  current: Pick<Invoice, "status" | "versatNumber">,
  target: WorkflowStatus,
  role: "owner" | "specialist" | "pending",
): string | null {
  if (target === "accepted" && role !== "specialist") {
    return "La aceptación del cliente debe registrarla el especialista del comercial asignado.";
  }
  if (target === "confirmed" && role !== "owner") {
    return "Solo el administrador puede confirmar que la factura ya se importó en Versat.";
  }
  if (role === "pending") return "No tienes acceso al equipo.";
  if (current.status === target) return null; // Safe retries, without replacing actor/date.
  if (target === "draft" && current.versatNumber) {
    return "Una factura numerada no puede volver a Edición ni liberar su número.";
  }
  if (!transitions[current.status].includes(target)) {
    return "Cambio de estado no permitido. Una factura anulada, cancelada o confirmada no puede reactivarse; sigue el flujo Edición → Terminada → Aceptada → Confirmada.";
  }
  return null;
}

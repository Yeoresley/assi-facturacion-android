import { and, eq, type SQL } from "drizzle-orm";
import { db, invoiceLinesTable, invoicesTable } from "@workspace/db";
import { allocateNumber, lockNumbering, NumberingError } from "./invoice-numbering";
import { getVersatDataIssues } from "./versat-file";
import { transitionIssue, type WorkflowStatus } from "./invoice-status";
import { canAccessInvoice } from "./invoice-access";
import type { CurrentTeamMember } from "../middlewares/team-access";
import { createInvoiceAcceptanceNotification } from "./invoice-acceptance-notifications";

export async function transitionInvoice(
  id: number, status: WorkflowStatus, scope: SQL,
  actor: Pick<CurrentTeamMember, "userId" | "role" | "commercialId">,
) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), scope)).for("update");
    if (!current) throw new NumberingError("Factura no encontrada.", 404);
    if (!canAccessInvoice(actor, current)) throw new NumberingError("Factura no encontrada.", 404);
    const issue = transitionIssue(current, status, actor.role);
    if (issue) throw new NumberingError(issue, status === "accepted" && actor.role !== "specialist" || status === "confirmed" && actor.role !== "owner" ? 403 : 409);
    if (current.status === status) return;
    let versat = current.versat;
    if (status === "finished") {
      if (!current.legalDocument) throw new NumberingError("Confirma el emisor y los responsables del documento antes de emitir.", 422);
      await lockNumbering(tx);
      // Recovering from an error must not consume a second number.
      if (!current.versatNumber) versat = await allocateNumber(tx, current);
      const lines = await tx.select().from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, current.id));
      const issues = getVersatDataIssues({ ...current, versat, lines, status });
      if (issues.length) throw new NumberingError(issues.join(" "), 422);
    }
    if (status === "accepted" || status === "confirmed") {
      if (!current.legalDocument) throw new NumberingError("Confirma el modelo imprimible antes de aceptar la factura.", 422);
      const lines = await tx.select().from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, current.id));
      const issues = getVersatDataIssues({ ...current, versat, lines, status });
      if (issues.length) throw new NumberingError(issues.join(" "), 422);
    }
    const transitionAt = new Date();
    await tx.update(invoicesTable).set({
      status, versat, versatNumber: versat?.number ?? null,
      // Historical "paid" was a lifecycle status. Preserve that fact when adopting the new workflow.
      ...(current.status === "paid" ? { paymentStatus: "paid" as const } : {}),
      ...(status === "accepted" ? {
        acceptedBy: actor.userId, acceptedAt: transitionAt, acceptedSource: "specialist" as const,
      } : {}),
      ...(status === "confirmed" ? {
        // Import confirmation is also an acceptance signal if the specialist missed the one-click action.
        acceptedBy: current.acceptedBy ?? actor.userId,
        acceptedAt: current.acceptedAt ?? transitionAt,
        ...(current.status !== "accepted" && !current.acceptedAt
          ? { acceptedSource: "versat_import" as const }
          : {}),
        confirmedBy: actor.userId,
        confirmedAt: transitionAt,
      } : {}),
    })
      .where(eq(invoicesTable.id, current.id));
    if (status === "confirmed" && current.status !== "accepted" && !current.acceptedAt) {
      await createInvoiceAcceptanceNotification(tx, current, "versat_import");
    }
  });
}

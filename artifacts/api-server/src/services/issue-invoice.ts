import { and, eq, type SQL } from "drizzle-orm";
import { db, invoiceLinesTable, invoicesTable } from "@workspace/db";
import { allocateNumber, lockNumbering, NumberingError } from "./invoice-numbering";
import { getVersatIssues } from "./versat-file";

export async function transitionInvoice(id: number, status: "draft" | "sent" | "paid" | "cancelled", scope: SQL) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id, id), scope)).for("update");
    if (!current) throw new NumberingError("Factura no encontrada.", 404);
    if ((status === "draft" && current.status !== "draft") ||
        (current.status === "cancelled" && status !== "cancelled")) {
      throw new NumberingError("Una factura emitida no puede volver a borrador; una anulada no puede reactivarse.");
    }
    let versat = current.versat;
    if (current.status === "draft" && ["sent", "paid"].includes(status)) {
      if (!current.legalDocument) throw new NumberingError("Confirma el emisor y los responsables del documento antes de emitir.", 422);
      await lockNumbering(tx);
      versat = await allocateNumber(tx, current);
      const lines = await tx.select().from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, current.id));
      const issues = getVersatIssues({ ...current, versat, lines, status });
      if (issues.length) throw new NumberingError(issues.join(" "), 422);
    }
    await tx.update(invoicesTable).set({ status, versat, versatNumber: versat?.number ?? null })
      .where(eq(invoicesTable.id, current.id));
  });
}

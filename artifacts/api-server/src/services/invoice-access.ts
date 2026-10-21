import { createHash } from "node:crypto";
import { and, eq, gt, isNull, sql, type SQL } from "drizzle-orm";
import { db, invoiceSharesTable, invoicesTable } from "@workspace/db";
import type { CurrentTeamMember } from "../middlewares/team-access";

type ScopeMember = Pick<CurrentTeamMember, "role" | "commercialId">;

export function activeInvoiceShare() {
  return and(isNull(invoiceSharesTable.revokedAt), gt(invoiceSharesTable.expiresAt, new Date()));
}

/** Shared by public data and image routes: a revoked capability grants neither. */
export async function getActiveInvoiceShare(token: string) {
  const hash = createHash("sha256").update(token).digest("hex");
  const [share] = await db.select({
    invoiceId: invoiceSharesTable.invoiceId,
    paymentId: invoiceSharesTable.paymentId,
  })
    .from(invoiceSharesTable)
    .where(and(eq(invoiceSharesTable.tokenHash, hash), activeInvoiceShare())).limit(1);
  return share;
}

/** A missing assignment never grants access, including to self-created invoices. */
export function canAccessInvoice(member: ScopeMember, invoice: { versat?: { commercialId: number } | null }): boolean {
  return member.role === "owner" ||
    (member.role === "specialist" && member.commercialId !== null &&
      invoice.versat?.commercialId === member.commercialId);
}

export function invoiceScope(member: ScopeMember): SQL {
  if (member.role === "owner") return sql`true`;
  if (member.role !== "specialist" || member.commercialId === null) return sql`false`;
  return sql`${invoicesTable.versat}->>'commercialId' = ${String(member.commercialId)}`;
}

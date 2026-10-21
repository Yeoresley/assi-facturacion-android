import { sql, type SQL } from "drizzle-orm";
import { invoicesTable } from "@workspace/db";
import type { CurrentTeamMember } from "../middlewares/team-access";

type ScopeMember = Pick<CurrentTeamMember, "role" | "commercialId">;

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

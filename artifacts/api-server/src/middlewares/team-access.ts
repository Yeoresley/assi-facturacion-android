import { clerkClient, getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import { and, eq, or } from "drizzle-orm";
import { db, teamInvitationsTable, teamMembersTable } from "@workspace/db";

export type CurrentTeamMember = {
  userId: string;
  name: string;
  email: string | null;
  role: "owner" | "specialist" | "pending";
  commercialId: number | null;
  suspended: boolean;
};

export async function resolveTeamMember(
  req: Request,
  res: Response,
  allowPending = false,
): Promise<CurrentTeamMember | null> {
  res.set("Cache-Control", "private, no-store");
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }

  const clerkUser = await clerkClient.users.getUser(userId);
  const primaryEmail = clerkUser.emailAddresses.find(
    (address) => address.id === clerkUser.primaryEmailAddressId,
  );
  const email =
    primaryEmail?.verification?.status === "verified"
      ? primaryEmail.emailAddress.toLowerCase()
      : null;
  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    email ||
    "Especialista";

  const [existing] = await db
    .select()
    .from(teamMembersTable)
    .where(eq(teamMembersTable.userId, userId))
    .limit(1);

  let role: CurrentTeamMember["role"] = existing?.role ?? "pending";
  let suspended = existing?.suspended ?? false;
  let commercialId: number | null = null;
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (email && ownerEmail && email === ownerEmail) {
    role = "owner";
  } else if (email) {
    const [invitation] = await db
      .select()
      .from(teamInvitationsTable)
      .where(eq(teamInvitationsTable.email, email))
      .limit(1);
    if (invitation) {
      role = "specialist";
      commercialId = invitation.commercialId;
      suspended ||= invitation.suspended;
    }
    // Email denial also survives a replacement identity with the same verified email.
    const [denied] = await db.select({ userId: teamMembersTable.userId }).from(teamMembersTable)
      .where(and(eq(teamMembersTable.email, email), eq(teamMembersTable.suspended, true))).limit(1);
    suspended ||= !!denied;
  }

  const values = { userId, name, email, role };
  const [member] = await db
    .insert(teamMembersTable)
    .values(values)
    .onConflictDoUpdate({
      target: teamMembersTable.userId,
      set: { name, email, role },
    })
    .returning();

  // Re-read after the profile upsert so a concurrent suspension is not overwritten.
  suspended ||= member.suspended;
  if (email) {
    const [deniedInvite] = await db.select({ email: teamInvitationsTable.email }).from(teamInvitationsTable)
      .where(and(eq(teamInvitationsTable.email, email), eq(teamInvitationsTable.suspended, true))).limit(1);
    suspended ||= !!deniedInvite;
  }
  if (suspended && !allowPending) {
    res.status(403).json({ error: "El propietario ha suspendido tu acceso.", code: "TEAM_ACCESS_SUSPENDED" });
    return null;
  }
  if (member.role === "pending" && !allowPending) {
    res.status(403).json({ error: "Team access has not been granted" });
    return null;
  }
  res.set("Cache-Control", "private, no-store");
  return { ...member, commercialId, suspended };
}

export class TeamAccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function setTeamMemberSuspension(owner: CurrentTeamMember, userId: string, suspended: boolean) {
  if (owner.suspended || owner.role !== "owner") throw new TeamAccessError(403, "Solo el propietario puede gestionar el acceso.");
  await db.transaction(async (tx) => {
    const [target] = await tx.select().from(teamMembersTable).where(eq(teamMembersTable.userId, userId)).for("update");
    const email = target?.email ?? (userId.startsWith("invite:") ? userId.slice(7) : null);
    const [invitation] = email ? await tx.select().from(teamInvitationsTable).where(eq(teamInvitationsTable.email, email)).for("update") : [];
    if (!target && !invitation) throw new TeamAccessError(404, "No se encontró el acceso.");
    const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (userId === owner.userId || target?.role === "owner" || (email && (email === owner.email || email === ownerEmail))) {
      throw new TeamAccessError(422, "La cuenta propietaria no puede suspenderse.");
    }
    if (email) {
      const [relatedOwner] = await tx.select({ userId: teamMembersTable.userId }).from(teamMembersTable)
        .where(and(eq(teamMembersTable.email, email), eq(teamMembersTable.role, "owner"))).limit(1);
      if (relatedOwner) throw new TeamAccessError(422, "La cuenta propietaria no puede suspenderse.");
    }
    await tx.update(teamMembersTable).set({ suspended })
      .where(email ? or(eq(teamMembersTable.userId, userId), eq(teamMembersTable.email, email)) : eq(teamMembersTable.userId, userId));
    if (email) {
      // Do not grant a new invitation when suspending a pending member.
      if (invitation) await tx.update(teamInvitationsTable).set({ suspended }).where(eq(teamInvitationsTable.email, email));
    }
  });
}

export async function requireOwner(
  req: Request,
  res: Response,
): Promise<CurrentTeamMember | null> {
  const member = await resolveTeamMember(req, res);
  if (!member) return null;
  if (member.role !== "owner") {
    res.status(403).json({ error: "Owner access required" });
    return null;
  }
  return member;
}

import { clerkClient, getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, teamInvitationsTable, teamMembersTable } from "@workspace/db";

export type CurrentTeamMember = {
  userId: string;
  name: string;
  email: string | null;
  role: "owner" | "specialist" | "pending";
  commercialId: number | null;
};

export async function resolveTeamMember(
  req: Request,
  res: Response,
  allowPending = false,
): Promise<CurrentTeamMember | null> {
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
  let commercialId: number | null = null;
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (email && ownerEmail && email === ownerEmail) {
    role = "owner";
  } else if (email) {
    const [invitation] = await db
      .select({ email: teamInvitationsTable.email, commercialId: teamInvitationsTable.commercialId })
      .from(teamInvitationsTable)
      .where(eq(teamInvitationsTable.email, email))
      .limit(1);
    if (invitation) {
      role = "specialist";
      commercialId = invitation.commercialId;
    }
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

  if (member.role === "pending" && !allowPending) {
    res.status(403).json({ error: "Team access has not been granted" });
    return null;
  }
  res.set("Cache-Control", "private, no-store");
  return { ...member, commercialId };
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

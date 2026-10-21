import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { versatCatalogTable } from "./versat-catalog";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const teamMembersTable = pgTable("team_members", {
  userId: text("user_id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  role: text("role").$type<"owner" | "specialist" | "pending">().notNull(),
  suspended: boolean("suspended").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const teamInvitationsTable = pgTable("team_invitations", {
  email: text("email").primaryKey(),
  suspended: boolean("suspended").notNull().default(false),
  commercialId: integer("commercial_id").references(() => versatCatalogTable.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertTeamMemberSchema = createInsertSchema(teamMembersTable);
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type TeamMember = typeof teamMembersTable.$inferSelect;

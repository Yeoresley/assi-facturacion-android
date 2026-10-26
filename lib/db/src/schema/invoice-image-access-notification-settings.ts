import { boolean, text, timestamp, pgTable } from "drizzle-orm/pg-core";

export const invoiceImageAccessNotificationSettingsTable = pgTable("invoice_image_access_notification_settings", {
  ownerUserId: text("owner_user_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InvoiceImageAccessNotificationSettings =
  typeof invoiceImageAccessNotificationSettingsTable.$inferSelect;

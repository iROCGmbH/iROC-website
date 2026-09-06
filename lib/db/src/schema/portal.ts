import { pgTable, serial, integer, text, jsonb, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { websiteCustomersTable } from "./website_customers";

export const portalQueueStatusEnum = pgEnum("portal_queue_status", ["pending", "approved", "rejected"]);

export const adminApprovalQueueTable = pgTable("admin_approval_queue", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id")
    .notNull()
    .references(() => websiteCustomersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("profile_update"), // 'profile_update' | 'order_request' | 'training_request'
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected'
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

import { pgTable, text, integer, boolean, timestamp, serial, real } from "drizzle-orm/pg-core";

// ── Sally CRM: Leads ──────────────────────────────────────────────────────────
export const sallyLeads = pgTable("sally_leads", {
  id:                   serial("id").primaryKey(),
  name:                 text("name").notNull(),
  email:                text("email").notNull(),
  productInterestGroup: text("product_interest_group").notNull().default(""),
  /** Original free-text specialty used to classify this lead at import time.
   *  Stored so reclassify/all can re-evaluate source text rather than the
   *  already-derived canonical label when keywords change. */
  specialty:            text("specialty"),
  firstContactDate:     text("first_contact_date"),
  trainingRegistered:   boolean("training_registered").notNull().default(false),
  isCancelled:          boolean("is_cancelled").notNull().default(false),
  createdAt:            timestamp("created_at").notNull().defaultNow(),
  updatedAt:            timestamp("updated_at").notNull().defaultNow(),
});

// ── Sally CRM: Certified Doctors ──────────────────────────────────────────────
export const sallyCertifiedDoctors = pgTable("sally_certified_doctors", {
  id:               serial("id").primaryKey(),
  name:             text("name").notNull(),
  email:            text("email").notNull(),
  lastPurchaseDate: text("last_purchase_date"),
  avgItemsPerOrder: real("avg_items_per_order").notNull().default(0),
  isCancelled:      boolean("is_cancelled").notNull().default(false),
  portalSessionsRevokedAt: timestamp("portal_sessions_revoked_at", { withTimezone: true }),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
});

// ── Sally CRM: Email Queue ────────────────────────────────────────────────────
// trigger_type: "first_contact" | "4_week_followup" | "2_month_reminder"
//               | "doctor_checkin" | "doctor_promo"
// status:       "pending" | "sent" | "cancelled"
export const sallyEmailQueue = pgTable("sally_email_queue", {
  id:             serial("id").primaryKey(),
  recipientEmail: text("recipient_email").notNull(),
  subject:        text("subject").notNull(),
  body:           text("body").notNull(),
  triggerType:    text("trigger_type").notNull(),
  status:         text("status").notNull().default("pending"),
  escalationForwardStatus: text("escalation_forward_status"),
  relatedLeadId:  integer("related_lead_id"),
  relatedDoctorId:integer("related_doctor_id"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

// ── Sally CRM: Lessons (learned from admin corrections of drafts) ────────────
export const sallyLessons = pgTable("sally_lessons", {
  id:            serial("id").primaryKey(),
  context:       text("context").notNull(),        // trigger_type of the corrected draft
  originalText:  text("original_text").notNull(),
  correctedText: text("corrected_text").notNull(),
  lesson:        text("lesson").notNull(),          // one-line distilled rule
  createdAt:     timestamp("created_at").notNull().defaultNow(),
});

export const sallyEscalationReconciliationAudit = pgTable("sally_escalation_reconciliation_audit", {
  id: serial("id").primaryKey(),
  queueItemId: integer("queue_item_id").notNull(),
  action: text("action").notNull(),
  previousStatus: text("previous_status"),
  resultingStatus: text("resulting_status"),
  actor: text("actor").notNull(),
  acknowledgedDuplicateRisk: boolean("acknowledged_duplicate_risk").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SallyLead            = typeof sallyLeads.$inferSelect;
export type SallyCertifiedDoctor = typeof sallyCertifiedDoctors.$inferSelect;
export type SallyEmailQueueItem  = typeof sallyEmailQueue.$inferSelect;

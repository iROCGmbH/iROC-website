import {
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { irocLeads } from "./iroc_app";
import { websiteCustomersTable } from "./website_customers";

/**
 * Immutable training offer snapshots. Unlike invoice drafts, these records do
 * not receive invoice numbers and cannot be sent as invoices. They preserve the
 * agreed training offer until payment is confirmed.
 */
export const irocTrainingOffers = pgTable("iroc_training_offers", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => irocLeads.id, { onDelete: "cascade" }),
  /** Filled only when the lead is qualified and made invoiceable. */
  websiteCustomerId: integer("website_customer_id")
    .references(() => websiteCustomersTable.id, { onDelete: "set null" }),
  invoiceType: text("invoice_type").notNull(),
  language: text("language").notNull().default("de"),
  issueDate: text("issue_date").notNull(),
  dueDate: text("due_date"),
  trainingDate: text("training_date"),
  orderNumber: text("order_number"),
  referenceNumber: text("reference_number"),
  shippingMethod: text("shipping_method"),
  reasonForExport: text("reason_for_export"),
  termsOfDelivery: text("terms_of_delivery"),
  deliveryCosts: numeric("delivery_costs", { precision: 12, scale: 2 }).notNull().default("0"),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  vatNote: text("vat_note"),
  /** JSON-serialized immutable AppInvoiceItemInput[] snapshot. */
  itemsSnapshot: text("items_snapshot").notNull(),
  /** JSON-serialized lead billing/contact details captured when the offer was issued. */
  customerSnapshot: text("customer_snapshot"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  qualifiedAt: timestamp("qualified_at"),
}, (table) => ({
  oneOfferPerLead: uniqueIndex("iroc_training_offers_lead_id_unique").on(table.leadId),
}));

export type IrocTrainingOffer = typeof irocTrainingOffers.$inferSelect;
import {
  pgTable, text, integer, numeric, boolean,
  timestamp, serial, uuid, index, uniqueIndex, jsonb, type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { websiteCustomersTable } from "./website_customers";

// ── App users (auth) ──────────────────────────────────────────────────────────
export const irocAppUsers = pgTable("iroc_app_users", {
  id:           serial("id").primaryKey(),
  username:     text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /** Set when an administrator chooses a password instead of the bootstrap secret. */
  passwordChangedAt: timestamp("password_changed_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

// ── Customers ─────────────────────────────────────────────────────────────────
export const irocCustomers = pgTable("iroc_customers", {
  id:          serial("id").primaryKey(),
  salutation:  text("salutation"),            // e.g. "Herr" / "Frau" / "Mr." / "Ms."
  title:       text("title"),                 // academic degree, e.g. "Dr. med"
  name:        text("name").notNull(),
  company:     text("company"),
  address:     text("address"),
  street:      text("street"),
  houseNumber: text("house_number"),
  city:        text("city"),
  postalCode:  text("postal_code"),
  country:     text("country").notNull().default("Germany"),
  vatId:       text("vat_id"),
  isEu:        boolean("is_eu").notNull().default(false),
  email:       text("email"),
  phone:       text("phone"),
  notes:       text("notes"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

// ── Products / Inventory ──────────────────────────────────────────────────────
/** Editable product groups (categories). `key` is the stable value stored in
 *  iroc_products.category; renaming a group's key propagates to product rows. */
export const irocProductGroups = pgTable("iroc_product_groups", {
  id:        serial("id").primaryKey(),
  key:       text("key").notNull().unique(),
  nameEn:    text("name_en").notNull(),
  nameDe:    text("name_de").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Service groups are hidden from the public website order form and have no stock. */
  isService: boolean("is_service").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const irocProducts = pgTable("iroc_products", {
  id:                 serial("id").primaryKey(),
  sku:                text("sku").notNull().unique(),
  nameEn:             text("name_en").notNull(),
  nameDe:             text("name_de").notNull(),
  descriptionEn:      text("description_en"),
  descriptionDe:      text("description_de"),
  unitPrice:          numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  stockQuantity:      integer("stock_quantity").notNull().default(0),
  lowStockThreshold:  integer("low_stock_threshold").notNull().default(5),
  /** Website order form group: 'spirecut' | 'ministem' | 'other' */
  category:           text("category").notNull().default("other"),
  unitPriceBrutto:    numeric("unit_price_brutto", { precision: 12, scale: 2 }),
  /** Purchase / cost price per unit (Einzelpreis) — stored at product level; carried forward to new lots automatically */
  purchasePrice:      numeric("purchase_price", { precision: 12, scale: 2 }),
  /** Manufacturer agreement discount % applied to purchase price (e.g. 15 = 15 %).
   *  Effective cost = purchasePrice × (1 − purchaseDiscount / 100) */
  purchaseDiscount:   numeric("purchase_discount", { precision: 5, scale: 2 }),
  /** Currency the purchase price was entered in (e.g. 'EUR', 'USD', 'CHF'). purchasePrice is always the converted EUR value. */
  purchaseCurrency:   text("purchase_currency").notNull().default("EUR"),
  /** Purchase price as entered, in purchaseCurrency, BEFORE discount and conversion. */
  purchaseRawPrice:   numeric("purchase_raw_price", { precision: 12, scale: 2 }),
  /** Recommended sell price to the customer (net). Invoicing below this triggers a UI warning. */
  recommendedPrice:   numeric("recommended_price", { precision: 12, scale: 2 }),
  createdAt:          timestamp("created_at").notNull().defaultNow(),
  updatedAt:          timestamp("updated_at").notNull().defaultNow(),
});

// ── Invoices ──────────────────────────────────────────────────────────────────
export const irocInvoices = pgTable("iroc_invoices", {
  id:               serial("id").primaryKey(),
  invoiceNumber:      text("invoice_number").notNull().unique(),
  customerId:         integer("customer_id").references(() => irocCustomers.id),           // legacy — nullable for new invoices
  websiteCustomerId:  integer("website_customer_id").references(() => websiteCustomersTable.id), // new source of truth
  invoiceType:      text("invoice_type").notNull(), // "domestic" | "eu" | "export" | "noneu"
  issueDate:        text("issue_date").notNull(),   // ISO date string
  dueDate:          text("due_date"),
  orderNumber:      text("order_number"),           // Auftragsnummer / Order Nr.
  referenceNumber:  text("reference_number"),       // Ihre Referenz / Reference Nr.
  buyerReference:   text("buyer_reference"),        // BT-10 / Leitweg-ID or buyer reference
  sellerVatId:      text("seller_vat_id"),           // immutable supplier VAT-ID snapshot
  buyerVatId:       text("buyer_vat_id"),            // immutable buyer VAT-ID snapshot
  paymentTerms:     text("payment_terms"),           // visible + structured payment terms
   paymentTermCode:  text("payment_term_code"),       // stable payment term value; legacy rows remain null
   isB2g:            boolean("is_b2g").notNull().default(false),
  shippingMethod:   text("shipping_method"),        // e.g. "DHL Express"
  reasonForExport:  text("reason_for_export"),      // e.g. "Permanent Sale / Commercial"
  termsOfDelivery:  text("terms_of_delivery"),      // e.g. "DAP (Delivered At Place)"
  deliveryCosts:    numeric("delivery_costs", { precision: 12, scale: 2 }).notNull().default("0"),
  insuranceCosts:   numeric("insurance_costs", { precision: 12, scale: 2 }).notNull().default("0"),
  subtotal:         numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  vatRate:          numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  vatAmount:        numeric("vat_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  total:            numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  status:           text("status").notNull().default("draft"), // "draft" | "sent" | "paid"
  notes:            text("notes"),
  vatNote:          text("vat_note"),                         // ** footnote override; null = auto-computed from invoiceType
  language:         text("language").notNull().default("de"), // "de" | "en"
  /** Website order this invoice was auto-drafted from (unique — one invoice per order) */
  sourceOrderId:    integer("source_order_id").references(() => irocOrders.id, { onDelete: "set null" }),
  /** True when Sally auto-generated this draft */
  sallyGenerated:   boolean("sally_generated").notNull().default(false),
  /** When true, the payment-reminder cron will not queue further reminders for this invoice */
  reminderSuppressed: boolean("reminder_suppressed").notNull().default(false),
  /** Immutable relationship for a seller-issued returned-product correction. */
  correctionOfInvoiceId: integer("correction_of_invoice_id").references((): AnyPgColumn => irocInvoices.id),
  correctionReason: text("correction_reason"),
  originalInvoiceNumber: text("original_invoice_number"),
  originalInvoiceDate: text("original_invoice_date"),
  /** Customer data at correction creation; never re-resolve mutable customer data for the document. */
  customerSnapshot: jsonb("customer_snapshot"),
  /** Set atomically when returned stock has been restored after finalization. */
  inventoryRestoredAt: timestamp("inventory_restored_at"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
});

// Keeps the legacy iroc_customers and website_customers ID spaces explicitly
// linked. Numeric IDs must never be compared directly across these tables.
export const irocCustomerWebsiteLinks = pgTable("iroc_customer_website_links", {
  websiteCustomerId: integer("website_customer_id")
    .primaryKey()
    .references(() => websiteCustomersTable.id, { onDelete: "cascade" }),
  irocCustomerId: integer("iroc_customer_id")
    .notNull()
    .unique()
    .references(() => irocCustomers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Invoice line items ────────────────────────────────────────────────────────
export const irocInvoiceItems = pgTable("iroc_invoice_items", {
  id:               serial("id").primaryKey(),
  invoiceId:        integer("invoice_id").notNull().references(() => irocInvoices.id, { onDelete: "cascade" }),
  productId:        integer("product_id").references(() => irocProducts.id),
  productName:      text("product_name").notNull(),
  sku:              text("sku"),                    // Article code / SKU
  description:      text("description"),
  lotNumber:        text("lot_number"),             // LOT-Nr. (DE) / LOT No. (EN)
  hsCode:           text("hs_code"),               // HS/HTS code for customs (export)
  countryOfOrigin:  text("country_of_origin"),     // Country of Origin (export)
  weightKg:         numeric("weight_kg", { precision: 8, scale: 3 }), // Item weight in kg (export)
  unitPrice:        numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  discountPercent:  numeric("discount_percent", { precision: 5, scale: 2 }), // Rabatt %
  vatRate:          numeric("vat_rate", { precision: 5, scale: 2 }), // null = legacy invoice-level rate
  isDemo:           boolean("is_demo").notNull().default(false),           // free-of-charge / demo unit
  quantity:         integer("quantity").notNull().default(1),
  lineTotal:        numeric("line_total", { precision: 12, scale: 2 }).notNull(),
  /** Original line returned by this correction line (null for ordinary invoice lines). */
  correctionSourceItemId: integer("correction_source_item_id").references((): AnyPgColumn => irocInvoiceItems.id),
});

// ── Notifications ─────────────────────────────────────────────────────────────
export const irocNotifications = pgTable("iroc_notifications", {
  id:        serial("id").primaryKey(),
  type:      text("type").notNull().default("low_stock"), // "low_stock" | "pending_quote"
  message:   text("message").notNull(),
  productId: integer("product_id").references(() => irocProducts.id),
  isRead:    boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // Ensures at most one unread pending_quote notification exists at any time.
  // onConflictDoNothing() in the insert relies on this to coalesce concurrent
  // patient submissions into a single bell notification instead of flooding it.
  uniqUnreadPendingQuote: uniqueIndex("uniq_unread_pending_quote")
    .on(table.type)
    .where(sql`${table.isRead} = false AND ${table.type} = 'pending_quote'`),
}));

// ── Inventory Lots ────────────────────────────────────────────────────────────
export const irocInventoryLots = pgTable("iroc_inventory_lots", {
  id:               serial("id").primaryKey(),
  productId:        integer("product_id").notNull().references(() => irocProducts.id, { onDelete: "cascade" }),
  lotNumber:        text("lot_number").notNull(),
  purchaseDate:     text("purchase_date").notNull(),   // ISO date string
  expirationDate:   text("expiration_date"),           // ISO date string; null = no expiry tracked
  description:      text("description"),
  quantityReceived: integer("quantity_received").notNull().default(0),
  quantityUsed:     integer("quantity_used").notNull().default(0),
  status:           text("status").notNull().default("in_house"),
  /** Set automatically when quantityUsed first reaches quantityReceived (lot becomes empty). Cleared if stock is topped up. */
  emptyAt:          timestamp("empty_at"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
});

// ── Leads / Potential Customers ───────────────────────────────────────────────
export const irocLeads = pgTable("iroc_leads", {
  id:           serial("id").primaryKey(),
  /** Anrede: Herr | Frau | Divers */
  salutation:   text("salutation").notNull().default("Herr"),
  /** Akademischer Titel: Dr. med. | Prof. Dr. | PD Dr. | … */
  medicalTitle: text("medical_title"),
  firstName:    text("first_name").notNull().default(""),
  lastName:     text("last_name").notNull(),
  /** Fachrichtung */
  specialty:    text("specialty"),
  /** Klinik / Arbeitsplatz */
  institutionName: text("institution_name"),
  zipCode:      text("zip_code"),
  street:       text("street"),
  houseNumber:  text("house_number"),
  city:         text("city"),
  country:      text("country"),
  email:        text("email"),
  phone:        text("phone"),
  website:      text("website"),
  /** Wo wurde der Kontakt hergestellt? (Kongress, Messe, Empfehlung, …) */
  contactWhere:     text("contact_where"),
  notes:            text("notes"),
  /** Date of first contact (YYYY-MM-DD) — auto-set on first email send */
  firstContactDate: text("first_contact_date"),
  /** new | contacted | qualified | converted */
  status:           text("status").notNull().default("new"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});

// ── Website orders (approval flow) ────────────────────────────────────────────
// Orders submitted on the iROC website. Each order must be confirmed by the
// customer via an email approval link before it becomes visible as an incoming
// order in the iROC Interface App.
export const irocOrders = pgTable("iroc_orders", {
  id:                serial("id").primaryKey(),
  /** Linked website customer (set for existing customers; set after registration for new ones) */
  websiteCustomerId: integer("website_customer_id").references(() => websiteCustomersTable.id, { onDelete: "set null" }),
  customerType:      text("customer_type").notNull(),            // "existing" | "new"
  customerNr:        text("customer_nr"),                        // as entered/validated at submit time
  companyName:       text("company_name"),
  contactName:       text("contact_name"),
  contactEmail:      text("contact_email").notNull(),            // approval email goes here
  contactPhone:      text("contact_phone"),
  instrument:        text("instrument").notNull(),
  products:          text("products"),                           // serialized product lines
  deliveryAddress:   text("delivery_address"),
  notes:             text("notes"),
  /** One-time token embedded in the approval link */
  approvalToken:     text("approval_token").notNull().unique(),
  /** "pending" (awaiting email approval) | "approved" | "cancelled" */
  status:            text("status").notNull().default("pending"),
  approvedAt:        timestamp("approved_at"),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  /** Customer contact language ("de" | "en"), detected on intake, admin-editable */
  contactLanguage:   text("contact_language"),
  /** Sally review: null (not reviewed) | "reviewing" | "missing_info" | "complete" */
  sallyReviewStatus: text("sally_review_status"),
  /** JSON review result (list of missing items etc.) */
  sallyReviewResult: text("sally_review_result"),
  /** Lease timestamp for the 'reviewing' claim */
  sallyReviewClaimedAt: timestamp("sally_review_claimed_at"),
});

// ── Sendcloud shipment snapshots ──────────────────────────────────────────────
// A shipment is created at most once per website order. Provider data is stored
// as a snapshot so invoice charges never depend on a later Sendcloud quote.
export const irocOrderShipments = pgTable("iroc_order_shipments", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").unique().references(() => irocOrders.id, { onDelete: "cascade" }),
  invoiceId: integer("invoice_id").references(() => irocInvoices.id, { onDelete: "set null" }),
  status: text("status").notNull().default("created"),
  carrier: text("carrier"),
  serviceCode: text("service_code"),
  trackingNumber: text("tracking_number"),
  labelUrl: text("label_url"),
  sendcloudShipmentId: text("sendcloud_shipment_id").unique(),
  quoteSnapshot: text("quote_snapshot").notNull(),
  parcelCount: integer("parcel_count").notNull().default(1),
  weightKg: numeric("weight_kg", { precision: 8, scale: 3 }).notNull(),
  lengthCm: numeric("length_cm", { precision: 8, scale: 2 }),
  widthCm: numeric("width_cm", { precision: 8, scale: 2 }),
  heightCm: numeric("height_cm", { precision: 8, scale: 2 }),
  deliveryCosts: numeric("delivery_costs", { precision: 12, scale: 2 }).notNull().default("0"),
  insuranceCosts: numeric("insurance_costs", { precision: 12, scale: 2 }).notNull().default("0"),
  insuredValue: numeric("insured_value", { precision: 12, scale: 2 }).notNull().default("0"),
  pickupScheduledFor: timestamp("pickup_scheduled_for"),
  pickupReference: text("pickup_reference"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("iroc_order_shipments_invoice_id_unique")
    .on(table.invoiceId)
    .where(sql`${table.invoiceId} IS NOT NULL`),
]);

// ── DATEV Export log ──────────────────────────────────────────────────────────
export const datevExports = pgTable("datev_exports", {
  id:              serial("id").primaryKey(),
  exportedAt:      timestamp("exported_at").notNull().defaultNow(),
  bookkeeperEmail: text("bookkeeper_email").notNull(),
  invoiceCount:    integer("invoice_count").notNull().default(0),
  /** 'pending' while ZIP is building/sending; 'sent' on success; 'failed' if email delivery failed. */
  status:          text("status").notNull().default("pending"),
}, (table) => [
  index("datev_exports_exported_at_idx").on(table.exportedAt.desc()),
  // pg_trgm is provisioned before the project's Drizzle schema sync runs.
  index("datev_exports_bookkeeper_email_trgm_idx").using(
    "gin",
    sql`${table.bookkeeperEmail} gin_trgm_ops`,
  ),
]);

export const datevExportItems = pgTable("datev_export_items", {
  id:        serial("id").primaryKey(),
  exportId:  integer("export_id").notNull().references(() => datevExports.id, { onDelete: "cascade" }),
  invoiceId: integer("invoice_id").notNull().references(() => irocInvoices.id, { onDelete: "cascade" }),
});

export type IrocCustomer       = typeof irocCustomers.$inferSelect;
export type IrocProduct      = typeof irocProducts.$inferSelect;
export type IrocInvoice      = typeof irocInvoices.$inferSelect;
export type IrocInvoiceItem  = typeof irocInvoiceItems.$inferSelect;
export type IrocInventoryLot = typeof irocInventoryLots.$inferSelect;
export type IrocNotification = typeof irocNotifications.$inferSelect;
export type IrocAppUser      = typeof irocAppUsers.$inferSelect;
export type IrocLead         = typeof irocLeads.$inferSelect;
export type IrocOrderShipment = typeof irocOrderShipments.$inferSelect;
export type DatevExport      = typeof datevExports.$inferSelect;
export type DatevExportItem  = typeof datevExportItems.$inferSelect;

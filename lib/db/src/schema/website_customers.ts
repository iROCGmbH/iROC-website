import { sql } from "drizzle-orm";
import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const websiteCustomersTable = pgTable("website_customers", {
  id:                  serial("id").primaryKey(),
  customerNr:          text("customer_nr"),           // yyyy-#### format, e.g. 2026-0001
  /** 8-char reorder code, uniquely bound to the customer number. Printed on invoices;
   *  required (together with customerNr) when an existing customer reorders online.
   *  Stays stable across invoices; admin can regenerate it if compromised. */
  reorderCode:         text("reorder_code"),
  salutation:          text("salutation"),
  title:               text("title"),
  firstName:           text("first_name"),
  lastName:            text("last_name"),
  specialty:           text("specialty"),
  institutionName:     text("institution_name"),
  institutionType:     text("institution_type"),
  address:             text("address"),
  street:              text("street"),
  houseNumber:         text("house_number"),
  postalCode:          text("postal_code"),
  city:                text("city"),
  country:             text("country"),
  phone:               text("phone"),
  fax:                 text("fax"),
  email:               text("email").notNull(),
  website:             text("website"),
  referenceNumber:     text("reference_number"),
  isPublicAuthority:   boolean("is_public_authority").notNull().default(false),
  defaultBuyerReference: text("default_buyer_reference"),
  ustIdNr:             text("ust_id_nr"),
  instrument:          text("instrument").notNull(),
  /** Product systems the doctor is certified to order. `instrument` remains
   * the legacy primary value used by older integrations. */
  certifications:      text("certifications").array().notNull().default(sql`ARRAY[]::text[]`),
  notes:               text("notes"),
  privacyConsent:      boolean("privacy_consent").notNull().default(false),
  // Shipping address (if different from billing)
  shippingFirstName:       text("shipping_first_name"),
  shippingLastName:        text("shipping_last_name"),
  shippingInstitutionName: text("shipping_institution_name"),
  shippingAddress:         text("shipping_address"),
  shippingStreet:          text("shipping_street"),
  shippingHouseNumber:     text("shipping_house_number"),
  shippingPostalCode:      text("shipping_postal_code"),
  shippingCity:            text("shipping_city"),
  shippingCountry:         text("shipping_country"),
  shippingPhone:           text("shipping_phone"),
  shippingEmail:           text("shipping_email"),
  treatingDoctorName:  text("treating_doctor_name"),
  createdAt:           timestamp("created_at").notNull().defaultNow(),
});

export type WebsiteCustomer = typeof websiteCustomersTable.$inferSelect;

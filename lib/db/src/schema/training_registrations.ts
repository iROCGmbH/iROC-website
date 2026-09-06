import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const trainingRegistrationsTable = pgTable("training_registrations", {
  id: serial("id").primaryKey(),
  salutation: text("salutation"),
  medicalDegree: text("medical_degree"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  specialty: text("specialty"),
  institutionName: text("institution_name"),
  address: text("address"),
  street: text("street"),
  houseNumber: text("house_number"),
  postalCode: text("postal_code"),
  city: text("city"),
  country: text("country"),
  phone: text("phone"),
  fax: text("fax"),
  email: text("email").notNull(),
  instrument: text("instrument").notNull(), // 'spirecut' | 'ministem'
  trainingDateId: integer("training_date_id"),
  trainingDateInfo: text("training_date_info"), // human-readable snapshot: "2025-09-15 – München"
  websiteUrl: text("website_url"),
  notes: text("notes"),
  privacyConsent: boolean("privacy_consent").notNull().default(false),
  marketingConsent: boolean("marketing_consent").notNull().default(false),
  certifiedDoctorId: integer("certified_doctor_id"), // set when promoted to certified list
  // Email double-opt-in: doctor must confirm the registration via emailed link
  status: text("status").notNull().default("pending"), // 'pending' | 'confirmed'
  confirmationToken: text("confirmation_token").unique(),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TrainingRegistration = typeof trainingRegistrationsTable.$inferSelect;

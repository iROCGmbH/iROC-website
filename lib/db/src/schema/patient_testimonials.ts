import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Curated, administrator-managed video stories for the public Spirecut patient
 * site. These deliberately do not share storage with anonymous postoperative
 * survey submissions, which have a separate consent and approval workflow.
 */
export const patientTestimonialsTable = pgTable("patient_testimonials", {
  id: serial("id").primaryKey(),
  titleDe: text("title_de").notNull(),
  titleEn: text("title_en").notNull(),
  descriptionDe: text("description_de").notNull().default(""),
  descriptionEn: text("description_en").notNull().default(""),
  patientLabel: text("patient_label").notNull().default(""),
  procedureDe: text("procedure_de").notNull().default(""),
  procedureEn: text("procedure_en").notNull().default(""),
  videoUrl: text("video_url").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  published: boolean("published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertPatientTestimonialSchema = createInsertSchema(patientTestimonialsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });

export type InsertPatientTestimonial = z.infer<typeof insertPatientTestimonialSchema>;
export type PatientTestimonial = typeof patientTestimonialsTable.$inferSelect;
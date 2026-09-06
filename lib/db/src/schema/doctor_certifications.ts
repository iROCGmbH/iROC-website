import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { trainedDoctorsTable } from "./trained_doctors";

export const doctorCertificationsTable = pgTable("doctor_certifications", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id")
    .notNull()
    .references(() => trainedDoctorsTable.id, { onDelete: "cascade" }),
  instrument: text("instrument").notNull(), // 'spirecut' | 'ministem' | any future product
  certifiedDate: text("certified_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DoctorCertification = typeof doctorCertificationsTable.$inferSelect;

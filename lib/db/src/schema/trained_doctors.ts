import { pgTable, serial, text, timestamp, real } from "drizzle-orm/pg-core";

export const trainedDoctorsTable = pgTable("trained_doctors", {
  id: serial("id").primaryKey(),
  title: text("title"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  specialty: text("specialty"),
  institutionName: text("institution_name"),
  city: text("city").notNull(),
  postalCode: text("postal_code"),
  country: text("country").notNull(),
  phone: text("phone"),
  email: text("email"),
  websiteUrl: text("website_url"),
  lat: real("lat"),
  lon: real("lon"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TrainedDoctor = typeof trainedDoctorsTable.$inferSelect;

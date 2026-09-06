import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const trainingDatesTable = pgTable("training_dates", {
  id: serial("id").primaryKey(),
  instrument: text("instrument").notNull(), // 'spirecut' | 'ministem'
  date: text("date").notNull(), // ISO date string e.g. 2025-09-15
  time: text("time"),
  location: text("location").notNull(),
  locationDetail: text("location_detail"),
  maxParticipants: integer("max_participants").notNull().default(20),
  registeredCount: integer("registered_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTrainingDateSchema = createInsertSchema(trainingDatesTable).omit({ id: true, createdAt: true, registeredCount: true });
export type InsertTrainingDate = z.infer<typeof insertTrainingDateSchema>;
export type TrainingDate = typeof trainingDatesTable.$inferSelect;

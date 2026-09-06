import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const eventsTable = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  titleDe: text("title_de"),
  description: text("description"),
  descriptionDe: text("description_de"),
  mediaUrl: text("media_url"),           // image URL or YouTube embed URL
  mediaType: text("media_type").notNull().default("image"), // "image" | "video"
  externalUrl: text("external_url").notNull(),
  eventDate: text("event_date").notNull(), // ISO date string – auto-remove 7 days after this
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // ── Congress / conference event fields ───────────────────────────────────────
  location: text("location"),                         // "City, Country"
  specialtyFocus: text("specialty_focus"),            // primary medical theme
  endDate: text("end_date"),                          // ISO date – multi-day events
  isCongressEvent: boolean("is_congress_event").notNull().default(false),
});

export type Event = typeof eventsTable.$inferSelect;
export type NewEvent = typeof eventsTable.$inferInsert;

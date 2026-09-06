import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const pageContentTable = pgTable("page_content", {
  key:       text("key").primaryKey(),
  site:      text("site").notNull(),   // 'iroc' | 'spirecut'
  page:      text("page").notNull(),   // page slug for grouping in admin
  label:     text("label").notNull(),  // human-readable label / original DE text (used for t() lookup)
  de:        text("de").notNull(),
  en:        text("en").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PageContent = typeof pageContentTable.$inferSelect;

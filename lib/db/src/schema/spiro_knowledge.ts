import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const spiroKnowledgeDocuments = pgTable("spiro_knowledge_documents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  objectPath: text("object_path").notNull().unique(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  status: text("status").notNull().default("processing"),
  extractedText: text("extracted_text"),
  pageCount: integer("page_count"),
  characterCount: integer("character_count").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
});

export const insertSpiroKnowledgeDocumentSchema = createInsertSchema(spiroKnowledgeDocuments).omit({
  id: true,
  createdAt: true,
});

export type SpiroKnowledgeDocument = typeof spiroKnowledgeDocuments.$inferSelect;
export type InsertSpiroKnowledgeDocument = z.infer<typeof insertSpiroKnowledgeDocumentSchema>;
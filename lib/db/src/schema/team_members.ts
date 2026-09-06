import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const teamMembersTable = pgTable("team_members", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  roleDe: text("role_de"),
  bio: text("bio"),
  bioDe: text("bio_de"),
  photoPath: text("photo_path"),      // /objects/uploads/<uuid> stored from GCS
  sortOrder: integer("sort_order").notNull().default(0),
  /** 'consulting_doctors' | 'specialists' | 'ai_agents' */
  category: text("category").notNull().default("consulting_doctors"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

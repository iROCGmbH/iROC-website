import { Router, type IRouter, type Request, type Response } from "express";
import { db, teamMembersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "./admin-auth.js";

const router: IRouter = Router();

// ─── Public: list all team members (sorted) ───────────────────────────────────
router.get("/team", async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(teamMembersTable)
    .orderBy(asc(teamMembersTable.sortOrder), asc(teamMembersTable.id));
  res.json(rows);
});

// ─── Admin: create ────────────────────────────────────────────────────────────
router.post("/admin/team", requireAdmin, async (req: Request, res: Response) => {
  const { name, role, roleDe, bio, bioDe, photoPath, sortOrder, category } = req.body as {
    name: string; role: string; roleDe?: string; bio?: string; bioDe?: string;
    photoPath?: string; sortOrder?: number; category?: string;
  };
  if (!name?.trim() || !role?.trim()) {
    res.status(400).json({ error: "name and role are required" });
    return;
  }
  const validCategories = ["consulting_doctors", "specialists", "ai_agents"];
  const [row] = await db.insert(teamMembersTable).values({
    name: name.trim(),
    role: role.trim(),
    roleDe: roleDe?.trim() ?? null,
    bio: bio?.trim() ?? null,
    bioDe: bioDe?.trim() ?? null,
    photoPath: photoPath ?? null,
    sortOrder: sortOrder ?? 0,
    category: validCategories.includes(category ?? "") ? category! : "consulting_doctors",
  }).returning();
  res.status(201).json(row);
});

// ─── Admin: update ────────────────────────────────────────────────────────────
router.patch("/admin/team/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { name, role, roleDe, bio, bioDe, photoPath, sortOrder, category } = req.body as {
    name?: string; role?: string; roleDe?: string; bio?: string; bioDe?: string;
    photoPath?: string; sortOrder?: number; category?: string;
  };

  const validCategories = ["consulting_doctors", "specialists", "ai_agents"];
  const patch: Partial<typeof teamMembersTable.$inferInsert> = {};
  if (name !== undefined)      patch.name = name.trim();
  if (role !== undefined)      patch.role = role.trim();
  if (roleDe !== undefined)    patch.roleDe = roleDe?.trim() ?? null;
  if (bio !== undefined)       patch.bio = bio?.trim() ?? null;
  if (bioDe !== undefined)     patch.bioDe = bioDe?.trim() ?? null;
  if (photoPath !== undefined) patch.photoPath = photoPath;
  if (sortOrder !== undefined) patch.sortOrder = sortOrder;
  if (category !== undefined && validCategories.includes(category)) patch.category = category;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [row] = await db.update(teamMembersTable).set(patch).where(eq(teamMembersTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ─── Admin: delete ────────────────────────────────────────────────────────────
router.delete("/admin/team/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(teamMembersTable).where(eq(teamMembersTable.id, id));
  res.json({ message: "Deleted" });
});

export default router;

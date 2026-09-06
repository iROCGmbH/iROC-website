/**
 * Patient media management routes
 * GET  /patient-media        — public, returns all image overrides for the patient site
 * POST /admin/patient-media  — admin only, set an image key to an object URL
 * DELETE /admin/patient-media/:key — admin only, remove a key
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { requireAdmin } from "./admin-auth.js";

const router: IRouter = Router();

const PREFIX = "patient_media_";

// Public: return all patient media settings as { key: url }
router.get("/patient-media", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(settingsTable)
      .where(like(settingsTable.key, `${PREFIX}%`));
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key.slice(PREFIX.length)] = row.value;
    }
    // Image uploads point each media key at a new object path. Never allow an
    // intermediary or installed browser client to reuse an older media map and
    // resolve a freshly uploaded slot to its previous image.
    res.set("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: set a media key
router.post("/admin/patient-media", requireAdmin, async (req, res) => {
  const { key, url } = req.body as { key?: string; url?: string };
  if (!key || !url) {
    res.status(400).json({ error: "key and url are required" });
    return;
  }
  const dbKey = `${PREFIX}${key}`;
  await db
    .insert(settingsTable)
    .values({ key: dbKey, value: url })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: url, updatedAt: new Date() } });
  res.json({ message: "Updated", key, url });
});

// Admin: delete a media key
router.delete("/admin/patient-media/:key", requireAdmin, async (req, res) => {
  const dbKey = `${PREFIX}${req.params.key}`;
  await db.delete(settingsTable).where(eq(settingsTable.key, dbKey));
  res.json({ message: "Deleted" });
});

export default router;

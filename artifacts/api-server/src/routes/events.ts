import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { eventsTable } from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import { requireAdmin } from "./admin-auth.js";

const router: IRouter = Router();

// Events are shown publicly if eventDate + 7 days >= today
function isVisible(eventDate: string): boolean {
  const cutoff = new Date(eventDate);
  cutoff.setDate(cutoff.getDate() + 7);
  return cutoff >= new Date();
}

// ─── Public: list active, non-expired events ──────────────────────────────────
router.get("/events", async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.isActive, true))
    .orderBy(asc(eventsTable.eventDate));

  const visible = rows.filter((r) => isVisible(r.eventDate));
  res.json(visible);
});

// ─── Admin: list ALL events (including expired) ───────────────────────────────
router.get("/admin/events", requireAdmin, async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(eventsTable)
    .orderBy(desc(eventsTable.eventDate));
  // Annotate expired status
  const annotated = rows.map((r) => ({ ...r, expired: !isVisible(r.eventDate) }));
  res.json(annotated);
});

// ─── Admin: create ────────────────────────────────────────────────────────────
router.post("/admin/events", requireAdmin, async (req: Request, res: Response) => {
  const { title, titleDe, description, descriptionDe, mediaUrl, mediaType, externalUrl, eventDate } =
    req.body as {
      title?: string;
      titleDe?: string;
      description?: string;
      descriptionDe?: string;
      mediaUrl?: string;
      mediaType?: string;
      externalUrl?: string;
      eventDate?: string;
    };

  if (!title?.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  if (!externalUrl?.trim()) {
    res.status(400).json({ error: "externalUrl is required" });
    return;
  }
  if (!eventDate?.trim()) {
    res.status(400).json({ error: "eventDate is required" });
    return;
  }
  if (mediaType && !["image", "video"].includes(mediaType)) {
    res.status(400).json({ error: "mediaType must be 'image' or 'video'" });
    return;
  }

  const [row] = await db.insert(eventsTable).values({
    title: title.trim(),
    titleDe: titleDe?.trim() ?? null,
    description: description?.trim() ?? null,
    descriptionDe: descriptionDe?.trim() ?? null,
    mediaUrl: mediaUrl?.trim() ?? null,
    mediaType: mediaType ?? "image",
    externalUrl: externalUrl.trim(),
    eventDate: eventDate.trim(),
  }).returning();

  res.status(201).json(row);
});

// ─── Admin: update ────────────────────────────────────────────────────────────
router.patch("/admin/events/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { title, titleDe, description, descriptionDe, mediaUrl, mediaType, externalUrl, eventDate, isActive } =
    req.body as Record<string, string | boolean | undefined>;

  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = (title as string).trim();
  if (titleDe !== undefined) updates.titleDe = (titleDe as string).trim();
  if (description !== undefined) updates.description = (description as string).trim();
  if (descriptionDe !== undefined) updates.descriptionDe = (descriptionDe as string).trim();
  if (mediaUrl !== undefined) updates.mediaUrl = (mediaUrl as string).trim();
  if (mediaType !== undefined) updates.mediaType = mediaType;
  if (externalUrl !== undefined) updates.externalUrl = (externalUrl as string).trim();
  if (eventDate !== undefined) updates.eventDate = (eventDate as string).trim();
  if (isActive !== undefined) updates.isActive = isActive;

  const [row] = await db.update(eventsTable).set(updates).where(eq(eventsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ─── Admin: delete ────────────────────────────────────────────────────────────
router.delete("/admin/events/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(eventsTable).where(eq(eventsTable.id, id));
  res.json({ message: "Deleted" });
});

export default router;

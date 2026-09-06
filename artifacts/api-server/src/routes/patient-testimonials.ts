import { Router, type IRouter, type Request, type Response } from "express";
import { asc, eq } from "drizzle-orm";
import { db, patientTestimonialsTable, type PatientTestimonial } from "@workspace/db";
import { requireAdmin } from "./admin-auth.js";

const router: IRouter = Router();

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_LABEL_LENGTH = 120;
const MAX_PROCEDURE_LENGTH = 120;
const MAX_VIDEO_URL_LENGTH = 2_048;
const MAX_DISPLAY_ORDER = 1_000_000;

export type TestimonialInput = {
  titleDe: string;
  titleEn: string;
  descriptionDe?: string;
  descriptionEn?: string;
  patientLabel?: string;
  procedureDe?: string;
  procedureEn?: string;
  videoUrl: string;
  displayOrder?: number;
  published?: boolean;
};

type TestimonialPatch = Partial<TestimonialInput>;

function getParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function parseId(value: string | string[] | undefined): number | null {
  const raw = getParam(value);
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function trimText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length <= maximumLength ? result : null;
}

/**
 * Accept only well-formed YouTube pages and embed URLs. This protects the
 * public iframe from arbitrary third-party origins while still allowing the
 * URLs that editors commonly paste from YouTube.
 */
export function isSupportedYouTubeUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_VIDEO_URL_LENGTH) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;

    const host = parsed.hostname.toLowerCase();
    const youtubeHosts = new Set([
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtube-nocookie.com",
      "www.youtube-nocookie.com",
    ]);
    const videoId = (id: string | null) => Boolean(id && /^[A-Za-z0-9_-]{6,}$/.test(id));

    if (host === "youtu.be" || host === "www.youtu.be") {
      return videoId(parsed.pathname.split("/").filter(Boolean)[0] ?? null);
    }
    if (!youtubeHosts.has(host)) return false;
    if (parsed.pathname === "/watch") return videoId(parsed.searchParams.get("v"));

    const [first, id] = parsed.pathname.split("/").filter(Boolean);
    return ["embed", "shorts", "live"].includes(first ?? "") && videoId(id ?? null);
  } catch {
    return false;
  }
}

function validateInput(body: unknown, partial: boolean): { data?: TestimonialPatch; error?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Expected a testimonial object" };
  }
  const source = body as Record<string, unknown>;
  const data: TestimonialPatch = {};

  const optionalStringFields: Array<[keyof Pick<TestimonialInput, "descriptionDe" | "descriptionEn" | "patientLabel" | "procedureDe" | "procedureEn">, number]> = [
    ["descriptionDe", MAX_DESCRIPTION_LENGTH],
    ["descriptionEn", MAX_DESCRIPTION_LENGTH],
    ["patientLabel", MAX_LABEL_LENGTH],
    ["procedureDe", MAX_PROCEDURE_LENGTH],
    ["procedureEn", MAX_PROCEDURE_LENGTH],
  ];

  for (const [field, limit] of optionalStringFields) {
    if (field in source) {
      const text = trimText(source[field], limit);
      if (text === null) return { error: `${field} must be a string up to ${limit} characters` };
      data[field] = text;
    }
  }

  for (const field of ["titleDe", "titleEn"] as const) {
    if (field in source) {
      const title = trimText(source[field], MAX_TITLE_LENGTH);
      if (!title) return { error: `${field} must be a non-empty string up to ${MAX_TITLE_LENGTH} characters` };
      data[field] = title;
    } else if (!partial) {
      return { error: `${field} is required` };
    }
  }

  if ("videoUrl" in source) {
    const videoUrl = trimText(source.videoUrl, MAX_VIDEO_URL_LENGTH);
    if (!videoUrl || !isSupportedYouTubeUrl(videoUrl)) {
      return { error: "videoUrl must be a supported HTTPS YouTube URL" };
    }
    data.videoUrl = videoUrl;
  } else if (!partial) {
    return { error: "videoUrl is required" };
  }

  if ("displayOrder" in source) {
    const displayOrder = source.displayOrder;
    if (
      typeof displayOrder !== "number" ||
      !Number.isInteger(displayOrder) ||
      displayOrder < 0 ||
      displayOrder > MAX_DISPLAY_ORDER
    ) {
      return { error: `displayOrder must be an integer between 0 and ${MAX_DISPLAY_ORDER}` };
    }
    data.displayOrder = displayOrder;
  }

  if ("published" in source) {
    if (typeof source.published !== "boolean") return { error: "published must be a boolean" };
    data.published = source.published;
  }

  if (partial && Object.keys(data).length === 0) {
    return { error: "Provide at least one editable testimonial field" };
  }
  return { data };
}

function isPubliclySafe(row: PatientTestimonial): boolean {
  return row.published && isSupportedYouTubeUrl(row.videoUrl);
}

// Public: published entries only. A second validity check ensures that old or
// manually corrupted rows can never cause an arbitrary URL to be embedded.
router.get("/patient-testimonials", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select()
    .from(patientTestimonialsTable)
    .where(eq(patientTestimonialsTable.published, true))
    .orderBy(asc(patientTestimonialsTable.displayOrder), asc(patientTestimonialsTable.id));
  res.json(rows.filter(isPubliclySafe));
});

// Admin: list every entry, including drafts and invalid legacy values that need correction.
router.get("/admin/patient-testimonials", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select()
    .from(patientTestimonialsTable)
    .orderBy(asc(patientTestimonialsTable.displayOrder), asc(patientTestimonialsTable.id));
  res.json(rows);
});

router.post("/admin/patient-testimonials", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const parsed = validateInput(req.body, false);
  if (!parsed.data) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const data = parsed.data as TestimonialInput;
  const [created] = await db.insert(patientTestimonialsTable).values({
    titleDe: data.titleDe,
    titleEn: data.titleEn,
    descriptionDe: data.descriptionDe ?? "",
    descriptionEn: data.descriptionEn ?? "",
    patientLabel: data.patientLabel ?? "",
    procedureDe: data.procedureDe ?? "",
    procedureEn: data.procedureEn ?? "",
    videoUrl: data.videoUrl,
    displayOrder: data.displayOrder ?? 0,
    published: data.published ?? false,
  }).returning();
  res.status(201).json(created);
});

router.patch("/admin/patient-testimonials/:id", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid testimonial id" });
    return;
  }

  const parsed = validateInput(req.body, true);
  if (!parsed.data) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const [existing] = await db
    .select()
    .from(patientTestimonialsTable)
    .where(eq(patientTestimonialsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Testimonial not found" });
    return;
  }

  const resultingVideoUrl = parsed.data.videoUrl ?? existing.videoUrl;
  if (parsed.data.published === true && !isSupportedYouTubeUrl(resultingVideoUrl)) {
    res.status(400).json({ error: "A valid YouTube video URL is required before publishing" });
    return;
  }

  const [updated] = await db
    .update(patientTestimonialsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(patientTestimonialsTable.id, id))
    .returning();
  // The select above provides an explicit 404; this guard handles a concurrent delete.
  if (!updated) { res.status(404).json({ error: "Testimonial not found" }); return; }
  res.json(updated);
});

router.delete("/admin/patient-testimonials/:id", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid testimonial id" });
    return;
  }
  const [deleted] = await db
    .delete(patientTestimonialsTable)
    .where(eq(patientTestimonialsTable.id, id))
    .returning({ id: patientTestimonialsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Testimonial not found" });
    return;
  }
  res.status(204).send();
});

export default router;
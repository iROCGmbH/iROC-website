/**
 * patient-extras — social links + postoperative submissions
 *
 * Public:
 *   GET  /patient-social                  → { instagram, youtube, linkedin }
 *   POST /patient-postop                  → save anonymous submission
 *   GET  /patient-postop-stats            → aggregate stats (no raw data exposed)
 *   GET  /patient-postop-config           → current form config (for patient form rendering)
 *
 * Admin:
 *   POST   /admin/patient-social              → set one social link key
 *   GET    /admin/patient-postop              → list all submissions (newest first)
 *   GET    /admin/patient-postop-diagnostics  → submissions plus unreadable-record diagnostics
 *   POST   /admin/patient-postop-recovery/:id → restore one unreadable submission from backup
 *   PATCH  /admin/patient-postop/:id          → approve/reject quote or correct rating
 *   DELETE /admin/patient-postop/:id          → delete one submission
 *   GET    /admin/patient-postop-form-config  → get current form config
 *   PUT    /admin/patient-postop-form-config  → save form config
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { settingsTable, irocNotifications } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import {
  getDefaultPostopFormConfig,
  type PostopFormConfig,
} from "@workspace/spirecut-shared";
import { requireAdmin } from "./admin-auth.js";

const router: IRouter = Router();

// ── Defaults ───────────────────────────────────────────────────────────────
const SOCIAL_DEFAULTS: Record<string, string> = {
  instagram: "https://www.instagram.com/spirecut_officiel/",
  youtube: "https://www.youtube.com/@Spirecut",
  linkedin: "https://www.linkedin.com/company/spirecut/",
  tiktok: "https://www.tiktok.com/@spirecut",
  facebook: "https://www.facebook.com/spirecut",
};
const SOCIAL_PREFIX = "patient_social_";
const POSTOP_PREFIX = "patient_postop_";
const POSTOP_REPAIR_AUDIT_PREFIX = "postop_repair_audit_";
const POSTOP_FORM_CONFIG_KEY = "postop_form_config";

// ── Form config helpers ─────────────────────────────────────────────────────

export async function getPostopFormConfig(): Promise<PostopFormConfig> {
  try {
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, POSTOP_FORM_CONFIG_KEY));
    if (!row) return getDefaultPostopFormConfig();
    const stored = JSON.parse(row.value) as Partial<PostopFormConfig>;
    const defaults = getDefaultPostopFormConfig();
    return {
      procedures:      Array.isArray(stored.procedures)      ? stored.procedures      : defaults.procedures,
      ageRanges:       Array.isArray(stored.ageRanges)       ? stored.ageRanges       : defaults.ageRanges,
      genders:         Array.isArray(stored.genders)         ? stored.genders         : defaults.genders,
      occupations:     Array.isArray(stored.occupations)     ? stored.occupations     : defaults.occupations,
      diseases:        Array.isArray(stored.diseases)        ? stored.diseases        : defaults.diseases,
      visibleSections: { ...defaults.visibleSections, ...(stored.visibleSections ?? {}) },
    };
  } catch {
    return getDefaultPostopFormConfig();
  }
}

type PostopProcedure = PostopFormConfig["procedures"][number];

function readableProcedureLabel(procedure: PostopProcedure, language: "de" | "en"): string {
  const preferred = language === "de" ? procedure.labelDe : procedure.labelEn;
  const fallback = language === "de" ? procedure.labelEn : procedure.labelDe;
  const preferredLabel = typeof preferred === "string" ? preferred.trim() : "";
  const fallbackLabel = typeof fallback === "string" ? fallback.trim() : "";
  return preferredLabel || fallbackLabel || procedure.key;
}

export async function archiveRemovedProcedureLabels(
  previousProcedures: PostopProcedure[],
  nextProcedures: PostopProcedure[],
): Promise<void> {
  const nextKeys = new Set(nextProcedures.map((procedure) => procedure.key));
  const removedProcedures = new Map(
    previousProcedures
      .filter((procedure) => !nextKeys.has(procedure.key))
      .map((procedure) => [procedure.key, procedure]),
  );
  if (removedProcedures.size === 0) return;

  const rows = await db
    .select()
    .from(settingsTable)
    .where(like(settingsTable.key, `${POSTOP_PREFIX}%`));

  for (const row of rows) {
    let submission: Record<string, unknown>;
    try {
      submission = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (!submission || typeof submission !== "object" || Array.isArray(submission)) continue;

    const procedure = typeof submission.procedure === "string"
      ? removedProcedures.get(submission.procedure)
      : undefined;
    if (!procedure) continue;

    const labelDe = typeof submission.procedureLabelDe === "string" && submission.procedureLabelDe.trim()
      ? submission.procedureLabelDe
      : readableProcedureLabel(procedure, "de");
    const labelEn = typeof submission.procedureLabelEn === "string" && submission.procedureLabelEn.trim()
      ? submission.procedureLabelEn
      : readableProcedureLabel(procedure, "en");

    if (submission.procedureLabelDe === labelDe && submission.procedureLabelEn === labelEn) continue;

    await db
      .update(settingsTable)
      .set({
        value: JSON.stringify({
          ...submission,
          procedureLabelDe: labelDe,
          procedureLabelEn: labelEn,
        }),
        updatedAt: new Date(),
      })
      .where(eq(settingsTable.key, row.key));
  }
}

// ── Public: form config ────────────────────────────────────────────────────

router.get("/patient-postop-config", async (_req, res) => {
  try {
    const config = await getPostopFormConfig();
    res.json(config);
  } catch {
    res.json(getDefaultPostopFormConfig());
  }
});

// ── Social links ────────────────────────────────────────────────────────────

router.get("/patient-social", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(settingsTable)
      .where(like(settingsTable.key, `${SOCIAL_PREFIX}%`));
    const result = { ...SOCIAL_DEFAULTS };
    for (const row of rows) {
      result[row.key.slice(SOCIAL_PREFIX.length)] = row.value;
    }
    res.json(result);
  } catch {
    res.json(SOCIAL_DEFAULTS);
  }
});

router.post("/admin/patient-social", requireAdmin, async (req, res) => {
  const { key, url } = req.body as { key?: string; url?: string };
  if (!key || !url || !["instagram", "youtube", "linkedin", "tiktok", "facebook"].includes(key)) {
    res.status(400).json({ error: "key must be instagram|youtube|linkedin|tiktok|facebook and url is required" });
    return;
  }
  const dbKey = `${SOCIAL_PREFIX}${key}`;
  await db
    .insert(settingsTable)
    .values({ key: dbKey, value: url })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: url, updatedAt: new Date() } });
  res.json({ message: "Updated", key, url });
});

// ── Postop submissions ──────────────────────────────────────────────────────

const VALID_HAND_SIDES = ["left", "right"] as const;
const VALID_HAND_PARTS = ["thumb", "index", "middle", "ring", "little", "wrist"] as const;

function isValidOperatedPart(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const [side, ...rest] = v.split("_");
  const part = rest.join("_");
  return (VALID_HAND_SIDES as readonly string[]).includes(side) &&
         (VALID_HAND_PARTS as readonly string[]).includes(part);
}

function isValidRecoverySubmission(value: unknown, expectedId: string): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const submission = value as Record<string, unknown>;
  return (
    submission.id === expectedId &&
    typeof submission.procedure === "string" &&
    submission.procedure.trim().length > 0 &&
    typeof submission.operationMonth === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(submission.operationMonth) &&
    typeof submission.rating === "number" &&
    Number.isInteger(submission.rating) &&
    submission.rating >= 1 &&
    submission.rating <= 5 &&
    typeof submission.submittedAt === "string" &&
    Number.isFinite(Date.parse(submission.submittedAt))
  );
}

router.post("/patient-postop", async (req, res) => {
  const { procedure, operationMonth, rating, experience, ageRange, gender, occupation, diseases, operatedParts } = req.body as Record<string, unknown>;

  // Load current form config to validate submitted values against live options
  const config = await getPostopFormConfig();
  const validProcedureKeys = config.procedures.map(p => p.key);
  const selectedProcedure = config.procedures.find((p) => p.key === procedure);
  const validGenderKeys    = config.genders.map(g => g.key);
  const validOccupationKeys = config.occupations.map(o => o.key);
  const validDiseaseKeys   = config.diseases.map(d => d.key);

  if (
    typeof procedure !== "string" || !validProcedureKeys.includes(procedure) ||
    typeof operationMonth !== "string" ||
    typeof rating !== "number" ||
    !Number.isInteger(rating) ||
    rating < 1 || rating > 5
  ) {
    res.status(400).json({ error: "Invalid submission data" });
    return;
  }

  // Silently drop invalid enum values — accepted keys are the ones in the current config
  const resolvedGender     = typeof gender     === "string" && validGenderKeys.includes(gender)         ? gender     : "";
  const resolvedOccupation = typeof occupation === "string" && validOccupationKeys.includes(occupation) ? occupation : "";
  const resolvedDiseases   = Array.isArray(diseases)
    ? diseases.filter((d): d is string => typeof d === "string" && validDiseaseKeys.includes(d))
    : [];

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const dbKey = `${POSTOP_PREFIX}${id}`;
  const value = JSON.stringify({
    id,
    procedure,
    procedureLabelDe: selectedProcedure ? readableProcedureLabel(selectedProcedure, "de") : undefined,
    procedureLabelEn: selectedProcedure ? readableProcedureLabel(selectedProcedure, "en") : undefined,
    operationMonth,
    rating,
    ageRange: typeof ageRange === "string" ? ageRange : "",
    gender: resolvedGender,
    occupation: resolvedOccupation,
    diseases: resolvedDiseases,
    operatedParts: Array.isArray(operatedParts) ? operatedParts.filter(isValidOperatedPart) : [],
    experience: typeof experience === "string" ? experience.slice(0, 1000) : "",
    shareQuote: experience && typeof experience === "string" && experience.trim().length > 0 ? Boolean(req.body.shareQuote) : false,
    // null = pending admin review, true = approved, false = rejected
    quoteApproved: (experience && typeof experience === "string" && experience.trim().length > 0 && Boolean(req.body.shareQuote)) ? null : undefined,
    submittedAt: new Date().toISOString(),
  });
  await db.insert(settingsTable).values({ key: dbKey, value });

  // Notify iROC admins when a patient consents to share their quote.
  const wantsToShare = experience && typeof experience === "string" && experience.trim().length > 0 && Boolean(req.body.shareQuote);
  if (wantsToShare) {
    await db.insert(irocNotifications).values({
      type: "pending_quote",
      message: JSON.stringify({
        de: "Ein Patient hat ein Angebot eingereicht, das auf Überprüfung wartet – besuchen Sie Spirecut-Angebote, um es zu genehmigen oder abzulehnen.",
        en: "A patient submitted a quote awaiting review — visit Spirecut Quotes to approve or reject it.",
        submissionKey: dbKey,
      }),
    }).onConflictDoNothing();
  }

  res.status(201).json({ message: "Submission saved" });
});

// ── Public aggregate stats ───────────────────────────────────────────────────

router.get("/patient-postop-stats", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(settingsTable)
      .where(like(settingsTable.key, `${POSTOP_PREFIX}%`));

    const submissions: any[] = rows
      .map((r) => { try { return JSON.parse(r.value); } catch { return null; } })
      .filter(Boolean);

    const total = submissions.length;

    const validRated = submissions.filter(
      (sub) => typeof sub.rating === "number" && Number.isInteger(sub.rating) && sub.rating >= 1 && sub.rating <= 5,
    );
    const skippedInvalid = total - validRated.length;

    if (total === 0) {
      res.json({
        total: 0,
        averageRating: null,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        byProcedure: {},
        skippedInvalid: 0,
        quotes: [],
      });
      return;
    }

    const ratingSum = validRated.reduce((s, sub) => s + sub.rating, 0);
    const averageRating = validRated.length > 0
      ? Math.round((ratingSum / validRated.length) * 10) / 10
      : null;

    const ratingDistribution: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const sub of validRated) {
      const r = String(sub.rating);
      if (r in ratingDistribution) ratingDistribution[r]++;
    }

    // Count all procedures dynamically (not just the hardcoded three)
    const byProcedure: Record<string, number> = {};
    for (const sub of submissions) {
      if (typeof sub.procedure === "string") {
        byProcedure[sub.procedure] = (byProcedure[sub.procedure] ?? 0) + 1;
      }
    }

    const eligible = submissions.filter(
      (sub) =>
        sub.shareQuote === true &&
        sub.quoteApproved === true &&
        typeof sub.experience === "string" &&
        sub.experience.trim().length >= 20 &&
        // Public quotes must not expose legacy/corrupt ratings excluded from the aggregates.
        typeof sub.rating === "number" &&
        Number.isInteger(sub.rating) &&
        sub.rating >= 1 &&
        sub.rating <= 5,
    );
    eligible.sort((a, b) => {
      if (a.featured === true && b.featured !== true) return -1;
      if (b.featured === true && a.featured !== true) return 1;
      return a.submittedAt.localeCompare(b.submittedAt);
    });
    const quotes = eligible.slice(0, 6).map((sub) => ({
      text: sub.experience.trim(),
      procedure: sub.procedure,
      rating: sub.rating,
      featured: sub.featured === true,
    }));

    res.json({ total, averageRating, ratingDistribution, byProcedure, skippedInvalid, quotes });
  } catch {
    res.status(500).json({ error: "Failed to compute stats" });
  }
});

// ── Admin: submissions ───────────────────────────────────────────────────────

router.get("/admin/patient-postop", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(settingsTable)
    .where(like(settingsTable.key, `${POSTOP_PREFIX}%`));
  const submissions = rows
    .map((r) => {
      try { return JSON.parse(r.value); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  res.json(submissions);
});

// Admin-only diagnostics intentionally expose only the setting keys for rows
// whose JSON cannot be parsed. The stored value may contain patient data and
// must never be returned as part of a diagnostic response.
router.get("/admin/patient-postop-diagnostics", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(settingsTable)
    .where(like(settingsTable.key, `${POSTOP_PREFIX}%`));

  const submissions: any[] = [];
  const unreadable: Array<{ key: string; reason: "invalid_json" }> = [];

  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value);
      if (parsed) submissions.push(parsed);
    } catch {
      unreadable.push({ key: row.key, reason: "invalid_json" });
    }
  }

  submissions.sort((a: any, b: any) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  res.json({
    submissions,
    unreadableCount: unreadable.length,
    unreadable,
  });
});

router.post("/admin/patient-postop-recovery/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (typeof id !== "string") {
    res.status(400).json({ error: "Invalid submission id" });
    return;
  }
  const dbKey = `${POSTOP_PREFIX}${id}`;
  const { verifiedBackup, submission } = req.body as {
    verifiedBackup?: unknown;
    submission?: unknown;
  };

  if (verifiedBackup !== true) {
    res.status(400).json({ error: "verifiedBackup must be true" });
    return;
  }
  if (!isValidRecoverySubmission(submission, id)) {
    res.status(400).json({ error: "Invalid replacement submission" });
    return;
  }

  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, dbKey));
  if (rows.length === 0) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  try {
    JSON.parse(rows[0].value);
    res.status(409).json({ error: "Submission is readable and cannot be replaced through recovery" });
    return;
  } catch {
    // Recovery is intentionally restricted to records confirmed as unreadable.
  }

  const repairedAt = new Date();
  await db
    .update(settingsTable)
    .set({ value: JSON.stringify(submission), updatedAt: repairedAt })
    .where(eq(settingsTable.key, dbKey));
  await db.insert(settingsTable).values({
    key: `${POSTOP_REPAIR_AUDIT_PREFIX}${repairedAt.getTime()}_${id}`,
    value: JSON.stringify({
      action: "postop_submission_recovered",
      submissionKey: dbKey,
      repairedAt: repairedAt.toISOString(),
      source: "verified_backup",
    }),
  });

  res.json({ message: "Submission restored", id });
});

router.patch("/admin/patient-postop/:id", requireAdmin, async (req, res) => {
  const { approved, rating } = req.body as { approved?: unknown; rating?: unknown };

  const hasApproved = approved !== undefined;
  const hasRating = rating !== undefined;
  if (!hasApproved && !hasRating) {
    res.status(400).json({ error: "approved (boolean) or rating (integer 1–5) is required" });
    return;
  }
  if (hasApproved && typeof approved !== "boolean") {
    res.status(400).json({ error: "approved must be a boolean" });
    return;
  }
  if (hasRating && (typeof rating !== "number" || !Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5)) {
    res.status(400).json({ error: "rating must be an integer between 1 and 5" });
    return;
  }

  const dbKey = `${POSTOP_PREFIX}${req.params.id}`;
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, dbKey));
  if (rows.length === 0) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rows[0].value);
  } catch {
    res.status(500).json({ error: "Corrupt submission data" });
    return;
  }

  if (hasRating) {
    parsed.rating = rating;
    await db
      .update(settingsTable)
      .set({ value: JSON.stringify(parsed), updatedAt: new Date() })
      .where(eq(settingsTable.key, dbKey));
    res.json({ message: "Rating corrected", id: req.params.id, rating });
    return;
  }

  if (!parsed.shareQuote) {
    res.status(400).json({ error: "This submission has no quote to approve" });
    return;
  }
  parsed.quoteApproved = approved;
  await db
    .update(settingsTable)
    .set({ value: JSON.stringify(parsed), updatedAt: new Date() })
    .where(eq(settingsTable.key, dbKey));
  res.json({ message: approved ? "Quote approved" : "Quote rejected", id: req.params.id, quoteApproved: approved });
});

router.delete("/admin/patient-postop/:id", requireAdmin, async (req, res) => {
  const dbKey = `${POSTOP_PREFIX}${req.params.id}`;
  await db.delete(settingsTable).where(eq(settingsTable.key, dbKey));
  res.json({ message: "Deleted" });
});

// ── Admin: form config ───────────────────────────────────────────────────────

router.get("/admin/patient-postop-form-config", requireAdmin, async (_req, res) => {
  const config = await getPostopFormConfig();
  res.json(config);
});

router.put("/admin/patient-postop-form-config", requireAdmin, async (req, res) => {
  const body = req.body as Partial<PostopFormConfig>;
  if (
    !Array.isArray(body.procedures) ||
    !Array.isArray(body.ageRanges) ||
    !Array.isArray(body.genders) ||
    !Array.isArray(body.occupations) ||
    !Array.isArray(body.diseases) ||
    typeof body.visibleSections !== "object"
  ) {
    res.status(400).json({ error: "Invalid form config structure" });
    return;
  }
  // Each keyed option must have key, labelDe, labelEn
  const allOptions = [...body.procedures, ...body.genders, ...body.occupations, ...body.diseases];
  for (const opt of allOptions) {
    const o = opt as Record<string, unknown>;
    if (typeof o.key !== "string" || !o.key || typeof o.labelDe !== "string") {
      res.status(400).json({ error: "Each option must have key (string) and labelDe (string)" });
      return;
    }
  }
  const previousConfig = await getPostopFormConfig();
  await archiveRemovedProcedureLabels(previousConfig.procedures, body.procedures as PostopProcedure[]);
  const value = JSON.stringify(body);
  await db
    .insert(settingsTable)
    .values({ key: POSTOP_FORM_CONFIG_KEY, value })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value, updatedAt: new Date() },
    });
  res.json({ ok: true });
});

export default router;

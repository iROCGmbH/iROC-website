import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { pageContentTable, settingsTable } from "@workspace/db";
import { eq, inArray, ne } from "drizzle-orm";
import { requireAdmin } from "./admin-auth.js";
import { SPIRECUT_SEED } from "../data/spirecut-seed.js";
import { IROC_SEED } from "../data/iroc-seed.js";

const router: IRouter = Router();

// ── Seed lookup maps ───────────────────────────────────────────────────────────

const IROC_DEFAULTS = new Map(IROC_SEED.map((r) => [r.key, { de: r.de, en: r.en }]));
const SPIRECUT_DEFAULTS = new Map(SPIRECUT_SEED.map((r) => [r.key, { de: r.de, en: r.en }]));
const IROC_SEED_ORDER = new Map(IROC_SEED.map((row, index) => [row.key, index]));

function getSeedDefaults(site: "iroc" | "spirecut") {
  return site === "iroc" ? IROC_DEFAULTS : SPIRECUT_DEFAULTS;
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

let seeded = { iroc: false, spirecut: false };
const IROC_AGB_REVISION_KEY = "iroc_agb_revision";
const IROC_AGB_REVISION = "2026-09-04";

/**
 * Claims a changed legal-text revision and applies its migration once. The
 * conditional upsert returns a row only for the request that inserts or changes
 * the revision; equal revisions leave administrator edits untouched.
 */
async function normalizeIrocAgb() {
  const agbSeeds = IROC_SEED.filter((row) => row.page === "agb");
  const canonicalKeys = new Set(agbSeeds.map((row) => row.key));

  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(settingsTable)
      .values({ key: IROC_AGB_REVISION_KEY, value: IROC_AGB_REVISION })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: IROC_AGB_REVISION, updatedAt: new Date() },
        where: ne(settingsTable.value, IROC_AGB_REVISION),
      })
      .returning({ key: settingsTable.key });
    if (claimed.length === 0) return;

    const existing = await tx
      .select({ key: pageContentTable.key })
      .from(pageContentTable)
      .where(eq(pageContentTable.site, "iroc"));
    const obsoleteKeys = existing
      .map((row) => row.key)
      .filter((key) => key.startsWith("iroc.agb.s") && !key.includes(".custom_") && !canonicalKeys.has(key));

    if (obsoleteKeys.length > 0) {
      await tx.delete(pageContentTable).where(inArray(pageContentTable.key, obsoleteKeys));
    }
    for (const row of agbSeeds) {
      await tx.insert(pageContentTable).values({
        key: row.key,
        site: "iroc",
        page: row.page,
        label: row.label,
        de: row.de,
        en: row.en,
      }).onConflictDoUpdate({
        target: pageContentTable.key,
        set: { page: row.page, label: row.label, de: row.de, en: row.en, updatedAt: new Date() },
      });
    }
  });
}

async function seedSiteIfEmpty(site: "iroc" | "spirecut") {
  if (seeded[site]) return;
  const rows = site === "spirecut" ? SPIRECUT_SEED : IROC_SEED;

  // Get all existing keys so we can insert only the ones that are missing.
  // This is safe to run on every cold start — onConflictDoNothing guards duplicates.
  const existing = await db
    .select({ key: pageContentTable.key })
    .from(pageContentTable)
    .where(eq(pageContentTable.site, site));

  const existingKeys = new Set(existing.map((r) => r.key));
  const missing = rows.filter((r) => !existingKeys.has(r.key));

  if (missing.length > 0) {
    for (let i = 0; i < missing.length; i += 50) {
      const batch = missing.slice(i, i + 50);
      await db.insert(pageContentTable).values(
        batch.map((r) => ({
          key: r.key,
          site,
          page: r.page,
          label: r.label,
          de: r.de,
          en: r.en,
        }))
      ).onConflictDoNothing();
    }
  }
  if (site === "iroc") await normalizeIrocAgb();
  seeded[site] = true;
}

// ── GET /api/content/:site ─────────────────────────────────────────────────────
// Public endpoint. Returns { [key]: { de, en, label, page, seedDe, seedEn } }
router.get("/content/:site", async (req, res) => {
  const site = req.params.site as "iroc" | "spirecut";
  if (site !== "iroc" && site !== "spirecut") {
    res.status(400).json({ error: "Invalid site" });
    return;
  }

  await seedSiteIfEmpty(site);

  const rows = await db
    .select()
    .from(pageContentTable)
    .where(eq(pageContentTable.site, site));
  if (site === "iroc") {
    rows.sort((a, b) => (IROC_SEED_ORDER.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (IROC_SEED_ORDER.get(b.key) ?? Number.MAX_SAFE_INTEGER));
  }

  const defaults = getSeedDefaults(site);
  const result: Record<string, { de: string; en: string; label: string; page: string; seedDe: string; seedEn: string }> = {};
  for (const row of rows) {
    const seed = defaults.get(row.key);
    result[row.key] = {
      de: row.de,
      en: row.en,
      label: row.label,
      page: row.page,
      seedDe: seed?.de ?? row.de,
      seedEn: seed?.en ?? row.en,
    };
  }

  res.setHeader("Cache-Control", "public, max-age=30");
  res.json(result);
});

// ── POST /admin/content ────────────────────────────────────────────────────────
// Protected. Body: { updates: [{ key, de, en }] }
router.post("/admin/content", requireAdmin, async (req, res) => {
  const { updates } = req.body as {
    updates: { key: string; de: string; en: string }[];
  };

  if (!Array.isArray(updates) || updates.length === 0) {
    res.status(400).json({ error: "updates must be a non-empty array" });
    return;
  }

  // A content row must always retain both translations. The client prevents
  // this state through disabled save controls, but enforce it at the API too.
  const emptyField = updates.filter((u) => !u.de?.trim() || !u.en?.trim());
  if (emptyField.length > 0) {
    res.status(400).json({
      error: `DE and EN must not be empty. Affected keys: ${emptyField.map((u) => u.key).join(", ")}`,
    });
    return;
  }

  // Validate all keys exist in the DB
  const keys = updates.map((u) => u.key);
  const existing = await db
    .select({ key: pageContentTable.key })
    .from(pageContentTable)
    .where(inArray(pageContentTable.key, keys));

  const existingKeys = new Set(existing.map((r) => r.key));
  const invalid = keys.filter((k) => !existingKeys.has(k));
  if (invalid.length > 0) {
    res.status(400).json({ error: `Unknown keys: ${invalid.join(", ")}` });
    return;
  }

  // Apply updates one by one (or use a transaction)
  await db.transaction(async (tx) => {
    for (const { key, de, en } of updates) {
      await tx
        .update(pageContentTable)
        .set({ de: de.trim(), en: en.trim(), updatedAt: new Date() })
        .where(eq(pageContentTable.key, key));
    }
  });

  res.json({ ok: true, updated: updates.length });
});

// ── POST /admin/content/new-entry ─────────────────────────────────────────────
// Protected. Creates a brand-new page_content row (for admin-added sections).
router.post("/admin/content/new-entry", requireAdmin, async (req, res) => {
  const { site, page, type, label, de, en } = req.body as {
    site: string; page: string; type: "heading" | "paragraph"; label: string; de: string; en: string;
  };

  if (!site || !page || !type || !de?.trim() || !(en ?? "").trim()) {
    res.status(400).json({ error: "site, page, type, de and en are required and must not be empty" });
    return;
  }

  // Generate a time-ordered unique key: iroc.impressum.custom_h_20260801120000
  const ts = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const typeSlug = type === "heading" ? "h" : "p";
  const key = `${site}.${page}.custom_${typeSlug}_${ts}`;

  await db.insert(pageContentTable).values({
    key,
    site,
    page,
    label: label?.trim() || de.trim().slice(0, 80),
    de: de.trim(),
    en: (en ?? "").trim(),
  });

  res.json({ ok: true, key, page, type, de: de.trim(), en: (en ?? "").trim() });
});

// ── POST /admin/content/bulk-reset ────────────────────────────────────────────
// Protected. Resets multiple seeded keys to their seed defaults in one request.
// Body: { keys: string[] }
// Returns: { results: [{ key, de, en }] }
router.post("/admin/content/bulk-reset", requireAdmin, async (req, res) => {
  const { keys } = req.body as { keys: string[] };
  if (!Array.isArray(keys) || keys.length === 0) {
    res.status(400).json({ error: "keys must be a non-empty array" });
    return;
  }

  const results: { key: string; de: string; en: string }[] = [];

  await db.transaction(async (tx) => {
    for (const key of keys) {
      const seed = IROC_DEFAULTS.get(key) ?? SPIRECUT_DEFAULTS.get(key);
      if (!seed) continue; // skip custom entries — they have no seed default

      await tx
        .update(pageContentTable)
        .set({ de: seed.de, en: seed.en, updatedAt: new Date() })
        .where(eq(pageContentTable.key, key));

      results.push({ key, de: seed.de, en: seed.en });
    }
  });

  res.json({ ok: true, results });
});

// ── DELETE /admin/content/:key ─────────────────────────────────────────────────
// Protected. For seeded keys: resets to seed default. For custom keys: deletes the row.
router.delete("/admin/content/:key", requireAdmin, async (req, res) => {
  const key = String(req.params.key);

  // Custom entries have no seed default — delete them entirely
  const seed = IROC_DEFAULTS.get(key) ?? SPIRECUT_DEFAULTS.get(key);
  if (!seed) {
    const deleted = await db
      .delete(pageContentTable)
      .where(eq(pageContentTable.key, key))
      .returning({ key: pageContentTable.key });
    if (deleted.length === 0) {
      res.status(404).json({ error: `Key not found: ${key}` });
      return;
    }
    res.json({ ok: true, key, deleted: true });
    return;
  }

  // Seeded entry: reset to default
  const existing = await db
    .select({ key: pageContentTable.key })
    .from(pageContentTable)
    .where(eq(pageContentTable.key, key))
    .limit(1);

  if (existing.length === 0) {
    res.status(404).json({ error: `Key not found: ${key}` });
    return;
  }

  await db
    .update(pageContentTable)
    .set({ de: seed.de, en: seed.en, updatedAt: new Date() })
    .where(eq(pageContentTable.key, key));

  res.json({ ok: true, key, de: seed.de, en: seed.en });
});

export default router;

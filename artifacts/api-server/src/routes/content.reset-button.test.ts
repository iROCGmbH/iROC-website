/**
 * content.ts — Reset-to-default endpoint tests (Task #161)
 *
 * Confirms the DELETE /admin/content/:key endpoint:
 *
 *  1. Resets an overridden seeded key back to its seed default values and
 *     returns { de, en } matching the seed so the frontend can update
 *     local state and hide the Reset button.
 *  2. The response body.de === seedDe after reset, making isOverridden()
 *     return false in the frontend.
 *  3. Returns 404 when the key does not exist in the DB.
 *  4. Deletes a custom (non-seeded) entry entirely and returns { deleted: true }.
 *
 * Strategy: shared in-memory maps simulate the page_content table. The db mock
 * builds a fully chainable select/from/where/limit chain so the route's
 * `db.select().from().where().limit()` call resolves correctly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── In-memory DB ──────────────────────────────────────────────────────────────

type Row = { key: string; site: string; page: string; label: string; de: string; en: string };

const { dbStore } = vi.hoisted(() => {
  const dbStore = new Map<string, Row>();
  return { dbStore };
});

// ── Seed mocks ────────────────────────────────────────────────────────────────

vi.mock("../data/iroc-seed.js", () => ({
  IROC_SEED: [
    {
      key: "iroc.home.hero_title",
      page: "home",
      site: "iroc",
      label: "Hero Title",
      de: "Willkommen bei iROC",
      en: "Welcome to iROC",
    },
  ],
}));

vi.mock("../data/spirecut-seed.js", () => ({
  SPIRECUT_SEED: [
    {
      key: "spirecut.home.hero_title",
      page: "home",
      site: "spirecut",
      label: "Hero Title",
      de: "Ihre Hand. Ihre Gesundheit.",
      en: "Your Hand. Your Health.",
    },
  ],
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
//
// Builds a chainable select → from → where → limit chain that resolves
// rows from the shared dbStore. The route uses:
//   db.select({...}).from(table).where(cond).limit(1)
//   db.update(table).set({...}).where(cond)
//   db.delete(table).where(cond).returning({...})

vi.mock("@workspace/db", () => {
  /**
   * Build a query chain where:
   *   .from(table) → { where, limit }
   *   .where(cond) → { limit }    — resolves full store if no where filter applied
   *   .limit(n)    → Promise<Row[]>
   *
   * Since we cannot introspect the drizzle condition object, we return all rows
   * from the store and rely on test setup to populate only the relevant keys.
   */
  function makeSelectChain() {
    const allRows = () => Array.from(dbStore.values());

    const limitFn = (rows: Row[]) => (n: number) =>
      Promise.resolve(rows.slice(0, n));

    const whereFn = (rows: Row[]) => (_cond: unknown) => {
      const result = rows;
      return {
        limit: limitFn(result),
        // allow chaining .where().where() if needed
        where: whereFn(result),
      };
    };

    return {
      from: (_table: unknown) => ({
        where: whereFn(allRows()),
        limit: limitFn(allRows()),
      }),
    };
  }

  const db = {
    select: vi.fn((_fields?: unknown) => makeSelectChain()),

    update: vi.fn((_table: unknown) => ({
      set: vi.fn((fields: { de?: string; en?: string; updatedAt?: Date }) => ({
        where: vi.fn((_cond: unknown) => {
          // Apply the set fields to all rows currently in the store.
          // (In real usage the where clause targets one key; since tests populate
          // only the relevant key we can safely update all rows.)
          for (const [k, row] of dbStore.entries()) {
            dbStore.set(k, {
              ...row,
              ...(fields.de !== undefined ? { de: fields.de } : {}),
              ...(fields.en !== undefined ? { en: fields.en } : {}),
            });
          }
          return Promise.resolve([]);
        }),
      })),
    })),

    delete: vi.fn((_table: unknown) => ({
      where: vi.fn((_cond: unknown) => ({
        returning: vi.fn((_fields: unknown) => {
          // Return all current rows as "deleted" rows
          const deleted = Array.from(dbStore.values()).map((r) => ({ key: r.key }));
          dbStore.clear();
          return Promise.resolve(deleted);
        }),
      })),
    })),

    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => Promise.resolve(undefined)),
      })),
    })),

    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });
    }),
  };

  return {
    db,
    pageContentTable: {
      key: "key",
      site: "site",
      page: "page",
      label: "label",
      de: "de",
      en: "en",
    },
  };
});

// ── Auth mock ─────────────────────────────────────────────────────────────────

vi.mock("./admin-auth.js", () => ({
  requireAdmin: (
    req: { headers: Record<string, string> },
    res: { status: (n: number) => { json: (o: unknown) => void } },
    next: () => void
  ) => {
    if (req.headers.authorization === "Bearer test-token") {
      next();
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  },
}));

import app from "../app";

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedRow(key: string, site: string, page: string, de: string, en: string) {
  dbStore.set(key, { key, site, page, label: key.split(".").pop() ?? key, de, en });
}

beforeEach(() => {
  dbStore.clear();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DELETE /api/admin/content/:key — reset to seed default", () => {

  // ── Scenario 1: seeded iROC key overridden → reset returns seed values ─────

  it("returns seed de/en after resetting an overridden iROC key", async () => {
    seedRow(
      "iroc.home.hero_title",
      "iroc",
      "home",
      "Herzlich Willkommen bei iROC GmbH",  // overridden
      "Welcome to iROC GmbH"                 // overridden
    );

    const res = await request(app)
      .delete("/api/admin/content/iroc.home.hero_title")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Response must carry seed values so the frontend can clear the Reset button
    expect(res.body.de).toBe("Willkommen bei iROC");
    expect(res.body.en).toBe("Welcome to iROC");
  });

  // ── Scenario 2: seeded Spirecut key → reset returns seed values ───────────

  it("returns seed de/en after resetting an overridden Spirecut key", async () => {
    seedRow(
      "spirecut.home.hero_title",
      "spirecut",
      "home",
      "Ihre Hand in guten Händen",   // overridden
      "Your Hand in good hands"       // overridden
    );

    const res = await request(app)
      .delete("/api/admin/content/spirecut.home.hero_title")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.de).toBe("Ihre Hand. Ihre Gesundheit.");
    expect(res.body.en).toBe("Your Hand. Your Health.");
  });

  // ── Scenario 3: unknown key → 404 ─────────────────────────────────────────

  it("returns 404 when the key does not exist in the DB", async () => {
    // dbStore is empty — no row for this key; it's also not a known seed key
    const res = await request(app)
      .delete("/api/admin/content/iroc.home.nonexistent_key_zzz")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  // ── Scenario 4: custom entry → deleted entirely ───────────────────────────

  it("deletes a custom entry (not in seed) entirely and returns deleted: true", async () => {
    const customKey = "iroc.impressum.custom_p_20260801120000";
    seedRow(customKey, "iroc", "impressum", "Custom paragraph text.", "Custom paragraph text.");

    const res = await request(app)
      .delete(`/api/admin/content/${encodeURIComponent(customKey)}`)
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.deleted).toBe(true);
    // No de/en in the response (row was deleted, not reset)
    expect(res.body.de).toBeUndefined();
  });

  // ── Scenario 5: response contract guarantees isOverridden = false ──────────

  it("ensures reset response de/en match the seed so isOverridden becomes false in the frontend", async () => {
    // This test validates the contract the frontend depends on.
    // After DELETE, the body must satisfy:
    //   data.de === seedDe  AND  data.en === seedEn
    // so the frontend's setContent(... seedDe: data.de, seedEn: data.en ...)
    // makes isOverridden() return false and hides the Reset button.

    seedRow(
      "iroc.home.hero_title",
      "iroc",
      "home",
      "Admin modified title",
      "Admin modified title EN"
    );

    const res = await request(app)
      .delete("/api/admin/content/iroc.home.hero_title")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);

    const data = res.body as { de: string; en: string };

    // Simulate what the frontend does after receiving this response:
    //   content[key] = { ...prev[key], de: data.de, en: data.en,
    //                    seedDe: data.de, seedEn: data.en }
    const simulatedEntry = {
      de: data.de,
      en: data.en,
      seedDe: data.de,   // frontend sets seedDe = data.de
      seedEn: data.en,   // frontend sets seedEn = data.en
    };

    // isOverridden() = de !== seedDe || en !== seedEn
    const isOverridden =
      simulatedEntry.de !== simulatedEntry.seedDe ||
      simulatedEntry.en !== simulatedEntry.seedEn;

    expect(isOverridden).toBe(false); // Reset button must disappear

    // The response values must be the actual seed defaults
    expect(data.de).toBe("Willkommen bei iROC");
    expect(data.en).toBe("Welcome to iROC");
  });
});

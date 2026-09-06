/**
 * content.ts — blank-language save validation tests.
 *
 * Confirms that POST /api/admin/content rejects an update where either
 * language field is blank, leaving the existing content untouched.
 *
 *  1. Blank DE field is rejected.
 *  2. Blank EN field is rejected.
 *  3. Both fields blank are rejected.
 *  4. Non-empty request still saves normally.
 *  5. A rejected blank-DE request leaves both stored values intact.
 *  6. A rejected blank-EN request leaves both stored values intact.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── In-memory DB ──────────────────────────────────────────────────────────────

type Row = { key: string; site: string; page: string; label: string; de: string; en: string };

const { dbStore, capturedUpdates } = vi.hoisted(() => {
  const dbStore = new Map<string, Row>();
  const capturedUpdates: { de: string; en: string }[] = [];
  return { dbStore, capturedUpdates };
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
// The POST /api/admin/content route:
//   1. db.select({ key }).from(table).where(inArray(...))  — returns Row[] (no .limit())
//   2. db.transaction(async tx => { tx.update(table).set({...}).where(...) })
//
// The select chain must be a Promise<Row[]> that also exposes .where() and .limit()
// so both the POST (no-limit) and other routes (with-limit) work.

vi.mock("@workspace/db", () => {
  function makeSelectResult(rows: Row[]) {
    // A Promise<Row[]> that also has .where() and .limit() chainable methods
    const p = Promise.resolve(rows) as Promise<Row[]> & {
      where: (cond: unknown) => ReturnType<typeof makeSelectResult>;
      limit: (n: number) => Promise<Row[]>;
    };
    p.where = (_cond: unknown) => makeSelectResult(rows);
    p.limit = (n: number) => Promise.resolve(rows.slice(0, n));
    return p;
  }

  function makeFromResult() {
    const allRows = () => Array.from(dbStore.values());
    return {
      where: (_cond: unknown) => makeSelectResult(allRows()),
      limit: (n: number) => Promise.resolve(allRows().slice(0, n)),
    };
  }

  const db = {
    select: vi.fn((_fields?: unknown) => ({
      from: (_table: unknown) => makeFromResult(),
    })),

    update: vi.fn((_table: unknown) => ({
      set: vi.fn((fields: { de?: string; en?: string; updatedAt?: Date }) => ({
        where: vi.fn((_cond: unknown) => {
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
        update: vi.fn((_table: unknown) => ({
          set: vi.fn((fields: { de?: string; en?: string; updatedAt?: Date }) => ({
            where: vi.fn((_cond: unknown) => {
              capturedUpdates.push({ de: fields.de ?? "", en: fields.en ?? "" });
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
      });
    }),
  };

  // Export all symbols the route imports (eq, inArray return opaque values used
  // only as arguments to the mock's where(), which ignores them).
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
    eq: vi.fn((_col: unknown, _val: unknown) => Symbol("eq")),
    inArray: vi.fn((_col: unknown, _vals: unknown) => Symbol("inArray")),
    // Provide stubs for any other table symbols referenced by transitively-loaded
    // routes (geocode.ts, doctors.ts, etc.).  An empty object is fine — the
    // test only exercises content.ts routes.
    trainedDoctorsTable: {},
    irocInvoiceTable: {},
    irocCustomerTable: {},
    irocCustomerItemTable: {},
    websiteCustomerTable: {},
    pageContentTable2: {},
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
  capturedUpdates.length = 0;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/admin/content — blank language field validation", () => {
  // ── Scenario 1: blank DE field rejected ────────────────────────────────────

  it("returns 400 when DE is blank (empty string)", async () => {
    seedRow("iroc.home.hero_title", "iroc", "home", "Willkommen bei iROC", "Welcome to iROC");

    const res = await request(app)
      .post("/api/admin/content")
      .set("Authorization", "Bearer test-token")
      .send({
        updates: [{ key: "iroc.home.hero_title", de: "", en: "Welcome to iROC" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DE and EN must not be empty/i);
    expect(capturedUpdates).toHaveLength(0);
  });

  // ── Scenario 2: blank EN field rejected ────────────────────────────────────

  it("returns 400 when EN is blank (empty string)", async () => {
    seedRow("iroc.home.hero_title", "iroc", "home", "Willkommen bei iROC", "Welcome to iROC");

    const res = await request(app)
      .post("/api/admin/content")
      .set("Authorization", "Bearer test-token")
      .send({
        updates: [{ key: "iroc.home.hero_title", de: "Willkommen bei iROC", en: "" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DE and EN must not be empty/i);
    expect(capturedUpdates).toHaveLength(0);
  });

  // ── Scenario 3: both fields blank rejected ─────────────────────────────────

  it("returns 400 when both DE and EN are blank", async () => {
    seedRow("iroc.home.hero_title", "iroc", "home", "Willkommen", "Welcome");

    const res = await request(app)
      .post("/api/admin/content")
      .set("Authorization", "Bearer test-token")
      .send({
        updates: [{ key: "iroc.home.hero_title", de: "", en: "" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DE and EN must not be empty/i);
    expect(capturedUpdates).toHaveLength(0);
  });

  // ── Scenario 4: non-empty save still works normally ─────────────────────────

  it("saves non-empty DE and EN values normally", async () => {
    seedRow("iroc.home.hero_title", "iroc", "home", "Willkommen bei iROC", "Welcome to iROC");

    const res = await request(app)
      .post("/api/admin/content")
      .set("Authorization", "Bearer test-token")
      .send({
        updates: [
          { key: "iroc.home.hero_title", de: "Geänderte Überschrift", en: "Changed Heading" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const written = capturedUpdates[capturedUpdates.length - 1];
    expect(written.de).toBe("Geänderte Überschrift");
    expect(written.en).toBe("Changed Heading");
  });

  // ── Scenario 5: rejected blank-DE does not overwrite EN ────────────────────

  it("leaves both values intact when DE is blank", async () => {
    const originalDe = "Eigener deutscher Text";
    const originalEn = "Custom English text that must survive";
    seedRow("iroc.home.hero_title", "iroc", "home", originalDe, originalEn);

    const res = await request(app)
      .post("/api/admin/content")
      .set("Authorization", "Bearer test-token")
      .send({
        updates: [{ key: "iroc.home.hero_title", de: "", en: "New English text" }],
      });

    expect(res.status).toBe(400);
    expect(dbStore.get("iroc.home.hero_title")).toMatchObject({ de: originalDe, en: originalEn });
    expect(capturedUpdates).toHaveLength(0);
  });

  // ── Scenario 6: rejected blank-EN does not overwrite DE ────────────────────

  it("leaves both values intact when EN is blank", async () => {
    const originalDe = "Eigener deutscher Text";
    const originalEn = "Custom English text that must survive";
    seedRow("iroc.home.hero_title", "iroc", "home", originalDe, originalEn);

    const res = await request(app)
      .post("/api/admin/content")
      .set("Authorization", "Bearer test-token")
      .send({
        updates: [{ key: "iroc.home.hero_title", de: "Neuer deutscher Text", en: "" }],
      });

    expect(res.status).toBe(400);
    expect(dbStore.get("iroc.home.hero_title")).toMatchObject({ de: originalDe, en: originalEn });
    expect(capturedUpdates).toHaveLength(0);
  });
});

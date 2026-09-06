/**
 * content.ts — bulk reset regression test.
 *
 * Confirms that POST /api/admin/content/bulk-reset restores every seeded key
 * in a batch, including rows whose persisted German value is empty.
 *
 * The content-save endpoint intentionally rejects blank translations. The test
 * therefore saves valid temporary overrides first, then models a legacy empty
 * DE value in the database before invoking bulk-reset.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

type Row = {
  key: string;
  site: string;
  page: string;
  label: string;
  de: string;
  en: string;
};

const { dbStore, seedRows } = vi.hoisted(() => ({
  dbStore: new Map<string, Row>(),
  seedRows: [
    {
      key: "iroc.home.hero_title",
      site: "iroc",
      page: "home",
      label: "Hero Title",
      de: "Willkommen bei iROC",
      en: "Welcome to iROC",
    },
    {
      key: "iroc.home.portfolio_title",
      site: "iroc",
      page: "home",
      label: "Portfolio Title",
      de: "Unser Portfolio",
      en: "Our Portfolio",
    },
    {
      key: "spirecut.home.hero_title",
      site: "spirecut",
      page: "home",
      label: "Hero Title",
      de: "Ihre Hand. Ihre Gesundheit.",
      en: "Your Hand. Your Health.",
    },
  ],
}));

const SEED_ROWS = seedRows;

vi.mock("../data/iroc-seed.js", () => ({
  IROC_SEED: seedRows.filter((row) => row.site === "iroc"),
}));

vi.mock("../data/spirecut-seed.js", () => ({
  SPIRECUT_SEED: seedRows.filter((row) => row.site === "spirecut"),
}));

vi.mock("@workspace/db", () => {
  const seedByDe = new Map(seedRows.map((row) => [row.de, row.key]));

  function makeSelectResult(rows: Row[]) {
    const result = Promise.resolve(rows) as Promise<Row[]> & {
      where: (condition: unknown) => ReturnType<typeof makeSelectResult>;
      limit: (count: number) => Promise<Row[]>;
    };
    result.where = (_condition: unknown) => makeSelectResult(rows);
    result.limit = (count: number) => Promise.resolve(rows.slice(0, count));
    return result;
  }

  function updateRows(fields: { de?: string; en?: string }) {
    const targetKey = fields.de ? seedByDe.get(fields.de) : undefined;
    for (const [key, row] of dbStore.entries()) {
      if (targetKey && key !== targetKey) continue;
      dbStore.set(key, {
        ...row,
        ...(fields.de !== undefined ? { de: fields.de } : {}),
        ...(fields.en !== undefined ? { en: fields.en } : {}),
      });
    }
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => makeSelectResult(Array.from(dbStore.values()))),
        limit: vi.fn((count: number) =>
          Promise.resolve(Array.from(dbStore.values()).slice(0, count)),
        ),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((fields: { de?: string; en?: string }) => ({
        where: vi.fn(() => {
          updateRows(fields);
          return Promise.resolve([]);
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([])),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => Promise.resolve(undefined)),
      })),
    })),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) => {
      await callback({
        update: vi.fn(() => ({
          set: vi.fn((fields: { de?: string; en?: string }) => ({
            where: vi.fn(() => {
              updateRows(fields);
              return Promise.resolve([]);
            }),
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
    trainedDoctorsTable: {},
    irocInvoiceTable: {},
    irocCustomerTable: {},
    irocCustomerItemTable: {},
    websiteCustomerTable: {},
    pageContentTable2: {},
  };
});

vi.mock("./admin-auth.js", () => ({
  requireAdmin: (
    req: { headers: Record<string, string> },
    res: { status: (status: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    if (req.headers.authorization === "Bearer test-token") {
      next();
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  },
}));

import app from "../app";

function seedRow(row: (typeof SEED_ROWS)[number]) {
  dbStore.set(row.key, { ...row });
}

async function saveContent(updates: { key: string; de: string; en: string }[]) {
  return request(app)
    .post("/api/admin/content")
    .set("Authorization", "Bearer test-token")
    .send({ updates });
}

beforeEach(() => {
  dbStore.clear();
  for (const row of SEED_ROWS) seedRow(row);
});

describe("POST /api/admin/content/bulk-reset", () => {
  it("restores non-empty DE/EN seeds for every key whose DE was empty", async () => {
    const keys = SEED_ROWS.map((row) => row.key);

    const saveResult = await saveContent(
      SEED_ROWS.map((row, index) => ({
        key: row.key,
        de: `Temporärer deutscher Text ${index}`,
        en: `Temporary English text ${index}`,
      })),
    );
    expect(saveResult.status).toBe(200);

    // Blank saves are rejected by the public admin contract. Model the
    // legacy empty-DE database state that bulk-reset must repair.
    for (const row of SEED_ROWS) {
      const current = dbStore.get(row.key);
      expect(current).toBeDefined();
      dbStore.set(row.key, { ...current!, de: "" });
      expect(dbStore.get(row.key)?.de).toBe("");
    }

    const resetResult = await request(app)
      .post("/api/admin/content/bulk-reset")
      .set("Authorization", "Bearer test-token")
      .send({ keys });

    expect(resetResult.status).toBe(200);
    expect(resetResult.body.ok).toBe(true);
    expect(resetResult.body.results).toHaveLength(SEED_ROWS.length);

    for (const expected of SEED_ROWS) {
      const responseEntry = resetResult.body.results.find(
        (entry: { key: string }) => entry.key === expected.key,
      );

      expect(responseEntry).toEqual({
        key: expected.key,
        de: expected.de,
        en: expected.en,
      });
      expect(responseEntry.de).toBeTruthy();
      expect(responseEntry.en).toBeTruthy();

      const storedEntry = dbStore.get(expected.key);
      expect(storedEntry?.de).toBe(expected.de);
      expect(storedEntry?.en).toBe(expected.en);
      expect(storedEntry?.de).not.toBe("");
    }
  });
});

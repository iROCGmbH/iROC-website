import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

type Row = { key: string; site: string; page: string; label: string; de: string; en: string };

const { content, settings, agbSeed } = vi.hoisted(() => ({
  content: new Map<string, Row>(),
  settings: new Map<string, string>(),
  agbSeed: [
    { key: "iroc.agb.s1_title", page: "agb", label: "1. Scope", de: "1. Geltung", en: "1. Scope" },
    { key: "iroc.agb.s5_p2_label", page: "agb", label: "5.2. Verbot", de: "5.2. Verbot", en: "5.2. Prohibition" },
    { key: "iroc.agb.s6_title", page: "agb", label: "6. Keine Rücknahmeverpflichtung", de: "6. Keine Rücknahmeverpflichtung", en: "6. No Repurchase Obligation" },
    { key: "iroc.agb.s10_title", page: "agb", label: "10. Salvatorische Klausel", de: "10. Salvatorische Klausel", en: "10. Severability Clause" },
  ],
}));

vi.mock("../data/iroc-seed.js", () => ({ IROC_SEED: agbSeed }));
vi.mock("../data/spirecut-seed.js", () => ({ SPIRECUT_SEED: [] }));
vi.mock("./admin-auth.js", () => ({ requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next() }));

vi.mock("@workspace/db", () => {
  const pageContentTable = { kind: "content", key: "key", site: "site", page: "page", label: "label", de: "de", en: "en" };
  const settingsTable = { kind: "settings", key: "key", value: "value" };
  const rows = () => Array.from(content.values());
  const select = () => ({
    from: () => ({
      where: () => Promise.resolve(rows()),
    }),
  });
  const insert = (table: typeof pageContentTable | typeof settingsTable) => ({
    values: (values: Row | Row[] | { key: string; value: string }) => {
      if (table === settingsTable) {
        const value = values as { key: string; value: string };
        return {
          onConflictDoUpdate: () => ({
            returning: () => {
              if (settings.get(value.key) === value.value) return Promise.resolve([]);
              settings.set(value.key, value.value);
              return Promise.resolve([{ key: value.key }]);
            },
          }),
        };
      }
      const input = Array.isArray(values) ? values : [values as Row];
      return {
        onConflictDoNothing: () => {
          for (const row of input) if (!content.has(row.key)) content.set(row.key, row);
          return Promise.resolve();
        },
        onConflictDoUpdate: () => {
          for (const row of input) content.set(row.key, row);
          return Promise.resolve();
        },
      };
    },
  });
  const deleteRows = () => ({
    where: () => {
      // The only obsolete row in this focused fixture is deliberately numbered.
      content.delete("iroc.agb.s99_title");
      return Promise.resolve();
    },
  });
  const db = {
    select,
    insert,
    delete: deleteRows,
    transaction: async (fn: (tx: any) => Promise<void>) => fn(db),
  };
  return { db, pageContentTable, settingsTable };
});

import app from "../app";

beforeEach(() => {
  content.clear();
  settings.clear();
  content.set("iroc.agb.s6_title", { key: "iroc.agb.s6_title", site: "iroc", page: "agb", label: "legacy", de: "Legacy warranty", en: "Legacy warranty" });
  content.set("iroc.agb.s99_title", { key: "iroc.agb.s99_title", site: "iroc", page: "agb", label: "obsolete", de: "obsolete", en: "obsolete" });
  content.set("iroc.agb.custom_h_20260904", { key: "iroc.agb.custom_h_20260904", site: "iroc", page: "agb", label: "custom", de: "Custom DE", en: "Custom EN" });
});

describe("GET /api/content/iroc AGB revision migration", () => {
  it("migrates legacy content once, preserves edits and custom rows, removes obsolete rows, and returns canonical order", async () => {
    const first = await request(app).get("/api/content/iroc");

    expect(first.status).toBe(200);
    expect(first.body["iroc.agb.s6_title"].de).toBe("6. Keine Rücknahmeverpflichtung");
    expect(first.body["iroc.agb.custom_h_20260904"].de).toBe("Custom DE");
    expect(first.body["iroc.agb.s99_title"]).toBeUndefined();
    expect(Object.keys(first.body)).toEqual([
      "iroc.agb.s1_title",
      "iroc.agb.s5_p2_label",
      "iroc.agb.s6_title",
      "iroc.agb.s10_title",
      "iroc.agb.custom_h_20260904",
    ]);

    content.set("iroc.agb.s6_title", { ...content.get("iroc.agb.s6_title")!, de: "Admin edit", en: "Admin edit" });
    const second = await request(app).get("/api/content/iroc");

    expect(second.body["iroc.agb.s6_title"].de).toBe("Admin edit");
    expect(settings.get("iroc_agb_revision")).toBe("2026-09-04");
  });
});
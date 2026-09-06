/**
 * website-settings-manufacturer-urls.test.ts — Task #423
 *
 * Confirms the manufacturer/company URL defaults (ws_spirecut_company_url and
 * ws_ministem_company_url) behave correctly across three cold-start scenarios:
 *
 *  1. No DB row for either key → GET returns the hardcoded defaults, so the
 *     /spirecut and /ministem pages render the "Visit website" button.
 *
 *  2. Admin saves a custom URL → GET returns the custom URL (override is live).
 *
 *  3. Admin sets the URL to empty string → GET returns "" (button is hidden).
 *     This is intentional: an explicit blank means the admin wants it hidden.
 *
 *  4. Admin deletes the DB row (key removed entirely) → GET reverts to the
 *     hardcoded default, NOT to an empty string, so the button reappears.
 *     The GET handler uses `db_map[key] !== undefined` so a missing key falls
 *     back to WS_DEFAULTS rather than producing "".
 *
 * Strategy: a shared in-memory Map simulates the `settings` table. Individual
 * tests manipulate it directly (set / delete) to simulate the DB state without
 * spinning up a real database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Stateful in-memory DB mock ────────────────────────────────────────────────
// vi.hoisted() runs before imports, so the mock is in place before
// @workspace/db is resolved.

const { store } = vi.hoisted(() => {
  const store = new Map<string, string>();

  // insert(table).values({ key, value }).onConflictDoUpdate(…)
  const mockOnConflictDoUpdate = vi.fn().mockImplementation(() =>
    Promise.resolve(undefined)
  );
  const mockValues = vi.fn().mockImplementation((row: { key: string; value: string }) => {
    store.set(row.key, row.value);
    return { onConflictDoUpdate: mockOnConflictDoUpdate };
  });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

  // select().from(table) — returns all rows currently in the store.
  const mockFrom = vi.fn().mockImplementation(() => {
    const rows = Array.from(store.entries()).map(([key, value]) => ({ key, value }));
    return Promise.resolve(rows);
  });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  return {
    store,
    mockInsert,
    mockSelect,
    mockOnConflictDoUpdate,
    mockValues,
    mockFrom,
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn().mockImplementation(() => {
      const mockOnConflictDoUpdate = vi.fn().mockImplementation(() =>
        Promise.resolve(undefined)
      );
      const mockValues = vi.fn().mockImplementation((row: { key: string; value: string }) => {
        store.set(row.key, row.value);
        return { onConflictDoUpdate: mockOnConflictDoUpdate };
      });
      return { values: mockValues };
    }),
    select: vi.fn().mockImplementation(() => {
      const mockFrom = vi.fn().mockImplementation(() => {
        const rows = Array.from(store.entries()).map(([key, value]) => ({ key, value }));
        return Promise.resolve(rows);
      });
      return { from: mockFrom };
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  },
  settingsTable: { key: "key" },
  trainingDatesTable: {},
  trainedDoctorsTable: {},
  doctorCertificationsTable: {},
  resourcesTable: {},
  trainingRegistrationsTable: {},
  websiteCustomersTable: {},
  irocAppUsers: {},
  irocCustomers: {},
  irocProducts: {},
  irocInventoryLots: {},
  irocInvoices: {},
  irocInvoiceItems: {},
  irocNotifications: {},
}));

import app from "../app";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("manufacturer URL defaults — cold-start behaviour", () => {
  beforeEach(() => {
    // Wipe the in-memory store before each test for full isolation.
    store.clear();
  });

  // ── Scenario 1: fresh install — no DB rows for the URL keys ─────────────────

  it("returns ws_spirecut_company_url default when no DB row exists", async () => {
    // store is empty — simulates a fresh install with no admin overrides
    const res = await request(app).get("/api/website-settings");

    expect(res.status).toBe(200);
    expect(res.body.ws_spirecut_company_url).toBe("https://www.spirecut.com");
  });

  it("returns ws_ministem_company_url default when no DB row exists", async () => {
    const res = await request(app).get("/api/website-settings");

    expect(res.status).toBe(200);
    expect(res.body.ws_ministem_company_url).toBe("https://www.jointechlabs.com");
  });

  it("returns both manufacturer URL defaults together on an empty store", async () => {
    const res = await request(app).get("/api/website-settings");

    expect(res.status).toBe(200);
    // Both defaults must be truthy strings so the page renders the buttons
    expect(res.body.ws_spirecut_company_url).toBeTruthy();
    expect(res.body.ws_ministem_company_url).toBeTruthy();
    expect(res.body.ws_spirecut_company_url).toBe("https://www.spirecut.com");
    expect(res.body.ws_ministem_company_url).toBe("https://www.jointechlabs.com");
  });

  // ── Scenario 2: admin saves a custom URL — override is live ─────────────────

  it("returns the custom Spirecut URL when an admin override is stored", async () => {
    store.set("ws_spirecut_company_url", "https://custom.spirecut.example.com");

    const res = await request(app).get("/api/website-settings");

    expect(res.status).toBe(200);
    expect(res.body.ws_spirecut_company_url).toBe("https://custom.spirecut.example.com");
  });

  it("returns the custom MiniStem URL when an admin override is stored", async () => {
    store.set("ws_ministem_company_url", "https://custom.ministem.example.com");

    const res = await request(app).get("/api/website-settings");

    expect(res.status).toBe(200);
    expect(res.body.ws_ministem_company_url).toBe("https://custom.ministem.example.com");
  });

  // ── Scenario 3: admin sets URL to empty string — button is hidden ────────────

  it("returns empty string (not the default) when ws_spirecut_company_url is explicitly set to blank", async () => {
    // Admin intentionally clears the field → the page should hide the button.
    // An empty string in the DB must NOT be replaced with the default.
    store.set("ws_spirecut_company_url", "");

    const res = await request(app).get("/api/website-settings");

    expect(res.status).toBe(200);
    expect(res.body.ws_spirecut_company_url).toBe("");
    // Confirm the default is NOT returned when the key has an explicit empty value
    expect(res.body.ws_spirecut_company_url).not.toBe("https://www.spirecut.com");
  });

  it("returns empty string (not the default) when ws_ministem_company_url is explicitly set to blank", async () => {
    store.set("ws_ministem_company_url", "");

    const res = await request(app).get("/api/website-settings");

    expect(res.status).toBe(200);
    expect(res.body.ws_ministem_company_url).toBe("");
    expect(res.body.ws_ministem_company_url).not.toBe("https://www.jointechlabs.com");
  });

  // ── Scenario 4: DB row deleted — reverts to default, not empty string ────────
  //
  // The GET handler uses `if (db_map[key] !== undefined)` so a missing key
  // uses WS_DEFAULTS rather than producing an empty string. This is the key
  // distinction from Scenario 3: explicit blank → hide, missing row → show default.

  it("reverts ws_spirecut_company_url to default when the DB row is deleted", async () => {
    // First: write an override
    store.set("ws_spirecut_company_url", "https://old-custom.spirecut.example.com");

    const overrideRes = await request(app).get("/api/website-settings");
    expect(overrideRes.body.ws_spirecut_company_url).toBe("https://old-custom.spirecut.example.com");

    // Then: delete the row (simulate DB DELETE)
    store.delete("ws_spirecut_company_url");

    const revertedRes = await request(app).get("/api/website-settings");
    expect(revertedRes.status).toBe(200);
    // Must revert to the hardcoded default, not to empty string
    expect(revertedRes.body.ws_spirecut_company_url).toBe("https://www.spirecut.com");
    expect(revertedRes.body.ws_spirecut_company_url).not.toBe("");
  });

  it("reverts ws_ministem_company_url to default when the DB row is deleted", async () => {
    store.set("ws_ministem_company_url", "https://old-custom.ministem.example.com");

    const overrideRes = await request(app).get("/api/website-settings");
    expect(overrideRes.body.ws_ministem_company_url).toBe("https://old-custom.ministem.example.com");

    store.delete("ws_ministem_company_url");

    const revertedRes = await request(app).get("/api/website-settings");
    expect(revertedRes.status).toBe(200);
    expect(revertedRes.body.ws_ministem_company_url).toBe("https://www.jointechlabs.com");
    expect(revertedRes.body.ws_ministem_company_url).not.toBe("");
  });

  // ── Distinguish empty-string in DB vs missing row ────────────────────────────
  //
  // This is the critical semantic: "" in DB ≠ key absent from DB.

  it("distinguishes empty string (hidden) from missing row (show default) for ws_spirecut_company_url", async () => {
    // Empty string → hidden
    store.set("ws_spirecut_company_url", "");
    const emptyRes = await request(app).get("/api/website-settings");
    expect(emptyRes.body.ws_spirecut_company_url).toBe("");

    // Missing row → default shown
    store.delete("ws_spirecut_company_url");
    const defaultRes = await request(app).get("/api/website-settings");
    expect(defaultRes.body.ws_spirecut_company_url).toBe("https://www.spirecut.com");
  });

  it("distinguishes empty string (hidden) from missing row (show default) for ws_ministem_company_url", async () => {
    store.set("ws_ministem_company_url", "");
    const emptyRes = await request(app).get("/api/website-settings");
    expect(emptyRes.body.ws_ministem_company_url).toBe("");

    store.delete("ws_ministem_company_url");
    const defaultRes = await request(app).get("/api/website-settings");
    expect(defaultRes.body.ws_ministem_company_url).toBe("https://www.jointechlabs.com");
  });
});

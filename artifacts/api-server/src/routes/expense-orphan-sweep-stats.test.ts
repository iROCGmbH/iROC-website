/**
 * expense-orphan-sweep-stats.test.ts
 *
 * Verifies the full loop:
 *   sweepExpenseOrphans() runs → settings row is written with the correct
 *   counts → GET /api/admin/expenses/orphan-sweep-stats reads that row and
 *   returns the expected JSON.
 *
 * Two describe blocks:
 *   1. Stats route — covers the GET endpoint directly (mocking the DB read).
 *   2. End-to-end loop — calls sweepExpenseOrphans() with a fake storage stub,
 *      captures what was written to the settings table, then asserts the route
 *      would serve the same JSON by feeding the captured value back through the
 *      GET endpoint mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist shared mock state ───────────────────────────────────────────────────
//
// vi.hoisted() runs before ESM imports so the mock factory below can close
// over `mockQuery` before @workspace/db is resolved.

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockQuery },
  // Drizzle ORM surface — referenced by other routers mounted on the same app.
  db: {
    insert:  vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) }),
    select:  vi.fn().mockReturnValue({ from: vi.fn().mockResolvedValue([]) }),
    update:  vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    delete:  vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  },
  settingsTable:              { key: "key" },
  trainingDatesTable:         {},
  trainedDoctorsTable:        {},
  doctorCertificationsTable:  {},
  resourcesTable:             {},
  trainingRegistrationsTable: {},
  websiteCustomersTable:      {},
  irocAppUsers:               {},
  irocCustomers:              {},
  irocProducts:               {},
  irocInventoryLots:          {},
  irocInvoices:               {},
  irocInvoiceItems:           {},
  irocNotifications:          {},
}));

// Import app AFTER mocks so all routers pick up the mocked DB.
import app from "../app";

// ── Auth helper ───────────────────────────────────────────────────────────────

function makeValidJwt(payload: { userId: number; username: string }): string {
  const secret = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const data = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig  = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const JWT_AUTH = `Bearer ${makeValidJwt({ userId: 1, username: "admin" })}`;

// ── 1. Stats route tests ───────────────────────────────────────────────────────

describe("GET /api/admin/expenses/orphan-sweep-stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 204 when no sweep has run yet (no settings row)", async () => {
    // getSetting returns null when the SELECT finds no row.
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get("/api/admin/expenses/orphan-sweep-stats")
      .set("Authorization", JWT_AUTH);

    expect(res.status).toBe(204);
  });

  it("returns the stored stats JSON when a sweep result exists", async () => {
    const stats = {
      scanned:  1,
      deleted:  1,
      errors:   0,
      last_run: "2026-08-14T10:00:00.000Z",
    };

    // getSetting issues: SELECT value FROM settings WHERE key=$1
    mockQuery.mockResolvedValue({ rows: [{ value: JSON.stringify(stats) }] });

    const res = await request(app)
      .get("/api/admin/expenses/orphan-sweep-stats")
      .set("Authorization", JWT_AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      scanned:  1,
      deleted:  1,
      errors:   0,
      last_run: "2026-08-14T10:00:00.000Z",
    });
  });

  it("returns 401 when no auth token is provided", async () => {
    const res = await request(app)
      .get("/api/admin/expenses/orphan-sweep-stats");

    expect(res.status).toBe(401);
  });

  it("returns 204 when the settings value is not valid JSON", async () => {
    // A corrupt settings row must not crash the route.
    mockQuery.mockResolvedValue({ rows: [{ value: "not-valid-json{{{" }] });

    const res = await request(app)
      .get("/api/admin/expenses/orphan-sweep-stats")
      .set("Authorization", JWT_AUTH);

    expect(res.status).toBe(204);
  });
});

// ── 2. Full sweep → stats loop ─────────────────────────────────────────────────
//
// Calls sweepExpenseOrphans() directly with a fake ObjectStorageService stub
// (one orphaned file, older than 30 min, not linked to any expense row).
// Captures what was written to the settings table, then feeds that value back
// through the GET route mock and asserts the route returns the correct JSON.

import { sweepExpenseOrphans } from "../lib/expense-orphan-sweep.js";
import type { ObjectStorageService } from "../lib/objectStorage.js";

/** Minimal GCS File fake whose metadata says the file was created `ageMinutes` ago. */
function makeGcsFile(ageMinutes: number) {
  const created = new Date(Date.now() - ageMinutes * 60 * 1000).toISOString();
  return {
    getMetadata: vi.fn().mockResolvedValue([{ timeCreated: created }]),
    delete:      vi.fn().mockResolvedValue(undefined),
  };
}

/** Returns a minimal ObjectStorageService stub whose listFilesInSubdir yields the given entries. */
function makeStorage(
  entries: Array<{ file: ReturnType<typeof makeGcsFile>; normalizedPath: string }>,
): Pick<ObjectStorageService, "listFilesInSubdir"> {
  return {
    listFilesInSubdir: vi.fn().mockResolvedValue(entries),
  };
}

describe("sweep → settings row → GET /api/admin/expenses/orphan-sweep-stats round-trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sweep writes scanned=1, deleted=1, errors=0 and route returns matching JSON", async () => {
    const uuid = "a1b2c3d4-2222-2222-2222-000000000001";
    const file = makeGcsFile(60); // 60 min old — qualifies as orphan
    const storage = makeStorage([
      { file, normalizedPath: `/objects/expense-receipts/${uuid}` },
    ]);

    // Track the value written by saveSweepStats so we can replay it into the route.
    let capturedSettingsValue: string | undefined;

    // pool.query mock shared between the sweep and the subsequent route call.
    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      const sqlStr = String(sql);

      if (sqlStr.includes("INSERT INTO settings")) {
        // saveSweepStats: ($1=key, $2=JSON)
        capturedSettingsValue = params?.[1] as string;
        return Promise.resolve({ rows: [] });
      }

      if (sqlStr.includes("LIKE")) {
        // Snapshot query — no linked files in iroc_expenses.
        return Promise.resolve({ rows: [] });
      }

      if (sqlStr.startsWith("SELECT value FROM settings")) {
        // getSetting for the stats route — replay what the sweep wrote.
        if (capturedSettingsValue !== undefined) {
          return Promise.resolve({ rows: [{ value: capturedSettingsValue }] });
        }
        return Promise.resolve({ rows: [] });
      }

      // Per-file recheck: not linked.
      return Promise.resolve({ rows: [] });
    });

    const before = Date.now();
    const sweepResult = await sweepExpenseOrphans(storage);
    const after  = Date.now();

    // ── Assert the sweep return value ──────────────────────────────────────────
    expect(sweepResult.scanned).toBe(1);
    expect(sweepResult.deleted).toBe(1);
    expect(sweepResult.errors).toBe(0);
    expect(file.delete).toHaveBeenCalledOnce();

    // ── Assert the settings row was written correctly ──────────────────────────
    expect(capturedSettingsValue).toBeDefined();
    const saved = JSON.parse(capturedSettingsValue!) as Record<string, unknown>;
    expect(saved.scanned).toBe(1);
    expect(saved.deleted).toBe(1);
    expect(saved.errors).toBe(0);
    expect(typeof saved.last_run).toBe("string");
    const lastRunMs = new Date(saved.last_run as string).getTime();
    expect(lastRunMs).toBeGreaterThanOrEqual(before);
    expect(lastRunMs).toBeLessThanOrEqual(after);

    // ── Assert the GET route returns the exact same JSON ───────────────────────
    const res = await request(app)
      .get("/api/admin/expenses/orphan-sweep-stats")
      .set("Authorization", JWT_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.scanned).toBe(1);
    expect(res.body.deleted).toBe(1);
    expect(res.body.errors).toBe(0);
    expect(typeof res.body.last_run).toBe("string");
    // The timestamp served by the route must be the same one the sweep wrote.
    expect(new Date(res.body.last_run as string).getTime()).toBe(lastRunMs);
  });
});

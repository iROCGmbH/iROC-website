/**
 * Tests for PATCH /api/iroc/quotes/:id — featured-quote invariants
 *
 * Confirms:
 *  1. featuring quote B automatically unfeatures all other quotes
 *  2. un-featuring a quote (featured:false) leaves others untouched
 *  3. only approved quotes can be featured (guard)
 *  4. un-authorized requests are rejected
 *
 * Note: The GET /api/patient-postop-stats featured-ordering invariants
 *       (featured quote at index 0, chronological fallback) are already
 *       covered by the "places the featured quote first" and
 *       "orders non-featured quotes oldest-first" tests in
 *       patient-extras.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Generate a valid iROC JWT for tests ─────────────────────────────────────
// SESSION_SECRET is not set in the test environment; iroc.ts falls back to
// "iroc-fallback-secret".
const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
function makeToken(payload: { userId: number; username: string; exp?: number } = { userId: 1, username: "admin" }): string {
  const exp = payload.exp ?? Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const full = { ...payload, exp };
  const data = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig   = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}
const IROC_AUTH = `Bearer ${makeToken()}`;

// ── Hoist mocks so vi.mock factories can reference them ──────────────────────

const { mockDbSelect, mockDbUpdate } = vi.hoisted(() => {
  const mockDbSelect = vi.fn();
  const mockDbUpdate = vi.fn();
  return { mockDbSelect, mockDbUpdate };
});

// ── Suppress transitive dependencies of iroc.ts ──────────────────────────────

vi.mock("@workspace/integrations-gemini-ai/image", () => ({
  ai: { models: { generateContent: vi.fn() } },
}));

vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService: class {
    getObjectEntityFile                = vi.fn();
    getObjectEntityUploadURLWithSubdir = vi.fn();
    normalizeObjectEntityPath          = vi.fn();
    downloadObject                     = vi.fn();
  },
  ObjectNotFoundError: class extends Error {
    constructor(msg = "not found") { super(msg); this.name = "ObjectNotFoundError"; }
  },
}));

vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");
  class MockPDF extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y = 0;
    font()           { return this; }
    fontSize()       { return this; }
    fillColor()      { return this; }
    strokeColor()    { return this; }
    lineWidth()      { return this; }
    save()           { return this; }
    restore()        { return this; }
    addPage()        { return this; }
    image()          { return this; }
    moveTo()         { return this; }
    lineTo()         { return this; }
    rect()           { return this; }
    clip()           { return this; }
    stroke()         { return this; }
    fill()           { return this; }
    text()           { return this; }
    heightOfString() { return 10; }
    end(cb?: () => void) { super.end(cb); return this; }
  }
  return { default: MockPDF };
});

// ── Mock @workspace/db ───────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  pool:  { query: vi.fn().mockResolvedValue({ rows: [] }) },
  db: {
    select:      mockDbSelect,
    update:      mockDbUpdate,
    insert:      vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    }),
    delete:      vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    execute:     vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  },
  irocAppUsers:               { username: "username", passwordHash: "passwordHash" },
  irocInvoices:               { id: "id" },
  irocInvoiceItems:           { invoiceId: "invoiceId" },
  irocCustomers:              { id: "id" },
  websiteCustomersTable:      { id: "id" },
  settingsTable:              { key: "key" },
  datevExports:               { id: "id", status: "status" },
  datevExportItems:           { exportId: "exportId", invoiceId: "invoiceId" },
  irocNotifications:          {},
  irocProducts:               { id: "id", stockQuantity: "stockQuantity", updatedAt: "updatedAt" },
  irocInventoryLots:          {},
  irocProductGroups:          {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable:        {},
  doctorCertificationsTable:  {},
  irocLeads:                  {},
  irocOrders:                 {},
}));

// ── Import app AFTER mocks ───────────────────────────────────────────────────

import app from "../app";

// ── Helpers ──────────────────────────────────────────────────────────────────

const POSTOP_PREFIX = "patient_postop_";

/** Build a Drizzle-like select chain: select().from().where() */
function makeSelectChain(rows: unknown[]) {
  const limitFn     = vi.fn().mockResolvedValue(rows);
  const whereResult = Object.assign(Promise.resolve(rows), { limit: limitFn });
  const whereFn     = vi.fn().mockReturnValue(whereResult);
  const fromFn      = vi.fn().mockReturnValue({ where: whereFn });
  return { from: fromFn };
}

/** Build a Drizzle-like update chain: update().set().where() */
function makeUpdateChain() {
  const whereFn = vi.fn().mockResolvedValue(undefined);
  const setFn   = vi.fn().mockReturnValue({ where: whereFn });
  return { set: setFn, _where: whereFn };
}

function makeSubmission(id: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id,
    procedure:      "ct",
    operationMonth: "2024-01",
    rating:         5,
    experience:     "Great outcome, very happy with the result.",
    shareQuote:     true,
    quoteApproved:  true,
    submittedAt:    "2024-01-15T10:00:00.000Z",
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Auth guard
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/iroc/quotes/:id – auth guard", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app)
      .patch("/api/iroc/quotes/some-id")
      .send({ featured: true });
    expect(res.status).toBe(401);
  });

  it("returns 401 when the JWT is invalid", async () => {
    const res = await request(app)
      .patch("/api/iroc/quotes/some-id")
      .set("Authorization", "Bearer bad.token")
      .send({ featured: true });
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Featuring a quote clears featured on all other quotes
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/iroc/quotes/:id – only one quote can be featured at a time", () => {
  const targetId   = "id_target";
  const otherId1   = "id_other1";
  const otherId2   = "id_other2";
  const targetKey  = `${POSTOP_PREFIX}${targetId}`;
  const otherKey1  = `${POSTOP_PREFIX}${otherId1}`;
  const otherKey2  = `${POSTOP_PREFIX}${otherId2}`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unfeaturing the previously-featured quote when a new one is featured", async () => {
    // Call 1: fetch the target submission by exact key
    const targetRow = { key: targetKey, value: makeSubmission(targetId, { featured: false }) };
    // Call 2: fetch all submissions (LIKE pattern) — one of the others is currently featured
    const allRows = [
      { key: targetKey,  value: makeSubmission(targetId,  { featured: false }) },
      { key: otherKey1,  value: makeSubmission(otherId1,  { featured: true  }) },
      { key: otherKey2,  value: makeSubmission(otherId2,  { featured: false }) },
    ];

    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([targetRow]))
      .mockReturnValueOnce(makeSelectChain(allRows));

    const updateChain = makeUpdateChain();
    mockDbUpdate.mockReturnValue(updateChain);

    const res = await request(app)
      .patch(`/api/iroc/quotes/${targetId}`)
      .set("Authorization", IROC_AUTH)
      .send({ featured: true });

    expect(res.status).toBe(200);
    expect(res.body.featured).toBe(true);
    expect(res.body.id).toBe(targetId);

    // db.update must be called at least twice:
    //  - once to persist the previously-featured other quote with featured:false
    //  - once to persist the target quote with featured:true
    expect(mockDbUpdate.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Verify that the other quote's persisted JSON has featured=false
    const setArgs: Array<{ value?: string }> = updateChain.set.mock.calls.map(
      (c: unknown[]) => c[0] as { value?: string },
    );
    const unfeatureSave = setArgs.find((arg) => {
      try {
        const p = JSON.parse(arg.value ?? "{}") as Record<string, unknown>;
        return p.id === otherId1;
      } catch { return false; }
    });
    expect(unfeatureSave).toBeDefined();
    expect(JSON.parse(unfeatureSave!.value ?? "{}").featured).toBe(false);
  });

  it("does NOT modify quotes that are already not featured when featuring a new one", async () => {
    const targetRow = { key: targetKey, value: makeSubmission(targetId, { featured: false }) };
    const allRows = [
      { key: targetKey,  value: makeSubmission(targetId,  { featured: false }) },
      { key: otherKey1,  value: makeSubmission(otherId1,  { featured: false }) },
      { key: otherKey2,  value: makeSubmission(otherId2,  { featured: false }) },
    ];

    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([targetRow]))
      .mockReturnValueOnce(makeSelectChain(allRows));

    const updateChain = makeUpdateChain();
    mockDbUpdate.mockReturnValue(updateChain);

    const res = await request(app)
      .patch(`/api/iroc/quotes/${targetId}`)
      .set("Authorization", IROC_AUTH)
      .send({ featured: true });

    expect(res.status).toBe(200);
    expect(res.body.featured).toBe(true);

    // Only 1 update expected: for the target quote itself
    // (the two un-featured others must NOT trigger a DB write)
    expect(mockDbUpdate.mock.calls.length).toBe(1);
  });

  it("clears featured on ALL previously-featured quotes (edge: two were featured)", async () => {
    // Defensive: should never happen in normal usage, but the code must handle it.
    const targetRow = { key: targetKey, value: makeSubmission(targetId, { featured: false }) };
    const allRows = [
      { key: targetKey,  value: makeSubmission(targetId,  { featured: false }) },
      { key: otherKey1,  value: makeSubmission(otherId1,  { featured: true  }) },
      { key: otherKey2,  value: makeSubmission(otherId2,  { featured: true  }) },
    ];

    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([targetRow]))
      .mockReturnValueOnce(makeSelectChain(allRows));

    const updateChain = makeUpdateChain();
    mockDbUpdate.mockReturnValue(updateChain);

    const res = await request(app)
      .patch(`/api/iroc/quotes/${targetId}`)
      .set("Authorization", IROC_AUTH)
      .send({ featured: true });

    expect(res.status).toBe(200);

    // Expect 3 updates: unfeature otherId1, unfeature otherId2, save target
    expect(mockDbUpdate.mock.calls.length).toBe(3);

    const setArgs: Array<{ value?: string }> = updateChain.set.mock.calls.map(
      (c: unknown[]) => c[0] as { value?: string },
    );
    for (const otherId of [otherId1, otherId2]) {
      const save = setArgs.find((arg) => {
        try { return (JSON.parse(arg.value ?? "{}") as Record<string, unknown>).id === otherId; }
        catch { return false; }
      });
      expect(save).toBeDefined();
      expect(JSON.parse(save!.value ?? "{}").featured).toBe(false);
    }
  });

  it("un-featuring a quote (featured:false) does not touch other quotes", async () => {
    const targetRow = { key: targetKey, value: makeSubmission(targetId, { featured: true }) };

    // Only one select call expected when un-featuring (no LIKE scan needed)
    mockDbSelect.mockReturnValue(makeSelectChain([targetRow]));

    const updateChain = makeUpdateChain();
    mockDbUpdate.mockReturnValue(updateChain);

    const res = await request(app)
      .patch(`/api/iroc/quotes/${targetId}`)
      .set("Authorization", IROC_AUTH)
      .send({ featured: false });

    expect(res.status).toBe(200);
    expect(res.body.featured).toBe(false);

    // Only 1 update: the target quote itself
    expect(mockDbUpdate.mock.calls.length).toBe(1);
  });

  it("returns 400 when trying to feature a non-approved quote", async () => {
    const targetRow = {
      key:   targetKey,
      value: makeSubmission(targetId, { quoteApproved: null, featured: false }),
    };
    mockDbSelect.mockReturnValue(makeSelectChain([targetRow]));

    const res = await request(app)
      .patch(`/api/iroc/quotes/${targetId}`)
      .set("Authorization", IROC_AUTH)
      .send({ featured: true });

    expect(res.status).toBe(400);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the submission does not exist", async () => {
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const res = await request(app)
      .patch(`/api/iroc/quotes/nonexistent`)
      .set("Authorization", IROC_AUTH)
      .send({ featured: true });

    expect(res.status).toBe(404);
  });
});

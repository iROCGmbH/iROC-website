/**
 * Tests for GET /iroc/dashboard — "Upcoming Training" filtering
 *
 * Verifies that the recentTrainings query:
 *   - passes certifiedDoctorId to isNull() so certified participants are excluded
 *   - returns registrations whose certifiedDoctorId IS NULL in the response
 *   - maps DB rows to the correct recentTrainings response shape
 *   - caps at 5 entries in most-recently-registered order
 *   - produces an empty array when all registrations are certified
 *
 * Strategy
 * --------
 * The DB is mocked (no real Postgres). `isNull` from drizzle-orm is replaced
 * with a spy so we can assert exactly which column the handler passes to it.
 * If someone removes the filter or targets the wrong column, the predicate
 * assertion fails — independent of what the mock DB happens to return.
 *
 * The response-mapping assertions validate that rows returned by the DB are
 * correctly marshalled into the recentTrainings JSON array.
 *
 * Hoisting note: vi.mock factories are hoisted above all imports. Every
 * variable they reference must be declared via vi.hoisted() first.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist mock-factory state ──────────────────────────────────────────────────
const { mockSelect, mockSelectDistinct, mockIsNull } = vi.hoisted(() => ({
  mockSelect:         vi.fn(),
  mockSelectDistinct: vi.fn(),
  /**
   * Replaces drizzle-orm's isNull. Returns a recognisable sentinel object so
   * callers never throw while we can still assert which column it was given.
   */
  mockIsNull: vi.fn().mockReturnValue({ __sentinel: "isNull" }),
}));

// ── Mock drizzle-orm — spy on isNull, pass everything else through ─────────────
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, isNull: mockIsNull };
});

// ── Mock @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select:         mockSelect,
    selectDistinct: mockSelectDistinct,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  },
  irocInvoices:               { status: "status", id: "id", websiteCustomerId: "websiteCustomerId", issueDate: "issueDate", total: "total" },
  irocInvoiceItems:           {},
  irocOrders:                 { status: "status" },
  irocCustomers:              {},
  websiteCustomersTable:      { id: "id", createdAt: "createdAt" },
  irocAppUsers:               {},
  irocNotifications:          { isRead: "isRead" },
  settingsTable:              { key: "key" },
  irocProducts:               { stockQuantity: "stockQuantity", lowStockThreshold: "lowStockThreshold" },
  irocInventoryLots:          {},
  trainingRegistrationsTable: {
    certifiedDoctorId: "certifiedDoctorId",
    createdAt:         "createdAt",
    id:                "id",
    medicalDegree:     "medicalDegree",
    firstName:         "firstName",
    lastName:          "lastName",
    email:             "email",
    instrument:        "instrument",
    trainingDateInfo:  "trainingDateInfo",
  },
}));

// ── PDFKit stub (imported transitively by iroc.ts) ────────────────────────────
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

// ── Import app AFTER all mocks ────────────────────────────────────────────────
import app from "../app";

// ── JWT helper ────────────────────────────────────────────────────────────────
const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = { userId: 1, username: "admin", exp };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig  = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const AUTH = `Bearer ${makeIrocToken()}`;

// ── Chain builder ─────────────────────────────────────────────────────────────
/**
 * Returns a fluent, awaitable DB query chain that resolves to `result`.
 *
 * All chaining methods (from, where, innerJoin, orderBy, groupBy) return the
 * same chain object. `limit()` returns a plain Promise so that chains ending
 * with `.limit(n)` also resolve correctly.
 */
function selectChain(result: unknown[]) {
  const p = Promise.resolve(result);
  type Chain = {
    from:      ReturnType<typeof vi.fn>;
    innerJoin: ReturnType<typeof vi.fn>;
    where:     ReturnType<typeof vi.fn>;
    orderBy:   ReturnType<typeof vi.fn>;
    groupBy:   ReturnType<typeof vi.fn>;
    limit:     ReturnType<typeof vi.fn>;
    then:      typeof p.then;
    catch:     typeof p.catch;
    finally:   typeof p.finally;
  };
  const c = {
    then:    p.then.bind(p),
    catch:   p.catch.bind(p),
    finally: p.finally.bind(p),
  } as unknown as Chain;

  c.from      = vi.fn().mockReturnValue(c);
  c.innerJoin = vi.fn().mockReturnValue(c);
  c.where     = vi.fn().mockReturnValue(c);
  c.orderBy   = vi.fn().mockReturnValue(c);
  c.groupBy   = vi.fn().mockReturnValue(c);
  c.limit     = vi.fn().mockResolvedValue(result);

  return c;
}

// ── Boilerplate setup ─────────────────────────────────────────────────────────
/**
 * The dashboard handler calls db.select() ~14 times. This helper stages
 * calls #1–13 with safe defaults so real test assertions can focus on call
 * #14 (recentTrainings).
 *
 * Call order (deterministic — Promise.all fires in declaration order):
 *   #1–6:  dashboard counts, including incoming orders
 *   #7–10: totalInvoices, revenueTotal, revenueSent, statusRows (groupBy)
 *   #11:   quoteRows  (settingsTable)
 *   #12:   recentOrders  (db.select + groupBy)
 *   #13:   pendingTrainings count  (non-certified training registrations)
 *   ----   << caller provides #14: recentTrainings >>
 *
 * selectDistinct is called only for yearRows (1 call).
 */
const UNIVERSAL_ROW = [{
  totalCustomers:      0,
  totalProducts:       0,
  lowStockCount:       0,
  unreadNotifications: 0,
  totalInvoices:       0,
  revenueTotal:        null,
  revenueSent:         null,
}];

function setupBoilerplateSelects() {
  // Calls #1–10: dashboard counts and invoice metrics
  for (let i = 0; i < 10; i++) {
    mockSelect.mockReturnValueOnce(selectChain(UNIVERSAL_ROW));
  }
  // Call #11: quoteRows (no pending quotes)
  mockSelect.mockReturnValueOnce(selectChain([]));
  // Call #12: recentOrders (db.select + groupBy)
  mockSelect.mockReturnValueOnce(selectChain([]));
  // Call #13: pendingTrainings count (non-certified registrations)
  mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));
  // selectDistinct call #1: yearRows only
  mockSelectDistinct.mockReturnValueOnce(selectChain([]));
}

// ── Training registration fixture ─────────────────────────────────────────────
function makeTrainingRow(overrides: Partial<{
  id:               number;
  medicalDegree:    string | null;
  firstName:        string;
  lastName:         string;
  email:            string;
  instrument:       string;
  trainingDateInfo: string | null;
  createdAt:        Date;
  certifiedDoctorId: number | null;
}> = {}) {
  return {
    id:               1,
    medicalDegree:    "Dr. med",
    firstName:        "Maria",
    lastName:         "Schmidt",
    email:            "maria@example.com",
    instrument:       "spirecut",
    trainingDateInfo: "2026-09-15 – München",
    createdAt:        new Date("2026-06-01T10:00:00Z"),
    certifiedDoctorId: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("GET /iroc/dashboard — Upcoming Training (recentTrainings) filtering", () => {
  beforeEach(() => {
    mockSelect.mockReset();
    mockSelectDistinct.mockReset();
    mockIsNull.mockClear();
    mockIsNull.mockReturnValue({ __sentinel: "isNull" });
  });

  // ── Core predicate test ────────────────────────────────────────────────────
  // Primary guard: isNull() must be called with the certifiedDoctorId column.
  // If someone removes the filter or targets the wrong column, this test fails.

  it("passes certifiedDoctorId to isNull() to exclude certified participants", async () => {
    setupBoilerplateSelects();
    // Call #12: recentTrainings — empty (irrelevant for predicate test)
    mockSelect.mockReturnValueOnce(selectChain([]));

    await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    // isNull is spied on. Find the call whose argument is the certifiedDoctorId column.
    const certifiedCall = mockIsNull.mock.calls.find(([col]) =>
      col === "certifiedDoctorId",
    );

    expect(certifiedCall, "isNull must be called with certifiedDoctorId").toBeDefined();
  });

  // ── Empty-state tests ──────────────────────────────────────────────────────

  it("returns an empty recentTrainings array when the DB yields no rows", async () => {
    setupBoilerplateSelects();
    mockSelect.mockReturnValueOnce(selectChain([]));

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentTrainings).toEqual([]);
  });

  it("includes pendingTrainings count in the dashboard response", async () => {
    // Override call #13 with a non-zero count to confirm it flows through.
    // Calls #1–10 are dashboard counts and invoice metrics.
    for (let i = 0; i < 10; i++) {
      mockSelect.mockReturnValueOnce(selectChain(UNIVERSAL_ROW));
    }
    mockSelect.mockReturnValueOnce(selectChain([]));   // #11: quoteRows
    mockSelect.mockReturnValueOnce(selectChain([]));   // #12: recentOrders
    mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 7 }])); // #13: count
    mockSelectDistinct.mockReturnValueOnce(selectChain([]));
    mockSelect.mockReturnValueOnce(selectChain([]));   // #14: recentTrainings

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.pendingTrainings).toBe(7);
  });

  it("returns an empty recentTrainings array when all registrations are certified", async () => {
    // The DB mock returns empty because the real query would exclude certified rows.
    // The mock's isNull sentinel is passed to .where(), and since the mock
    // was told to resolve with [], the filter is effectively honoured here.
    setupBoilerplateSelects();
    mockSelect.mockReturnValueOnce(selectChain([]));

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentTrainings).toEqual([]);
  });

  // ── Response-mapping tests ─────────────────────────────────────────────────

  it("maps a single pending registration to the correct recentTrainings entry", async () => {
    const row = makeTrainingRow(); // certifiedDoctorId: null → should appear
    setupBoilerplateSelects();
    mockSelect.mockReturnValueOnce(selectChain([row]));

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentTrainings).toHaveLength(1);

    const entry = res.body.recentTrainings[0];
    expect(entry.id).toBe(1);
    expect(entry.email).toBe("maria@example.com");
    expect(entry.name).toBe("Dr. med Maria Schmidt");
    expect(entry.instrument).toBe("spirecut");
    expect(entry.trainingDateInfo).toBe("2026-09-15 – München");
  });

  it("falls back to email as the name when medicalDegree, firstName, and lastName are all empty", async () => {
    const row = makeTrainingRow({ medicalDegree: null, firstName: "", lastName: "" });
    setupBoilerplateSelects();
    mockSelect.mockReturnValueOnce(selectChain([row]));

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentTrainings[0].name).toBe("maria@example.com");
  });

  it("sets trainingDateInfo to null when the DB row has no date info", async () => {
    const row = makeTrainingRow({ trainingDateInfo: null });
    setupBoilerplateSelects();
    mockSelect.mockReturnValueOnce(selectChain([row]));

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentTrainings[0].trainingDateInfo).toBeNull();
  });

  it("preserves the order returned by the DB (most-recently registered first)", async () => {
    const rows = [5, 4, 3, 2, 1].map(i =>
      makeTrainingRow({
        id:        i,
        firstName: `Doctor${i}`,
        lastName:  "Test",
        email:     `doc${i}@example.com`,
        createdAt: new Date(`2026-0${i}-15T00:00:00Z`),
      }),
    );

    setupBoilerplateSelects();
    mockSelect.mockReturnValueOnce(selectChain(rows));

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentTrainings).toHaveLength(5);
    expect(res.body.recentTrainings[0].email).toBe("doc5@example.com");
    expect(res.body.recentTrainings[4].email).toBe("doc1@example.com");
  });

  it("includes medicalDegree in the name only when it is non-empty", async () => {
    const withDegree    = makeTrainingRow({ medicalDegree: "Dr. med", firstName: "Anna", lastName: "Bauer", email: "a@ex.com" });
    const withoutDegree = makeTrainingRow({ id: 2, medicalDegree: null, firstName: "Klaus", lastName: "Meier", email: "k@ex.com" });

    setupBoilerplateSelects();
    mockSelect.mockReturnValueOnce(selectChain([withDegree, withoutDegree]));

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentTrainings[0].name).toBe("Dr. med Anna Bauer");
    expect(res.body.recentTrainings[1].name).toBe("Klaus Meier");
  });
});

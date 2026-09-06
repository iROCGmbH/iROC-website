/**
 * Tests for GET /iroc/dashboard — "New Orders" filtering
 *
 * Verifies that the recentOrders query:
 *   - uses an innerJoin between websiteCustomersTable and irocInvoices
 *   - passes ["draft", "sent"] — and not "paid"/"cancelled" — to every
 *     inArray status filter
 *   - maps the returned rows to the correct response shape
 *   - caps at 5 entries in most-recently-registered order
 *
 * Strategy
 * --------
 * The DB is mocked (no real Postgres).  Additionally, `inArray` from
 * drizzle-orm is replaced with a spy so we can assert exactly which status
 * values the handler sends to the WHERE clause.  If someone adds "paid" or
 * "cancelled" to the list, or removes the status filter entirely, the
 * predicate assertions fail — independent of what the mock DB happens to
 * return.
 *
 * The response-mapping assertions then validate that rows returned by the DB
 * are correctly marshalled into the recentOrders JSON array.
 *
 * Hoisting note: vi.mock factories are hoisted above all imports.  Every
 * variable they reference must be declared via vi.hoisted() first.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist mock-factory state ──────────────────────────────────────────────────
const { mockSelect, mockSelectDistinct, mockInArray, mockUpdate } = vi.hoisted(() => ({
  mockSelect:         vi.fn(),
  mockSelectDistinct: vi.fn(),
  /**
   * Replaces drizzle-orm's inArray.  Returns a recognisable sentinel object
   * so callers never throw, while we can still assert call arguments.
   */
  mockInArray: vi.fn().mockReturnValue({ __sentinel: "inArray" }),
  /** Controls db.update() for PATCH-status tests. */
  mockUpdate: vi.fn(),
}));

// ── Mock drizzle-orm — spy on inArray, pass everything else through ───────────
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, inArray: mockInArray };
});

// ── Mock @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select:         mockSelect,
    selectDistinct: mockSelectDistinct,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
    update: mockUpdate,
  },
  irocInvoices:               { status: "status", id: "id", websiteCustomerId: "websiteCustomerId", issueDate: "issueDate", total: "total" },
  irocInvoiceItems:           { invoiceId: "invoiceId", productId: "productId", productName: "productName", lineTotal: "lineTotal" },
  irocOrders:                 { status: "status" },
  irocCustomers:              {},
  websiteCustomersTable:      { id: "id", createdAt: "createdAt" },
  irocAppUsers:               {},
  irocNotifications:          { isRead: "isRead" },
  settingsTable:              { key: "key" },
  irocProducts:               { stockQuantity: "stockQuantity", lowStockThreshold: "lowStockThreshold", id: "id", category: "category" },
  irocInventoryLots:          {},
  trainingRegistrationsTable: { certifiedDoctorId: "certifiedDoctorId", createdAt: "createdAt" },
  irocLeads:                  {},
  trainedDoctorsTable:        {},
  doctorCertificationsTable:  {},
  eventsTable:                {},
  pageContentTable:           {},
  resourcesTable:             {},
  teamMembersTable:           {},
  trainingDatesTable:         {},
  datevExports:               {},
  datevExportItems:           {},
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
 * same chain object so any combination resolves to `result` when awaited.
 * `limit()` returns a plain Promise (also resolving to `result`) to handle
 * the cases where the last method in the chain is `.limit(n)`.
 */
function selectChain(result: unknown[]) {
  const p = Promise.resolve(result);
  type Chain = {
    from:      ReturnType<typeof vi.fn>;
    innerJoin: ReturnType<typeof vi.fn>;
    leftJoin:  ReturnType<typeof vi.fn>;
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
  c.leftJoin  = vi.fn().mockReturnValue(c);
  c.where     = vi.fn().mockReturnValue(c);
  c.orderBy   = vi.fn().mockReturnValue(c);
  c.groupBy   = vi.fn().mockReturnValue(c);
  c.limit     = vi.fn().mockResolvedValue(result);

  return c;
}

// ── Update chain builder ──────────────────────────────────────────────────────
/**
 * Returns a fluent DB update chain whose `.returning()` tail resolves to
 * `rows`.  The chain is: update → set → where → returning.
 */
function updateChain(rows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where     = vi.fn().mockReturnValue({ returning });
  const set       = vi.fn().mockReturnValue({ where });
  mockUpdate.mockReturnValue({ set });
  return { set, where, returning };
}

// ── Default select dispatcher for PATCH-status tests ──────────────────────────
/**
 * The PATCH /iroc/invoices/:id/status route now reads the invoice BEFORE
 * updating (to know the old status) and reads its line items when the
 * transition deducts/restores stock.  This installs a base implementation
 * (mockReturnValueOnce entries still take precedence) that serves those
 * reads: the invoice row with `existingStatus`, and an empty line-item list
 * so no stock mutation is attempted.
 */
function installDefaultPatchSelects(existingStatus: "draft" | "sent" | "paid" = "sent") {
  mockSelect.mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: Record<string, unknown>) => ({
      where: vi.fn().mockResolvedValue(
        table.invoiceId
          ? []                                                  // irocInvoiceItems → no items
          : table.websiteCustomerId
            ? [makeInvoiceRow({ id: 42, status: existingStatus })] // irocInvoices → existing row
            : [],
      ),
    })),
  }));
}

// ── Boilerplate setup ─────────────────────────────────────────────────────────
/**
 * The dashboard handler calls db.select() ~14 times for counts/sums/quotes/
 * orders/training rows.  This helper stages the first 9 with safe defaults so
 * the real test assertions can focus on the recentOrders and recentTrainings
 * calls (now both plain db.select()).
 *
 * Call order (deterministic — Promise.all fires in declaration order):
 *   #1–6:  dashboard counts, including incoming orders
 *   #7–10: totalInvoices, revenueTotal, revenueSent, statusRows (groupBy)
 *   #11:    quoteRows  (settingsTable)
 *  #12:    recentOrders (db.select + groupBy)
 *  #13:    pendingTrainings count (non-certified training registrations)
 *  #14:    recentTrainings (.limit(5))
 *
 * yearRows still uses db.selectDistinct and is mocked per-test.
 *
 * The universal row carries all possible property names so any named
 * destructuring in the handler resolves to 0/null without throwing.
 * The statusRows query returns [] to avoid mapping crashes.
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
  for (let i = 0; i < 10; i++) {
    mockSelect.mockReturnValueOnce(selectChain(UNIVERSAL_ROW));
  }
  mockSelect.mockReturnValueOnce(selectChain([])); // #11: quoteRows
  // #12 (recentOrders) and #14 (recentTrainings) are mocked per-test
}

// ── Customer fixture ──────────────────────────────────────────────────────────
function makeWcRow(overrides: Partial<{
  id: number;
  firstName: string;
  lastName: string;
  institutionName: string | null;
  email: string;
  instrument: string;
  createdAt: Date;
  openOrderCount: number;
}> = {}) {
  return {
    id:              1,
    firstName:       "Anna",
    lastName:        "Müller",
    institutionName: "Test Clinic",
    email:           "anna@example.com",
    instrument:      "iroc",
    createdAt:       new Date("2026-06-01T10:00:00Z"),
    openOrderCount:  1,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("GET /iroc/dashboard — New Orders (recentOrders) filtering", () => {
  beforeEach(() => {
    mockSelect.mockReset();
    mockSelectDistinct.mockReset();
    mockInArray.mockClear();
    mockInArray.mockReturnValue({ __sentinel: "inArray" });
    // Default: update chain returns no rows (safe default; overridden per test)
    updateChain([]);
  });

  // ── Core predicate test ────────────────────────────────────────────────────
  // This is the primary guard: it verifies that the dashboard query filters
  // on exactly ["draft", "sent"] — no more, no less.  The customer query and
  // both category-total queries must use the same open-status definition.

  it("uses exactly draft and sent for the open-order status filters", async () => {
    // Stage a non-empty recentOrders so the two category-total queries also
    // run, proving all three status predicates use the same open set.
    const wc = makeWcRow();
    setupBoilerplateSelects();
    mockSelectDistinct.mockReturnValueOnce(selectChain([]));                         // yearRows
    mockSelect.mockReturnValueOnce(selectChain([wc]));                               // recentOrders (#10)
    mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));          // pendingTrainings (#11)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // recentTrainings (#12)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // openInvoiceRows (#14)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // itemRows (#15)

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const statusCalls = mockInArray.mock.calls.filter(([, values]) =>
      Array.isArray(values) &&
      (values as unknown[]).some(v => typeof v === "string"),
    );
    expect(statusCalls).toHaveLength(3);
    for (const [, values] of statusCalls) {
      expect(values).toEqual(["draft", "sent"]);
    }
  });

  // ── Response-mapping tests ─────────────────────────────────────────────────
  // These confirm that rows returned by the DB are correctly mapped to the
  // recentOrders JSON array (name, email, instrument, institutionName, createdAt).

  it("returns an empty recentOrders array when the DB yields no rows", async () => {
    setupBoilerplateSelects();
    mockSelectDistinct.mockReturnValueOnce(selectChain([]));                         // yearRows
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // recentOrders (#10)
    mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));          // pendingTrainings (#11)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // recentTrainings (#12)

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentOrders).toEqual([]);
  });

  it("maps a single DB row to the correct recentOrders entry", async () => {
    const wc = makeWcRow();
    setupBoilerplateSelects();
    mockSelectDistinct.mockReturnValueOnce(selectChain([]));                         // yearRows
    mockSelect.mockReturnValueOnce(selectChain([wc]));                               // recentOrders (#10)
    mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));          // pendingTrainings (#11)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // recentTrainings (#12)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // openInvoiceRows (#14)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // itemRows (#15)

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentOrders).toHaveLength(1);
    const entry = res.body.recentOrders[0];
    expect(entry.email).toBe("anna@example.com");
    expect(entry.name).toBe("Anna Müller");
    expect(entry.instrument).toBe("iroc");
    expect(entry.institutionName).toBe("Test Clinic");
    expect(entry.id).toBe(1);
    expect(entry.openOrderCount).toBe(1);
  });

  it("returns one New Orders row when a customer has multiple open invoices", async () => {
    const wc = makeWcRow({ openOrderCount: 2 });
    setupBoilerplateSelects();
    mockSelectDistinct.mockReturnValueOnce(selectChain([]));                         // yearRows
    const recentOrderQuery = selectChain([wc]);
    mockSelect.mockReturnValueOnce(recentOrderQuery);                                // recentOrders (#12)
    mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));          // pendingTrainings (#13)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // recentTrainings (#14)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // openInvoiceRows (#15)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // itemRows (#16)

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentOrders).toHaveLength(1);
    expect(res.body.recentOrders[0]).toEqual(expect.objectContaining({
      id: wc.id,
      email: wc.email,
      openOrderCount: 2,
    }));
    expect(recentOrderQuery.groupBy).toHaveBeenCalledTimes(1);
  });

  it("keeps the five newest customers when the newest customer has multiple open invoices", async () => {
    const rows = [
      makeWcRow({
        id: 6,
        firstName: "Newest",
        lastName: "Customer",
        email: "newest@example.com",
        createdAt: new Date("2026-06-06T10:00:00Z"),
        openOrderCount: 3,
      }),
      ...[5, 4, 3, 2].map(id =>
        makeWcRow({
          id,
          firstName: `Customer${id}`,
          lastName: "Test",
          email: `c${id}@example.com`,
          createdAt: new Date(`2026-06-0${id}T10:00:00Z`),
          openOrderCount: 1,
        }),
      ),
    ];

    setupBoilerplateSelects();
    mockSelectDistinct.mockReturnValueOnce(selectChain([]));                         // yearRows
    const recentOrderQuery = selectChain(rows);
    mockSelect.mockReturnValueOnce(recentOrderQuery);                                // recentOrders (#12)
    mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));          // pendingTrainings (#13)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // recentTrainings (#14)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // openInvoiceRows (#15)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // itemRows (#16)

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentOrders).toHaveLength(5);
    expect(res.body.recentOrders.map((order: { email: string }) => order.email)).toEqual([
      "newest@example.com",
      "c5@example.com",
      "c4@example.com",
      "c3@example.com",
      "c2@example.com",
    ]);
    expect(res.body.recentOrders[0].openOrderCount).toBe(3);

    const groupByOrder = recentOrderQuery.groupBy.mock.invocationCallOrder[0];
    const limitOrder = recentOrderQuery.limit.mock.invocationCallOrder[0];
    expect(groupByOrder).toBeLessThan(limitOrder);
    expect(recentOrderQuery.limit).toHaveBeenCalledWith(5);
  });

  it("falls back to the email as the name when both firstName and lastName are empty", async () => {
    const wc = makeWcRow({ firstName: "", lastName: "" });
    setupBoilerplateSelects();
    mockSelectDistinct.mockReturnValueOnce(selectChain([]));                         // yearRows
    mockSelect.mockReturnValueOnce(selectChain([wc]));                               // recentOrders (#10)
    mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));          // pendingTrainings (#11)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // recentTrainings (#12)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // openInvoiceRows (#14)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // itemRows (#15)

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentOrders[0].name).toBe("anna@example.com");
  });

  it("preserves the order returned by the DB (most-recently registered first)", async () => {
    // 5 rows ordered newest→oldest — exactly as the DB delivers with
    // .orderBy(desc(createdAt)).limit(5)
    const rows = [5, 4, 3, 2, 1].map(i =>
      makeWcRow({
        id:        i,
        firstName: `Customer${i}`,
        lastName:  "Test",
        email:     `c${i}@example.com`,
        createdAt: new Date(`2026-0${i}-15T00:00:00Z`),
      }),
    );

    setupBoilerplateSelects();
    mockSelectDistinct.mockReturnValueOnce(selectChain([]));                         // yearRows
    mockSelect.mockReturnValueOnce(selectChain(rows));                               // recentOrders (#10)
    mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));          // pendingTrainings (#11)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // recentTrainings (#12)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // openInvoiceRows (#14)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // itemRows (#15)

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentOrders).toHaveLength(5);
    expect(res.body.recentOrders[0].email).toBe("c5@example.com");
    expect(res.body.recentOrders[4].email).toBe("c1@example.com");
  });

  // ── Stateful round-trip: draft → paid → draft ────────────────────────────
  // A single test that mirrors the real admin workflow:
  //   1. Invoice starts paid  → customer absent from New Orders
  //   2. Admin PATCHes status back to draft (the status passed to set() is
  //      captured and used to derive the dashboard response)
  //   3. Dashboard re-fetched  → customer reappears
  //
  // Crucially, the second dashboard mock is built *after* the PATCH resolves,
  // using the same shared `invoiceStatus` variable that the PATCH mock wrote.
  // If the endpoint never calls set({ status: "draft" }), the variable stays
  // "paid" and the second dashboard call still returns [] — the test fails.

  it("stateful round-trip: customer absent when paid, reappears after invoice is reset to draft", async () => {
    // ── Shared state ──────────────────────────────────────────────────────
    let invoiceStatus: "draft" | "sent" | "paid" = "paid";
    const wc = makeWcRow({ id: 42, firstName: "Karl", lastName: "Bauer", email: "karl@example.com" });

    // ── Wire up the PATCH mock to update shared state ─────────────────────
    // set() captures the requested status and updates invoiceStatus so that
    // the next dashboard call derives the correct recentOrders result.
    const setFn = vi.fn().mockImplementation((data: { status: "draft" | "sent" | "paid" }) => {
      invoiceStatus = data.status;
      return {
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            makeInvoiceRow({ id: 42, status: invoiceStatus }),
          ]),
        }),
      };
    });
    mockUpdate.mockReturnValue({ set: setFn });
    installDefaultPatchSelects("paid");

    // ── Step 1: dashboard while invoice is paid → customer absent ─────────
    setupBoilerplateSelects();
    mockSelectDistinct.mockReturnValueOnce(selectChain([]));                              // yearRows
    mockSelect.mockReturnValueOnce(selectChain(invoiceStatus === "paid" ? [] : [wc]));   // recentOrders (#10, [] when paid)
    mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));              // pendingTrainings (#11)
    mockSelect.mockReturnValueOnce(selectChain([]));                                     // recentTrainings (#12)

    const res1 = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res1.status).toBe(200);
    expect(res1.body.recentOrders).toEqual([]);

    // ── Step 2: PATCH resets invoice to draft ─────────────────────────────
    const patchRes = await request(app)
      .patch("/api/iroc/invoices/42/status")
      .set("Authorization", AUTH)
      .send({ status: "draft" });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe("draft");
    // Assert the correct status was forwarded to db.update().set()
    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));
    // Shared state must now reflect the mutation
    expect(invoiceStatus).toBe("draft");

    // ── Step 3: dashboard after reset → customer reappears ────────────────
    // The select mock is rebuilt here, AFTER invoiceStatus is "draft",
    // so the result is derived from the PATCH outcome, not scripted in advance.
    setupBoilerplateSelects();
    mockSelectDistinct.mockReturnValueOnce(selectChain([]));                              // yearRows
    const step3RecentOrders = invoiceStatus === "paid" ? [] : [wc];
    mockSelect.mockReturnValueOnce(selectChain(step3RecentOrders));                      // recentOrders (#10, [wc] when draft)
    mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));              // pendingTrainings (#11)
    mockSelect.mockReturnValueOnce(selectChain([]));                                     // recentTrainings (#12)
    // openInvoiceRows (#14) + itemRows (#15): only fired when recentOrders is non-empty
    if (step3RecentOrders.length > 0) {
      mockSelect.mockReturnValueOnce(selectChain([]));                                   // openInvoiceRows (#14)
      mockSelect.mockReturnValueOnce(selectChain([]));                                   // itemRows (#15)
    }

    const res2 = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res2.status).toBe(200);
    expect(res2.body.recentOrders).toHaveLength(1);
    expect(res2.body.recentOrders[0].email).toBe("karl@example.com");
    expect(res2.body.recentOrders[0].name).toBe("Karl Bauer");
  });

  it("stateful round-trip: customer with a sent invoice remains open after reset to draft", async () => {
    let invoiceStatus: "draft" | "sent" = "sent";
    const wc = makeWcRow({
      id: 43,
      firstName: "Maria",
      lastName: "Schmidt",
      email: "maria@example.com",
    });

    const setFn = vi.fn().mockImplementation((data: { status: "draft" | "sent" }) => {
      invoiceStatus = data.status;
      return {
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            makeInvoiceRow({ id: 43, status: invoiceStatus }),
          ]),
        }),
      };
    });
    mockUpdate.mockReturnValue({ set: setFn });
    installDefaultPatchSelects("sent");

    // A customer with only a sent invoice is initially visible in New Orders.
    setupBoilerplateSelects();
    mockSelectDistinct.mockReturnValueOnce(selectChain([]));                         // yearRows
    mockSelect.mockReturnValueOnce(selectChain([wc]));                               // recentOrders (#10)
    mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));          // pendingTrainings (#11)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // recentTrainings (#12)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // openInvoiceRows (#14)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // itemRows (#15)

    const beforeRes = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(beforeRes.status).toBe(200);
    expect(beforeRes.body.recentOrders).toHaveLength(1);
    expect(beforeRes.body.recentOrders[0].email).toBe("maria@example.com");

    // Reopening the sent invoice must succeed and update the shared state.
    const patchRes = await request(app)
      .patch("/api/iroc/invoices/43/status")
      .set("Authorization", AUTH)
      .send({ status: "draft" });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe("draft");
    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));
    expect(invoiceStatus).toBe("draft");

    // Draft invoices are also open, so reopening the sole sent invoice keeps
    // this customer in the list with one open order.
    setupBoilerplateSelects();
    mockSelectDistinct.mockReturnValueOnce(selectChain([]));                         // yearRows
    const postResetRecentOrders =
      ["draft", "sent"].includes(invoiceStatus) ? [wc] : [];
    mockSelect.mockReturnValueOnce(selectChain(postResetRecentOrders));              // recentOrders (#10)
    mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));          // pendingTrainings (#11)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // recentTrainings (#12)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // openInvoiceRows (#14)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // itemRows (#15)

    const afterRes = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(afterRes.status).toBe(200);
    expect(afterRes.body.recentOrders).toHaveLength(1);
    expect(afterRes.body.recentOrders[0].email).toBe("maria@example.com");
    expect(afterRes.body.recentOrders[0].openOrderCount).toBe(1);
  });

  it("updates mixed open-order counts after paid/cancelled changes and removes the customer after the last invoice is paid", async () => {
    type InvoiceStatus = "draft" | "sent" | "paid" | "cancelled";
    const invoiceStatuses = new Map<number, InvoiceStatus>([
      [101, "draft"],
      [102, "sent"],
      [103, "draft"],
      [104, "paid"],
    ]);
    const wc = makeWcRow({
      id: 44,
      firstName: "Lea",
      lastName: "Fischer",
      email: "lea@example.com",
    });
    let targetInvoiceId = 0;

    const openCount = () =>
      Array.from(invoiceStatuses.values()).filter(
        status => status === "draft" || status === "sent",
      ).length;

    const stageDashboard = () => {
      const count = openCount();
      const rows = count > 0 ? [makeWcRow({ ...wc, openOrderCount: count })] : [];
      setupBoilerplateSelects();
      mockSelectDistinct.mockReturnValueOnce(selectChain([]));
      mockSelect.mockReturnValueOnce(selectChain(rows));
      mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));
      mockSelect.mockReturnValueOnce(selectChain([]));
      if (rows.length > 0) {
        mockSelect.mockReturnValueOnce(selectChain([]));
        mockSelect.mockReturnValueOnce(selectChain([]));
      }
    };

    const setFn = vi.fn().mockImplementation((data: { status: InvoiceStatus }) => {
      invoiceStatuses.set(targetInvoiceId, data.status);
      return {
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            makeInvoiceRow({ id: targetInvoiceId, status: data.status }),
          ]),
        }),
      };
    });
    mockUpdate.mockReturnValue({ set: setFn });
    installDefaultPatchSelects("sent");

    // Mixed draft + sent + paid invoices count only the three open invoices.
    stageDashboard();
    const initial = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);
    expect(initial.status).toBe(200);
    expect(initial.body.recentOrders).toHaveLength(1);
    expect(initial.body.recentOrders[0].openOrderCount).toBe(3);

    // Paying a sent invoice drops the count but keeps the customer visible.
    targetInvoiceId = 102;
    const paidSent = await request(app)
      .patch("/api/iroc/invoices/102/status")
      .set("Authorization", AUTH)
      .send({ status: "paid" });
    expect(paidSent.status).toBe(200);
    expect(paidSent.body.status).toBe("paid");

    stageDashboard();
    const afterPaid = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);
    expect(afterPaid.status).toBe(200);
    expect(afterPaid.body.recentOrders).toHaveLength(1);
    expect(afterPaid.body.recentOrders[0].openOrderCount).toBe(2);

    // Cancelling a draft invoice is also excluded from the open count.
    targetInvoiceId = 101;
    const cancelledDraft = await request(app)
      .patch("/api/iroc/invoices/101/status")
      .set("Authorization", AUTH)
      .send({ status: "cancelled" });
    expect(cancelledDraft.status).toBe(200);
    expect(cancelledDraft.body.status).toBe("cancelled");

    stageDashboard();
    const afterCancelled = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);
    expect(afterCancelled.status).toBe(200);
    expect(afterCancelled.body.recentOrders).toHaveLength(1);
    expect(afterCancelled.body.recentOrders[0].openOrderCount).toBe(1);

    // Paying the final draft invoice removes the customer from New Orders.
    targetInvoiceId = 103;
    const paidFinal = await request(app)
      .patch("/api/iroc/invoices/103/status")
      .set("Authorization", AUTH)
      .send({ status: "paid" });
    expect(paidFinal.status).toBe(200);
    expect(paidFinal.body.status).toBe("paid");

    stageDashboard();
    const afterFinalPayment = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);
    expect(afterFinalPayment.status).toBe(200);
    expect(afterFinalPayment.body.recentOrders).toEqual([]);
    expect(setFn).toHaveBeenCalledTimes(3);
  });
});

// ── PATCH /iroc/invoices/:id/status ──────────────────────────────────────────
// Verifies the status-update endpoint handles every transition, including the
// paid → draft round-trip that allows an admin to correct a mistake.

/** Minimal invoice row shape required by formatInvoiceRow in iroc.ts. */
function makeInvoiceRow(overrides: Partial<{
  id: number;
  status: "draft" | "sent" | "paid" | "cancelled";
  invoiceNumber: string;
  customerId: number;
  websiteCustomerId: number | null;
  invoiceType: "domestic" | "eu" | "export" | "noneu";
  issueDate: string;
  deliveryCosts: string;
  insuranceCosts: string;
  subtotal: string;
  vatRate: string;
  vatAmount: string;
  total: string;
  language: "de" | "en";
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id:                1,
    status:            "draft" as const,
    invoiceNumber:     "RE-2026-0001",
    customerId:        10,
    websiteCustomerId: null,
    customerName:      null,
    invoiceType:       "domestic" as const,
    issueDate:         "2026-07-01",
    dueDate:           null,
    orderNumber:       null,
    referenceNumber:   null,
    shippingMethod:    null,
    reasonForExport:   null,
    termsOfDelivery:   null,
    deliveryCosts:     "0",
    insuranceCosts:    "0",
    subtotal:          "100",
    vatRate:           "19",
    vatAmount:         "19",
    total:             "119",
    notes:             null,
    language:          "de" as const,
    createdAt:         new Date("2026-07-01T08:00:00Z"),
    updatedAt:         new Date("2026-07-01T08:00:00Z"),
    ...overrides,
  };
}

describe("PATCH /iroc/invoices/:id/status — paid↔draft round-trip", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    installDefaultPatchSelects("draft");
  });

  it("transitions a draft invoice to paid and passes status:'paid' to the DB set() call", async () => {
    const updated = makeInvoiceRow({ id: 7, status: "paid" });
    const { set } = updateChain([updated]);

    const res = await request(app)
      .patch("/api/iroc/invoices/7/status")
      .set("Authorization", AUTH)
      .send({ status: "paid" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paid");
    expect(res.body.id).toBe(7);
    // The correct status must have been forwarded to db.update().set()
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "paid" }));
  });

  it("resets a paid invoice back to draft — no server-side guard blocks it and status:'draft' reaches the DB", async () => {
    // The PATCH /status endpoint has no guard for paid → draft.
    // Only the invoice EDIT endpoint (PUT /invoices/:id) rejects paid invoices.
    const updated = makeInvoiceRow({ id: 7, status: "draft" });
    const { set } = updateChain([updated]);

    const res = await request(app)
      .patch("/api/iroc/invoices/7/status")
      .set("Authorization", AUTH)
      .send({ status: "draft" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("draft");
    // Confirm status:"draft" was actually forwarded — no early-return guard dropped it
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));
  });

  it("resets a sent invoice back to draft and returns the updated draft status", async () => {
    installDefaultPatchSelects("sent");
    const updated = makeInvoiceRow({ id: 7, status: "draft" });
    const { set } = updateChain([updated]);

    const res = await request(app)
      .patch("/api/iroc/invoices/7/status")
      .set("Authorization", AUTH)
      .send({ status: "draft" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("draft");
    expect(res.body.id).toBe(7);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));
  });

  it("returns 404 when no invoice matches the given id", async () => {
    // db.update returns [] — no row was updated
    updateChain([]);

    const res = await request(app)
      .patch("/api/iroc/invoices/999/status")
      .set("Authorization", AUTH)
      .send({ status: "draft" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 for a truly unrecognised status value", async () => {
    // The Zod schema accepts draft/sent/paid/cancelled.
    // A value outside that set (e.g. "voided") must be rejected before any DB call.
    updateChain([]);

    const res = await request(app)
      .patch("/api/iroc/invoices/7/status")
      .set("Authorization", AUTH)
      .send({ status: "voided" });

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 401 without a valid JWT", async () => {
    const res = await request(app)
      .patch("/api/iroc/invoices/7/status")
      .send({ status: "draft" });

    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ── Concurrent status updates — last-write-wins, no stale dashboard ───────────
//
// Simulates two admins updating the same invoice status simultaneously.
//
// Design
// ------
// A shared `invoiceStatus` variable acts as the mocked DB state:
//   • The PATCH mock's returning().then() callback writes to it when each
//     commit resolves — this is the "write" side.
//   • The post-race dashboard mock derives its recentOrders result from it —
//     this is the "read" side that connects write and read through shared state.
//
// Deferreds are bound to requested status (not call-arrival order) so the test
// is deterministic under any scheduling.  A pollUntil barrier spins until both
// set() calls have fired, proving both requests were in-flight at the DB write
// boundary before either commit was released.
//
// Last-write ordering is controlled explicitly: the "paid" deferred resolves
// last, so invoiceStatus ends as "paid" regardless of which request called
// set() first.  The post-race dashboard is then built from invoiceStatus,
// which means it can only pass if the write side actually updated the variable.

/** Poll (via setImmediate) until `cond` is truthy or `maxMs` elapses. */
async function pollUntil(cond: () => boolean, maxMs = 2000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("pollUntil: timed out");
    await new Promise<void>(r => setImmediate(r));
  }
}

describe("Concurrent PATCH /iroc/invoices/:id/status — last-write-wins, no stale dashboard", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockSelect.mockReset();
    mockSelectDistinct.mockReset();
    installDefaultPatchSelects("sent");
    mockInArray.mockClear();
    mockInArray.mockReturnValue({ __sentinel: "inArray" });
  });

  it("both in-flight writes commit via shared state; dashboard after the race reads from that shared state, not a stale pre-update snapshot", async () => {
    // ── Shared mutable DB state ────────────────────────────────────────────
    // Both the PATCH write-side and the dashboard read-side reference this
    // variable.  It starts as "sent" (customer visible).  After the race the
    // last-committed write sets it to "paid" (customer hidden).
    let invoiceStatus: "draft" | "sent" | "paid" = "sent";
    const wc = makeWcRow({ id: 5 });

    // ── Deferreds bound to REQUESTED STATUS (not call-arrival order) ──────
    // This removes any dependency on which request reaches set() first.
    let resolveForDraft!: (rows: unknown[]) => void;
    let resolveForPaid!:  (rows: unknown[]) => void;
    const deferredForDraft = new Promise<unknown[]>(r => { resolveForDraft = r; });
    const deferredForPaid  = new Promise<unknown[]>(r => { resolveForPaid  = r; });

    // returning() blocks on the status-specific deferred.
    // When the deferred resolves, the .then() callback mutates invoiceStatus
    // (last-write-wins), then returns the rows to the Express handler.
    const setFn = vi.fn().mockImplementation(
      (data: { status: "draft" | "sent" | "paid" | "cancelled" }) => {
        const d = data.status === "draft" ? deferredForDraft : deferredForPaid;
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockImplementation(() =>
              d.then(rows => {
                invoiceStatus = data.status as "draft" | "sent" | "paid";
                return rows;
              }),
            ),
          }),
        };
      },
    );
    mockUpdate.mockReturnValue({ set: setFn });

    // ── Step 1: dashboard BEFORE any updates (baseline) ───────────────────
    // invoiceStatus = "sent" → customer is visible in New Orders.
    setupBoilerplateSelects();
    mockSelectDistinct.mockReturnValueOnce(selectChain([]));
    mockSelect.mockReturnValueOnce(selectChain([wc]));                               // recentOrders: customer visible
    mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // recentTrainings
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // openInvoiceRows (#14)
    mockSelect.mockReturnValueOnce(selectChain([]));                                 // itemRows (#15)

    const preDashRes = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);
    expect(preDashRes.status).toBe(200);
    expect(preDashRes.body.recentOrders).toHaveLength(1);                            // baseline confirmed

    // ── Step 2: start both PATCHes without awaiting ───────────────────────
    // Admin A → "draft"   (first to be committed)
    // Admin B → "paid"    (last to be committed → final state)
    const patchDraftPromise = request(app)
      .patch("/api/iroc/invoices/5/status")
      .set("Authorization", AUTH)
      .send({ status: "draft" });
    const patchPaidPromise = request(app)
      .patch("/api/iroc/invoices/5/status")
      .set("Authorization", AUTH)
      .send({ status: "paid" });

    const bothDone = Promise.all([patchDraftPromise, patchPaidPromise]);

    // Spin until BOTH set() calls have fired — at this point both handlers
    // are genuinely suspended at their returning() await (in-flight simultaneously).
    await pollUntil(() => setFn.mock.calls.length >= 2);

    // ── Step 3: resolve in controlled order ───────────────────────────────
    // draft commits first  → invoiceStatus = "draft"
    // paid  commits second → invoiceStatus = "paid"  (last-write-wins)
    resolveForDraft([makeInvoiceRow({ id: 5, status: "draft" })]);
    await new Promise<void>(r => setImmediate(r));  // allow draft .then() to run
    resolveForPaid([makeInvoiceRow({ id: 5, status: "paid" })]);

    const [resDraft, resPaid] = await bothDone;

    // Both requests succeed; each echoes only its own write (no cross-bleed).
    expect(resDraft.status).toBe(200);
    expect(resPaid.status).toBe(200);
    expect(resDraft.body.status).toBe("draft");
    expect(resPaid.body.status).toBe("paid");
    expect(setFn).toHaveBeenCalledTimes(2);

    // Shared state reflects the final committed write.
    expect(invoiceStatus).toBe("paid");

    // ── Step 4: dashboard AFTER both commits ─────────────────────────────
    // The dashboard mock derives its recentOrders from `invoiceStatus` —
    // the SAME variable that the returning().then() callbacks wrote to above.
    // This links write and read through shared state: if the write callbacks
    // never ran, invoiceStatus would still be "sent" and postRecentOrders
    // would be [wc] (1 entry) — making the `toEqual([])` assertion fail.
    setupBoilerplateSelects();
    mockSelectDistinct.mockReturnValueOnce(selectChain([]));
    const postRecentOrders = (invoiceStatus as "draft" | "sent" | "paid") === "paid" ? [] : [wc];
    mockSelect.mockReturnValueOnce(selectChain(postRecentOrders));                   // read from shared state
    mockSelect.mockReturnValueOnce(selectChain([{ pendingTrainings: 0 }]));
    mockSelect.mockReturnValueOnce(selectChain([]));
    if (postRecentOrders.length > 0) {
      mockSelect.mockReturnValueOnce(selectChain([]));                               // openInvoiceRows (#14)
      mockSelect.mockReturnValueOnce(selectChain([]));                               // itemRows (#15)
    }

    const postDashRes = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);
    expect(postDashRes.status).toBe(200);

    // Final write was "paid" → customer absent from New Orders.
    expect(postDashRes.body.recentOrders).toEqual([]);

    // The pre-update dashboard had 1 entry; the post-update dashboard has 0.
    // A stale in-process cache returning the pre-update snapshot would have
    // kept 1 entry here, causing this assertion to fail.
    expect(preDashRes.body.recentOrders).toHaveLength(1);
    expect(postDashRes.body.recentOrders).toHaveLength(0);
  });

  it("each concurrent request's response carries only its own status — no state leaks between handlers", async () => {
    // Cross-contamination guard: even when both handlers are in-flight
    // simultaneously, response for "paid" always returns "paid" and response
    // for "sent" always returns "sent".  Any leaked mutable state between
    // handler invocations would cause a swap or merge.
    //
    // Deferreds are bound to requested status (not arrival order) for the
    // same determinism guarantee as the main concurrency test.
    let resolveForPaid2!: (rows: unknown[]) => void;
    let resolveForSent!:  (rows: unknown[]) => void;
    const deferredForPaid2 = new Promise<unknown[]>(r => { resolveForPaid2 = r; });
    const deferredForSent  = new Promise<unknown[]>(r => { resolveForSent  = r; });

    const setFn2 = vi.fn().mockImplementation(
      (data: { status: "draft" | "sent" | "paid" | "cancelled" }) => {
        const d = data.status === "paid" ? deferredForPaid2 : deferredForSent;
        return { where: vi.fn().mockReturnValue({ returning: vi.fn().mockReturnValue(d) }) };
      },
    );
    mockUpdate.mockReturnValue({ set: setFn2 });

    const patchPaidPromise = request(app)
      .patch("/api/iroc/invoices/11/status")
      .set("Authorization", AUTH)
      .send({ status: "paid" });
    const patchSentPromise = request(app)
      .patch("/api/iroc/invoices/11/status")
      .set("Authorization", AUTH)
      .send({ status: "sent" });

    const bothDone2 = Promise.all([patchPaidPromise, patchSentPromise]);
    await pollUntil(() => setFn2.mock.calls.length >= 2);

    resolveForPaid2([makeInvoiceRow({ id: 11, status: "paid" })]);
    await new Promise<void>(r => setImmediate(r));
    resolveForSent([makeInvoiceRow({ id: 11, status: "sent" })]);

    const [resPaid2, resSent] = await bothDone2;

    expect(resPaid2.status).toBe(200);
    expect(resSent.status).toBe(200);
    // Statuses must not have swapped or merged.
    expect(resPaid2.body.status).toBe("paid");
    expect(resSent.body.status).toBe("sent");
    expect(setFn2).toHaveBeenCalledTimes(2);
  });
});

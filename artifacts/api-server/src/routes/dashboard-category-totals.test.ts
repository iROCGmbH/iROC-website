/**
 * Tests for GET /api/iroc/dashboard — product-group totals in New Orders
 *
 * Confirms that the `categoryTotals` array in each recentOrders entry is
 * built correctly from open (draft or sent) invoices.
 *
 * What & Why
 * ──────────
 * The backend fetches `recentOrderRows` (customers with draft/sent invoices)
 * and then, when the list is non-empty, fetches `openInvoiceRows` +
 * `itemRows` in a Promise.all and computes per-category proportional gross
 * totals in JS via inferCategory().
 *
 * Cancelling or paying an invoice removes it from the open-status filter, so:
 *   1. Two open invoices  → both Spirecut® and MiniStem® totals visible.
 *   2. MiniStem cancelled → only Spirecut® total remains.
 *   3. All paid/cancelled → customer row absent from New Orders entirely.
 *   4. Services invoice   → "services" category total appears.
 *   5. All-unlinked invoice items → customer row remains with an "other" total.
 *   6. All-zero invoice items → dashboard response remains valid.
 *   7. No invoice items      → customer row remains with an empty array.
 *
 * Regression guard
 * ────────────────
 * Alongside the response-shape assertions each test spies on `inArray` (from
 * drizzle-orm) and verifies that the customer-id predicate was applied to
 * BOTH the openInvoiceRows query and the itemRows query (calls 14 & 15).
 * Removing or widening either WHERE clause breaks the spy assertion even if
 * the mocked DB rows happen to look correct.
 *
 * Mock structure
 * ─────────────
 * A position-based queue provides return values for the ~15 sequential
 * db.select() / db.selectDistinct() calls.  Each call pops the next entry
 * and returns a "chainable thenable" — an object that supports every Drizzle
 * builder method (.from, .where, .innerJoin, .leftJoin, .groupBy, .orderBy,
 * .limit) by returning itself, and that also acts as a Promise resolving with
 * the queued value.
 *
 * db.select() call order
 * ──────────────────────
 * Batch 1 (Promise.all): [1] totalCustomers, [2] totalProducts,
 *                        [3] lowStockCount,   [4] unreadNotifications,
 *                        [5] pendingIncomingOrders,
 *                        [6] confirmedIncomingOrders
 * Batch 2 (Promise.all): [7] totalInvoices,   [8] revenueTotal,
 *                        [9] revenueSent,      [10] statusRows
 * Sequential:            [11] quoteRows
 *                        [12] recentOrderRows
 *                        [13] pendingTrainings
 *                        [14] recentTrainingRows
 * Promise.all (when customerIds non-empty):
 *                        [15] openInvoiceRows
 *                        [16] itemRows
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist queue + select mocks ────────────────────────────────────────────────
// All state referenced inside vi.mock() factories must be declared via
// vi.hoisted() so it is available before factories execute.

const { mockSelectQueue, mockSelect, mockSelectDistinct } = vi.hoisted(() => {
  const mockSelectQueue: unknown[][] = [];

  /** Chainable thenable: every Drizzle builder method returns `chain`
   *  and the object resolves as a Promise with the queued `data`. */
  function makeChain(data: unknown[]) {
    const p = Promise.resolve(data);
    const chain: Record<string, unknown> = {
      then:    (res: Parameters<Promise<unknown>["then"]>[0], rej?: Parameters<Promise<unknown>["then"]>[1]) => p.then(res, rej),
      catch:   (rej: Parameters<Promise<unknown>["catch"]>[0]) => p.catch(rej),
      finally: (fn: Parameters<Promise<unknown>["finally"]>[0]) => p.finally(fn),
    };
    for (const m of ["from", "where", "innerJoin", "leftJoin", "groupBy", "orderBy", "limit"]) {
      chain[m] = () => chain;
    }
    return chain;
  }

  const mockSelect = vi.fn(() => {
    const data = mockSelectQueue.shift() ?? [];
    return makeChain(data);
  });

  const mockSelectDistinct = vi.fn(() => {
    const data = mockSelectQueue.shift() ?? [];
    return makeChain(data);
  });

  return { mockSelectQueue, mockSelect, mockSelectDistinct };
});

// ── Spy on inArray from drizzle-orm ──────────────────────────────────────────
// Wrap the real inArray with vi.fn so we can assert which status arrays were
// passed to the WHERE clauses without actually running SQL.
// The original function still executes so the route handler receives valid
// Drizzle predicate objects (even though the mocked DB ignores them).
vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    inArray: vi.fn(original.inArray),
  };
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
  irocInvoices:               {},
  irocInvoiceItems:           {},
  irocOrders:                 {},
  irocCustomers:              {},
  websiteCustomersTable:      {},
  irocAppUsers:               {},
  irocNotifications:          {},
  settingsTable:              {},
  irocProducts:               {},
  irocInventoryLots:          {},
  trainingRegistrationsTable: {},
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

// ── Mock pdfkit (imported transitively by iroc.ts) ────────────────────────────

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

// ── Import app AFTER mocks ────────────────────────────────────────────────────

import app from "../app";

// Pull in the already-mocked inArray so we can inspect spy calls.
import { inArray } from "drizzle-orm";
const inArraySpy = inArray as ReturnType<typeof vi.fn>;

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_CUSTOMER = {
  id:              1,
  firstName:       "Anna",
  lastName:        "Example",
  institutionName: "Example Clinic",
  email:           "anna@example.com",
  instrument:      "spirecut",
  createdAt:       new Date("2026-01-15T10:00:00Z"),
};

// ── Queue helper ──────────────────────────────────────────────────────────────
//
// Stages all 15 sequential db calls the dashboard handler makes.
//
// @param recentOrders  Response for call #11.  Pass [] to simulate no open
//                      invoices (calls #14 & #15 are then skipped).
// @param sentInvoices  Response for call #14 — gross totals per open invoice.
// @param items         Response for call #15 — line items with category.

function stageQueue(
  recentOrders: (typeof BASE_CUSTOMER & { openOrderCount: number })[],
  sentInvoices: { id: number; customerId: number | null; total: string | null }[],
  items: {
    invoiceId: number;
    productId?: number | null;
    productName: string;
    category: string | null;
    lineTotal: string | null;
  }[],
) {
  mockSelectQueue.length = 0;

  // Batch 1
  mockSelectQueue.push([{ totalCustomers: 2 }]);
  mockSelectQueue.push([{ totalProducts:  3 }]);
  mockSelectQueue.push([{ lowStockCount:  0 }]);
  mockSelectQueue.push([{ unreadNotifications: 0 }]);
  mockSelectQueue.push([{ pendingIncomingOrders: 0 }]);
  mockSelectQueue.push([{ confirmedIncomingOrders: 0 }]);

  // Batch 2
  mockSelectQueue.push([{ totalInvoices: 3 }]);
  mockSelectQueue.push([{ revenueTotal: null }]);
  mockSelectQueue.push([{ revenueSent:  null }]);
  mockSelectQueue.push([
    { status: "draft",     n: 1 },
    { status: "sent",      n: 1 },
    { status: "paid",      n: 1 },
    { status: "cancelled", n: 1 },
  ]);

  // Sequential
  mockSelectQueue.push([{ year: 2026 }]);               // [11] yearRows (selectDistinct)
  mockSelectQueue.push([]);                              // [12] quoteRows → pendingQuotes = 0
  mockSelectQueue.push(recentOrders);                    // [13] recentOrderRows
  mockSelectQueue.push([{ pendingTrainings: 0 }]);       // [14]
  mockSelectQueue.push([]);                              // [15] recentTrainingRows

  // [16]+[17] openInvoiceRows + itemRows — only queued when recentOrders has entries
  if (recentOrders.length > 0) {
    mockSelectQueue.push(sentInvoices);  // [16]
    mockSelectQueue.push(items);         // [17]
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/iroc/dashboard — product-group totals and status filtering", () => {
  beforeEach(() => {
    mockSelect.mockClear();
    mockSelectDistinct.mockClear();
    inArraySpy.mockClear();
    mockSelectQueue.length = 0;
  });

  // ── Helper: assert the customer-id filter was applied ────────────────────
  // Verifies that inArray was called with exactly the expected customerIds at
  // least twice (once for openInvoiceRows, once for itemRows WHERE clauses).
  // Removing or widening either WHERE clause breaks this assertion even if the
  // mocked DB rows happen to look correct.
  function assertCustomerFilterApplied(expectedCustomerIds: number[]) {
    const customerIdCalls = inArraySpy.mock.calls.filter(
      (call) =>
        Array.isArray(call[1]) &&
        call[1].length === expectedCustomerIds.length &&
        expectedCustomerIds.every((id) => (call[1] as number[]).includes(id)),
    );
    expect(customerIdCalls.length).toBeGreaterThanOrEqual(2);
  }

  it("shows both Spirecut® and MiniStem® totals when both invoices are open", async () => {
    // One invoice contains both a Spirecut® and a MiniStem® line item.
    // The handler splits the invoice gross proportionally between categories.
    stageQueue(
      [{ ...BASE_CUSTOMER, openOrderCount: 2 }],
      [{ id: 101, customerId: 1, total: "1500.00" }],
      [
        { invoiceId: 101, productName: "Spirecut Device", category: "spirecut", lineTotal: "1000.00" },
        { invoiceId: 101, productName: "MiniStem Kit",    category: "ministem", lineTotal: "500.00"  },
      ],
    );

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const orders: { id: number; categoryTotals: { category: string; total: string }[] }[] =
      res.body.recentOrders;
    expect(orders).toHaveLength(1);

    const cats = orders[0].categoryTotals;
    expect(cats).toHaveLength(2);
    // spirecut gross = 1500 × (1000/1500) = 1000.00
    expect(cats.find(c => c.category === "spirecut")?.total).toBe("1000.00");
    // ministem gross = 1500 × (500/1500) = 500.00
    expect(cats.find(c => c.category === "ministem")?.total).toBe("500.00");
    expect(cats.find(c => c.category === "other")).toBeUndefined();

    // Both openInvoiceRows and itemRows queries must have applied the
    // customer-id inArray predicate.
    assertCustomerFilterApplied([1]);
  });

  it("keeps exactly three category totals for an uneven three-group invoice", async () => {
    // A single sent invoice contains all three product groups with uneven net
    // line totals. The handler must allocate the invoice gross proportionally
    // without dropping or accumulating a category.
    stageQueue(
      [{ ...BASE_CUSTOMER, openOrderCount: 1 }],
      [{ id: 101, customerId: 1, total: "1234.50" }],
      [
        { invoiceId: 101, productName: "Spirecut Device", category: "spirecut", lineTotal: "100.00" },
        { invoiceId: 101, productName: "MiniStem Kit",    category: "ministem", lineTotal: "200.00" },
        { invoiceId: 101, productName: "Other Item",      category: "other",    lineTotal: "700.00" },
      ],
    );

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const orders: { id: number; categoryTotals: { category: string; total: string }[] }[] =
      res.body.recentOrders;
    expect(orders).toHaveLength(1);

    // Net total = 1000.00; gross allocations are 10%, 20%, and 70%.
    expect(orders[0].categoryTotals).toEqual([
      { category: "spirecut", total: "123.45" },
      { category: "ministem", total: "246.90" },
      { category: "other",    total: "864.15" },
    ]);

    // Both openInvoiceRows and itemRows queries must have applied the
    // customer-id inArray predicate.
    assertCustomerFilterApplied([1]);
  });

  it("groups multiple open invoices under one customer and aggregates their category totals", async () => {
    // Two separate open invoices belong to the same customer.  The dashboard
    // must keep one New Orders row while adding each invoice's proportional
    // category gross to that customer's total.
    stageQueue(
      [{ ...BASE_CUSTOMER, openOrderCount: 2 }],
      [
        { id: 101, customerId: 1, total: "1000.00" }, // draft
        { id: 102, customerId: 1, total: "500.00" },  // sent
      ],
      [
        { invoiceId: 101, productName: "Spirecut Device", category: "spirecut", lineTotal: "1000.00" },
        { invoiceId: 102, productName: "MiniStem Kit",    category: "ministem",  lineTotal: "500.00"  },
      ],
    );

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentOrders).toHaveLength(1);
    expect(res.body.recentOrders[0]).toEqual(expect.objectContaining({
      id: BASE_CUSTOMER.id,
      email: BASE_CUSTOMER.email,
      openOrderCount: 2,
      categoryTotals: [
        { category: "spirecut", total: "1000.00" },
        { category: "ministem", total: "500.00" },
      ],
    }));

    // The open-status predicates on the customer and both follow-up queries
    // keep paid/cancelled invoices out of these totals.
    const statusCalls = inArraySpy.mock.calls.filter(
      (call) => Array.isArray(call[1]) && call[1].join(",") === "draft,sent",
    );
    expect(statusCalls).toHaveLength(3);
    assertCustomerFilterApplied([BASE_CUSTOMER.id]);
  });

  it("splits a mixed Spirecut® and other invoice gross proportionally", async () => {
    // A sent invoice with one named-category line and one unlinked line must
    // expose both category rows while preserving the invoice gross.
    stageQueue(
      [{ ...BASE_CUSTOMER, openOrderCount: 1 }],
      [{ id: 101, customerId: 1, total: "892.50" }],
      [
        { invoiceId: 101, productName: "Spirecut Device", category: "spirecut", lineTotal: "500.00" },
        { invoiceId: 101, productName: "Custom consulting line", category: null, lineTotal: "250.00" },
      ],
    );

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const orders: { id: number; categoryTotals: { category: string; total: string }[] }[] =
      res.body.recentOrders;
    expect(orders).toHaveLength(1);

    const cats = orders[0].categoryTotals;
    expect(cats).toHaveLength(2);
    // spirecut gross = 892.50 × (500/750) = 595.00
    expect(cats.find(c => c.category === "spirecut")?.total).toBe("595.00");
    // other gross = 892.50 × (250/750) = 297.50
    expect(cats.find(c => c.category === "other")?.total).toBe("297.50");
    expect(cats.reduce((sum, category) => sum + Number(category.total), 0)).toBeCloseTo(892.5, 2);

    // Both openInvoiceRows and itemRows queries must have applied the
    // customer-id inArray predicate.
    assertCustomerFilterApplied([1]);
  });

  it("keeps category totals equal to all line items when an invoice mixes linked and text-only items", async () => {
    const mixedItems = [
      {
        invoiceId: 101,
        productId: 11,
        productName: "Spirecut Device",
        category: "spirecut",
        lineTotal: "400.00",
      },
      {
        invoiceId: 101,
        productId: null,
        productName: "Custom consulting line",
        category: null,
        lineTotal: "200.00",
      },
    ];
    stageQueue(
      [{ ...BASE_CUSTOMER, openOrderCount: 1 }],
      [{ id: 101, customerId: 1, total: "600.00" }],
      mixedItems,
    );

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const orders: { id: number; categoryTotals: { category: string; total: string }[] }[] =
      res.body.recentOrders;
    expect(orders).toHaveLength(1);

    const cats = orders[0].categoryTotals;
    const lineItemsTotalCents = mixedItems.reduce(
      (sum, item) => sum + Math.round(Number(item.lineTotal) * 100),
      0,
    );
    const categoryTotalsCents = cats.reduce(
      (sum, item) => sum + Math.round(Number(item.total) * 100),
      0,
    );

    expect(categoryTotalsCents).toBe(lineItemsTotalCents);
    expect(categoryTotalsCents).toBe(60000);
    expect(cats.find(c => c.category === "spirecut")?.total).toBe("400.00");
    expect(cats.find(c => c.category === "other")?.total).toBe("200.00");
    expect(cats.filter(c => c.category === "other")).toHaveLength(1);

    assertCustomerFilterApplied([1]);
  });

  it("keeps an all-unlinked sent invoice in New Orders with an 'other' total", async () => {
    const unlinkedItems = [
      {
        invoiceId: 101,
        productId: null,
        productName: "Custom line item",
        category: null,
        lineTotal: "100.00",
      },
      {
        invoiceId: 101,
        productId: null,
        productName: "Manual adjustment",
        category: null,
        lineTotal: "200.00",
      },
    ];
    stageQueue(
      [{ ...BASE_CUSTOMER, openOrderCount: 1 }],
      [{ id: 101, customerId: 1, total: "300.00" }],
      unlinkedItems,
    );

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const orders: { id: number; email: string; categoryTotals: { category: string; total: string }[] }[] =
      res.body.recentOrders;
    expect(orders).toHaveLength(1);
    expect(orders[0].email).toBe(BASE_CUSTOMER.email);
    expect(orders[0].categoryTotals).toEqual([
      { category: "other", total: "300.00" },
    ]);

    assertCustomerFilterApplied([1]);
  });

  it("does not crash when all line items on an open invoice have zero totals", async () => {
    stageQueue(
      [{ ...BASE_CUSTOMER, openOrderCount: 1 }],
      [{ id: 101, customerId: 1, total: "0.00" }],
      [
        {
          invoiceId: 101,
          productId: null,
          productName: "Zero-value custom line",
          category: null,
          lineTotal: "0.00",
        },
      ],
    );

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentOrders).toEqual([
      expect.objectContaining({
        email: BASE_CUSTOMER.email,
        categoryTotals: [],
      }),
    ]);

    assertCustomerFilterApplied([1]);
  });

  it("keeps draft and sent customers visible with empty category totals when invoices have no line items", async () => {
    const secondCustomer = {
      ...BASE_CUSTOMER,
      id: 2,
      firstName: "Bernd",
      lastName: "Beispiel",
      email: "bernd@example.com",
    };

    // The recent-order query has already established that both customers have
    // an open invoice; the follow-up invoice and item queries return no items.
    stageQueue(
      [
        { ...BASE_CUSTOMER, openOrderCount: 1 },
        { ...secondCustomer, openOrderCount: 1 },
      ],
      [
        { id: 101, customerId: 1, total: "0.00" }, // draft
        { id: 102, customerId: 2, total: "125.00" }, // sent
      ],
      [],
    );

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentOrders).toEqual([
      expect.objectContaining({
        email: BASE_CUSTOMER.email,
        categoryTotals: [],
      }),
      expect.objectContaining({
        email: secondCustomer.email,
        categoryTotals: [],
      }),
    ]);

    assertCustomerFilterApplied([1, 2]);
  });

  it("shows only Spirecut® total after the MiniStem® invoice is cancelled", async () => {
    // The DB mock returns only the Spirecut® invoice — mirroring what a real
    // DB would return after applying the open-status filter post-cancellation.
    // The spy assertion independently confirms the handler scoped both queries
    // to the expected customer id.
    stageQueue(
      [{ ...BASE_CUSTOMER, openOrderCount: 1 }],
      [{ id: 101, customerId: 1, total: "1000.00" }],
      [
        { invoiceId: 101, productName: "Spirecut Device", category: "spirecut", lineTotal: "1000.00" },
      ],
    );

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const orders: { id: number; categoryTotals: { category: string; total: string }[] }[] =
      res.body.recentOrders;
    expect(orders).toHaveLength(1);

    const cats = orders[0].categoryTotals;
    expect(cats).toHaveLength(1);
    expect(cats[0].category).toBe("spirecut");
    expect(cats[0].total).toBe("1000.00");
    expect(cats.find(c => c.category === "ministem")).toBeUndefined();

    assertCustomerFilterApplied([1]);
  });

  it("shows a services category total when a services invoice is open", async () => {
    // Stages a single sent invoice whose only line item has category "services".
    // Confirms the category flows through to recentOrders[0].categoryTotals
    // with category === "services" so the frontend can render the correct label.
    stageQueue(
      [{ ...BASE_CUSTOMER, openOrderCount: 1 }],
      [{ id: 101, customerId: 1, total: "750.00" }],
      [
        { invoiceId: 101, productName: "Consultation Service", category: "services", lineTotal: "750.00" },
      ],
    );

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const orders: { id: number; categoryTotals: { category: string; total: string }[] }[] =
      res.body.recentOrders;
    expect(orders).toHaveLength(1);

    const cats = orders[0].categoryTotals;
    expect(cats).toHaveLength(1);
    expect(cats[0].category).toBe("services");
    // services gross = 750.00 × (750/750) = 750.00
    expect(cats[0].total).toBe("750.00");

    // Both openInvoiceRows and itemRows queries must have applied the
    // customer-id inArray predicate.
    assertCustomerFilterApplied([1]);
  });

  it("shows an 'other' category total when an invoice has an uncategorised line item", async () => {
    // Stages a single sent invoice whose only line item has category "other".
    // Confirms the category flows through to recentOrders[0].categoryTotals
    // with category === "other" so the frontend can render "Sonstige" / "Other".
    stageQueue(
      [{ ...BASE_CUSTOMER, openOrderCount: 1 }],
      [{ id: 101, customerId: 1, total: "200.00" }],
      [
        { invoiceId: 101, productName: "Miscellaneous Item", category: "other", lineTotal: "200.00" },
      ],
    );

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const orders: { id: number; categoryTotals: { category: string; total: string }[] }[] =
      res.body.recentOrders;
    expect(orders).toHaveLength(1);

    const cats = orders[0].categoryTotals;
    expect(cats).toHaveLength(1);
    expect(cats[0].category).toBe("other");
    // other gross = 200.00 × (200/200) = 200.00
    expect(cats[0].total).toBe("200.00");

    // Both openInvoiceRows and itemRows queries must have applied the
    // customer-id inArray predicate.
    assertCustomerFilterApplied([1]);
  });

  it("removes the customer row entirely after all invoices are paid or cancelled", async () => {
    // When no open invoices remain, recentOrderRows returns nothing.
    // openInvoiceRows and itemRows are never queried because customerIds is
    // empty.
    stageQueue(
      [],  // no open invoices → recentOrderRows = []
      [],  // openInvoiceRows never called
      [],  // itemRows never called
    );

    const res = await request(app)
      .get("/api/iroc/dashboard")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.recentOrders).toHaveLength(0);

    // The main recent-order query still applies the open-status predicate even
    // when no customer IDs are returned for the follow-up queries.
    const statusCalls = inArraySpy.mock.calls.filter(
      (call) => Array.isArray(call[1]) && call[1].join(",") === "draft,sent",
    );
    expect(statusCalls).toHaveLength(1);
  });
});

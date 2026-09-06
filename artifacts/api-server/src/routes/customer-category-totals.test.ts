/**
 * Tests for GET /api/iroc/website-customers/:id/category-totals
 *
 * Verifies that:
 *  1. A customer with mixed spirecut + services invoice items returns both
 *     category rows with the correct summed totals.
 *  2. A customer with no invoices returns an empty array.
 *  3. A non-numeric :id returns 400 with { error: "Invalid id" }.
 *
 * The endpoint DB chain is:
 *   db.select({...}).from(irocCustomerWebsiteLinks).where(...)
 *   db.select({...}).from(irocInvoiceItems)
 *     .innerJoin(irocInvoices, ...)
 *     .leftJoin(irocProducts, ...)
 *     .where(...)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist mock-factory state ──────────────────────────────────────────────────
const { mockWhere, mockLeftJoin, mockInnerJoin, mockFrom, mockDbSelect } =
  vi.hoisted(() => {
    const mockWhere     = vi.fn();
    const mockLeftJoin  = vi.fn();
    const mockInnerJoin = vi.fn();
    const mockFrom      = vi.fn();
    const mockDbSelect  = vi.fn().mockReturnValue({ from: mockFrom });

    return { mockWhere, mockLeftJoin, mockInnerJoin, mockFrom, mockDbSelect };
  });

// ── Mock @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  },
  irocInvoices:               {},
  irocInvoiceItems:           {},
  irocCustomers:              {},
  irocCustomerWebsiteLinks:   {},
  websiteCustomersTable:      {},
  irocAppUsers:               {},
  irocNotifications:          {},
  settingsTable:              {},
  irocProducts:               {},
  irocInventoryLots:          {},
  irocLeads:                  {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable:        {},
  doctorCertificationsTable:  {},
}));

// ── Mock pdfkit ───────────────────────────────────────────────────────────────
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

// ── JWT helper (mirrors requireIrocAuth in iroc.ts) ───────────────────────────
const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = { userId: 1, username: "admin", exp };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig  = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const AUTH = `Bearer ${makeIrocToken()}`;

// ── Helper: wire up the full select chain ─────────────────────────────────────
// Endpoint chains: mapping lookup, then invoice aggregate query.
function wireSelectChain(rows: unknown[], link?: { irocCustomerId: number }) {
  mockWhere
    .mockResolvedValueOnce(link ? [link] : [])
    .mockResolvedValueOnce(rows);
  mockLeftJoin.mockReturnValue({ where: mockWhere });
  mockInnerJoin.mockReturnValue({ leftJoin: mockLeftJoin });
  mockFrom
    .mockReturnValueOnce({ where: mockWhere })
    .mockReturnValue({ innerJoin: mockInnerJoin });
  mockDbSelect.mockReturnValue({ from: mockFrom });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("GET /api/iroc/website-customers/:id/category-totals", () => {
  beforeEach(() => {
    mockWhere.mockReset();
    mockLeftJoin.mockReset();
    mockInnerJoin.mockReset();
    mockFrom.mockReset();
    mockDbSelect.mockReset();
  });

  it("returns both categories when a customer has mixed spirecut and services invoice items", async () => {
    // Two items: one linked to a product with category "spirecut",
    // one linked to a product with category "services".
    wireSelectChain([
      { lineTotal: "150.00", productName: "Spirecut Pro",    productCategory: "spirecut" },
      { lineTotal: "250.00", productName: "Training Day",    productCategory: "services" },
      { lineTotal: "50.00",  productName: "Spirecut Bundle", productCategory: "spirecut" },
    ]);

    const res = await request(app)
      .get("/api/iroc/website-customers/7/category-totals")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    // Sorted alphabetically: services before spirecut
    expect(res.body).toEqual([
      { category: "services", total: "250.00" },
      { category: "spirecut", total: "200.00" },
    ]);
  });

  it("returns an empty array when a customer has no invoices", async () => {
    wireSelectChain([]);

    const res = await request(app)
      .get("/api/iroc/website-customers/99/category-totals")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 400 for a non-numeric id", async () => {
    // No DB call should be made — the handler short-circuits on NaN check.
    const res = await request(app)
      .get("/api/iroc/website-customers/not-a-number/category-totals")
      .set("Authorization", AUTH);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid id");
  });

  it("infers category from product name when no linked product category is available", async () => {
    // productCategory is null → inferCategory falls back to name keyword matching.
    wireSelectChain([
      { lineTotal: "100.00", productName: "Spirecut Basic",   productCategory: null },
      { lineTotal: "80.00",  productName: "MiniStem Classic", productCategory: null },
      { lineTotal: "30.00",  productName: "misc item",        productCategory: null },
    ]);

    const res = await request(app)
      .get("/api/iroc/website-customers/12/category-totals")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    // Sorted: ministem, other, spirecut
    expect(res.body).toEqual([
      { category: "ministem", total: "80.00" },
      { category: "other",    total: "30.00" },
      { category: "spirecut", total: "100.00" },
    ]);
  });

  it("includes legacy invoice totals only after the customer has a verified legacy link", async () => {
    wireSelectChain(
      [{ lineTotal: "120.00", productName: "Legacy service", productCategory: "services" }],
      { irocCustomerId: 7 },
    );

    const res = await request(app)
      .get("/api/iroc/website-customers/42/category-totals")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ category: "services", total: "120.00" }]);
    expect(mockWhere).toHaveBeenCalledTimes(2);
  });

  it("does not add a legacy fallback when the website customer has no verified link", async () => {
    wireSelectChain([]);

    const res = await request(app)
      .get("/api/iroc/website-customers/42/category-totals")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mockWhere).toHaveBeenCalledTimes(2);
  });

  it("excludes cancelled invoices before summing category totals", async () => {
    // The mocked query result represents the active invoice rows that remain
    // after the database applies the status predicate. Assert the predicate
    // itself so a cancelled invoice cannot be included by a future refactor.
    wireSelectChain([
      { lineTotal: "125.00", productName: "Spirecut Pro", productCategory: "spirecut" },
    ]);

    const res = await request(app)
      .get("/api/iroc/website-customers/7/category-totals")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ category: "spirecut", total: "125.00" }]);
    expect(JSON.stringify(mockWhere.mock.calls[1]?.[0])).toContain("cancelled");
  });
});

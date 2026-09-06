/**
 * Confirmation test: GET /iroc/invoices/:id/delivery-note returns 400 when
 * the invoice's websiteCustomerId does not exist in the DB.
 *
 * A missing linked customer must be rejected before PDF generation. Otherwise
 * the endpoint can return a successful but incomplete delivery note, or expose
 * an unhandled error as a 500.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

const { mockDbSelect, mockDbUpdate, updateReturning, mockDbDelete, mockDbInsert } = vi.hoisted(() => {
  const mockDbSelect = vi.fn();

  const updateReturning = vi.fn();
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const mockDbUpdate = vi.fn().mockReturnValue({ set: updateSet });

  const mockDbDelete = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue([]),
  });
  const mockDbInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue([]),
  });

  return { mockDbSelect, mockDbUpdate, updateReturning, mockDbDelete, mockDbInsert };
});


vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");

  class MockPDFDocument extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y = 0;

    text() { return this; }
    font() { return this; }
    fontSize() { return this; }
    fillColor() { return this; }
    strokeColor() { return this; }
    lineWidth() { return this; }
    opacity() { return this; }
    save() { return this; }
    restore() { return this; }
    rotate() { return this; }
    addPage() { return this; }
    image() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    rect() { return this; }
    clip() { return this; }
    stroke() { return this; }
    fill() { return this; }
    heightOfString() { return 10; }
    widthOfString(text: string) { return text.length * 5; }
    switchToPage() { return this; }
    bufferedPageRange() { return { start: 0, count: 1 }; }
    flushPages() { return this; }
  }

  return { default: MockPDFDocument };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    delete: mockDbDelete,
  },
  irocInvoices: {},
  irocInvoiceItems: {},
  irocCustomers: {},
  websiteCustomersTable: {},
  irocAppUsers: {},
  irocNotifications: {},
  settingsTable: {},
  irocProducts: {},
  irocInventoryLots: {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable: {},
}));

vi.mock("../lib/geocode", () => ({
  geocodeMissingDoctors: vi.fn().mockResolvedValue(undefined),
  geocodeSearch: vi.fn(),
  toCountryCode: vi.fn(),
  lookupPostalAddress: vi.fn(),
  lookupInstitutionMultiple: vi.fn(),
}));

import app from "../app";

const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = { userId: 1, username: "admin", exp };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const AUTH = `Bearer ${makeIrocToken()}`;

function selectChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockResolvedValue(result);
  return chain;
}

describe("GET /iroc/invoices/:id/delivery-note — rejects unknown customer references", () => {
  beforeEach(() => {
    mockDbSelect.mockReset().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    });
    updateReturning.mockReset();
  });

  it("returns 400 (not 200 or 500) when the website customer does not exist", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([{
        id: 1,
        websiteCustomerId: 99999,
        customerId: null,
      }]))
      .mockReturnValueOnce(selectChain([]));

    const res = await request(app)
      .get("/api/iroc/invoices/1/delivery-note")
      .set("Authorization", AUTH);

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
    expect(res.body).toHaveProperty("error");
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.headers["content-type"]).not.toMatch(/pdf/);
  });

  it("returns 400 (not 200 or 500) when only the legacy customerId is missing", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([{
        id: 2,
        websiteCustomerId: null,
        customerId: 99999,
      }]))
      .mockReturnValueOnce(selectChain([]));

    const res = await request(app)
      .get("/api/iroc/invoices/2/delivery-note")
      .set("Authorization", AUTH);

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
    expect(res.body).toHaveProperty("error");
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.headers["content-type"]).not.toMatch(/pdf/);
    // The missing-customer guard must run before the line-items query/PDF path.
    expect(mockDbSelect).toHaveBeenCalledTimes(2);
  });

  it("returns 400 before line-item lookup when both customer references are empty", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([{
      id: 3,
      websiteCustomerId: null,
      customerId: null,
    }]));

    const res = await request(app)
      .get("/api/iroc/invoices/3/delivery-note")
      .set("Authorization", AUTH);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.headers["content-type"]).not.toMatch(/pdf/);
    expect(mockDbSelect).toHaveBeenCalledTimes(1);
  });

  it("rejects a resolved but incomplete customer before line-item lookup or PDF rendering", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([{
        id: 4,
        websiteCustomerId: 7,
        customerId: null,
      }]))
      .mockReturnValueOnce(selectChain([{
        id: 7,
        name: "Incomplete Clinic",
        address: null,
        postalCode: "80331",
        city: "Munich",
        country: "Germany",
      }]));

    const res = await request(app)
      .get("/api/iroc/invoices/4/delivery-note")
      .set("Authorization", AUTH);

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toEqual({
      error: "Customer record is incomplete / Kundendatensatz ist unvollständig.",
    });
    expect(mockDbSelect).toHaveBeenCalledTimes(2);
  });
});
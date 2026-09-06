/**
 * Inventory lot receipt — stock transition
 *
 * Receiving a pending lot must be atomic: status changes from pending to
 * in_house and the product's stock quantity increases by that exact lot amount.
 * This is the durable server state the Inventory page reads after a refresh.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import request from "supertest";

const {
  mockPoolQuery,
  mockPoolConnect,
  mockClientQuery,
  mockClientRelease,
  MockObjectNotFoundError,
  MockObjectStorageService,
} = vi.hoisted(() => {
  const mockPoolQuery = vi.fn();
  const mockPoolConnect = vi.fn();
  const mockClientQuery = vi.fn();
  const mockClientRelease = vi.fn();

  class MockObjectNotFoundError extends Error {}
  class MockObjectStorageService {}

  return {
    mockPoolQuery,
    mockPoolConnect,
    mockClientQuery,
    mockClientRelease,
    MockObjectNotFoundError,
    MockObjectStorageService,
  };
});

vi.mock("@workspace/integrations-gemini-ai/image", () => ({
  ai: { models: { generateContent: vi.fn() } },
}));

vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService: MockObjectStorageService,
  ObjectNotFoundError: MockObjectNotFoundError,
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: mockPoolQuery,
    connect: mockPoolConnect,
  },
  db: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  },
  irocInvoices: {},
  irocInvoiceItems: {},
  irocCustomers: {},
  websiteCustomersTable: {},
  settingsTable: {},
  datevExports: {},
  datevExportItems: {},
  irocAppUsers: {},
  irocNotifications: {},
  irocProducts: {},
  irocInventoryLots: {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable: {},
  doctorCertificationsTable: {},
}));

vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");
  class MockPDF extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y = 0;
    font() { return this; }
    fontSize() { return this; }
    fillColor() { return this; }
    strokeColor() { return this; }
    lineWidth() { return this; }
    save() { return this; }
    restore() { return this; }
    addPage() { return this; }
    image() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    rect() { return this; }
    clip() { return this; }
    stroke() { return this; }
    fill() { return this; }
    text() { return this; }
    heightOfString() { return 10; }
    widthOfString() { return 10; }
    end(callback?: () => void) { super.end(callback); return this; }
  }
  return { default: MockPDF };
});

import app from "../app";

const secret = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
const data = Buffer.from(JSON.stringify({
  userId: 1,
  username: "admin",
  exp: Math.floor(Date.now() / 1000) + 60 * 60,
})).toString("base64url");
const auth = `Bearer ${data}.${crypto.createHmac("sha256", secret).update(data).digest("base64url")}`;

describe("PATCH /api/admin/inventory-lots/:id/receive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease,
    });
    mockClientQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [{
          id: 31,
          product_id: 7,
          quantity_received: 6,
          lot_number: "DELIVERY-LOT-31",
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined);
  });

  it("moves the lot into inventory and increments stock in one transaction", async () => {
    const res = await request(app)
      .patch("/api/admin/inventory-lots/31/receive")
      .set("Authorization", auth)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, lot: { id: 31, product_id: 7, quantity_received: 6 } });
    expect(mockClientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mockClientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("SET status='in_house'"),
      [31],
    );
    expect(mockClientQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("stock_quantity = stock_quantity + $1"),
      [6, 7],
    );
    expect(mockClientQuery).toHaveBeenNthCalledWith(4, "COMMIT");
    expect(mockClientRelease).toHaveBeenCalledOnce();
  });

  it("allows only one of two simultaneous receive requests to increment stock", async () => {
    let alreadyReceived = false;
    let stockIncrementCount = 0;
    mockPoolConnect.mockImplementation(async () => ({
      query: async (sql: string) => {
        if (sql.includes("UPDATE iroc_inventory_lots")) {
          if (alreadyReceived) return { rows: [] };
          alreadyReceived = true;
          return {
            rows: [{
              id: 31,
              product_id: 7,
              quantity_received: 6,
              lot_number: "DELIVERY-LOT-31",
            }],
          };
        }
        if (sql.includes("UPDATE iroc_products")) {
          stockIncrementCount += 1;
          return { rows: [] };
        }
        return undefined;
      },
      release: mockClientRelease,
    }));

    const responses = await Promise.all([
      request(app).patch("/api/admin/inventory-lots/31/receive").set("Authorization", auth).send({}),
      request(app).patch("/api/admin/inventory-lots/31/receive").set("Authorization", auth).send({}),
    ]);

    expect(responses.map(response => response.status).sort()).toEqual([200, 404]);
    expect(responses.find(response => response.status === 404)?.body).toEqual({
      error: "Lot not found or already received",
    });
    expect(stockIncrementCount).toBe(1);
    expect(mockClientRelease).toHaveBeenCalledTimes(2);
  });
});
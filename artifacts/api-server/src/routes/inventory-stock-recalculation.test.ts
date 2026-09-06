/**
 * Inventory stock recalculation — pending deliveries stay unavailable
 *
 * Editing or deleting an in-house lot recalculates its product's stock. That
 * aggregate must ignore pending delivery lots, otherwise unrelated inventory
 * maintenance would make unreceived stock available before receipt.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import request from "supertest";

const {
  mockAnd,
  mockEq,
  mockDelete,
  mockInsert,
  mockSelect,
  mockUpdate,
  mockPoolConnect,
  mockPoolQuery,
  MockObjectNotFoundError,
  MockObjectStorageService,
} = vi.hoisted(() => {
  const mockAnd = vi.fn((...conditions: unknown[]) => ({ conditions }));
  const mockEq = vi.fn((column: unknown, value: unknown) => ({ column, value }));
  class MockObjectNotFoundError extends Error {}
  class MockObjectStorageService {}
  return {
    mockAnd,
    mockEq,
    mockDelete: vi.fn(),
    mockInsert: vi.fn(),
    mockSelect: vi.fn(),
    mockUpdate: vi.fn(),
    mockPoolConnect: vi.fn(),
    mockPoolQuery: vi.fn(),
    MockObjectNotFoundError,
    MockObjectStorageService,
  };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, and: mockAnd, eq: mockEq };
});

vi.mock("@workspace/integrations-gemini-ai/image", () => ({
  ai: { models: { generateContent: vi.fn() } },
}));

vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService: MockObjectStorageService,
  ObjectNotFoundError: MockObjectNotFoundError,
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
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
  irocProducts: { id: "product.id", stockQuantity: "product.stock_quantity" },
  irocInventoryLots: {
    id: "lot.id",
    productId: "lot.product_id",
    status: "lot.status",
    emptyAt: "lot.empty_at",
  },
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

const inHouseLot = {
  id: 11,
  productId: 7,
  quantityReceived: 3,
  quantityUsed: 0,
  emptyAt: null,
  status: "in_house",
};

function selectAggregate(total: number) {
  const aggregateWhere = vi.fn().mockResolvedValue([{ total }]);
  mockSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({ where: aggregateWhere }),
  });
}

function updateStock() {
  mockUpdate.mockReturnValueOnce({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  });
}

function expectReceivedOnlyAggregate() {
  expect(mockEq).toHaveBeenCalledWith("lot.product_id", 7);
  expect(mockEq).toHaveBeenCalledWith("lot.status", "in_house");
  expect(mockAnd).toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPoolConnect.mockResolvedValue({ query: vi.fn(), release: vi.fn() });
  mockInsert.mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) });
});

describe("received-only inventory stock recalculation", () => {
  it("keeps a pending delivery out of stock when an in-house lot is edited", async () => {
    mockUpdate
      .mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([inHouseLot]) }),
        }),
      });
    selectAggregate(3); // The product also has a pending quantity of 8, excluded from this total.
    updateStock();

    const res = await request(app)
      .patch("/api/iroc/inventory/11")
      .set("Authorization", auth)
      .send({ quantityReceived: 3, quantityUsed: 0 });

    expect(res.status).toBe(200);
    expectReceivedOnlyAggregate();
    expect(mockUpdate).toHaveBeenLastCalledWith(expect.anything());
  });

  it("keeps a pending delivery out of stock when an in-house lot is deleted", async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([inHouseLot]),
        }),
      });
    mockDelete.mockReturnValueOnce({ where: vi.fn().mockResolvedValue([]) });
    selectAggregate(0); // The only remaining lot is pending and must not become available.
    updateStock();

    const res = await request(app)
      .delete("/api/iroc/inventory/11")
      .set("Authorization", auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Deleted" });
    expectReceivedOnlyAggregate();
  });
});
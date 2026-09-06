import crypto from "crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockInsert, mockUpdate } = vi.hoisted(() => {
  process.env.SESSION_SECRET = "product-group-validation-test-secret";
  return {
    mockSelect: vi.fn(),
    mockInsert: vi.fn(),
    mockUpdate: vi.fn(),
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: vi.fn(),
    transaction: vi.fn(),
    execute: vi.fn(),
  },
  pool: {},
  irocAppUsers: {},
  irocCustomers: {},
  irocProducts: { id: "id" },
  irocProductGroups: { id: "id", key: "key" },
  irocInventoryLots: {},
  irocInvoices: {},
  irocInvoiceItems: {},
  irocNotifications: {},
  irocLeads: {},
  irocOrders: {},
  websiteCustomersTable: {},
  trainingRegistrationsTable: {},
  settingsTable: {},
  trainedDoctorsTable: {},
  doctorCertificationsTable: {},
}));

import irocRouter from "./iroc";

const app = express();
app.use(express.json());
app.use(irocRouter);

const TEST_SECRET = "product-group-validation-test-secret";

function authorizationHeader(): string {
  const data = Buffer.from(JSON.stringify({
    userId: 1,
    username: "admin",
    exp: Math.floor(Date.now() / 1000) + 60,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", TEST_SECRET).update(data).digest("base64url");
  return `Bearer ${data}.${signature}`;
}

function mockProductGroupLookup(found: boolean) {
  const where = vi.fn().mockResolvedValue(found ? [{ id: 1 }] : []);
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({ where }),
  });
}

function storedProduct(category: string) {
  return {
    id: 1,
    sku: "TEST-001",
    nameEn: "Test product",
    nameDe: "Testprodukt",
    descriptionEn: null,
    descriptionDe: null,
    unitPrice: "10.00",
    unitPriceBrutto: null,
    purchasePrice: null,
    purchaseDiscount: null,
    purchaseCurrency: null,
    purchaseRawPrice: null,
    recommendedPrice: null,
    stockQuantity: 0,
    lowStockThreshold: 5,
    category,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function mockProductInsert(category: string) {
  mockInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([storedProduct(category)]),
    }),
  });
}

function mockProductUpdate(category: string) {
  mockUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([storedProduct(category)]),
      }),
    }),
  });
}

function productBody(category: string) {
  return {
    sku: "TEST-001",
    nameEn: "Test product",
    nameDe: "Testprodukt",
    unitPrice: "10.00",
    category,
  };
}

describe("product-group validation", () => {
  beforeEach(() => {
    mockSelect.mockReset();
    mockInsert.mockReset();
    mockUpdate.mockReset();
  });

  it("returns 400 without saving or editing to an unknown product group", async () => {
    mockProductGroupLookup(false);

    const createResponse = await request(app)
      .post("/iroc/products")
      .set("Authorization", authorizationHeader())
      .send(productBody("invalid_group"));

    expect(createResponse.status).toBe(400);
    expect(createResponse.body).toEqual({ error: "Unknown product group" });
    expect(mockInsert).not.toHaveBeenCalled();

    mockProductGroupLookup(false);
    const updateResponse = await request(app)
      .patch("/iroc/products/1")
      .set("Authorization", authorizationHeader())
      .send(productBody("invalid_group"));

    expect(updateResponse.status).toBe(400);
    expect(updateResponse.body).toEqual({ error: "Unknown product group" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it.each(["services", "custom-accessories"])(
    "accepts an existing %s product group",
    async (category) => {
      mockProductGroupLookup(true);
      mockProductInsert(category);

      const response = await request(app)
        .post("/iroc/products")
        .set("Authorization", authorizationHeader())
        .send(productBody(category));

      expect(response.status).toBe(201);
      expect(response.body.category).toBe(category);

      mockProductGroupLookup(true);
      mockProductUpdate(category);
      const updateResponse = await request(app)
        .patch("/iroc/products/1")
        .set("Authorization", authorizationHeader())
        .send(productBody(category));

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.category).toBe(category);
    },
  );
});
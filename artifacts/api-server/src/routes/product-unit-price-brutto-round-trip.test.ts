import crypto from "crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSelect,
  mockInsert,
  mockUpdate,
  getStoredProduct,
  setStoredProduct,
  mockTables,
} = vi.hoisted(() => {
  process.env.SESSION_SECRET = "product-unit-price-brutto-test-secret";

  const mockTables = {
    irocAppUsers: { username: "username" },
    irocCustomers: {},
    irocProducts: { id: "product_id", sku: "sku" },
    irocProductGroups: { id: "group_id", key: "key" },
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
  };

  let storedProduct = {
    id: 1,
    sku: "TEST-BRUTTO-001",
    nameEn: "Gross price test product",
    nameDe: "Testprodukt Bruttopreis",
    descriptionEn: null,
    descriptionDe: null,
    unitPrice: "100.00",
    unitPriceBrutto: null as string | null,
    purchasePrice: null as string | null,
    purchaseDiscount: null as string | null,
    purchaseCurrency: "EUR",
    purchaseRawPrice: null,
    recommendedPrice: null as string | null,
    stockQuantity: 0,
    lowStockThreshold: 5,
    category: "cellenis",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  return {
    mockSelect: vi.fn(),
    mockInsert: vi.fn(),
    mockUpdate: vi.fn(),
    getStoredProduct: () => storedProduct,
    setStoredProduct: (next: typeof storedProduct) => { storedProduct = next; },
    mockTables,
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
  ...mockTables,
}));

import irocRouter from "./iroc";

const app = express();
app.use(express.json());
app.use(irocRouter);

function authorizationHeader(): string {
  const data = Buffer.from(JSON.stringify({
    userId: 1,
    username: "admin",
    exp: Math.floor(Date.now() / 1000) + 60,
  })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", "product-unit-price-brutto-test-secret")
    .update(data)
    .digest("base64url");
  return `Bearer ${data}.${signature}`;
}

function productSelectChain() {
  const rows = [getStoredProduct()];
  const whereResult = Object.assign(Promise.resolve(rows), {
    limit: vi.fn().mockResolvedValue(rows),
  });
  return {
    from: vi.fn().mockImplementation((table: unknown) => {
      if (table === mockTables.irocProducts) {
        return {
          where: vi.fn().mockReturnValue(whereResult),
          orderBy: vi.fn().mockResolvedValue(rows),
        };
      }
      return {
        where: vi.fn().mockReturnValue(Object.assign(Promise.resolve([]), {
          limit: vi.fn().mockResolvedValue([]),
        })),
        orderBy: vi.fn().mockResolvedValue([]),
      };
    }),
  };
}

beforeEach(() => {
  mockInsert.mockReset();
  mockUpdate.mockReset();
  setStoredProduct({
    ...getStoredProduct(),
    unitPriceBrutto: null,
    purchasePrice: null,
    purchaseDiscount: null,
    recommendedPrice: null,
  });
  mockSelect.mockImplementation(productSelectChain);
  mockInsert.mockImplementation(() => ({
    values: vi.fn().mockImplementation((values: Record<string, unknown>) => ({
      returning: vi.fn().mockImplementation(async () => {
        setStoredProduct({ ...getStoredProduct(), ...values });
        return [getStoredProduct()];
      }),
    })),
  }));
  mockUpdate.mockImplementation(() => ({
    set: vi.fn().mockImplementation((values: Record<string, unknown>) => ({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(async () => {
          setStoredProduct({ ...getStoredProduct(), ...values });
          return [getStoredProduct()];
        }),
      }),
    })),
  }));
});

describe("product unitPriceBrutto round-trip", () => {
  it("keeps nullable purchase and recommended prices identical in list, detail, create, and update responses", async () => {
    const monetaryFields = {
      purchasePrice: "70.25",
      purchaseDiscount: "12.50",
      recommendedPrice: "149.99",
    };
    const expectedPopulated = expect.objectContaining(monetaryFields);
    const createResponse = await request(app)
      .post("/iroc/products")
      .set("Authorization", authorizationHeader())
      .send({
        sku: "TEST-BRUTTO-001",
        nameEn: "Gross price test product",
        nameDe: "Testprodukt Bruttopreis",
        unitPrice: "100.00",
        ...monetaryFields,
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toEqual(expectedPopulated);

    const listResponse = await request(app).get("/iroc/products").set("Authorization", authorizationHeader());
    const detailResponse = await request(app).get("/iroc/products/1").set("Authorization", authorizationHeader());
    expect(listResponse.body[0]).toEqual(expectedPopulated);
    expect(detailResponse.body).toEqual(expectedPopulated);

    const cleared = {
      purchasePrice: null,
      purchaseDiscount: null,
      recommendedPrice: null,
    };
    const updateResponse = await request(app)
      .patch("/iroc/products/1")
      .set("Authorization", authorizationHeader())
      .send({
        sku: "TEST-BRUTTO-001",
        nameEn: "Gross price test product",
        nameDe: "Testprodukt Bruttopreis",
        unitPrice: "100.00",
        ...cleared,
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toEqual(expect.objectContaining(cleared));
    const listAfterClear = await request(app).get("/iroc/products").set("Authorization", authorizationHeader());
    const detailAfterClear = await request(app).get("/iroc/products/1").set("Authorization", authorizationHeader());
    expect(listAfterClear.body[0]).toEqual(expect.objectContaining(cleared));
    expect(detailAfterClear.body).toEqual(expect.objectContaining(cleared));
  });

  it("persists gross price on create and update, and returns it from GET /iroc/products", async () => {
    const createResponse = await request(app)
      .post("/iroc/products")
      .set("Authorization", authorizationHeader())
      .send({
        sku: "TEST-BRUTTO-001",
        nameEn: "Gross price test product",
        nameDe: "Testprodukt Bruttopreis",
        unitPrice: "100.00",
        unitPriceBrutto: "119.00",
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.unitPriceBrutto).toBe("119.00");
    expect(mockInsert.mock.results[0]?.value.values).toHaveBeenCalledWith(
      expect.objectContaining({ unitPriceBrutto: "119.00" }),
    );

    const afterCreate = await request(app)
      .get("/iroc/products")
      .set("Authorization", authorizationHeader());

    expect(afterCreate.status).toBe(200);
    expect(afterCreate.body).toEqual([
      expect.objectContaining({
        sku: "TEST-BRUTTO-001",
        unitPriceBrutto: "119.00",
      }),
    ]);

    const updateResponse = await request(app)
      .patch("/iroc/products/1")
      .set("Authorization", authorizationHeader())
      .send({
        sku: "TEST-BRUTTO-001",
        nameEn: "Gross price test product",
        nameDe: "Testprodukt Bruttopreis",
        unitPrice: "100.00",
        unitPriceBrutto: "121.50",
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.unitPriceBrutto).toBe("121.50");
    expect(mockUpdate.mock.results[0]?.value.set).toHaveBeenCalledWith(
      expect.objectContaining({ unitPriceBrutto: "121.50" }),
    );

    const afterUpdate = await request(app)
      .get("/iroc/products")
      .set("Authorization", authorizationHeader());

    expect(afterUpdate.status).toBe(200);
    expect(afterUpdate.body).toEqual([
      expect.objectContaining({
        sku: "TEST-BRUTTO-001",
        unitPriceBrutto: "121.50",
      }),
    ]);

    const detailAfterUpdate = await request(app)
      .get("/iroc/products/1")
      .set("Authorization", authorizationHeader());

    expect(detailAfterUpdate.status).toBe(200);
    expect(detailAfterUpdate.body.unitPriceBrutto).toBe("121.50");

    const clearResponse = await request(app)
      .patch("/iroc/products/1")
      .set("Authorization", authorizationHeader())
      .send({
        sku: "TEST-BRUTTO-001",
        nameEn: "Gross price test product",
        nameDe: "Testprodukt Bruttopreis",
        unitPrice: "100.00",
        unitPriceBrutto: null,
      });

    expect(clearResponse.status).toBe(200);
    expect(clearResponse.body.unitPriceBrutto).toBeNull();
    expect(mockUpdate.mock.results[1]?.value.set).toHaveBeenCalledWith(
      expect.objectContaining({ unitPriceBrutto: null }),
    );

    const afterClear = await request(app)
      .get("/iroc/products")
      .set("Authorization", authorizationHeader());

    expect(afterClear.status).toBe(200);
    expect(afterClear.body).toEqual([
      expect.objectContaining({
        sku: "TEST-BRUTTO-001",
        unitPriceBrutto: null,
      }),
    ]);

    const detailAfterClear = await request(app)
      .get("/iroc/products/1")
      .set("Authorization", authorizationHeader());

    expect(detailAfterClear.status).toBe(200);
    expect(detailAfterClear.body.unitPriceBrutto).toBeNull();
  });
});
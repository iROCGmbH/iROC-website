import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockValues, mockPoolQuery, mockCreatePortalOrder } = vi.hoisted(() => {
  process.env.SESSION_SECRET = "portal-products-order-test-secret";
  return {
    mockSelect: vi.fn(),
    mockValues: vi.fn().mockResolvedValue({}),
    mockPoolQuery: vi.fn().mockResolvedValue({ rows: [] }),
    mockCreatePortalOrder: vi.fn().mockResolvedValue({
      orderId: 101,
      invoiceId: 202,
      invoiceNumber: "2026-0101",
      invoiceStatus: "draft",
    }),
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn().mockReturnValue({ values: mockValues }),
  },
  pool: { query: mockPoolQuery },
  websiteCustomersTable: {
    id: "id",
    instrument: "instrument",
    certifications: "certifications",
  },
  irocInvoices: {},
  irocInvoiceItems: {},
  irocCustomers: {},
  resourcesTable: {},
  adminApprovalQueueTable: {},
  irocProducts: {
    id: "id",
    nameEn: "name_en",
    nameDe: "name_de",
    category: "category",
  },
  irocProductGroups: {
    key: "key",
    isService: "is_service",
    sortOrder: "sort_order",
  },
  trainingDatesTable: {},
  settingsTable: {},
}));

vi.mock("../lib/portal-order-invoice", () => ({
  createPortalOrderAndDraftInvoice: mockCreatePortalOrder,
}));

import portalRouter from "./portal";

const app = express();
app.use(express.json());
app.use(portalRouter);

function authHeaderFor(instrument: string): string {
  return `Bearer ${jwt.sign(
    { customerId: 25, customerNr: "DOC10025", instrument },
    "portal-products-order-test-secret",
  )}`;
}

function authHeaderForCertifications(certifications: string[]): string {
  return `Bearer ${jwt.sign(
    {
      customerId: 25,
      customerNr: "DOC10025",
      instrument: certifications[0] ?? "spirecut",
      certifications,
    },
    "portal-products-order-test-secret",
  )}`;
}

const authHeader = authHeaderFor("spirecut");
const confirmedOrderDetails = {
  contactName: "Doctor Example",
  contactEmail: "doctor@example.com",
  contactPhone: "+49 30 123456",
  deliveryAddress: "Clinic Street 1\n10115 Berlin\nGermany",
  privacyConsent: true,
  detailsConfirmed: true,
};

function mockSelectRows(rows: unknown[]) {
  const result = Promise.resolve(rows);
  mockSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
        then: result.then.bind(result),
      }),
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: result.then.bind(result),
        }),
      }),
    }),
  });
}

function mockCatalogRows(groups: unknown[], products: unknown[]) {
  mockSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(groups),
      }),
    }),
  });
  mockSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockResolvedValue(products),
    }),
  });
}

beforeEach(() => {
  mockSelect.mockReset();
  mockValues.mockClear();
  mockPoolQuery.mockReset();
  mockPoolQuery.mockResolvedValue({ rows: [] });
  mockCreatePortalOrder.mockClear();
});

describe("portal order product payload", () => {
  it("rejects product orders unless both confirmations are explicitly true", async () => {
    const response = await request(app)
      .post("/portal/order-request")
      .set("Authorization", authHeader)
      .send({
        ...confirmedOrderDetails,
        detailsConfirmed: false,
        orderMode: "product",
        products: [{ productId: 7, quantity: 1 }],
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "ORDER_DETAILS_CONFIRMATION_REQUIRED" });
    expect(mockCreatePortalOrder).not.toHaveBeenCalled();
  });

  it("creates an incoming order and draft invoice from server-derived product details", async () => {
    const payload = {
      ...confirmedOrderDetails,
      orderMode: "product",
      products: [
        {
          productId: 7,
          name: "Client-supplied name is ignored",
          quantity: 2,
          category: "Client-supplied category is ignored",
        },
      ],
    };
    mockSelectRows([{ instrument: "spirecut" }]);
    mockSelectRows([
      {
        id: 7,
        nameEn: "Spirecut CT",
        nameDe: "Spirecut CT",
        category: "spirecut",
        isService: false,
      },
    ]);

    const response = await request(app)
      .post("/portal/order-request")
      .set("Authorization", authHeader)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      orderId: 101,
      invoiceId: 202,
      invoiceNumber: "2026-0101",
      invoiceStatus: "draft",
    });
    expect(mockCreatePortalOrder).toHaveBeenCalledWith(expect.objectContaining({
      contactEmail: "doctor@example.com",
      contactPhone: "+49 30 123456",
      deliveryAddress: "Clinic Street 1\n10115 Berlin\nGermany",
      products: [
        expect.objectContaining({
          id: 7,
          nameEn: "Spirecut CT",
          quantity: 2,
          category: "spirecut",
        }),
      ],
    }), { createInvoice: true });
    expect(mockValues).not.toHaveBeenCalled();
  });

  it("passes the paused invoice automation state through while retaining the incoming order", async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{ key: "sally_auto_invoice_enabled", value: "false" }],
    });
    mockSelectRows([{ instrument: "spirecut" }]);
    mockSelectRows([{
      id: 7,
      nameEn: "Spirecut CT",
      nameDe: "Spirecut CT",
      category: "spirecut",
      isService: false,
    }]);

    const response = await request(app)
      .post("/portal/order-request")
      .set("Authorization", authHeader)
      .send({
        ...confirmedOrderDetails,
        orderMode: "product",
        products: [{ productId: 7, quantity: 1 }],
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, orderId: 101, invoiceId: 202 });
    expect(mockCreatePortalOrder).toHaveBeenCalledWith(expect.anything(), { createInvoice: false });
  });

  it("rejects a MiniStem product for a Spirecut-certified doctor", async () => {
    mockSelectRows([{ instrument: "spirecut" }]);
    mockSelectRows([
      {
        id: 11,
        nameEn: "Mini Stem System",
        nameDe: "Mini Stem System",
        category: "ministem",
        isService: false,
      },
    ]);

    const response = await request(app)
      .post("/portal/order-request")
      .set("Authorization", authHeader)
      .send({
        ...confirmedOrderDetails,
        orderMode: "product",
        products: [{ productId: 11, quantity: 1 }],
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "PRODUCT_NOT_CERTIFIED" });
    expect(mockValues).not.toHaveBeenCalled();
    expect(mockCreatePortalOrder).not.toHaveBeenCalled();
  });

  it("accepts a shared Cellenis product for a Spirecut-certified doctor", async () => {
    mockSelectRows([{ instrument: "spirecut" }]);
    mockSelectRows([
      {
        id: 21,
        nameEn: "Cellenis PRF 12ml",
        nameDe: "Cellenis PRF 12ml",
        category: "cellenis",
        isService: false,
      },
    ]);

    const response = await request(app)
      .post("/portal/order-request")
      .set("Authorization", authHeader)
      .send({
        ...confirmedOrderDetails,
        orderMode: "product",
        products: [{ productId: 21, quantity: 1 }],
      });

    expect(response.status).toBe(200);
    expect(mockCreatePortalOrder).toHaveBeenCalledOnce();
  });

  it("accepts a MiniStem product for a doctor certified for both systems", async () => {
    mockSelectRows([{ instrument: "spirecut", certifications: ["spirecut", "ministem"] }]);
    mockSelectRows([
      {
        id: 11,
        nameEn: "Mini Stem System",
        nameDe: "Mini Stem System",
        category: "ministem",
        isService: false,
      },
    ]);

    const response = await request(app)
      .post("/portal/order-request")
      .set("Authorization", authHeaderForCertifications(["spirecut", "ministem"]))
      .send({
        ...confirmedOrderDetails,
        orderMode: "product",
        products: [{ productId: 11, quantity: 1 }],
      });

    expect(response.status).toBe(200);
    expect(mockCreatePortalOrder).toHaveBeenCalledOnce();
  });

  it("rejects service-only products even for a doctor certified for both", async () => {
    mockSelectRows([{ instrument: "both" }]);
    mockSelectRows([
      {
        id: 30,
        nameEn: "Professional Medical Training",
        nameDe: "Professionelle medizinische Schulung",
        category: "services",
        isService: true,
      },
    ]);

    const response = await request(app)
      .post("/portal/order-request")
      .set("Authorization", authHeaderFor("both"))
      .send({
        ...confirmedOrderDetails,
        orderMode: "product",
        products: [{ productId: 30, quantity: 1 }],
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "PRODUCT_NOT_CERTIFIED" });
    expect(mockValues).not.toHaveBeenCalled();
    expect(mockCreatePortalOrder).not.toHaveBeenCalled();
  });

  it("allows an SVF-certified doctor to request a legacy JointechLabs product", async () => {
    mockSelectRows([{ instrument: "svf" }]);
    mockSelectRows([
      {
        id: 11,
        nameEn: "Mini Stem System",
        nameDe: "Mini Stem System",
        category: "jointechlabs",
        isService: false,
      },
    ]);

    const response = await request(app)
      .post("/portal/order-request")
      .set("Authorization", authHeaderFor("svf"))
      .send({
        ...confirmedOrderDetails,
        orderMode: "product",
        products: [{ productId: 11, quantity: 1 }],
      });

    expect(response.status).toBe(200);
    expect(mockCreatePortalOrder).toHaveBeenCalledOnce();
  });
});

describe("portal product catalog certification aliases", () => {
  it("shows both catalog families for separate Spirecut and MiniStem certifications", async () => {
    mockCatalogRows(
      [
        { id: 1, key: "spirecut", nameEn: "Spirecut", nameDe: "Spirecut", sortOrder: 1 },
        { id: 2, key: "ministem", nameEn: "MiniStem", nameDe: "MiniStem", sortOrder: 2 },
        { id: 3, key: "cellenis", nameEn: "Cellenis", nameDe: "Cellenis", sortOrder: 3 },
      ],
      [
        { id: 11, sku: "SC-01", nameEn: "Spirecut", nameDe: "Spirecut", category: "spirecut" },
        { id: 12, sku: "MS-01", nameEn: "MiniStem", nameDe: "MiniStem", category: "ministem" },
        { id: 13, sku: "CE-01", nameEn: "Cellenis", nameDe: "Cellenis", category: "cellenis" },
      ],
    );

    const response = await request(app)
      .get("/portal/products")
      .set("Authorization", authHeaderForCertifications(["spirecut", "ministem"]));

    expect(response.status).toBe(200);
    expect(response.body.map((group: { key: string }) => group.key))
      .toEqual(["spirecut", "ministem", "cellenis"]);
  });

  it.each(["ministem", "svf"])(
    "shows MiniStem, JointechLabs, and SVF groups to a %s-certified doctor",
    async (instrument) => {
      mockCatalogRows(
        [
          { id: 1, key: "spirecut", nameEn: "Spirecut", nameDe: "Spirecut", sortOrder: 1 },
          { id: 2, key: "ministem", nameEn: "MiniStem", nameDe: "MiniStem", sortOrder: 2 },
          { id: 3, key: "jointechlabs", nameEn: "JointechLabs", nameDe: "JointechLabs", sortOrder: 3 },
          { id: 4, key: "svf", nameEn: "SVF", nameDe: "SVF", sortOrder: 4 },
        ],
        [
          { id: 11, sku: "MS-01", nameEn: "MiniStem", nameDe: "MiniStem", category: "ministem" },
          { id: 12, sku: "JT-01", nameEn: "JointechLabs", nameDe: "JointechLabs", category: "jointechlabs" },
          { id: 13, sku: "SVF-01", nameEn: "SVF", nameDe: "SVF", category: "svf" },
          { id: 14, sku: "SC-01", nameEn: "Spirecut", nameDe: "Spirecut", category: "spirecut" },
        ],
      );

      const response = await request(app)
        .get("/portal/products")
        .set("Authorization", authHeaderFor(instrument));

      expect(response.status).toBe(200);
      expect(response.body.map((group: { key: string }) => group.key))
        .toEqual(["ministem", "jointechlabs", "svf"]);
    },
  );

  it.each(["unknown", "post_training_support"])(
    "shows no catalog groups to an unrecognized %s certification",
    async (instrument) => {
      mockCatalogRows(
        [
          { id: 1, key: "spirecut", nameEn: "Spirecut", nameDe: "Spirecut", sortOrder: 1 },
          { id: 2, key: "cellenis", nameEn: "Cellenis", nameDe: "Cellenis", sortOrder: 2 },
        ],
        [
          { id: 7, sku: "SC-01", nameEn: "Spirecut", nameDe: "Spirecut", category: "spirecut" },
          { id: 21, sku: "CE-01", nameEn: "Cellenis", nameDe: "Cellenis", category: "cellenis" },
        ],
      );

      const response = await request(app)
        .get("/portal/products")
        .set("Authorization", authHeaderFor(instrument));

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    },
  );
});

describe("portal order requests from unrecognized certifications", () => {
  it.each(["unknown", "post_training_support"])(
    "rejects a shared Cellenis product from a %s customer",
    async (instrument) => {
      mockSelectRows([{ instrument }]);
      mockSelectRows([
        {
          id: 21,
          nameEn: "Cellenis PRF 12ml",
          nameDe: "Cellenis PRF 12ml",
          category: "cellenis",
          isService: false,
        },
      ]);

      const response = await request(app)
        .post("/portal/order-request")
        .set("Authorization", authHeaderFor(instrument))
        .send({
          ...confirmedOrderDetails,
          orderMode: "product",
          products: [{ productId: 21, quantity: 1 }],
        });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "PRODUCT_NOT_CERTIFIED" });
      expect(mockValues).not.toHaveBeenCalled();
      expect(mockCreatePortalOrder).not.toHaveBeenCalled();
    },
  );
});
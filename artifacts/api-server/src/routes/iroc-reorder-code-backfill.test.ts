import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";

const {
  mockDbSelect,
  mockTransaction,
  mockGenerateUniqueReorderCode,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockTransaction: vi.fn(),
  mockGenerateUniqueReorderCode: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: mockTransaction,
  },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  irocAppUsers: { id: "id", username: "username", passwordHash: "passwordHash" },
  irocInvoices: { id: "id" },
  irocInvoiceItems: { invoiceId: "invoiceId" },
  irocCustomers: { id: "id" },
  irocCustomerWebsiteLinks: {},
  websiteCustomersTable: { id: "id", reorderCode: "reorder_code" },
  irocNotifications: {},
  settingsTable: {},
  irocProducts: {},
  irocProductGroups: {},
  irocInventoryLots: {},
  irocLeads: {},
  irocOrders: {},
  irocOrderShipments: {},
  irocTrainingOffers: {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable: {},
  doctorCertificationsTable: {},
}));

vi.mock("../lib/reorder-code", () => ({
  generateUniqueReorderCode: mockGenerateUniqueReorderCode,
}));

vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");
  return { default: class MockPDF extends PassThrough {} };
});

import app from "../app";

const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocAuth(): string {
  const payload = {
    userId: 1,
    username: "admin",
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET).update(encoded).digest("base64url");
  return `Bearer ${encoded}.${signature}`;
}

function selectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

describe("POST /api/iroc/website-customers/reorder-codes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue(selectChain([]));
    mockGenerateUniqueReorderCode.mockResolvedValue("ABCD2345");
  });

  it("rejects an empty or malformed customer selection before opening a transaction", async () => {
    const response = await request(app)
      .post("/api/iroc/website-customers/reorder-codes")
      .set("Authorization", makeIrocAuth())
      .send({ customerIds: [1, "2"] });

    expect(response.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("assigns only customers still missing a code and reports counts without returning codes", async () => {
    const rows = [
      { id: 11, reorderCode: null },
      { id: 12, reorderCode: "KEPT2345" },
    ];
    const updateReturning = vi.fn().mockResolvedValue([{ id: 11 }]);
    const tx = {
      select: vi.fn().mockReturnValue(selectChain(rows)),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning: updateReturning }),
        }),
      }),
    };
    mockTransaction.mockImplementation(async (callback) => callback(tx));

    const response = await request(app)
      .post("/api/iroc/website-customers/reorder-codes")
      .set("Authorization", makeIrocAuth())
      .send({ customerIds: [11, 12, 404] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      requested: 3,
      assigned: 1,
      skipped: 1,
      notFound: 1,
    });
    expect(JSON.stringify(response.body)).not.toContain("ABCD2345");
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(mockGenerateUniqueReorderCode).toHaveBeenCalledTimes(1);
  });
});
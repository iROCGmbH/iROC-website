import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";

const { mockWhere, mockLeftJoin, mockFrom, mockDbSelect } = vi.hoisted(() => {
  const mockWhere = vi.fn();
  const mockLeftJoin = vi.fn();
  const mockFrom = vi.fn();
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockFrom });
  return { mockWhere, mockLeftJoin, mockFrom, mockDbSelect };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn() }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    transaction: async (callback: (tx: unknown) => unknown) => callback({
      select: mockDbSelect,
      insert: vi.fn(),
      update: vi.fn(),
    }),
  },
  irocInvoices: {},
  irocInvoiceItems: {},
  irocCustomers: {},
  irocCustomerWebsiteLinks: {},
  websiteCustomersTable: {},
  irocAppUsers: {},
  irocNotifications: {},
  settingsTable: {},
  irocProducts: {},
  irocInventoryLots: {},
  irocLeads: {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable: {},
  doctorCertificationsTable: {},
}));

vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");
  return { default: class MockPDF extends PassThrough {} };
});

import app from "../app";

const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
const payload = { userId: 1, username: "admin", exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 };
const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
const signature = crypto.createHmac("sha256", SECRET).update(encodedPayload).digest("base64url");
const AUTH = `Bearer ${encodedPayload}.${signature}`;

const websiteCustomer = {
  id: 42,
  email: "customer@example.com",
  createdAt: new Date("2026-08-20T00:00:00.000Z"),
};

describe("GET /api/iroc/website-customers/:id legacy invoice mapping", () => {
  beforeEach(() => {
    mockWhere.mockReset();
    mockLeftJoin.mockReset().mockReturnValue({ where: mockWhere });
    mockFrom.mockReset()
      .mockReturnValueOnce({ leftJoin: mockLeftJoin })
      .mockReturnValue({ where: mockWhere });
    mockDbSelect.mockReset().mockReturnValue({ from: mockFrom });
  });

  it("returns the verified legacy customer ID for a mapped website customer", async () => {
    mockWhere.mockResolvedValueOnce([{ customer: websiteCustomer, legacyCustomerId: 7 }]);

    const res = await request(app)
      .get("/api/iroc/website-customers/42")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.legacyCustomerId).toBe(7);
  });

  it("does not create a legacy mapping from equal numeric IDs without a unique email match", async () => {
    mockWhere
      .mockResolvedValueOnce([{ customer: websiteCustomer, legacyCustomerId: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 42 }])
      .mockResolvedValueOnce([]);

    const res = await request(app)
      .get("/api/iroc/website-customers/42")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.legacyCustomerId).toBeNull();
  });
});
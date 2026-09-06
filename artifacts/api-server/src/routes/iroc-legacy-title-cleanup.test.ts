import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";

const {
  mockDbSelect,
  mockWhere,
  mockLimit,
  mockTransaction,
  mockUpdate,
  mockUpdateSet,
  mockUpdateWhere,
  mockUpdateReturning,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockWhere: vi.fn(),
  mockLimit: vi.fn(),
  mockTransaction: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockUpdateReturning: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: mockUpdate,
    delete: vi.fn(),
    transaction: mockTransaction,
  },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  irocAppUsers: { id: "id", username: "username" },
  irocCustomers: { id: "id", title: "title", name: "name" },
  irocInvoices: { id: "id" },
  irocInvoiceItems: { invoiceId: "invoiceId" },
  irocCustomerWebsiteLinks: {},
  websiteCustomersTable: { id: "id" },
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

function selectChain() {
  const from = vi.fn().mockReturnValue({
    where: mockWhere,
    limit: mockLimit,
    orderBy: vi.fn().mockResolvedValue([]),
  });
  return { from };
}

const rows = [
  {
    id: 11,
    title: "Dr. med",
    name: "Dr. med Max Mustermann",
  },
  {
    id: 12,
    title: "Dr.",
    name: "Prof. Dr. Anna Example",
  },
  {
    id: 13,
    title: "Dr. med",
    name: "Max Mustermann",
  },
];

describe("POST /api/iroc/customers/cleanup-duplicated-titles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue(selectChain());
    mockLimit.mockResolvedValue([]);
    mockUpdateReturning.mockResolvedValue([{ id: 11 }]);
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
  });

  it("defaults to a dry run and reports ambiguous names without changing rows", async () => {
    mockWhere.mockResolvedValueOnce(rows);

    const response = await request(app)
      .post("/api/iroc/customers/cleanup-duplicated-titles")
      .set("Authorization", makeIrocAuth())
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      dryRun: true,
      scanned: 3,
      candidateCount: 1,
      updated: 0,
      unchanged: 1,
    });
    expect(response.body.candidates).toEqual([{
      id: 11,
      title: "Dr. med",
      originalName: "Dr. med Max Mustermann",
      cleanedName: "Max Mustermann",
      matchedPrefix: "Dr. med",
    }]);
    expect(response.body.skipped).toEqual([{
      id: 12,
      title: "Dr.",
      name: "Prof. Dr. Anna Example",
      matchedPrefix: "Prof. Dr.",
      reason: "ambiguous",
    }]);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("applies only the audited candidate and guards against concurrent edits", async () => {
    mockWhere.mockResolvedValueOnce(rows);
    const tx = {
      update: mockUpdate,
    };
    mockTransaction.mockImplementationOnce(async (callback: (value: typeof tx) => unknown) => callback(tx));

    const response = await request(app)
      .post("/api/iroc/customers/cleanup-duplicated-titles")
      .set("Authorization", makeIrocAuth())
      .send({ apply: true });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      dryRun: false,
      candidateCount: 1,
      updated: 1,
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      name: "Max Mustermann",
      updatedAt: expect.any(Date),
    }));
    expect(mockUpdateWhere).toHaveBeenCalled();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});
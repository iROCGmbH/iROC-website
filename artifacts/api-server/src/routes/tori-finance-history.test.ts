import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery },
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
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
}));

vi.mock("pdf-parse", () => ({ default: vi.fn() }));

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
    end(cb?: () => void) { super.end(cb); return this; }
  }
  return { default: MockPDF };
});

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

describe("GET /api/iroc/tori/finance-history", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
  });

  it("requires iROC authentication", async () => {
    const res = await request(app).get("/api/iroc/tori/finance-history");

    expect(res.status).toBe(401);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("combines committed expenses and invoices and applies an exact search", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        { record_id: 12, record_type: "expense", document_number: "SUP-12", total_count: 2 },
        { record_id: 34, record_type: "invoice", document_number: "2026-0034", total_count: 2 },
      ],
    });

    const res = await request(app)
      .get("/api/iroc/tori/finance-history")
      .query({ period: "quarter", value: "2026-Q3", search: "2026-0034" })
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { record_id: 12, record_type: "expense", document_number: "SUP-12" },
        { record_id: 34, record_type: "invoice", document_number: "2026-0034" },
      ],
      count: 2,
      page: 1,
      page_size: 50,
      total: 2,
    });

    const [sql, values] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM iroc_expenses");
    expect(sql).toContain("FROM iroc_invoices");
    expect(sql).toContain("COALESCE(NULLIF(TRIM(e.invoice_date::text), '')::date, e.created_at::date)");
    expect(sql).toContain("COALESCE(NULLIF(TRIM(i.issue_date::text), '')::date, i.created_at::date)");
    expect(sql).toContain("record_date >= $1::date AND record_date < $2::date");
    expect(sql).toContain("LOWER(COALESCE(document_number, '')) = LOWER($3)");
    expect(sql).toContain("LIMIT $4 OFFSET $5");
    expect(values).toEqual(["2026-07-01", "2026-10-01", "2026-0034", 50, 0]);
  });

  it("rejects invalid period values before querying the database", async () => {
    const res = await request(app)
      .get("/api/iroc/tori/finance-history")
      .query({ period: "month", value: "2026-13" })
      .set("Authorization", AUTH);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid history period value.");
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("filters history by committed record type", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ record_id: 34, record_type: "invoice" }] });

    const res = await request(app)
      .get("/api/iroc/tori/finance-history")
      .query({ type: "invoice" })
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ record_id: 34, record_type: "invoice" }]);

    const [sql, values] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("record_type = $1");
    expect(values).toEqual(["invoice", 50, 0]);
  });

  it("bounds and applies pagination", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ record_id: 34, record_type: "invoice", total_count: 130 }],
    });
    const res = await request(app)
      .get("/api/iroc/tori/finance-history")
      .query({ page: "3", page_size: "25" })
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 3, page_size: 25, total: 130, count: 130 });
    expect(mockPoolQuery.mock.calls[0]?.[1]).toEqual([25, 50]);

    const invalid = await request(app)
      .get("/api/iroc/tori/finance-history")
      .query({ page_size: "101" })
      .set("Authorization", AUTH);
    expect(invalid.status).toBe(400);
  });

  it("rejects invalid history record types before querying the database", async () => {
    const res = await request(app)
      .get("/api/iroc/tori/finance-history")
      .query({ type: "receipt" })
      .set("Authorization", AUTH);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid history record type.");
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});
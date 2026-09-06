/**
 * Tests for Tori PDF uploads — file-type and readable-text guards
 *
 * Verifies that:
 *  1. Sending no file returns 400 with "No file uploaded"
 *  2. Uploading a .docx file returns 422 with "Only PDF files are supported"
 *  3. Uploading an image-only PDF returns 422 with a helpful no-text message
 *  4. Returning a parser error for a PDF returns 422 with a clear parse-error message
 *  5. Uploading a valid PDF returns 200 with a non-empty `text` and `pages > 0`
 *  6. Uploading a truncated PDF returns 422 before downstream processing
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist mock state ──────────────────────────────────────────────────────────
const { mockPdfParse, mockPoolQuery } = vi.hoisted(() => {
  const mockPdfParse = vi.fn();
  const mockPoolQuery = vi.fn().mockResolvedValue({ rows: [] });
  return { mockPdfParse, mockPoolQuery };
});

// ── Mock pdf-parse ────────────────────────────────────────────────────────────
vi.mock("pdf-parse", () => ({ default: mockPdfParse }));

// ── Mock @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  pool: {
    query: mockPoolQuery,
  },
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
  irocInvoices:               {},
  irocInvoiceItems:           {},
  irocCustomers:              {},
  websiteCustomersTable:      {},
  irocAppUsers:               {},
  irocNotifications:          {},
  settingsTable:              {},
  irocProducts:               {},
  irocInventoryLots:          {},
  trainingRegistrationsTable: {},
}));

// ── Mock pdfkit (transitively imported by iroc.ts) ────────────────────────────
vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");
  class MockPDF extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y = 0;
    font()           { return this; }
    fontSize()       { return this; }
    fillColor()      { return this; }
    strokeColor()    { return this; }
    lineWidth()      { return this; }
    save()           { return this; }
    restore()        { return this; }
    addPage()        { return this; }
    image()          { return this; }
    moveTo()         { return this; }
    lineTo()         { return this; }
    rect()           { return this; }
    clip()           { return this; }
    stroke()         { return this; }
    fill()           { return this; }
    text()           { return this; }
    heightOfString() { return 10; }
    end(cb?: () => void) { super.end(cb); return this; }
  }
  return { default: MockPDF };
});

// ── Import app AFTER mocks ────────────────────────────────────────────────────
import app from "../app";

// ── JWT helper (mirrors iroc.ts signToken) ────────────────────────────────────
const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = { userId: 1, username: "admin", exp };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig  = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const AUTH = `Bearer ${makeIrocToken()}`;

// ── A minimal valid PDF header (enough bytes for multer, parsing is mocked) ───
const FAKE_PDF_BYTES = Buffer.from("%PDF-1.4 fake pdf content for testing purposes");
const TRUNCATED_PDF_BYTES = Buffer.from("%PDF-1.7\n");

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("POST /api/iroc/tori/extract-pdf", () => {
  beforeEach(() => {
    mockPdfParse.mockReset();
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  it("returns 400 with 'No file uploaded' when no file is attached", async () => {
    const res = await request(app)
      .post("/api/iroc/tori/extract-pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No file uploaded");
  });

  it("returns 422 with 'Only PDF files are supported' when a .docx file is uploaded", async () => {
    const res = await request(app)
      .post("/api/iroc/tori/extract-pdf")
      .set("Authorization", AUTH)
      .attach(
        "file",
        Buffer.from("PK\x03\x04fake docx content"),
        {
          filename:    "invoice.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      );

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Only PDF files are supported");
  });

  it("returns 422 with a helpful no-text message when an image-only PDF is uploaded", async () => {
    mockPdfParse.mockResolvedValueOnce({ text: "", numpages: 1 });

    const res = await request(app)
      .post("/api/iroc/tori/extract-pdf")
      .set("Authorization", AUTH)
      .attach("file", FAKE_PDF_BYTES, { filename: "scanned-invoice.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe(
      "This PDF appears to be image-only — no text could be extracted. Please copy-paste the text manually.",
    );
  });

  it("returns 422 with a clear parse-error message when pdf-parse throws", async () => {
    mockPdfParse.mockRejectedValueOnce(new Error("PDF is encrypted or malformed"));

    const res = await request(app)
      .post("/api/iroc/tori/extract-pdf")
      .set("Authorization", AUTH)
      .attach("file", FAKE_PDF_BYTES, { filename: "corrupt-invoice.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Could not parse PDF — the file may be encrypted or image-only.");
  });

  it("returns 422 for a truncated PDF without continuing to downstream processing", async () => {
    mockPdfParse.mockRejectedValueOnce(new Error("Unexpected end of file"));

    const res = await request(app)
      .post("/api/iroc/tori/extract-pdf")
      .set("Authorization", AUTH)
      .attach("file", TRUNCATED_PDF_BYTES, { filename: "truncated-invoice.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Could not parse PDF — the file may be encrypted or image-only.");
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("returns 200 with non-empty text and pages > 0 when a valid PDF is uploaded", async () => {
    const extractedText = "Supplier Invoice\nItem A  SKU-001  10 units  €50.00\nItem B  SKU-002  5 units  €120.00\nTotal: €1100.00";
    mockPdfParse.mockResolvedValueOnce({ text: extractedText, numpages: 2 });

    const res = await request(app)
      .post("/api/iroc/tori/extract-pdf")
      .set("Authorization", AUTH)
      .attach("file", FAKE_PDF_BYTES, { filename: "invoice.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    expect(typeof res.body.text).toBe("string");
    expect(res.body.text.trim().length).toBeGreaterThan(0);
    expect(res.body.pages).toBeGreaterThan(0);
  });
});

describe("Tori pipeline PDF readable-text guard", () => {
  beforeEach(() => {
    mockPdfParse.mockReset();
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  it("returns 422 with 'Only PDF files are supported' for a non-PDF contract upload", async () => {
    const res = await request(app)
      .post("/api/iroc/tori/contracts")
      .set("Authorization", AUTH)
      .attach(
        "file",
        Buffer.from("PK\x03\x04fake docx content"),
        {
          filename:    "supplier-contract.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      );

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Only PDF files are supported");
  });

  it("rejects a non-PDF invoice upload before calling the PDF parser", async () => {
    const res = await request(app)
      .post("/api/iroc/tori/analyze-invoice")
      .set("Authorization", AUTH)
      .attach(
        "file",
        Buffer.from("PK\x03\x04fake docx content"),
        {
          filename:    "supplier-invoice.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      );

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Only PDF files are supported");
    expect(mockPdfParse).not.toHaveBeenCalled();
  });

  it("rejects a non-PDF payload named .pdf before calling the PDF parser", async () => {
    const res = await request(app)
      .post("/api/iroc/tori/analyze-invoice")
      .set("Authorization", AUTH)
      .attach(
        "file",
        Buffer.from("This is not a PDF, despite its filename."),
        {
          filename:    "supplier-invoice.pdf",
          contentType: "application/pdf",
        },
      );

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Only PDF files are supported");
    expect(mockPdfParse).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/iroc/tori/analyze-invoice", "invoice.pdf"],
    ["/api/iroc/tori/contracts", "contract.pdf"],
  ])("returns a structured warning for an image-only PDF at %s", async (path, filename) => {
    mockPdfParse.mockResolvedValueOnce({ text: "   ", numpages: 1 });

    const res = await request(app)
      .post(path)
      .set("Authorization", AUTH)
      .attach("file", FAKE_PDF_BYTES, { filename, contentType: "application/pdf" });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: expect.any(String),
      warning: {
        code: "PDF_TEXT_NOT_EXTRACTABLE",
        reason: "image_only_or_scanned_pdf",
        extracted_character_count: 0,
        guidance: expect.any(String),
      },
    });
  });

  it.each([
    [
      "/api/iroc/tori/analyze-invoice",
      "invoice.pdf",
      "Could not parse PDF — may be encrypted or image-only.",
    ],
    ["/api/iroc/tori/contracts", "contract.pdf", "Could not parse PDF"],
  ])("returns the documented parse-error response for a corrupt PDF at %s", async (path, filename, error) => {
    mockPdfParse.mockRejectedValueOnce(new Error("PDF is encrypted or malformed"));

    const res = await request(app)
      .post(path)
      .set("Authorization", AUTH)
      .attach("file", FAKE_PDF_BYTES, { filename, contentType: "application/pdf" });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error });
  });

  it.each([
    [
      "/api/iroc/tori/analyze-invoice",
      "truncated-invoice.pdf",
      "Could not parse PDF — may be encrypted or image-only.",
    ],
    ["/api/iroc/tori/contracts", "truncated-contract.pdf", "Could not parse PDF"],
  ])("returns a clear 422 and does not persist a truncated PDF at %s", async (path, filename, error) => {
    mockPdfParse.mockRejectedValueOnce(new Error("Unexpected end of file"));

    const res = await request(app)
      .post(path)
      .set("Authorization", AUTH)
      .attach("file", TRUNCATED_PDF_BYTES, { filename, contentType: "application/pdf" });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error });
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});

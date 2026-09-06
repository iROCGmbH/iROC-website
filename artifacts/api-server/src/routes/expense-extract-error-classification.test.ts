/**
 * Integration tests: POST /api/admin/expenses/extract — error classification
 *
 * What & Why
 * ──────────
 * When the AI extraction model receives a password-protected, corrupt, or
 * zero-byte PDF it may return an empty response, a natural-language explanation,
 * or throw outright.  Without explicit classification all of these collapse into
 * either a blank form or a generic 500 error, leaving the admin with no
 * actionable guidance.
 *
 * These tests verify that each failure mode surfaces a specific, helpful
 * parseError (or 422 status) rather than a silent blank or a generic message.
 *
 * Tests
 * ─────
 *  1. Zero-byte buffer (< 64 B)        → 422 "empty or unreadable"
 *  2. PDF mime + wrong file signature   → 422 "empty or unreadable"
 *  3. PDF with /Encrypt marker          → 200 + password parseError
 *  4. AI returns empty rawText          → 200 + password/corrupt parseError
 *  5. AI throws with "password" message → 200 + password/corrupt parseError
 *  6. AI throws generic message         → 500 "AI extraction failed"
 *  7. AI returns non-JSON (generic)     → 200 + generic parseError
 *  8. AI returns non-JSON with "password" keyword → 200 + targeted parseError
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist ALL mock state so vi.mock() factories can reference it ──────────────

const {
  mockGenerateContent,
  mockGetObjectEntityFile,
  mockPoolQuery,
  MockObjectStorageService,
  MockObjectNotFoundError,
} = vi.hoisted(() => {
  const mockGenerateContent = vi.fn();
  const mockPoolQuery       = vi.fn().mockResolvedValue({ rows: [] });

  class MockObjectNotFoundError extends Error {
    constructor(msg = "not found") { super(msg); this.name = "ObjectNotFoundError"; }
  }

  const mockGetFile = vi.fn().mockResolvedValue({ download: vi.fn() });

  class MockObjectStorageService {
    getObjectEntityFile                = mockGetFile;
    getObjectEntityUploadURLWithSubdir = vi.fn();
    normalizeObjectEntityPath          = vi.fn();
  }

  return {
    mockGenerateContent,
    mockGetObjectEntityFile: mockGetFile,
    mockPoolQuery,
    MockObjectStorageService,
    MockObjectNotFoundError,
  };
});

// ── Mock: AI model ─────────────────────────────────────────────────────────────

vi.mock("@workspace/integrations-gemini-ai/image", () => ({
  ai: { models: { generateContent: mockGenerateContent } },
}));

// ── Mock: object storage ───────────────────────────────────────────────────────

vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService: MockObjectStorageService,
  ObjectNotFoundError:  MockObjectNotFoundError,
}));

// ── Mock: @workspace/db ───────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery },
  db: {
    select:      vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert:      vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    update:      vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    delete:      vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    execute:     vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  },
  irocInvoices:               { id: "id" },
  irocInvoiceItems:           { invoiceId: "invoiceId" },
  irocCustomers:              { id: "id" },
  websiteCustomersTable:      { id: "id" },
  settingsTable:              { key: "key" },
  datevExports:               { id: "id", status: "status" },
  datevExportItems:           { exportId: "exportId", invoiceId: "invoiceId" },
  irocAppUsers:               {},
  irocNotifications:          {},
  irocProducts:               { id: "id", stockQuantity: "stockQuantity", updatedAt: "updatedAt" },
  irocInventoryLots:          {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable:        {},
}));

// ── Mock: pdfkit (transitively imported; not exercised here) ─────────────────

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

// ── JWT helper (mirrors requireIrocAuth) ──────────────────────────────────────

const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocToken(): string {
  const exp     = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = { userId: 1, username: "admin", exp };
  const data    = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig     = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const AUTH = `Bearer ${makeIrocToken()}`;

// ── Buffer helpers ────────────────────────────────────────────────────────────

/** Minimal valid-looking PDF buffer (starts with %PDF- and is >= 64 bytes). */
function makePdfBuffer(extra = ""): Buffer {
  // Pad to comfortably exceed the MIN_FILE_BYTES (64) threshold.
  const content = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${extra}\n%%EOF`;
  const buf = Buffer.from(content, "latin1");
  if (buf.length < 80) {
    return Buffer.concat([buf, Buffer.alloc(80 - buf.length, 0x20)]);
  }
  return buf;
}

/** PDF buffer that contains an /Encrypt dictionary entry. */
function makeEncryptedPdfBuffer(): Buffer {
  return makePdfBuffer("trailer\n<</Encrypt 5 0 R/Size 6>>");
}

/** Build a fake successful AI response wrapping the given text. */
function aiResponse(text: string) {
  return {
    candidates: [{ content: { parts: [{ text }] } }],
  };
}

const GOOD_JSON = JSON.stringify({
  vendor_name: "ACME GmbH", invoice_date: "2026-01-15", invoice_number: "INV-001",
  category: "Software", net_amount: 100, tax_amount: 19, gross_amount: 119,
  currency: "EUR", confidence: "high",
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/admin/expenses/extract — error classification", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  // ── 1. Zero-byte / tiny buffer ────────────────────────────────────────────

  it("returns 422 with 'empty or unreadable' when the downloaded buffer is below 64 bytes", async () => {
    // The GCS download returns a buffer that is too small to be a real PDF.
    mockGetObjectEntityFile.mockResolvedValueOnce({
      download: vi.fn().mockResolvedValue([Buffer.alloc(0)]),
    });

    const res = await request(app)
      .post("/api/admin/expenses/extract")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: "/objects/expense-receipts/test.pdf", mimeType: "application/pdf" });

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/empty or unreadable/i);
  });

  // ── 2. Wrong file signature for PDF mime type ─────────────────────────────

  it("returns 422 with 'empty or unreadable' when a PDF-typed file has the wrong header", async () => {
    // A ZIP-like header (PK magic bytes) sent with application/pdf mime type.
    const badBuffer = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(100)]);
    mockGetObjectEntityFile.mockResolvedValueOnce({
      download: vi.fn().mockResolvedValue([badBuffer]),
    });

    const res = await request(app)
      .post("/api/admin/expenses/extract")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: "/objects/expense-receipts/test.pdf", mimeType: "application/pdf" });

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/empty or unreadable/i);
  });

  // ── 3. /Encrypt marker in PDF buffer → password parseError ───────────────

  it("returns 200 with a password-targeted parseError when the PDF contains /Encrypt", async () => {
    mockGetObjectEntityFile.mockResolvedValueOnce({
      download: vi.fn().mockResolvedValue([makeEncryptedPdfBuffer()]),
    });

    const res = await request(app)
      .post("/api/admin/expenses/extract")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: "/objects/expense-receipts/enc.pdf", mimeType: "application/pdf" });

    expect(res.status).toBe(200);
    const body = res.body as { parseError?: string; extracted?: { confidence: string } };
    expect(body.parseError).toMatch(/password-protected/i);
    expect(body.extracted?.confidence).toBe("low");
    // The AI model must NOT have been called — we short-circuit before it.
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  // ── 4. AI returns empty rawText ───────────────────────────────────────────

  it("returns 200 with a password/corrupt parseError when AI returns no text", async () => {
    mockGetObjectEntityFile.mockResolvedValueOnce({
      download: vi.fn().mockResolvedValue([makePdfBuffer()]),
    });
    // Model returns a response with no usable text parts.
    mockGenerateContent.mockResolvedValueOnce({ candidates: [{ content: { parts: [] } }] });

    const res = await request(app)
      .post("/api/admin/expenses/extract")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: "/objects/expense-receipts/blank.pdf", mimeType: "application/pdf" });

    expect(res.status).toBe(200);
    const body = res.body as { parseError?: string; extracted?: { confidence: string } };
    expect(body.parseError).toMatch(/password-protected or corrupt/i);
    expect(body.extracted?.confidence).toBe("low");
  });

  // ── 5. AI throws with "password" in message → targeted parseError ─────────

  it("returns 200 with a targeted parseError when generateContent throws a password error", async () => {
    mockGetObjectEntityFile.mockResolvedValueOnce({
      download: vi.fn().mockResolvedValue([makePdfBuffer()]),
    });
    mockGenerateContent.mockRejectedValueOnce(
      new Error("Unable to process the document: password-protected PDF"),
    );

    const res = await request(app)
      .post("/api/admin/expenses/extract")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: "/objects/expense-receipts/locked.pdf", mimeType: "application/pdf" });

    expect(res.status).toBe(200);
    const body = res.body as { parseError?: string; extracted?: { confidence: string } };
    expect(body.parseError).toMatch(/password-protected or corrupt/i);
    expect(body.extracted?.confidence).toBe("low");
  });

  // ── 6. AI throws a generic error → 500 ───────────────────────────────────

  it("returns 500 when generateContent throws a generic (non-document) error", async () => {
    mockGetObjectEntityFile.mockResolvedValueOnce({
      download: vi.fn().mockResolvedValue([makePdfBuffer()]),
    });
    mockGenerateContent.mockRejectedValueOnce(new Error("Service temporarily unavailable"));

    const res = await request(app)
      .post("/api/admin/expenses/extract")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: "/objects/expense-receipts/test.pdf", mimeType: "application/pdf" });

    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toMatch(/AI extraction failed/i);
  });

  // ── 7. AI returns non-JSON text (no document keywords) → generic parseError

  it("returns 200 with the generic parseError when AI returns non-JSON without unreadability keywords", async () => {
    mockGetObjectEntityFile.mockResolvedValueOnce({
      download: vi.fn().mockResolvedValue([makePdfBuffer()]),
    });
    mockGenerateContent.mockResolvedValueOnce(aiResponse("I see an invoice from ACME but cannot determine the amounts."));

    const res = await request(app)
      .post("/api/admin/expenses/extract")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: "/objects/expense-receipts/test.pdf", mimeType: "application/pdf" });

    expect(res.status).toBe(200);
    const body = res.body as { parseError?: string };
    expect(body.parseError).toMatch(/Could not parse AI response/i);
  });

  // ── 8. AI returns non-JSON text containing "password" → targeted parseError

  it("returns 200 with the targeted parseError when AI explains it cannot read the document", async () => {
    mockGetObjectEntityFile.mockResolvedValueOnce({
      download: vi.fn().mockResolvedValue([makePdfBuffer()]),
    });
    mockGenerateContent.mockResolvedValueOnce(
      aiResponse("I cannot process this document because it appears to be password-protected."),
    );

    const res = await request(app)
      .post("/api/admin/expenses/extract")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: "/objects/expense-receipts/test.pdf", mimeType: "application/pdf" });

    expect(res.status).toBe(200);
    const body = res.body as { parseError?: string; extracted?: { confidence: string } };
    expect(body.parseError).toMatch(/password-protected or corrupt/i);
    expect(body.extracted?.confidence).toBe("low");
  });

  // ── Sanity: happy path still works ───────────────────────────────────────

  it("returns 200 with extracted fields when AI returns valid JSON", async () => {
    mockGetObjectEntityFile.mockResolvedValueOnce({
      download: vi.fn().mockResolvedValue([makePdfBuffer()]),
    });
    mockGenerateContent.mockResolvedValueOnce(aiResponse(GOOD_JSON));

    const res = await request(app)
      .post("/api/admin/expenses/extract")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: "/objects/expense-receipts/ok.pdf", mimeType: "application/pdf" });

    expect(res.status).toBe(200);
    const body = res.body as { extracted?: { vendor_name: string; confidence: string }; parseError?: string };
    expect(body.parseError).toBeUndefined();
    expect(body.extracted?.vendor_name).toBe("ACME GmbH");
    expect(body.extracted?.confidence).toBe("high");
  });

});

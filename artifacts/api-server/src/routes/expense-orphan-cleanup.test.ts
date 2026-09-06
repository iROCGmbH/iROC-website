/**
 * Integration tests: DELETE /api/admin/expenses/file — orphan-file cleanup
 *
 * What & Why
 * ──────────
 * When the admin dismisses the extraction confirmation modal without clicking
 * Save, the frontend calls DELETE /api/admin/expenses/file with the path of
 * the already-uploaded GCS object.  Without this cleanup the file accumulates
 * as an unreachable orphan in Object Storage.
 *
 * These tests verify that:
 *  1. A valid unlinked file is deleted from GCS and returns 204.
 *  2. A path outside /objects/expense-receipts/ is rejected with 403.
 *  3. A file already linked to a saved expense row is rejected with 409.
 *  4. A file that has already been deleted from GCS (ObjectNotFoundError)
 *     is treated as success (204) — idempotent cleanup.
 *  5. A GCS storage error returns 500.
 *  6. A missing or non-string fileObjectPath returns 400.
 *  7. An unauthenticated request is rejected with 401.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist ALL mock state so vi.mock() factories can reference it ──────────────

const {
  mockPoolQuery,
  mockGetObjectEntityFile,
  mockDeleteFile,
  MockObjectStorageService,
  MockObjectNotFoundError,
} = vi.hoisted(() => {
  const mockPoolQuery  = vi.fn().mockResolvedValue({ rows: [] });
  const mockDeleteFile = vi.fn().mockResolvedValue(undefined);
  const mockGetFile    = vi.fn().mockResolvedValue({ delete: mockDeleteFile });

  class MockObjectNotFoundError extends Error {
    constructor(msg = "not found") { super(msg); this.name = "ObjectNotFoundError"; }
  }

  class MockObjectStorageService {
    getObjectEntityFile                = mockGetFile;
    getObjectEntityUploadURLWithSubdir = vi.fn();
    normalizeObjectEntityPath          = vi.fn();
    downloadObject                     = vi.fn();
  }

  return {
    mockPoolQuery,
    mockGetObjectEntityFile: mockGetFile,
    mockDeleteFile,
    MockObjectStorageService,
    MockObjectNotFoundError,
  };
});

// ── Mock: AI model (transitively imported; not exercised here) ────────────────

vi.mock("@workspace/integrations-gemini-ai/image", () => ({
  ai: { models: { generateContent: vi.fn() } },
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

/** A valid expense-receipts path (the prefix written by the upload-url endpoint). */
const ORPHAN_PATH = "/objects/expense-receipts/abc123-receipt.pdf";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DELETE /api/admin/expenses/file — orphan-file cleanup", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: pool returns no linked expense rows (file is truly orphaned).
    mockPoolQuery.mockResolvedValue({ rows: [] });
    // Default: GCS delete succeeds.
    mockDeleteFile.mockResolvedValue(undefined);
    mockGetObjectEntityFile.mockResolvedValue({ delete: mockDeleteFile });
  });

  // ── 1. Happy path: orphaned file is deleted ────────────────────────────────
  // Simulates the "upload → extract → cancel modal" flow:
  //   • The file was uploaded to GCS (path starts with /objects/expense-receipts/).
  //   • The admin dismissed the modal without saving, so no iroc_expenses row exists.
  //   • The endpoint should delete the GCS object and respond 204.

  it("deletes the GCS object and returns 204 when the file is unlinked", async () => {
    // No linked expense row.
    mockPoolQuery.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .delete("/api/admin/expenses/file")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: ORPHAN_PATH });

    expect(res.status).toBe(204);

    // The DB was queried to confirm there is no saved expense referencing this path.
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("SELECT id FROM iroc_expenses WHERE file_object_path"),
      [ORPHAN_PATH],
    );

    // The GCS file object was fetched and its delete() method was called.
    expect(mockGetObjectEntityFile).toHaveBeenCalledWith(ORPHAN_PATH);
    expect(mockDeleteFile).toHaveBeenCalled();
  });

  // ── 2. Path outside the expense-receipts prefix ───────────────────────────
  // A caller trying to delete an unrelated object storage file should be
  // rejected immediately without touching GCS.

  it("returns 403 when the path is outside /objects/expense-receipts/", async () => {
    const res = await request(app)
      .delete("/api/admin/expenses/file")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: "/objects/uploads/some-other-file.pdf" });

    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toMatch(/expense-receipts/i);

    // Neither the DB nor GCS should have been touched.
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  // ── 3. File already linked to a saved expense ─────────────────────────────
  // If the admin somehow triggered the cleanup for a file that was already
  // saved (e.g. via a race or duplicate request), the endpoint must refuse
  // to delete it so the saved expense record keeps its source document.

  it("returns 409 when the file is already linked to a saved iroc_expenses row", async () => {
    // Simulate a linked expense row.
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 42 }] });

    const res = await request(app)
      .delete("/api/admin/expenses/file")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: ORPHAN_PATH });

    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toMatch(/already linked/i);

    // GCS must NOT have been touched.
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  // ── 4. File already gone from GCS (ObjectNotFoundError) ──────────────────
  // The cleanup is fire-and-forget; if the file was already deleted by a
  // previous call or the orphan sweeper the endpoint must still return 204
  // so the UI can clear cleanly.

  it("returns 204 (idempotent) when the file no longer exists in GCS", async () => {
    // No linked expense row.
    mockPoolQuery.mockResolvedValue({ rows: [] });
    // GCS reports the file is already gone.
    mockGetObjectEntityFile.mockRejectedValueOnce(new MockObjectNotFoundError());

    const res = await request(app)
      .delete("/api/admin/expenses/file")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: ORPHAN_PATH });

    expect(res.status).toBe(204);
    // delete() must not have been called — the object was not found.
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  // ── 5. GCS storage error ──────────────────────────────────────────────────

  it("returns 500 when the GCS delete call fails with an unexpected error", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] });
    mockDeleteFile.mockRejectedValueOnce(new Error("GCS network timeout"));

    const res = await request(app)
      .delete("/api/admin/expenses/file")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: ORPHAN_PATH });

    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toMatch(/Failed to delete file/i);
  });

  // ── 6. Missing fileObjectPath ─────────────────────────────────────────────

  it("returns 400 when fileObjectPath is absent from the request body", async () => {
    const res = await request(app)
      .delete("/api/admin/expenses/file")
      .set("Authorization", AUTH)
      .send({});

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/fileObjectPath is required/i);
  });

  it("returns 400 when fileObjectPath is not a string", async () => {
    const res = await request(app)
      .delete("/api/admin/expenses/file")
      .set("Authorization", AUTH)
      .send({ fileObjectPath: 12345 });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/fileObjectPath is required/i);
  });

  // ── 7. Unauthenticated request ────────────────────────────────────────────

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await request(app)
      .delete("/api/admin/expenses/file")
      .send({ fileObjectPath: ORPHAN_PATH });

    expect(res.status).toBe(401);
  });

  // ── 8. JWT signed with the wrong secret ───────────────────────────────────
  // A structurally valid token (correct header.payload.sig format) but signed
  // with a different secret must be rejected — a crafted token should not be
  // able to trigger GCS deletes.

  it("returns 401 when the token is signed with the wrong secret", async () => {
    const payload = { userId: 1, username: "admin" };
    const data    = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const wrongSig = crypto
      .createHmac("sha256", "totally-wrong-secret")
      .update(data)
      .digest("base64url");
    const badToken = `Bearer ${data}.${wrongSig}`;

    const res = await request(app)
      .delete("/api/admin/expenses/file")
      .set("Authorization", badToken)
      .send({ fileObjectPath: ORPHAN_PATH });

    expect(res.status).toBe(401);

    // GCS must NOT have been touched.
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  // ── 9. Malformed / tampered token ─────────────────────────────────────────
  // A random string that does not conform to the data.sig format must also be
  // rejected with 401 — no silent fallback to an unauthenticated state.

  it("returns 401 when the token is a random malformed string", async () => {
    const res = await request(app)
      .delete("/api/admin/expenses/file")
      .set("Authorization", "Bearer this-is-not-a-valid-token-at-all")
      .send({ fileObjectPath: ORPHAN_PATH });

    expect(res.status).toBe(401);

    // GCS must NOT have been touched.
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

});

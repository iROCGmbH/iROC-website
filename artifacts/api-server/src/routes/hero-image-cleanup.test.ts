/**
 * hero-image-cleanup.test.ts — Task #59
 *
 * Verifies that POST /api/admin/website-settings (ws_hero_image_url) and
 * POST /api/admin/hero-upload-cleanup correctly delete old or orphaned Object
 * Storage objects so that no hero images accumulate in the bucket.
 *
 * Scenarios:
 * A. Replacement — stored _ws_hero_object_path → deleted after new URL saved
 * B. Removal (empty value) — stored path → deleted
 * C. Legacy URL cleanup — no stored objectPath but ws_hero_image_url is a
 *    storage URL → path extracted from URL and deleted
 * D. No-op re-save — same URL submitted → no delete called
 * E. External CDN hero → no delete (URL not in our /api/storage/ namespace)
 * F. hero-upload-cleanup: valid hero-images path → delete called, 200 ok
 * G. hero-upload-cleanup: invalid path / wrong namespace → 400, no delete
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";
import {
  HERO_IMAGE_CONTENT_TYPE_MESSAGE,
  HERO_IMAGE_SIZE_LIMIT_MESSAGE,
  MAX_HERO_IMAGE_SIZE_BYTES,
} from "@workspace/spirecut-shared";

// ── Object Storage mock ───────────────────────────────────────────────────────

// Must be hoisted so the vi.mock factory below can close over it.
const mockDeleteEntity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const { mockGetHeroUploadURL, mockNormalizeObjectEntityPath, mockGetObjectEntityFile, mockDownloadObject, heroBytes } = vi.hoisted(() => ({
  mockGetHeroUploadURL: vi.fn().mockResolvedValue("https://uploads.example.test/hero"),
  mockNormalizeObjectEntityPath: vi.fn((path: string) => `/objects/hero-images/${path.split("/").pop()}`),
  mockGetObjectEntityFile: vi.fn().mockResolvedValue({}),
  mockDownloadObject: vi.fn(),
  heroBytes: { value: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
}));
mockDownloadObject.mockImplementation(() => new Response(heroBytes.value));

vi.mock("../lib/objectStorage.js", () => {
  function MockObjectStorageService(this: unknown) {
    (this as Record<string, unknown>).deleteObjectEntity = mockDeleteEntity;
    (this as Record<string, unknown>).getObjectEntityUploadURL = vi.fn();
    (this as Record<string, unknown>).getObjectEntityUploadURLWithSubdir = mockGetHeroUploadURL;
    (this as Record<string, unknown>).normalizeObjectEntityPath = mockNormalizeObjectEntityPath;
    (this as Record<string, unknown>).getObjectEntityFile = mockGetObjectEntityFile;
    (this as Record<string, unknown>).downloadObject = mockDownloadObject;
  }
  return { ObjectStorageService: MockObjectStorageService };
});

// ── In-memory DB mock ─────────────────────────────────────────────────────────

const { store, mockInsert, mockSelect } = vi.hoisted(() => {
  const store = new Map<string, string>();

  const mockOnConflictDoUpdate = vi.fn().mockImplementation(() =>
    Promise.resolve(undefined)
  );

  const mockValues = vi.fn().mockImplementation((row: { key: string; value: string }) => {
    store.set(row.key, row.value);
    return { onConflictDoUpdate: mockOnConflictDoUpdate };
  });

  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

  const mockFrom = vi.fn().mockImplementation(() => {
    const rows = Array.from(store.entries()).map(([key, value]) => ({ key, value }));
    return Promise.resolve(rows);
  });

  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  return { store, mockInsert, mockSelect };
});

vi.mock("@workspace/db", () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  },
  settingsTable: { key: "key" },
  trainingDatesTable: {},
  trainedDoctorsTable: {},
  doctorCertificationsTable: {},
  resourcesTable: {},
  trainingRegistrationsTable: {},
  websiteCustomersTable: {},
  irocAppUsers: {},
  irocCustomers: {},
  irocProducts: {},
  irocInventoryLots: {},
  irocInvoices: {},
  irocInvoiceItems: {},
  irocNotifications: {},
}));

import app from "../app";

// ── Auth helper ───────────────────────────────────────────────────────────────

function makeValidJwt(payload: { userId: number; username: string }): string {
  const secret = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const data = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const JWT_AUTH = `Bearer ${makeValidJwt({ userId: 1, username: "admin" })}`;

// ── Constants ─────────────────────────────────────────────────────────────────

const HERO_UUID      = "550e8400-e29b-41d4-a716-446655440000";
const OLD_HERO_UUID  = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const HERO_PATH      = `/objects/hero-images/${HERO_UUID}`;
const OLD_HERO_PATH  = `/objects/hero-images/${OLD_HERO_UUID}`;
const LEGACY_PATH    = `/objects/uploads/${OLD_HERO_UUID}`;
const NEW_HERO_URL   = `https://example.com/api/storage${HERO_PATH}`;
const CANONICAL_HERO_URL = `/api/storage${HERO_PATH}`;
const OLD_HERO_URL   = `https://example.com/api/storage${OLD_HERO_PATH}`;
const LEGACY_URL     = `https://example.com/api/storage${LEGACY_PATH}`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("hero-image cleanup — POST /api/admin/website-settings ws_hero_image_url", () => {
  beforeEach(() => {
    store.clear();
    mockInsert.mockClear();
    mockDeleteEntity.mockClear();
    heroBytes.value = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  // A. Replacement — stored _ws_hero_object_path → deleted after new URL saved
  it("A: deletes the old hero object after a real URL change (stored objectPath)", async () => {
    // Pre-populate: an existing hero URL and its stored object path
    store.set("ws_hero_image_url", OLD_HERO_URL);
    store.set("_ws_hero_object_path", OLD_HERO_PATH);

    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_hero_image_url", value: NEW_HERO_URL, objectPath: HERO_PATH });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    // Old object must have been deleted using the stored path
    expect(mockDeleteEntity).toHaveBeenCalledOnce();
    expect(mockDeleteEntity).toHaveBeenCalledWith(OLD_HERO_PATH);

    // New URL and new object path must now be stored
    expect(store.get("ws_hero_image_url")).toBe(CANONICAL_HERO_URL);
    expect(store.get("_ws_hero_object_path")).toBe(HERO_PATH);
  });

  // B. Removal (empty value) — stored path → deleted
  it("B: deletes the old hero object when the admin clears the URL (value = '')", async () => {
    store.set("ws_hero_image_url", OLD_HERO_URL);
    store.set("_ws_hero_object_path", OLD_HERO_PATH);

    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_hero_image_url", value: "" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    expect(mockDeleteEntity).toHaveBeenCalledOnce();
    expect(mockDeleteEntity).toHaveBeenCalledWith(OLD_HERO_PATH);

    // URL cleared, objectPath cleared to empty string
    expect(store.get("ws_hero_image_url")).toBe("");
    expect(store.get("_ws_hero_object_path")).toBe("");
  });

  // C. Legacy URL cleanup — no stored objectPath but ws_hero_image_url is a storage URL
  it("C: deletes a legacy hero (no stored objectPath) by extracting path from the stored URL", async () => {
    // Before _ws_hero_object_path was introduced, only the URL was stored
    store.set("ws_hero_image_url", LEGACY_URL);
    // No _ws_hero_object_path in store

    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_hero_image_url", value: NEW_HERO_URL, objectPath: HERO_PATH });

    expect(res.status).toBe(200);
    expect(mockDeleteEntity).toHaveBeenCalledOnce();
    // Must delete via the extracted path from the legacy URL
    expect(mockDeleteEntity).toHaveBeenCalledWith(LEGACY_PATH);
  });

  // C2. Legacy hero-images URL also extracted correctly
  it("C2: extracts a hero-images path from a legacy URL stored without _ws_hero_object_path", async () => {
    store.set("ws_hero_image_url", OLD_HERO_URL); // hero-images namespace URL
    // No _ws_hero_object_path

    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_hero_image_url", value: NEW_HERO_URL, objectPath: HERO_PATH });

    expect(res.status).toBe(200);
    expect(mockDeleteEntity).toHaveBeenCalledWith(OLD_HERO_PATH);
  });

  // D. No-op re-save — same URL submitted → no delete called
  it("D: does NOT delete anything when the submitted URL equals the stored URL (no-op re-save)", async () => {
    store.set("ws_hero_image_url", `/api/storage${OLD_HERO_PATH}`);
    store.set("_ws_hero_object_path", OLD_HERO_PATH);

    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_hero_image_url", value: OLD_HERO_URL, objectPath: OLD_HERO_PATH });

    expect(res.status).toBe(200);
    expect(mockDeleteEntity).not.toHaveBeenCalled();
  });

  // E. External CDN hero → no delete (URL not in our /api/storage/ namespace)
  it("E: does NOT delete when the old URL is an external CDN URL (not our storage namespace)", async () => {
    store.set("ws_hero_image_url", "https://images.unsplash.com/photo-1234567890");
    // No _ws_hero_object_path

    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_hero_image_url", value: NEW_HERO_URL, objectPath: HERO_PATH });

    expect(res.status).toBe(200);
    expect(mockDeleteEntity).not.toHaveBeenCalled();
  });

  // Extra: malformed objectPath is rejected before any DB/storage operation
  it("rejects a malformed objectPath (wrong namespace) with 400", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_hero_image_url", value: NEW_HERO_URL, objectPath: "/objects/uploads/not-a-uuid" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid objectPath format" });
    expect(mockDeleteEntity).not.toHaveBeenCalled();
  });

  it("rejects spoofed PDF bytes even when their upload metadata claimed JPEG", async () => {
    heroBytes.value = new TextEncoder().encode("%PDF-1.7 spoofed as image/jpeg");
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_hero_image_url", value: NEW_HERO_URL, objectPath: HERO_PATH });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Uploaded hero file is not a supported image" });
    expect(store.get("ws_hero_image_url")).toBeUndefined();
  });

  it("activates a valid raster image after inspecting its stored bytes", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_hero_image_url", value: NEW_HERO_URL, objectPath: HERO_PATH });

    expect(res.status).toBe(200);
    expect(mockGetObjectEntityFile).toHaveBeenCalledWith(HERO_PATH);
    expect(store.get("ws_hero_image_url")).toBe(CANONICAL_HERO_URL);
  });

  it("canonicalizes a cross-origin same-path URL to the local storage route", async () => {
    const attackerUrl = `https://attacker.example/api/storage${HERO_PATH}`;
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_hero_image_url", value: attackerUrl, objectPath: HERO_PATH });

    expect(res.status).toBe(200);
    expect(store.get("ws_hero_image_url")).toBe(CANONICAL_HERO_URL);
    expect(store.get("ws_hero_image_url")).not.toContain("attacker.example");
  });
});

// ── hero-upload-cleanup endpoint ──────────────────────────────────────────────

describe("POST /api/admin/hero-upload-cleanup — orphan cleanup after failed save", () => {
  beforeEach(() => {
    store.clear();
    mockDeleteEntity.mockClear();
  });

  // F. Valid hero-images path → delete called, 200 ok
  it("F: deletes the object when a valid hero-images objectPath is supplied", async () => {
    const res = await request(app)
      .post("/api/admin/hero-upload-cleanup")
      .set("Authorization", JWT_AUTH)
      .send({ objectPath: HERO_PATH });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(mockDeleteEntity).toHaveBeenCalledOnce();
    expect(mockDeleteEntity).toHaveBeenCalledWith(HERO_PATH);
  });

  // F2. Returns 200 even if deleteObjectEntity throws (best-effort, GCS 404 etc.)
  it("F2: returns 200 even when the delete fails (idempotent / best-effort)", async () => {
    mockDeleteEntity.mockRejectedValueOnce(new Error("GCS 404"));

    const res = await request(app)
      .post("/api/admin/hero-upload-cleanup")
      .set("Authorization", JWT_AUTH)
      .send({ objectPath: HERO_PATH });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  // G. Wrong namespace (uploads/) → 400, no delete
  it("G: rejects a path in the uploads/ namespace with 400 (cross-asset deletion guard)", async () => {
    const res = await request(app)
      .post("/api/admin/hero-upload-cleanup")
      .set("Authorization", JWT_AUTH)
      .send({ objectPath: LEGACY_PATH });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid objectPath" });
    expect(mockDeleteEntity).not.toHaveBeenCalled();
  });

  // G2. Non-UUID suffix → 400
  it("G2: rejects a hero-images path with a non-UUID suffix with 400", async () => {
    const res = await request(app)
      .post("/api/admin/hero-upload-cleanup")
      .set("Authorization", JWT_AUTH)
      .send({ objectPath: "/objects/hero-images/not-a-uuid" });

    expect(res.status).toBe(400);
    expect(mockDeleteEntity).not.toHaveBeenCalled();
  });

  // G3. Missing objectPath → 400
  it("G3: rejects a request with no objectPath with 400", async () => {
    const res = await request(app)
      .post("/api/admin/hero-upload-cleanup")
      .set("Authorization", JWT_AUTH)
      .send({});

    expect(res.status).toBe(400);
    expect(mockDeleteEntity).not.toHaveBeenCalled();
  });

  // Requires auth
  it("returns 401 without Authorization header", async () => {
    const res = await request(app)
      .post("/api/admin/hero-upload-cleanup")
      .send({ objectPath: HERO_PATH });

    expect(res.status).toBe(401);
    expect(mockDeleteEntity).not.toHaveBeenCalled();
  });
});

// ── hero upload URL endpoint ──────────────────────────────────────────────────

describe("POST /api/storage/uploads/request-url/hero — upload size limit", () => {
  beforeEach(() => {
    mockGetHeroUploadURL.mockClear();
    mockNormalizeObjectEntityPath.mockClear();
  });

  it("rejects files above the shared 10 MB limit before requesting storage", async () => {
    const res = await request(app)
      .post("/api/storage/uploads/request-url/hero")
      .set("Authorization", JWT_AUTH)
      .send({
        name: "hero.jpg",
        size: MAX_HERO_IMAGE_SIZE_BYTES + 1,
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: HERO_IMAGE_SIZE_LIMIT_MESSAGE });
    expect(mockGetHeroUploadURL).not.toHaveBeenCalled();
    expect(mockNormalizeObjectEntityPath).not.toHaveBeenCalled();
  });

  it("returns a presigned URL for a file at the shared 10 MB limit", async () => {
    const res = await request(app)
      .post("/api/storage/uploads/request-url/hero")
      .set("Authorization", JWT_AUTH)
      .send({
        name: "hero.jpg",
        size: MAX_HERO_IMAGE_SIZE_BYTES,
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      uploadURL: "https://uploads.example.test/hero",
      metadata: {
        name: "hero.jpg",
        size: MAX_HERO_IMAGE_SIZE_BYTES,
        contentType: "image/jpeg",
      },
    });
    expect(mockGetHeroUploadURL).toHaveBeenCalledOnce();
    expect(mockGetHeroUploadURL).toHaveBeenCalledWith("hero-images");
  });

  it.each(["application/pdf", "text/plain", "video/mp4"])(
    "rejects non-image content type %s before requesting storage",
    async (contentType) => {
      const res = await request(app)
        .post("/api/storage/uploads/request-url/hero")
        .set("Authorization", JWT_AUTH)
        .send({
        name: `hero-upload.${contentType.split("/")[1].replace("jpeg", "jpg")}`,
          size: 1024,
          contentType,
        });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: HERO_IMAGE_CONTENT_TYPE_MESSAGE });
      expect(mockGetHeroUploadURL).not.toHaveBeenCalled();
      expect(mockNormalizeObjectEntityPath).not.toHaveBeenCalled();
    },
  );

  it.each(["image/png", "image/jpeg", "image/webp"])(
    "accepts image content type %s",
    async (contentType) => {
      const res = await request(app)
        .post("/api/storage/uploads/request-url/hero")
        .set("Authorization", JWT_AUTH)
        .send({
          name: `hero-upload.${contentType.split("/")[1].replace("jpeg", "jpg")}`,
          size: 1024,
          contentType,
        });

      expect(res.status).toBe(200);
      expect(res.body.metadata.contentType).toBe(contentType);
      expect(mockGetHeroUploadURL).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["renamed.pdf", "image/jpeg"],
    ["renamed.jpg", "application/pdf"],
    ["hero.svg", "image/svg+xml"],
  ])("rejects filename/MIME mismatch or unsafe image subtype (%s, %s)", async (name, contentType) => {
    const res = await request(app)
      .post("/api/storage/uploads/request-url/hero")
      .set("Authorization", JWT_AUTH)
      .send({ name, size: 1024, contentType });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: HERO_IMAGE_CONTENT_TYPE_MESSAGE });
    expect(mockGetHeroUploadURL).not.toHaveBeenCalled();
  });
});

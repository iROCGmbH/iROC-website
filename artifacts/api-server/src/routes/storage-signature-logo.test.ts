import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetUploadURL,
  mockGetUploadURLWithSubdir,
  mockNormalizeObjectEntityPath,
  mockVerifyToken,
} = vi.hoisted(() => {
  process.env.ADMIN_PASSWORD = "storage-signature-logo-test-password";

  return {
    mockGetUploadURL: vi.fn().mockResolvedValue("https://uploads.example.test/logo"),
    mockGetUploadURLWithSubdir: vi.fn().mockResolvedValue("https://uploads.example.test/subdir"),
    mockNormalizeObjectEntityPath: vi.fn().mockReturnValue("/objects/logos/test-logo"),
    mockVerifyToken: vi.fn().mockReturnValue(null),
  };
});

vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService: class {
    getObjectEntityUploadURLWithSubdir = mockGetUploadURL;
    getObjectEntityUploadURL = mockGetUploadURLWithSubdir;
    normalizeObjectEntityPath = mockNormalizeObjectEntityPath;
  },
  ObjectNotFoundError: class extends Error {},
}));

vi.mock("@workspace/db", () => ({
  db: {},
  pool: {},
  settingsTable: { key: "key" },
}));

vi.mock("./iroc.js", () => ({
  verifyToken: mockVerifyToken,
}));

import {
  EMAIL_SIGNATURE_LOGO_LIMIT_MESSAGE,
  EMAIL_SIGNATURE_LOGO_MAX_BYTES,
} from "../lib/email-signatures.js";
import storageRouter from "./storage.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  if (req.header("x-test-replit-auth") === "true") {
    Object.defineProperty(req, "isAuthenticated", { value: () => true });
  }
  next();
});
app.use("/api", storageRouter);

const AUTHORIZATION = "Bearer storage-signature-logo-test-password";
const VALID_LOGO = {
  name: "signature.png",
  size: 2048,
  contentType: "image/png",
};

beforeEach(() => {
  mockGetUploadURL.mockClear();
  mockGetUploadURLWithSubdir.mockClear();
  mockNormalizeObjectEntityPath.mockClear();
  mockVerifyToken.mockReset();
  mockVerifyToken.mockReturnValue(null);
});

const UPLOAD_ROUTES = [
  {
    name: "generic uploads",
    path: "/api/storage/uploads/request-url",
    storageMock: mockGetUploadURLWithSubdir,
  },
  {
    name: "hero uploads",
    path: "/api/storage/uploads/request-url/hero",
    storageMock: mockGetUploadURL,
  },
  {
    name: "logo uploads",
    path: "/api/storage/uploads/request-url/logo",
    storageMock: mockGetUploadURL,
  },
] as const;

describe("storage upload authorization", () => {
  it.each(UPLOAD_ROUTES)("accepts the admin bearer token for $name", async ({ path, storageMock }) => {
    const response = await request(app)
      .post(path)
      .set("Authorization", AUTHORIZATION)
      .send(VALID_LOGO);

    expect(response.status).toBe(200);
    expect(storageMock).toHaveBeenCalledOnce();
  });

  it.each(UPLOAD_ROUTES)("accepts a valid iROC JWT for $name", async ({ path, storageMock }) => {
    mockVerifyToken.mockReturnValue({ userId: 1, username: "admin" });

    const response = await request(app)
      .post(path)
      .set("Authorization", "Bearer valid-iroc-jwt")
      .send(VALID_LOGO);

    expect(response.status).toBe(200);
    expect(storageMock).toHaveBeenCalledOnce();
  });

  it.each(UPLOAD_ROUTES)("accepts an authenticated Replit Auth session for $name", async ({ path, storageMock }) => {
    const response = await request(app)
      .post(path)
      .set("x-test-replit-auth", "true")
      .send(VALID_LOGO);

    expect(response.status).toBe(200);
    expect(storageMock).toHaveBeenCalledOnce();
  });
});

describe("POST /api/storage/uploads/request-url/logo", () => {
  it.each([
    ["without an Authorization header", undefined],
    ["with an invalid bearer token", "Bearer invalid-storage-signature-logo-token"],
  ])("returns 401 %s without requesting a storage URL", async (_description, authorization) => {
    const testRequest = request(app)
      .post("/api/storage/uploads/request-url/logo")
      .send(VALID_LOGO);

    if (authorization) {
      testRequest.set("Authorization", authorization);
    }

    const response = await testRequest;

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
    expect(mockGetUploadURL).not.toHaveBeenCalled();
    expect(mockNormalizeObjectEntityPath).not.toHaveBeenCalled();
  });

  it("returns a presigned URL for an accepted raster logo request", async () => {
    const response = await request(app)
      .post("/api/storage/uploads/request-url/logo")
      .set("Authorization", AUTHORIZATION)
      .send(VALID_LOGO);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      uploadURL: "https://uploads.example.test/logo",
      objectPath: "/objects/logos/test-logo",
      metadata: VALID_LOGO,
    });
    expect(mockGetUploadURL).toHaveBeenCalledOnce();
    expect(mockGetUploadURL).toHaveBeenCalledWith("logos");
  });

  it.each([
    ["a logo above 512 KB", { size: EMAIL_SIGNATURE_LOGO_MAX_BYTES + 1 }],
    ["an unsupported content type", { contentType: "application/pdf" }],
  ])("returns the bilingual adjustment message for %s", async (_description, metadata) => {
    const response = await request(app)
      .post("/api/storage/uploads/request-url/logo")
      .set("Authorization", AUTHORIZATION)
      .send({ ...VALID_LOGO, ...metadata });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: EMAIL_SIGNATURE_LOGO_LIMIT_MESSAGE });
    expect(mockGetUploadURL).not.toHaveBeenCalled();
    expect(mockNormalizeObjectEntityPath).not.toHaveBeenCalled();
  });
});
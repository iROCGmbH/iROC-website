import express from "express";
import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";

const {
  mockGetUploadURL,
  mockGetUploadURLWithSubdir,
  mockNormalizeObjectEntityPath,
} = vi.hoisted(() => ({
  mockGetUploadURL: vi.fn().mockResolvedValue("https://uploads.example.test/subdir"),
  mockGetUploadURLWithSubdir: vi.fn().mockResolvedValue("https://uploads.example.test/generic"),
  mockNormalizeObjectEntityPath: vi.fn().mockReturnValue("/objects/test-upload"),
}));

vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService: class {
    getObjectEntityUploadURLWithSubdir = mockGetUploadURL;
    getObjectEntityUploadURL = mockGetUploadURLWithSubdir;
    normalizeObjectEntityPath = mockNormalizeObjectEntityPath;
  },
  ObjectNotFoundError: class extends Error {},
}));

vi.mock("./iroc.js", () => ({
  verifyToken: vi.fn().mockReturnValue(null),
}));

import storageRouter from "./storage.js";

vi.mock("./index.js", () => {
  const router = express.Router();
  router.use(storageRouter);
  return { default: router };
});

import { createApp } from "../app.js";

const app = createApp();
const sessionKey = crypto.randomUUID();
const ACTIVE_SESSION_ID = `active-replit-session-${sessionKey}`;
const EXPIRED_SESSION_ID = `expired-replit-session-${sessionKey}`;
let createdSessionsTable = false;
const VALID_IMAGE = {
  name: "upload.png",
  size: 2048,
  contentType: "image/png",
};

const UPLOAD_PATHS = [
  "/api/storage/uploads/request-url",
  "/api/storage/uploads/request-url/hero",
  "/api/storage/uploads/request-url/logo",
] as const;

async function seedSessions() {
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire)
     VALUES
       ($1, $2::jsonb, NOW() + INTERVAL '1 hour'),
       ($3, $4::jsonb, NOW() - INTERVAL '1 hour')`,
    [
      ACTIVE_SESSION_ID,
      JSON.stringify({ user: { id: "active-replit-user", email: "admin@example.test" } }),
      EXPIRED_SESSION_ID,
      JSON.stringify({ user: { id: "expired-replit-user", email: "expired@example.test" } }),
    ],
  );
}

beforeAll(async () => {
  // Replit Auth owns this table in deployed environments. Some isolated local
  // databases omit it, so provide the same minimal session-store contract for
  // this integration test and remove it again when this suite created it.
  const existing = await pool.query<{ session_table: string | null }>(
    "SELECT to_regclass('sessions') AS session_table",
  );
  if (existing.rows[0]?.session_table) return;

  await pool.query(
    `CREATE TABLE sessions (
       sid text PRIMARY KEY,
       sess jsonb NOT NULL,
       expire timestamp with time zone NOT NULL
     )`,
  );
  createdSessionsTable = true;
});

beforeEach(async () => {
  mockGetUploadURL.mockClear();
  mockGetUploadURLWithSubdir.mockClear();
  mockNormalizeObjectEntityPath.mockClear();
  await pool.query("DELETE FROM sessions WHERE sid = ANY($1::text[])", [
    [ACTIVE_SESSION_ID, EXPIRED_SESSION_ID],
  ]);
  await seedSessions();
});

afterAll(async () => {
  await pool.query("DELETE FROM sessions WHERE sid = ANY($1::text[])", [
    [ACTIVE_SESSION_ID, EXPIRED_SESSION_ID],
  ]);
  if (createdSessionsTable) {
    await pool.query("DROP TABLE sessions");
  }
});

describe("storage uploads through the production Replit Auth middleware", () => {
  it.each(UPLOAD_PATHS)("accepts a database-backed active session at %s", async (path) => {
    const response = await request(app)
      .post(path)
      .set("Cookie", `sid=${ACTIVE_SESSION_ID}`)
      .send(VALID_IMAGE);

    expect(response.status).toBe(200);
    expect(mockGetUploadURL.mock.calls.length + mockGetUploadURLWithSubdir.mock.calls.length).toBe(1);
  });

  it.each(UPLOAD_PATHS)("rejects an expired database session at %s before storage URL generation", async (path) => {
    const response = await request(app)
      .post(path)
      .set("Cookie", `sid=${EXPIRED_SESSION_ID}`)
      .send(VALID_IMAGE);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
    expect(mockGetUploadURL).not.toHaveBeenCalled();
    expect(mockGetUploadURLWithSubdir).not.toHaveBeenCalled();
  });
});
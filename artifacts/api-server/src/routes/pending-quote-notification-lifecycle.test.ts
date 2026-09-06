/**
 * Integration coverage for the pending quote notification lifecycle.
 *
 * The unread pending_quote notification is intentionally coalesced by a
 * partial unique index. Once an admin reads it, a later patient submission
 * must be able to create a new unread notification.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { pool as bootstrapPool } from "@workspace/db";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "iroc-admin-2024";
const TEST_MARKER = `pending-quote-notification-lifecycle-${Date.now()}`;
const TEST_SCHEMA = `pending_quote_lifecycle_${process.pid}_${Date.now()}`;
const CONTROL_SCHEMA = `${TEST_SCHEMA}_unrelated`;
const UNRELATED_MESSAGE = `${TEST_MARKER}-unrelated-alert`;
const DATABASE_ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_INTERNAL",
  "DATABASE_URL_PUBLIC",
  "DATABASE_URL_PATIENTS",
  "DATABASE_URL_DOCTORS",
] as const;
const originalDatabaseUrls = Object.fromEntries(
  DATABASE_ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof DATABASE_ENV_KEYS)[number], string | undefined>;
const sharedDatabaseUrl = process.env.DATABASE_URL_INTERNAL ?? process.env.DATABASE_URL;

if (!sharedDatabaseUrl) {
  throw new Error("DATABASE_URL_INTERNAL or DATABASE_URL is required for this integration test");
}

let app: Express;
let pool: typeof bootstrapPool;
let adminToken: string;
let testNotificationIds: number[] = [];
let testSubmissionKeys: string[] = [];

function databaseUrlForSchema(connectionString: string, schema: string) {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

async function cleanup() {
  const { rows: submissionRows } = await pool.query<{ key: string }>(
    "SELECT key FROM settings WHERE value LIKE $1",
    [`%${TEST_MARKER}%`],
  );
  const submissionKeys = [
    ...new Set([
      ...testSubmissionKeys,
      ...submissionRows.map((row) => row.key),
    ]),
  ];

  if (testNotificationIds.length > 0) {
    await pool.query(
      "DELETE FROM iroc_notifications WHERE id = ANY($1::int[])",
      [testNotificationIds],
    );
  }
  if (submissionKeys.length > 0) {
    await pool.query(
      "DELETE FROM settings WHERE key = ANY($1::text[])",
      [submissionKeys],
    );
  }

}

async function submitQuote(suffix: string) {
  return request(app)
    .post("/api/patient-postop")
    .send({
      procedure: "ct",
      operationMonth: "2026-08",
      rating: 5,
      experience: `${TEST_MARKER}-${suffix}: Excellent recovery and very happy with the result.`,
      shareQuote: true,
    })
    .set("Content-Type", "application/json");
}

async function findOwnedUnreadNotification(submissionKeys: string[]) {
  return pool.query<{ id: number; is_read: boolean; submission_key: string }>(
    `SELECT id, is_read, message::jsonb->>'submissionKey' AS submission_key
       FROM iroc_notifications
      WHERE type = 'pending_quote'
        AND is_read = false
        AND message::jsonb->>'submissionKey' = ANY($1::text[])`,
    [submissionKeys],
  );
}

describe("pending_quote notification lifecycle", () => {
  beforeAll(async () => {
    await bootstrapPool.query(`CREATE SCHEMA "${TEST_SCHEMA}"`);
    await bootstrapPool.query(`CREATE SCHEMA "${CONTROL_SCHEMA}"`);
    await bootstrapPool.query(`
      CREATE TABLE "${TEST_SCHEMA}".settings (
        key text PRIMARY KEY,
        value text NOT NULL,
        updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE "${TEST_SCHEMA}".iroc_app_users (
        id serial PRIMARY KEY,
        username text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        password_changed_at timestamp,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE "${TEST_SCHEMA}".iroc_notifications (
        id serial PRIMARY KEY,
        type text NOT NULL DEFAULT 'low_stock',
        message text NOT NULL,
        product_id integer,
        is_read boolean NOT NULL DEFAULT false,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX uniq_unread_pending_quote
        ON "${TEST_SCHEMA}".iroc_notifications (type)
        WHERE is_read = false AND type = 'pending_quote';
      CREATE TABLE "${CONTROL_SCHEMA}".iroc_notifications (
        id serial PRIMARY KEY,
        type text NOT NULL,
        message text NOT NULL,
        is_read boolean NOT NULL DEFAULT false
      );
      INSERT INTO "${CONTROL_SCHEMA}".iroc_notifications (type, message)
      VALUES ('pending_quote', '${UNRELATED_MESSAGE}');
    `);

    const isolatedDatabaseUrl = databaseUrlForSchema(sharedDatabaseUrl, TEST_SCHEMA);
    for (const key of DATABASE_ENV_KEYS) {
      process.env[key] = isolatedDatabaseUrl;
    }

    vi.resetModules();
    ({ pool } = await import("@workspace/db"));
    ({ default: app } = await import("../app.js"));

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const login = await request(app)
        .post("/api/iroc/login")
        .send({ username: "admin", password: ADMIN_PASSWORD })
        .set("Content-Type", "application/json");
      if (login.status === 200) {
        adminToken = login.body.token as string;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(adminToken).toEqual(expect.any(String));
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
    for (const key of DATABASE_ENV_KEYS) {
      const originalValue = originalDatabaseUrls[key];
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
    await bootstrapPool.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
    await bootstrapPool.query(`DROP SCHEMA IF EXISTS "${CONTROL_SCHEMA}" CASCADE`);
  });

  it("creates a fresh unread notification after the previous one is read", async () => {
    const firstSubmission = await submitQuote("first");
    expect(firstSubmission.status).toBe(201);
    const firstSubmissionRow = await pool.query<{ key: string }>(
      "SELECT key FROM settings WHERE value LIKE $1 ORDER BY key DESC LIMIT 1",
      [`%${TEST_MARKER}-first%`],
    );
    expect(firstSubmissionRow.rows).toHaveLength(1);
    testSubmissionKeys.push(firstSubmissionRow.rows[0].key);

    const firstUnread = await findOwnedUnreadNotification([firstSubmissionRow.rows[0].key]);
    expect(firstUnread.rows).toHaveLength(1);
    const firstNotificationId = firstUnread.rows[0].id;
    testNotificationIds.push(firstNotificationId);
    expect(firstUnread.rows[0].is_read).toBe(false);
    expect(firstUnread.rows[0].submission_key).toBe(firstSubmissionRow.rows[0].key);

    const readResponse = await request(app)
      .patch(`/api/iroc/notifications/${firstNotificationId}/read`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(readResponse.status).toBe(200);

    const afterRead = await pool.query<{ is_read: boolean }>(
      "SELECT is_read FROM iroc_notifications WHERE id = $1",
      [firstNotificationId],
    );
    expect(afterRead.rows).toEqual([{ is_read: true }]);

    const secondSubmission = await submitQuote("second");
    expect(secondSubmission.status).toBe(201);
    const secondSubmissionRow = await pool.query<{ key: string }>(
      "SELECT key FROM settings WHERE value LIKE $1 ORDER BY key DESC LIMIT 1",
      [`%${TEST_MARKER}-second%`],
    );
    expect(secondSubmissionRow.rows).toHaveLength(1);
    testSubmissionKeys.push(secondSubmissionRow.rows[0].key);

    const secondUnread = await findOwnedUnreadNotification([secondSubmissionRow.rows[0].key]);
    expect(secondUnread.rows).toHaveLength(1);
    expect(secondUnread.rows[0].id).not.toBe(firstNotificationId);
    expect(secondUnread.rows[0].is_read).toBe(false);
    testNotificationIds.push(secondUnread.rows[0].id);
  });

  it("coalesces concurrent shareable submissions into one unread notification", async () => {
    // The prior lifecycle test intentionally leaves its second notification
    // unread. Read all notifications created by this test file so the
    // concurrent submissions exercise the partial unique index from an empty
    // pending_quote state.
    expect(testNotificationIds).not.toHaveLength(0);
    await pool.query(
      "UPDATE iroc_notifications SET is_read = true WHERE id = ANY($1::int[])",
      [testNotificationIds],
    );

    const suffixes = ["one", "two", "three", "four", "five"];
    const responses = await Promise.all(suffixes.map((suffix) => submitQuote(`concurrent-${suffix}`)));

    expect(responses.every((response) => response.status === 201)).toBe(true);

    const submissionRows = await pool.query<{ key: string }>(
      "SELECT key FROM settings WHERE value LIKE $1 ORDER BY key",
      [`%${TEST_MARKER}-concurrent-%`],
    );
    expect(submissionRows.rows).toHaveLength(suffixes.length);
    testSubmissionKeys.push(...submissionRows.rows.map((row) => row.key));

    const concurrentSubmissionKeys = submissionRows.rows.map((row) => row.key);
    const unreadNotifications = await findOwnedUnreadNotification(concurrentSubmissionKeys);
    expect(unreadNotifications.rows).toHaveLength(1);
    expect(unreadNotifications.rows[0]).toMatchObject({
      is_read: false,
    });
    expect(concurrentSubmissionKeys).toContain(unreadNotifications.rows[0].submission_key);
    testNotificationIds.push(unreadNotifications.rows[0].id);
  });

  it("does not change a preexisting unread pending quote alert outside its schema", async () => {
    const unrelated = await bootstrapPool.query<{ message: string; is_read: boolean }>(
      `SELECT message, is_read
         FROM "${CONTROL_SCHEMA}".iroc_notifications
        WHERE type = 'pending_quote'`,
    );
    expect(unrelated.rows).toEqual([{
      message: UNRELATED_MESSAGE,
      is_read: false,
    }]);
  });
});

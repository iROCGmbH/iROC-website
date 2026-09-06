/**
 * Regression tests: edited Sally reply drafts are saved and sent as edited.
 *
 * The admin flow saves changed subject/body values before approving a pending
 * queue item. These tests cover both halves of that contract against the real
 * route and database, while replacing the email transport so no message is
 * delivered during the test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import {
  pool as bootstrapPool,
  provisionMigrationBackedTestSchema,
  withDatabaseUrlsScopedToSchema,
} from "@workspace/db";

const emailState = vi.hoisted(() => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "edited-draft-message-id" }),
  getEmailDest: vi.fn().mockResolvedValue("admin@i-roc.de"),
}));

vi.mock("../lib/email.js", () => ({
  sendEmail: emailState.sendEmail,
  isSmtpConfigured: vi.fn().mockResolvedValue(true),
  getEmailDest: emailState.getEmailDest,
}));

vi.mock("../lib/sally-lessons.js", () => ({
  recordCorrectionLesson: vi.fn().mockResolvedValue(undefined),
}));

const ADMIN_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? "iroc-admin-2024"}`;
const TEST_EMAIL = "sally-email-queue-edit-test@example.com";
const TEST_SCHEMA = `sally_email_queue_edit_${process.pid}_${Date.now()}`;
const sharedDatabaseUrl = process.env.DATABASE_URL_INTERNAL ?? process.env.DATABASE_URL;

if (!sharedDatabaseUrl) {
  throw new Error("DATABASE_URL_INTERNAL or DATABASE_URL is required for this integration test");
}

let app: Express;
let pool: typeof bootstrapPool;

function makeValidJwt(username: string): string {
  const secret = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
  const payload = Buffer.from(JSON.stringify({
    userId: username === "alice" ? 1 : 2,
    username,
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `Bearer ${payload}.${signature}`;
}

const ALICE_AUTH = makeValidJwt("alice");
const BOB_AUTH = makeValidJwt("bob");

async function cleanup() {
  await pool.query(
    `DELETE FROM sally_escalation_reconciliation_audit
      WHERE queue_item_id IN (
        SELECT id FROM sally_email_queue WHERE recipient_email = $1
      )`,
    [TEST_EMAIL],
  );
  await pool.query(
    "DELETE FROM sally_email_queue WHERE recipient_email = $1",
    [TEST_EMAIL],
  );
  await pool.query(
    "DELETE FROM iroc_notifications WHERE message::text LIKE $1",
    [`%${TEST_EMAIL}%`],
  );
}

async function insertQueueItem(
  status: "pending" | "sent" | "cancelled" = "pending",
  subject = "Original subject",
  body = "Original body",
) {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sally_email_queue
       (recipient_email, subject, body, trigger_type, status)
     VALUES ($1, $3, $4, 'inbound_reply', $2)
     RETURNING id`,
    [TEST_EMAIL, status, subject, body],
  );
  return rows[0].id;
}

async function insertReconciliationItem(
  escalationStatus: "unconfirmed" | "succeeded" | "confirmed" | "failed" = "unconfirmed",
  queueStatus: "pending" | "sent" = "sent",
) {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sally_email_queue
       (recipient_email, subject, body, trigger_type, status,
        escalation_forward_status, inbound_from, inbound_body,
        detected_language, detected_formality)
      VALUES ($1, 'Escalation subject', 'Holding reply', 'inbound_reply', $2,
              $3, 'customer@example.com', 'Original customer inquiry',
              'en', 'formal')
     RETURNING id`,
    [TEST_EMAIL, queueStatus, escalationStatus],
  );
  return rows[0].id;
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const content = csv.startsWith("\uFEFF") ? csv.slice(1) : csv;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (inQuotes) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && content[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error("CSV ended inside a quoted field");
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

beforeAll(async () => {
  await provisionMigrationBackedTestSchema(bootstrapPool, TEST_SCHEMA);
  await withDatabaseUrlsScopedToSchema(sharedDatabaseUrl, TEST_SCHEMA, async () => {
    vi.resetModules();
    ({ pool } = await import("@workspace/db"));
    ({ default: app } = await import("../app.js"));
  });
  await pool.query(`
    ALTER TABLE sally_email_queue
      DROP CONSTRAINT IF EXISTS sally_email_queue_escalation_forward_status_check;
    ALTER TABLE sally_email_queue
      ADD CONSTRAINT sally_email_queue_escalation_forward_status_check
        CHECK (escalation_forward_status IN (
          'forwarding', 'unconfirmed', 'resending', 'succeeded', 'confirmed', 'failed'
        ));
    ALTER TABLE sally_escalation_reconciliation_audit
      DROP CONSTRAINT IF EXISTS sally_escalation_reconciliation_action_check;
    ALTER TABLE sally_escalation_reconciliation_audit
      ADD CONSTRAINT sally_escalation_reconciliation_action_check
        CHECK (action IN (
          'confirm_delivery', 'confirm_conflict',
          'resend_requested', 'resend_conflict',
          'resend_succeeded', 'resend_failed', 'resend_unconfirmed',
          'retry_succeeded', 'retry_failed', 'retry_unconfirmed'
        ));
  `);
});
beforeEach(async () => {
  await cleanup();
  emailState.sendEmail.mockClear();
  emailState.getEmailDest.mockResolvedValue("admin@i-roc.de");
});
afterAll(async () => {
  try {
    if (pool) {
      await cleanup();
    }
  } finally {
    await bootstrapPool.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
  }
});

describe("GET /api/admin/sally/email-queue/reconciliation-actors", () => {
  it("returns distinct trimmed actors from reconciliation history in stable order", async () => {
    const queueItemId = await insertReconciliationItem();
    await pool.query(
      `INSERT INTO sally_escalation_reconciliation_audit
         (queue_item_id, action, previous_status, resulting_status, actor)
       VALUES
         ($1, 'confirm_delivery', 'unconfirmed', 'confirmed', 'iroc:Bob'),
         ($1, 'resend_conflict', 'confirmed', 'confirmed', ' iroc:Bob '),
         ($1, 'confirm_conflict', 'confirmed', 'confirmed', 'iroc:alice')`,
      [queueItemId],
    );

    const response = await request(app)
      .get("/api/admin/sally/email-queue/reconciliation-actors")
      .set("Authorization", ADMIN_AUTH);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(["iroc:alice", "iroc:Bob"]);
  });
});

describe("named password administrator authentication", () => {
  it("returns a non-secret session and attributes Sally reconciliation to the named administrator", async () => {
    const loginResponse = await request(app)
      .post("/api/admin/login")
      .send({ name: "  Casey   Reviewer  ", password: process.env.ADMIN_PASSWORD ?? "iroc-admin-2024" });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body).toMatchObject({ actor: "password:Casey Reviewer" });
    expect(typeof loginResponse.body.token).toBe("string");
    expect(loginResponse.body.token).not.toContain(process.env.ADMIN_PASSWORD ?? "iroc-admin-2024");

    const queueItemId = await insertReconciliationItem();
    const reconciliationResponse = await request(app)
      .post(`/api/admin/sally/email-queue/${queueItemId}/confirm-escalation`)
      .set("Authorization", `Bearer ${loginResponse.body.token}`)
      .send();

    expect(reconciliationResponse.status).toBe(200);
    const { rows } = await pool.query<{ actor: string }>(
      `SELECT actor
         FROM sally_escalation_reconciliation_audit
        WHERE queue_item_id = $1`,
      [queueItemId],
    );
    expect(rows).toEqual([{ actor: "password:Casey Reviewer" }]);
  });

  it("keeps the legacy shared password actor generic and rejects incorrect credentials", async () => {
    const wrongPasswordResponse = await request(app)
      .post("/api/admin/login")
      .send({ username: "Casey Reviewer", password: "not-the-admin-password" });
    expect(wrongPasswordResponse.status).toBe(401);

    const queueItemId = await insertReconciliationItem();
    const reconciliationResponse = await request(app)
      .post(`/api/admin/sally/email-queue/${queueItemId}/confirm-escalation`)
      .set("Authorization", ADMIN_AUTH)
      .send();

    expect(reconciliationResponse.status).toBe(200);
    const { rows } = await pool.query<{ actor: string }>(
      "SELECT actor FROM sally_escalation_reconciliation_audit WHERE queue_item_id = $1",
      [queueItemId],
    );
    expect(rows).toEqual([{ actor: "admin" }]);
  });
});

describe("PUT /api/admin/sally/email-queue/:id", () => {
  it("persists an edited subject and body on a pending reply draft", async () => {
    const queueItemId = await insertQueueItem();

    const response = await request(app)
      .put(`/api/admin/sally/email-queue/${queueItemId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({
        subject: "Edited subject",
        body: "Edited body",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: queueItemId,
      subject: "Edited subject",
      body: "Edited body",
      status: "pending",
    });

    const { rows } = await pool.query<{ subject: string; body: string; status: string }>(
      "SELECT subject, body, status FROM sally_email_queue WHERE id = $1",
      [queueItemId],
    );
    expect(rows).toEqual([
      { subject: "Edited subject", body: "Edited body", status: "pending" },
    ]);
  });

  it.each(["sent", "cancelled"] as const)(
    "rejects edits to a %s queue item",
    async (status) => {
      const queueItemId = await insertQueueItem(status);

      const response = await request(app)
        .put(`/api/admin/sally/email-queue/${queueItemId}`)
        .set("Authorization", ADMIN_AUTH)
        .send({
          subject: "Should not be saved",
          body: "Should not be saved",
        });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Not found or not pending" });

      const { rows } = await pool.query<{ subject: string; body: string; status: string }>(
        "SELECT subject, body, status FROM sally_email_queue WHERE id = $1",
        [queueItemId],
      );
      expect(rows).toEqual([
        { subject: "Original subject", body: "Original body", status },
      ]);
    },
  );

  it.each([
    { field: "subject", value: "" },
    { field: "subject", value: "   " },
    { field: "body", value: "" },
    { field: "body", value: " \t\n " },
  ] as const)(
    "rejects a blank $field without changing the pending draft",
    async ({ field, value }) => {
      const queueItemId = await insertQueueItem();

      const response = await request(app)
        .put(`/api/admin/sally/email-queue/${queueItemId}`)
        .set("Authorization", ADMIN_AUTH)
        .send({ [field]: value });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain(`Email ${field} cannot be blank`);

      const { rows } = await pool.query<{ subject: string; body: string; status: string }>(
        "SELECT subject, body, status FROM sally_email_queue WHERE id = $1",
        [queueItemId],
      );
      expect(rows).toEqual([
        { subject: "Original subject", body: "Original body", status: "pending" },
      ]);
    },
  );
});

describe("POST /api/admin/sally/email-queue/:id/approve", () => {
  it("sends the subject and body saved by the edit endpoint", async () => {
    const queueItemId = await insertQueueItem();

    const updateResponse = await request(app)
      .put(`/api/admin/sally/email-queue/${queueItemId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({
        subject: "Final edited subject",
        body: "Final edited body",
      });
    expect(updateResponse.status).toBe(200);

    const approveResponse = await request(app)
      .post(`/api/admin/sally/email-queue/${queueItemId}/approve`)
      .set("Authorization", ADMIN_AUTH)
      .send();

    expect(approveResponse.status).toBe(200);
    expect(emailState.sendEmail).toHaveBeenCalledTimes(1);
    expect(emailState.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: TEST_EMAIL,
        subject: "Final edited subject",
        mailboxPurpose: "sally_ai",
      }),
    );

    const { rows } = await pool.query<{ status: string; message_id: string }>(
      "SELECT status, message_id FROM sally_email_queue WHERE id = $1",
      [queueItemId],
    );
    expect(rows).toEqual([
      { status: "sent", message_id: "edited-draft-message-id" },
    ]);
  });

  it.each([
    { subject: "", body: "Original body" },
    { subject: "   ", body: "Original body" },
    { subject: "Original subject", body: "" },
    { subject: "Original subject", body: " \t\n " },
  ])(
    "rejects a queue item with a blank subject or body without sending",
    async ({ subject, body }) => {
      const queueItemId = await insertQueueItem("pending", subject, body);

      const response = await request(app)
        .post(`/api/admin/sally/email-queue/${queueItemId}/approve`)
        .set("Authorization", ADMIN_AUTH)
        .send();

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/cannot be blank/);
      expect(emailState.sendEmail).not.toHaveBeenCalled();

      const { rows } = await pool.query<{ subject: string; body: string; status: string }>(
        "SELECT subject, body, status FROM sally_email_queue WHERE id = $1",
        [queueItemId],
      );
      expect(rows).toEqual([{ subject, body, status: "pending" }]);
    },
  );
});

describe("POST /api/admin/sally/email-queue/:id/resend-escalation", () => {
  it("requires explicit acknowledgement of duplicate-delivery risk", async () => {
    const response = await request(app)
      .post("/api/admin/sally/email-queue/999999/resend-escalation")
      .set("Authorization", ADMIN_AUTH)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Explicit duplicate-delivery acknowledgement is required",
    });
  });

  it("serializes a simultaneous confirmation and resend, preserving the winner and conflict audit", async () => {
    const queueItemId = await insertReconciliationItem();

    const [confirmResponse, resendResponse] = await Promise.all([
      request(app)
        .post(`/api/admin/sally/email-queue/${queueItemId}/confirm-escalation`)
        .set("Authorization", ALICE_AUTH)
        .send(),
      request(app)
        .post(`/api/admin/sally/email-queue/${queueItemId}/resend-escalation`)
        .set("Authorization", BOB_AUTH)
        .send({ acknowledgeDuplicateRisk: true }),
    ]);

    expect([confirmResponse.status, resendResponse.status].sort()).toEqual([200, 409]);
    expect(
      [confirmResponse, resendResponse].find((response) => response.status === 409)?.body,
    ).toEqual({
      error: "Escalation was already reconciled by another administrator",
    });

    const [{ rows: queueRows }, { rows: auditRows }] = await Promise.all([
      pool.query<{ escalation_forward_status: string }>(
        "SELECT escalation_forward_status FROM sally_email_queue WHERE id = $1",
        [queueItemId],
      ),
      pool.query<{ action: string; previous_status: string; resulting_status: string; actor: string }>(
        `SELECT action, previous_status, resulting_status, actor
           FROM sally_escalation_reconciliation_audit
          WHERE queue_item_id = $1
          ORDER BY id`,
        [queueItemId],
      ),
    ]);

    const finalStatus = queueRows[0].escalation_forward_status;
    expect(["confirmed", "succeeded"]).toContain(finalStatus);
    const expectedActions = confirmResponse.status === 200
      ? ["confirm_delivery", "resend_conflict"]
      : ["resend_requested", "confirm_conflict", "resend_succeeded"];
    expect(auditRows).toHaveLength(expectedActions.length);
    expect(auditRows.map((row) => row.action)).toEqual(expect.arrayContaining(expectedActions));
    expect(auditRows.filter((row) => row.action.endsWith("_conflict"))).toHaveLength(1);
    if (confirmResponse.status === 200) {
      expect(auditRows).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: "confirm_delivery", actor: "iroc:alice" }),
        expect.objectContaining({ action: "resend_conflict", actor: "iroc:bob" }),
      ]));
    } else {
      expect(auditRows).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: "resend_requested", actor: "iroc:bob" }),
        expect.objectContaining({ action: "confirm_conflict", actor: "iroc:alice" }),
        expect.objectContaining({ action: "resend_succeeded", actor: "iroc:bob" }),
      ]));
    }
    expect(emailState.sendEmail).toHaveBeenCalledTimes(resendResponse.status === 200 ? 1 : 0);
  });

  it("does not resend an already-succeeded escalation or create a second delivery attempt", async () => {
    const queueItemId = await insertReconciliationItem("succeeded");

    const response = await request(app)
      .post(`/api/admin/sally/email-queue/${queueItemId}/resend-escalation`)
      .set("Authorization", ADMIN_AUTH)
      .send({ acknowledgeDuplicateRisk: true });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "Escalation was already reconciled by another administrator",
    });
    expect(emailState.sendEmail).not.toHaveBeenCalled();

    const { rows } = await pool.query(
      `SELECT action, previous_status, resulting_status, acknowledged_duplicate_risk
         FROM sally_escalation_reconciliation_audit
        WHERE queue_item_id = $1`,
      [queueItemId],
    );
    expect(rows).toEqual([{
      action: "resend_conflict",
      previous_status: "succeeded",
      resulting_status: "succeeded",
      acknowledged_duplicate_risk: true,
    }]);
  });
});

describe("POST /api/admin/sally/email-queue/:id/retry-escalation", () => {
  it.each([
    {
      outcome: "succeeded",
      actor: ALICE_AUTH,
      expectedStatus: 200,
      expectedAction: "retry_succeeded",
      resultingStatus: "succeeded",
    },
    {
      outcome: "failed",
      actor: BOB_AUTH,
      expectedStatus: 502,
      expectedAction: "retry_failed",
      resultingStatus: "failed",
    },
    {
      outcome: "unconfirmed",
      actor: ALICE_AUTH,
      expectedStatus: 502,
      expectedAction: "retry_unconfirmed",
      resultingStatus: "forwarding",
    },
  ] as const)(
    "records $outcome retry attribution without changing delivery safety",
    async ({ outcome, actor, expectedStatus, expectedAction, resultingStatus }) => {
      const queueItemId = await insertReconciliationItem("failed", "pending");
      if (outcome === "failed") {
        emailState.getEmailDest.mockResolvedValueOnce("");
      } else if (outcome === "unconfirmed") {
        emailState.sendEmail.mockRejectedValueOnce(new Error("simulated SMTP failure"));
      }

      const response = await request(app)
        .post(`/api/admin/sally/email-queue/${queueItemId}/retry-escalation`)
        .set("Authorization", actor)
        .send();

      expect(response.status).toBe(expectedStatus);
      const { rows: auditRows } = await pool.query<{
        action: string;
        previous_status: string;
        resulting_status: string;
        actor: string;
      }>(
        `SELECT action, previous_status, resulting_status, actor
           FROM sally_escalation_reconciliation_audit
          WHERE queue_item_id = $1`,
        [queueItemId],
      );
      expect(auditRows).toEqual([{
        action: expectedAction,
        previous_status: "forwarding",
        resulting_status: resultingStatus,
        actor: actor === ALICE_AUTH ? "iroc:alice" : "iroc:bob",
      }]);

      const { rows: queueRows } = await pool.query<{ escalation_forward_status: string }>(
        "SELECT escalation_forward_status FROM sally_email_queue WHERE id = $1",
        [queueItemId],
      );
      expect(queueRows[0].escalation_forward_status).toBe(resultingStatus);
      expect(emailState.sendEmail).toHaveBeenCalledTimes(outcome === "failed" ? 0 : 1);

      if (outcome === "unconfirmed") {
        expect(response.body).toEqual({
          error: "Escalation delivery is unconfirmed; review manually before any resend",
        });

        const secondResponse = await request(app)
          .post(`/api/admin/sally/email-queue/${queueItemId}/retry-escalation`)
          .set("Authorization", actor)
          .send();

        expect(secondResponse.status).toBe(409);
        expect(secondResponse.body).toEqual({
          error: "Escalation is not eligible for retry",
        });
        expect(emailState.sendEmail).toHaveBeenCalledTimes(1);
      }
    },
  );
});

describe("POST /api/admin/sally/email-queue/:id/confirm-escalation", () => {
  it("records a conflict for a repeated confirmation without sending email", async () => {
    const queueItemId = await insertReconciliationItem();

    const firstResponse = await request(app)
      .post(`/api/admin/sally/email-queue/${queueItemId}/confirm-escalation`)
      .set("Authorization", ADMIN_AUTH)
      .send();
    const secondResponse = await request(app)
      .post(`/api/admin/sally/email-queue/${queueItemId}/confirm-escalation`)
      .set("Authorization", ADMIN_AUTH)
      .send();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(409);
    expect(emailState.sendEmail).not.toHaveBeenCalled();

    const { rows } = await pool.query(
      `SELECT escalation_forward_status
         FROM sally_email_queue
        WHERE id = $1`,
      [queueItemId],
    );
    expect(rows).toEqual([{ escalation_forward_status: "confirmed" }]);

    const { rows: auditRows } = await pool.query(
      `SELECT action, previous_status, resulting_status
         FROM sally_escalation_reconciliation_audit
        WHERE queue_item_id = $1
        ORDER BY id`,
      [queueItemId],
    );
    expect(auditRows).toEqual([
      {
        action: "confirm_delivery",
        previous_status: "unconfirmed",
        resulting_status: "confirmed",
      },
      {
        action: "confirm_conflict",
        previous_status: "confirmed",
        resulting_status: "confirmed",
      },
    ]);
  });
});

describe("GET /api/admin/sally/email-queue", () => {
  it("filters reconciliation deliveries by outcome and audit actor without changing them", async () => {
    const unresolvedId = await insertReconciliationItem("unconfirmed");
    const confirmedId = await insertReconciliationItem("confirmed");
    const succeededId = await insertReconciliationItem("succeeded");
    await pool.query(
      `INSERT INTO sally_escalation_reconciliation_audit
         (queue_item_id, action, previous_status, resulting_status, actor)
       VALUES
         ($1, 'confirm_delivery', 'unconfirmed', 'confirmed', 'iroc:alice'),
         ($2, 'resend_succeeded', 'resending', 'succeeded', 'iroc:bob')`,
      [confirmedId, succeededId],
    );

    const confirmedResponse = await request(app)
      .get("/api/admin/sally/email-queue?status=all&reconciliationOutcome=confirmed")
      .set("Authorization", ADMIN_AUTH);
    expect(confirmedResponse.status).toBe(200);
    expect(confirmedResponse.body.map((item: { id: number }) => item.id))
      .toEqual([confirmedId]);

    const actorResponse = await request(app)
      .get("/api/admin/sally/email-queue?status=all&reconciliationActor=ALICE")
      .set("Authorization", ADMIN_AUTH);
    expect(actorResponse.status).toBe(200);
    expect(actorResponse.body.map((item: { id: number }) => item.id))
      .toEqual([confirmedId]);

    const unresolvedResponse = await request(app)
      .get("/api/admin/sally/email-queue?status=all&reconciliationOutcome=unresolved")
      .set("Authorization", ADMIN_AUTH);
    expect(unresolvedResponse.status).toBe(200);
    expect(unresolvedResponse.body.map((item: { id: number }) => item.id))
      .toEqual([unresolvedId]);

    const handledResponse = await request(app)
      .get("/api/admin/sally/email-queue?status=all&reconciliationOutcome=handled")
      .set("Authorization", ADMIN_AUTH);
    expect(handledResponse.status).toBe(200);
    expect(handledResponse.body.map((item: { id: number }) => item.id))
      .toEqual(expect.arrayContaining([confirmedId, succeededId]));
    expect(handledResponse.body).toHaveLength(2);

    const { rows } = await pool.query<{ escalation_forward_status: string }>(
      `SELECT escalation_forward_status
         FROM sally_email_queue
        WHERE id = $1`,
      [unresolvedId],
    );
    expect(rows).toEqual([{ escalation_forward_status: "unconfirmed" }]);
  });
});

describe("GET /api/admin/sally/email-queue/:id/reconciliation-history", () => {
  it("returns the immutable reconciliation history in chronological order", async () => {
    const queueItemId = await insertQueueItem("sent");
    await pool.query(
      `INSERT INTO sally_escalation_reconciliation_audit
         (queue_item_id, action, previous_status, resulting_status, actor,
          acknowledged_duplicate_risk, created_at)
       VALUES
         ($1, 'resend_requested', 'unconfirmed', 'resending', 'iroc:alice', true, NOW() - INTERVAL '1 minute'),
         ($1, 'resend_succeeded', 'resending', 'succeeded', 'iroc:alice', true, NOW())`,
      [queueItemId],
    );

    const response = await request(app)
      .get(`/api/admin/sally/email-queue/${queueItemId}/reconciliation-history`)
      .set("Authorization", ADMIN_AUTH);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body).toEqual([
      expect.objectContaining({
        queue_item_id: queueItemId,
        action: "resend_requested",
        previous_status: "unconfirmed",
        resulting_status: "resending",
        actor: "iroc:alice",
        acknowledged_duplicate_risk: true,
      }),
      expect.objectContaining({
        queue_item_id: queueItemId,
        action: "resend_succeeded",
        previous_status: "resending",
        resulting_status: "succeeded",
        actor: "iroc:alice",
        acknowledged_duplicate_risk: true,
      }),
    ]);
    expect(new Date(response.body[0].created_at).getTime())
      .toBeLessThan(new Date(response.body[1].created_at).getTime());
  });

  it("does not change reconciliation state while reading history", async () => {
    const queueItemId = await insertQueueItem("sent");
    await pool.query(
      `INSERT INTO sally_escalation_reconciliation_audit
         (queue_item_id, action, previous_status, resulting_status, actor)
       VALUES ($1, 'confirm_delivery', 'unconfirmed', 'confirmed', 'iroc:alice')`,
      [queueItemId],
    );

    const response = await request(app)
      .get(`/api/admin/sally/email-queue/${queueItemId}/reconciliation-history`)
      .set("Authorization", ADMIN_AUTH);

    expect(response.status).toBe(200);
    const { rows } = await pool.query<{ escalation_forward_status: string | null }>(
      "SELECT escalation_forward_status FROM sally_email_queue WHERE id = $1",
      [queueItemId],
    );
    expect(rows[0].escalation_forward_status).toBeNull();
  });
});

describe("GET /api/admin/sally/email-queue/:id/reconciliation-history/export", () => {
  it("exports bilingual audit fields without changing reconciliation state", async () => {
    const queueItemId = await insertQueueItem("sent");
    await pool.query(
      `INSERT INTO sally_escalation_reconciliation_audit
         (queue_item_id, action, previous_status, resulting_status, actor,
          acknowledged_duplicate_risk, created_at)
       VALUES
         ($1, 'resend_requested', 'unconfirmed', 'resending', 'iroc:alice', true,
                 TIMESTAMP '2026-08-30 12:00:00'),
         ($1, 'resend_succeeded', 'resending', 'succeeded', 'iroc:alice', true,
                 TIMESTAMP '2026-08-30 12:01:00')`,
      [queueItemId],
    );

    const response = await request(app)
      .get(`/api/admin/sally/email-queue/${queueItemId}/reconciliation-history/export`)
      .set("Authorization", ADMIN_AUTH);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/csv; charset=utf-8/);
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="sally-reconciliation-${queueItemId}.csv"`,
    );
    expect(response.text).toContain("Lieferkontext / Delivery context");
    expect(response.text).toContain("Queue-ID / Queue item ID");
    expect(response.text).toContain(`"${queueItemId}"`);
    expect(response.text).toContain("Empfänger / Recipient");
    expect(response.text).toContain(`"${TEST_EMAIL}"`);
    expect(response.text).toContain("Betreff / Subject");
    expect(response.text).toContain('"Original subject"');
    expect(response.text).toContain("Auslöser / Trigger source");
    expect(response.text).toContain("Antwort-Entwurf / Reply Draft");
    expect(response.text).toContain("Finaler Queue-Status / Final queue status");
    expect(response.text).toContain("Gesendet / Sent");
    expect(response.text).toContain("Finaler Eskalationsstatus / Final escalation status");
    expect(response.text).toContain("Aktion (DE) / Action (EN)");
    expect(response.text).toContain("Erneuter Versand angefordert / Resend requested");
    expect(response.text).toContain("Unbestätigt / Unconfirmed");
    expect(response.text).toContain("Erneuter Versand läuft / Resending");
    expect(response.text).toContain("Ja / Yes");
    expect(response.text).toContain("iroc:alice");

    const { rows } = await pool.query<{ escalation_forward_status: string | null }>(
      "SELECT escalation_forward_status FROM sally_email_queue WHERE id = $1",
      [queueItemId],
    );
    expect(rows[0].escalation_forward_status).toBeNull();
  });

  it("exports delivery context even when the selected item has no audit rows", async () => {
    const queueItemId = await insertQueueItem("sent");

    const response = await request(app)
      .get(`/api/admin/sally/email-queue/${queueItemId}/reconciliation-history/export`)
      .set("Authorization", ADMIN_AUTH);

    expect(response.status).toBe(200);
    expect(response.text).toContain(`"${queueItemId}"`);
    expect(response.text).toContain(`"${TEST_EMAIL}"`);
    expect(response.text).toContain('"Original subject"');
    expect(response.text).toContain("Antwort-Entwurf / Reply Draft");
    expect(response.text).toContain("ID");
  });

  it("keeps commas, quotes, line breaks, and formula-like audit values parseable and inert", async () => {
    const subject = 'Subject, "quoted"\r\nnext line';
    const queueItemId = await insertQueueItem("sent", subject);
    const actors = [
      "compliance,reviewer",
      'compliance "reviewer"',
      "compliance\r\nreviewer",
      '=HYPERLINK("https://example.com","Open")',
      "+SUM(1,1)",
      "-2+3",
      "@cmd",
    ];

    for (const actor of actors) {
      await pool.query(
        `INSERT INTO sally_escalation_reconciliation_audit
           (queue_item_id, action, previous_status, resulting_status, actor)
         VALUES ($1, 'resend_requested', 'unconfirmed', 'resending', $2)`,
        [queueItemId, actor],
      );
    }

    const response = await request(app)
      .get(`/api/admin/sally/email-queue/${queueItemId}/reconciliation-history/export`)
      .set("Authorization", ADMIN_AUTH);

    expect(response.status).toBe(200);
    const rows = parseCsvRows(response.text);
    const headerIndex = rows.findIndex((row) => row[0] === "ID");
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    expect(rows[3]).toEqual(["Betreff / Subject", subject]);

    const exportedActors = rows
      .slice(headerIndex + 1)
      .map((row) => row[2]);
    expect(exportedActors).toEqual(
      actors.map((actor) => /^[=+\-@]/.test(actor) ? `'${actor}` : actor),
    );
    expect(exportedActors.slice(3).every((actor) => actor.startsWith("'"))).toBe(true);
    expect(exportedActors.slice(3).map((actor) => actor.slice(1))).toEqual(actors.slice(3));
  });

  it("requires admin authorization", async () => {
    const response = await request(app)
      .get("/api/admin/sally/email-queue/999999/reconciliation-history/export");

    expect(response.status).toBe(401);
  });
});

describe("POST /api/admin/sally/email-queue/reconciliation-history/export", () => {
  it("exports several authorized delivery contexts with explicit resource bounds", async () => {
    const firstId = await insertReconciliationItem("confirmed", "sent");
    const secondId = await insertReconciliationItem("succeeded", "sent");

    const response = await request(app)
      .post("/api/admin/sally/email-queue/reconciliation-history/export")
      .set("Authorization", ADMIN_AUTH)
      .send({ ids: [firstId, secondId] });

    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toContain("sally-reconciliation-export.csv");
    expect(response.text).toContain(`"${firstId}"`);
    expect(response.text).toContain(`"${secondId}"`);
    expect(response.text).toContain("Bestätigt / Confirmed");
    expect(response.text).toContain("Erfolgreich / Succeeded");
  });

  it("rejects unauthenticated, malformed, and oversized selections", async () => {
    expect((await request(app)
      .post("/api/admin/sally/email-queue/reconciliation-history/export")
      .send({ ids: [1] })).status).toBe(401);

    expect((await request(app)
      .post("/api/admin/sally/email-queue/reconciliation-history/export")
      .set("Authorization", ADMIN_AUTH)
      .send({ ids: ["bad"] })).status).toBe(400);

    expect((await request(app)
      .post("/api/admin/sally/email-queue/reconciliation-history/export")
      .set("Authorization", ADMIN_AUTH)
      .send({ ids: Array.from({ length: 51 }, (_, index) => index + 1) })).status).toBe(400);
  });
});

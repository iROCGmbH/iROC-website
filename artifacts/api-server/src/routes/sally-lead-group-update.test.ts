/**
 * Integration test: updating a lead's productInterestGroup via PUT persists the
 * new group and the next cron-queued follow-up emails use the updated brand label.
 *
 * What & Why
 * ──────────
 * When a lead is imported with an empty specialty (e.g. the iroc_leads row had
 * no specialty field filled in), product_interest_group is set to "" and any
 * outgoing emails carry a generic "iROC Produkte" label. Once an admin corrects
 * the group via PUT /admin/sally/leads/:id, all subsequent queue inserts by the
 * Sally cron must use the new value — otherwise follow-up emails continue to go
 * out with the wrong brand context.
 *
 * Test steps:
 *  1. Seed a sally_lead with product_interest_group = "" whose first_contact_date
 *     is 30 days in the past (making it eligible for both the 4-week follow-up
 *     cron and the 2-month reminder).
 *  2. PUT /admin/sally/leads/:id  { productInterestGroup: "spirecut" }
 *  3. Assert the DB row now holds product_interest_group = "spirecut".
 *  4. Run runSallyCronNow() — the same entry point the scheduler calls — and
 *     confirm the newly queued "4_week_followup" email subject contains "Spirecut"
 *     (not the generic "iROC Produkte" that the old empty group would produce).
 *  5. Confirm the "2_month_reminder" email also queued by the same cron run
 *     uses the corrected brand label ("Spirecut"), not the old generic one.
 *
 * sendEmail is mocked so no SMTP traffic occurs.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";

// Mock sendEmail before app is imported so no real SMTP traffic occurs
vi.mock("../lib/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "mock-id" }),
}));

import app from "../app.js";
import { runSallyCronNow } from "../lib/sally-cron.js";

const ADMIN_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? "iroc-admin-2024"}`;
const TEST_EMAIL = "sally-group-update-test@example.com";

let leadId: number;

async function cleanup() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [TEST_EMAIL]);
  await pool.query("DELETE FROM sally_leads WHERE email = $1", [TEST_EMAIL]);
}

beforeAll(async () => {
  await cleanup();

  // Seed a lead with:
  //  - product_interest_group = "" (imported with unknown specialty)
  //  - first_contact_date 30 days ago so the cron considers it eligible for a
  //    4-week follow-up (threshold is >= 28 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sally_leads
       (name, email, product_interest_group, first_contact_date,
        is_cancelled, training_registered)
     VALUES ('Test Lead', $1, '', $2, false, false)
     RETURNING id`,
    [TEST_EMAIL, thirtyDaysAgo],
  );
  leadId = rows[0].id;
});

afterAll(cleanup);

describe("PUT /admin/sally/leads/:id — brand group update persists and routes next cron email", () => {
  it("persists the new productInterestGroup in sally_leads", async () => {
    const res = await request(app)
      .put(`/api/admin/sally/leads/${leadId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ productInterestGroup: "spirecut" });

    expect(res.status).toBe(200);
    expect(res.body.product_interest_group).toBe("spirecut");

    // Confirm the DB row reflects the update
    const { rows } = await pool.query<{ product_interest_group: string }>(
      "SELECT product_interest_group FROM sally_leads WHERE id = $1",
      [leadId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].product_interest_group).toBe("spirecut");
  });

  it("cron-queued 4-week follow-up email uses the updated brand label, not the old generic one", async () => {
    // Run the same cron entry point the scheduler calls every hour.
    // The leads job will see our lead (30 days old, no prior 4_week_followup entry)
    // and queue a follow-up using whatever product_interest_group is now in the DB.
    await runSallyCronNow();

    const { rows: queued } = await pool.query<{ subject: string; trigger_type: string }>(
      `SELECT subject, trigger_type FROM sally_email_queue
       WHERE recipient_email = $1 AND trigger_type = '4_week_followup'
       ORDER BY id DESC LIMIT 1`,
      [TEST_EMAIL],
    );

    expect(queued).toHaveLength(1);
    // After the PUT the group is "spirecut" — the subject must reference Spirecut,
    // not the fallback "iROC Produkte" that an empty group would produce.
    expect(queued[0].subject).toContain("Spirecut");
    expect(queued[0].subject).not.toContain("iROC Produkte");
  });

  it("cron-queued 2-month reminder email also uses the corrected brand label, not the old generic one", async () => {
    // The same runSallyCronNow() call in the previous test also triggers the
    // 2_month_reminder path: the lead is 30 days old (>= 28), has never had a
    // 2_month_reminder queued (daysSinceLast = Infinity >= 60), so the cron
    // inserts one using product_interest_group read directly from the DB row.
    // After the PUT that value is "spirecut", so the subject must reference
    // "Spirecut" — not the generic "iROC Produkte" the empty group produces.
    const { rows: queued } = await pool.query<{ subject: string; trigger_type: string }>(
      `SELECT subject, trigger_type FROM sally_email_queue
       WHERE recipient_email = $1 AND trigger_type = '2_month_reminder'
       ORDER BY id DESC LIMIT 1`,
      [TEST_EMAIL],
    );

    expect(queued).toHaveLength(1);
    expect(queued[0].subject).toContain("Spirecut");
    expect(queued[0].subject).not.toContain("iROC Produkte");
  });
});

/**
 * Confirm that cancelling a lead via PUT stops the cron from queuing any
 * further follow-up emails for that lead.
 *
 * What & Why
 * ──────────
 * runLeadsJob queries: WHERE is_cancelled = false AND training_registered = false
 * So a cancelled lead must be excluded from the next cron run. If the filter
 * ever broke, a cancelled lead could keep receiving follow-up emails.
 *
 * Test steps:
 *  1. Seed a lead with first_contact_date 30 days ago (cron-eligible).
 *  2. PUT /admin/sally/leads/:id { isCancelled: true } — cancel the lead.
 *  3. Run runSallyCronNow().
 *  4. Assert no new queue entries exist for that lead.
 */
const CANCEL_TEST_EMAIL = "sally-cancel-lead-test@example.com";
let cancelLeadId: number;

async function cleanupCancelLead() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [CANCEL_TEST_EMAIL]);
  await pool.query("DELETE FROM sally_leads WHERE email = $1", [CANCEL_TEST_EMAIL]);
}

describe("PUT /admin/sally/leads/:id with isCancelled:true — cron skips the lead on next run", () => {
  beforeAll(async () => {
    await cleanupCancelLead();

    // Seed a lead that is 30 days old — eligible for the 4_week_followup and
    // 2_month_reminder cron paths (threshold is >= 28 days for both).
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO sally_leads
         (name, email, product_interest_group, first_contact_date,
          is_cancelled, training_registered)
       VALUES ('Cancel Test Lead', $1, 'spirecut', $2, false, false)
       RETURNING id`,
      [CANCEL_TEST_EMAIL, thirtyDaysAgo],
    );
    cancelLeadId = rows[0].id;
  });

  afterAll(cleanupCancelLead);

  it("marks the lead as cancelled via PUT", async () => {
    const res = await request(app)
      .put(`/api/admin/sally/leads/${cancelLeadId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ isCancelled: true });

    expect(res.status).toBe(200);
    expect(res.body.is_cancelled).toBe(true);

    // Confirm the DB row reflects the cancellation
    const { rows } = await pool.query<{ is_cancelled: boolean }>(
      "SELECT is_cancelled FROM sally_leads WHERE id = $1",
      [cancelLeadId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_cancelled).toBe(true);
  });

  it("cron run does not queue any follow-up emails for the cancelled lead", async () => {
    // runSallyCronNow() uses WHERE is_cancelled = false in runLeadsJob, so the
    // cancelled lead must be invisible to the cron and produce no queue inserts.
    await runSallyCronNow();

    const { rows: queued } = await pool.query<{ id: number; trigger_type: string }>(
      `SELECT id, trigger_type FROM sally_email_queue
       WHERE recipient_email = $1`,
      [CANCEL_TEST_EMAIL],
    );

    // No emails — pending or otherwise — should have been created for this lead.
    expect(queued).toHaveLength(0);
  });
});

/**
 * Confirm that cancelling a certified doctor via PUT stops the cron from
 * queuing doctor_checkin and doctor_promo emails for that doctor.
 *
 * What & Why
 * ──────────
 * runDoctorsJob queries: WHERE is_cancelled = false AND deleted_at IS NULL
 * runPromoJob   queries: WHERE is_cancelled = false AND deleted_at IS NULL
 * So a cancelled doctor must be excluded from both jobs. If the filter ever
 * broke, a cancelled doctor could keep receiving check-in or promo emails.
 *
 * Test steps:
 *  1. Seed a sally_certified_doctors row with:
 *       - last_purchase_date 70 days ago (> 60-day threshold for doctor_checkin)
 *       - avg_items_per_order = 2 (< 5 threshold for doctor_promo)
 *       - is_cancelled = false
 *  2. Reset the sally_cron_promo_last_run setting so the promo job will run.
 *  3. PUT /admin/sally/doctors/:id { isCancelled: true } — cancel the doctor.
 *  4. Run runSallyCronNow().
 *  5. Assert no doctor_checkin or doctor_promo entries exist for that doctor.
 */
const CANCEL_DOCTOR_EMAIL = "sally-cancel-doctor-test@example.com";
let cancelDoctorId: number;

async function cleanupCancelDoctor() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [CANCEL_DOCTOR_EMAIL]);
  await pool.query("DELETE FROM sally_certified_doctors WHERE email = $1", [CANCEL_DOCTOR_EMAIL]);
  // Restore promo last-run to prevent test pollution for other suites
  await pool.query("DELETE FROM settings WHERE key = 'sally_cron_promo_last_run'");
}

describe("PUT /admin/sally/doctors/:id with isCancelled:true — cron skips the doctor on next run", () => {
  beforeAll(async () => {
    await cleanupCancelDoctor();

    // Seed a doctor that is 70 days since last purchase — eligible for
    // doctor_checkin (threshold: >= 60 days) and doctor_promo (avg < 5).
    const seventyDaysAgo = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO sally_certified_doctors
         (name, email, last_purchase_date, avg_items_per_order, is_cancelled)
       VALUES ('Cancel Doctor Test', $1, $2, 2, false)
       RETURNING id`,
      [CANCEL_DOCTOR_EMAIL, seventyDaysAgo],
    );
    cancelDoctorId = rows[0].id;

    // Clear the promo last-run so runPromoJob will not skip due to the 180-day gate.
    await pool.query("DELETE FROM settings WHERE key = 'sally_cron_promo_last_run'");
  });

  afterAll(cleanupCancelDoctor);

  it("marks the doctor as cancelled via PUT", async () => {
    const res = await request(app)
      .put(`/api/admin/sally/doctors/${cancelDoctorId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ isCancelled: true });

    expect(res.status).toBe(200);
    expect(res.body.is_cancelled).toBe(true);

    // Confirm the DB row reflects the cancellation
    const { rows } = await pool.query<{ is_cancelled: boolean }>(
      "SELECT is_cancelled FROM sally_certified_doctors WHERE id = $1",
      [cancelDoctorId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_cancelled).toBe(true);
  });

  it("cron run does not queue any check-in or promo emails for the cancelled doctor", async () => {
    // runDoctorsJob and runPromoJob both filter WHERE is_cancelled = false, so
    // the cancelled doctor must be invisible to both jobs and produce no queue
    // inserts — neither doctor_checkin nor doctor_promo.
    await runSallyCronNow();

    const { rows: queued } = await pool.query<{ id: number; trigger_type: string }>(
      `SELECT id, trigger_type FROM sally_email_queue
       WHERE recipient_email = $1`,
      [CANCEL_DOCTOR_EMAIL],
    );

    // No emails — pending or otherwise — should have been created for this doctor.
    expect(queued).toHaveLength(0);
  });
});

/**
 * Confirm that cancelling a doctor via PUT also cancels any already-pending
 * emails in sally_email_queue for that doctor.
 *
 * What & Why
 * ──────────
 * The cron filter (WHERE is_cancelled = false) prevents *new* emails from being
 * queued for a cancelled doctor. But if a doctor_checkin or doctor_promo email
 * was already sitting in the queue as 'pending' when the doctor gets cancelled,
 * nothing in the old flow cancelled those entries. An admin who cancels a doctor
 * may not realise a pending email is still waiting to be approved and sent.
 *
 * PUT /admin/sally/doctors/:id { isCancelled: true } must now also flip any
 * 'pending' queue rows for that doctor to 'cancelled'.
 *
 * Test steps:
 *  1. Seed a sally_certified_doctors row.
 *  2. Directly insert a 'pending' doctor_checkin entry into sally_email_queue
 *     linked to that doctor via related_doctor_id.
 *  3. PUT /admin/sally/doctors/:id { isCancelled: true }.
 *  4. Assert the queue entry's status is now 'cancelled'.
 */
const PENDING_EMAIL_DOCTOR_EMAIL = "sally-cancel-doctor-pending-test@example.com";
let pendingEmailDoctorId: number;
let pendingQueueEntryId: number;

async function cleanupPendingEmailDoctor() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [PENDING_EMAIL_DOCTOR_EMAIL]);
  await pool.query("DELETE FROM sally_certified_doctors WHERE email = $1", [PENDING_EMAIL_DOCTOR_EMAIL]);
}

describe("PUT /admin/sally/doctors/:id with isCancelled:true — cancels already-pending queue entries", () => {
  beforeAll(async () => {
    await cleanupPendingEmailDoctor();

    // Seed a doctor
    const { rows: doctorRows } = await pool.query<{ id: number }>(
      `INSERT INTO sally_certified_doctors
         (name, email, last_purchase_date, avg_items_per_order, is_cancelled)
       VALUES ('Pending Email Doctor', $1, NOW() - INTERVAL '70 days', 2, false)
       RETURNING id`,
      [PENDING_EMAIL_DOCTOR_EMAIL],
    );
    pendingEmailDoctorId = doctorRows[0].id;

    // Seed a 'pending' doctor_checkin email directly in the queue so it is
    // already waiting for admin approval before the doctor gets cancelled.
    const { rows: queueRows } = await pool.query<{ id: number }>(
      `INSERT INTO sally_email_queue
         (recipient_email, subject, body, trigger_type, status, related_doctor_id)
       VALUES ($1, 'Check-in subject', 'Check-in body', 'doctor_checkin', 'pending', $2)
       RETURNING id`,
      [PENDING_EMAIL_DOCTOR_EMAIL, pendingEmailDoctorId],
    );
    pendingQueueEntryId = queueRows[0].id;
  });

  afterAll(cleanupPendingEmailDoctor);

  it("pending queue entry exists before cancellation", async () => {
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM sally_email_queue WHERE id = $1",
      [pendingQueueEntryId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
  });

  it("cancelling the doctor also cancels the already-pending queue entry", async () => {
    const res = await request(app)
      .put(`/api/admin/sally/doctors/${pendingEmailDoctorId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ isCancelled: true });

    expect(res.status).toBe(200);
    expect(res.body.is_cancelled).toBe(true);

    // The previously-pending queue entry must now be 'cancelled', not 'pending'.
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM sally_email_queue WHERE id = $1",
      [pendingQueueEntryId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("cancelled");
  });
});

/**
 * Confirm that soft-deleting a doctor via DELETE /admin/sally/doctors/:id
 * prevents the cron from queuing new doctor_checkin or doctor_promo emails
 * for that doctor.
 *
 * What & Why
 * ──────────
 * runDoctorsJob queries: WHERE is_cancelled = false AND deleted_at IS NULL
 * runPromoJob   queries: WHERE is_cancelled = false AND deleted_at IS NULL
 * The DELETE endpoint sets deleted_at = NOW() (soft-delete). So a deleted
 * doctor must be invisible to both jobs. If the filter ever broke, deleted
 * doctors would continue receiving check-in or promo emails.
 *
 * Test steps:
 *  1. Seed a sally_certified_doctors row with:
 *       - last_purchase_date 70 days ago (> 60-day threshold for doctor_checkin)
 *       - avg_items_per_order = 2 (< 5 threshold for doctor_promo)
 *       - is_cancelled = false, deleted_at = NULL
 *  2. Reset the sally_cron_promo_last_run setting so the promo job will run.
 *  3. DELETE /admin/sally/doctors/:id — soft-delete the doctor.
 *  4. Run runSallyCronNow().
 *  5. Assert no doctor_checkin or doctor_promo entries exist for that doctor.
 */
const DELETED_DOCTOR_EMAIL = "sally-deleted-doctor-test@example.com";
let deletedDoctorId: number;

async function cleanupDeletedDoctor() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [DELETED_DOCTOR_EMAIL]);
  await pool.query("DELETE FROM sally_certified_doctors WHERE email = $1", [DELETED_DOCTOR_EMAIL]);
  // Restore promo last-run to prevent test pollution for other suites
  await pool.query("DELETE FROM settings WHERE key = 'sally_cron_promo_last_run'");
}

describe("DELETE /admin/sally/doctors/:id — cron skips the soft-deleted doctor on next run", () => {
  beforeAll(async () => {
    await cleanupDeletedDoctor();

    // Seed a doctor that is 70 days since last purchase — eligible for
    // doctor_checkin (threshold: >= 60 days) and doctor_promo (avg < 5).
    const seventyDaysAgo = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO sally_certified_doctors
         (name, email, last_purchase_date, avg_items_per_order, is_cancelled)
       VALUES ('Deleted Doctor Test', $1, $2, 2, false)
       RETURNING id`,
      [DELETED_DOCTOR_EMAIL, seventyDaysAgo],
    );
    deletedDoctorId = rows[0].id;

    // Clear the promo last-run so runPromoJob will not skip due to the 180-day gate.
    await pool.query("DELETE FROM settings WHERE key = 'sally_cron_promo_last_run'");
  });

  afterAll(cleanupDeletedDoctor);

  it("soft-deletes the doctor via DELETE and sets deleted_at", async () => {
    const res = await request(app)
      .delete(`/api/admin/sally/doctors/${deletedDoctorId}`)
      .set("Authorization", ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Confirm the DB row has deleted_at set
    const { rows } = await pool.query<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM sally_certified_doctors WHERE id = $1",
      [deletedDoctorId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it("cron run does not queue any check-in or promo emails for the deleted doctor", async () => {
    // runDoctorsJob and runPromoJob both filter WHERE deleted_at IS NULL, so the
    // soft-deleted doctor must be invisible to both jobs and produce no queue
    // inserts — neither doctor_checkin nor doctor_promo.
    await runSallyCronNow();

    const { rows: queued } = await pool.query<{ id: number; trigger_type: string }>(
      `SELECT id, trigger_type FROM sally_email_queue
       WHERE recipient_email = $1`,
      [DELETED_DOCTOR_EMAIL],
    );

    // No emails — pending or otherwise — should have been created for this doctor.
    expect(queued).toHaveLength(0);
  });
});

/**
 * Confirm that soft-deleting a doctor via DELETE /admin/sally/doctors/:id
 * also cancels any already-pending emails in sally_email_queue for that doctor.
 *
 * What & Why
 * ──────────
 * The cron filter (WHERE deleted_at IS NULL) prevents *new* emails from being
 * queued for a deleted doctor. But if a doctor_checkin or doctor_promo email
 * was already sitting in the queue as 'pending' when the doctor gets deleted,
 * the old DELETE handler only set deleted_at and left those pending entries
 * untouched. An admin who deletes a doctor may not realise a pending email is
 * still waiting for approval.
 *
 * DELETE /admin/sally/doctors/:id must also flip any 'pending' queue rows for
 * that doctor to 'cancelled'.
 *
 * Test steps:
 *  1. Seed a sally_certified_doctors row.
 *  2. Directly insert a 'pending' doctor_checkin entry into sally_email_queue
 *     linked to that doctor via related_doctor_id.
 *  3. DELETE /admin/sally/doctors/:id — soft-delete the doctor.
 *  4. Assert the queue entry's status is now 'cancelled'.
 */
const DELETE_PENDING_DOCTOR_EMAIL = "sally-delete-doctor-pending-test@example.com";
let deletePendingDoctorId: number;
let deletePendingQueueEntryId: number;

async function cleanupDeletePendingDoctor() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [DELETE_PENDING_DOCTOR_EMAIL]);
  await pool.query("DELETE FROM sally_certified_doctors WHERE email = $1", [DELETE_PENDING_DOCTOR_EMAIL]);
}

describe("DELETE /admin/sally/doctors/:id — cancels already-pending queue entries", () => {
  beforeAll(async () => {
    await cleanupDeletePendingDoctor();

    // Seed a doctor
    const { rows: doctorRows } = await pool.query<{ id: number }>(
      `INSERT INTO sally_certified_doctors
         (name, email, last_purchase_date, avg_items_per_order, is_cancelled)
       VALUES ('Delete Pending Doctor', $1, NOW() - INTERVAL '70 days', 2, false)
       RETURNING id`,
      [DELETE_PENDING_DOCTOR_EMAIL],
    );
    deletePendingDoctorId = doctorRows[0].id;

    // Seed a 'pending' doctor_checkin email directly in the queue so it is
    // already waiting for admin approval before the doctor gets soft-deleted.
    const { rows: queueRows } = await pool.query<{ id: number }>(
      `INSERT INTO sally_email_queue
         (recipient_email, subject, body, trigger_type, status, related_doctor_id)
       VALUES ($1, 'Check-in subject', 'Check-in body', 'doctor_checkin', 'pending', $2)
       RETURNING id`,
      [DELETE_PENDING_DOCTOR_EMAIL, deletePendingDoctorId],
    );
    deletePendingQueueEntryId = queueRows[0].id;
  });

  afterAll(cleanupDeletePendingDoctor);

  it("pending queue entry exists before deletion", async () => {
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM sally_email_queue WHERE id = $1",
      [deletePendingQueueEntryId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
  });

  it("soft-deleting the doctor also cancels the already-pending queue entry", async () => {
    const res = await request(app)
      .delete(`/api/admin/sally/doctors/${deletePendingDoctorId}`)
      .set("Authorization", ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The previously-pending queue entry must now be 'cancelled', not 'pending'.
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM sally_email_queue WHERE id = $1",
      [deletePendingQueueEntryId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("cancelled");
  });
});

/**
 * Confirm that cancelling a lead via PUT also cancels any already-pending
 * emails in sally_email_queue for that lead.
 *
 * What & Why
 * ──────────
 * The cron filter (WHERE is_cancelled = false) prevents *new* emails from being
 * queued for a cancelled lead. But if a first_contact or follow-up email was
 * already sitting in the queue as 'pending' when the lead gets cancelled,
 * nothing in the old flow cancelled those entries. An admin who cancels a lead
 * may not realise a pending email is still waiting to be approved and sent.
 *
 * PUT /admin/sally/leads/:id { isCancelled: true } must now also flip any
 * 'pending' queue rows for that lead to 'cancelled'.
 *
 * Test steps:
 *  1. Seed a sally_leads row.
 *  2. Directly insert a 'pending' first_contact entry into sally_email_queue
 *     linked to that lead via related_lead_id.
 *  3. PUT /admin/sally/leads/:id { isCancelled: true }.
 *  4. Assert the queue entry's status is now 'cancelled'.
 */
const PENDING_EMAIL_LEAD_EMAIL = "sally-cancel-lead-pending-test@example.com";
let pendingEmailLeadId: number;
let pendingLeadQueueEntryId: number;

async function cleanupPendingEmailLead() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [PENDING_EMAIL_LEAD_EMAIL]);
  await pool.query("DELETE FROM sally_leads WHERE email = $1", [PENDING_EMAIL_LEAD_EMAIL]);
}

describe("PUT /admin/sally/leads/:id with isCancelled:true — cancels already-pending queue entries", () => {
  beforeAll(async () => {
    await cleanupPendingEmailLead();

    // Seed a lead
    const { rows: leadRows } = await pool.query<{ id: number }>(
      `INSERT INTO sally_leads
         (name, email, product_interest_group, first_contact_date,
          is_cancelled, training_registered)
       VALUES ('Pending Email Lead', $1, 'spirecut', CURRENT_DATE, false, false)
       RETURNING id`,
      [PENDING_EMAIL_LEAD_EMAIL],
    );
    pendingEmailLeadId = leadRows[0].id;

    // Seed a 'pending' first_contact email directly in the queue so it is
    // already waiting for admin approval before the lead gets cancelled.
    const { rows: queueRows } = await pool.query<{ id: number }>(
      `INSERT INTO sally_email_queue
         (recipient_email, subject, body, trigger_type, status, related_lead_id)
       VALUES ($1, 'First contact subject', 'First contact body', 'first_contact', 'pending', $2)
       RETURNING id`,
      [PENDING_EMAIL_LEAD_EMAIL, pendingEmailLeadId],
    );
    pendingLeadQueueEntryId = queueRows[0].id;
  });

  afterAll(cleanupPendingEmailLead);

  it("pending queue entry exists before cancellation", async () => {
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM sally_email_queue WHERE id = $1",
      [pendingLeadQueueEntryId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
  });

  it("cancelling the lead also cancels the already-pending queue entry", async () => {
    const res = await request(app)
      .put(`/api/admin/sally/leads/${pendingEmailLeadId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ isCancelled: true });

    expect(res.status).toBe(200);
    expect(res.body.is_cancelled).toBe(true);

    // The previously-pending queue entry must now be 'cancelled', not 'pending'.
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM sally_email_queue WHERE id = $1",
      [pendingLeadQueueEntryId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("cancelled");
  });
});

/**
 * Confirm that soft-deleting a lead via DELETE /admin/sally/leads/:id
 * prevents the cron from queuing new 4_week_followup or 2_month_reminder
 * emails for that lead.
 *
 * What & Why
 * ──────────
 * runLeadsJob queries: WHERE is_cancelled = false AND training_registered = false
 *                            AND deleted_at IS NULL
 * The DELETE endpoint sets deleted_at = NOW() (soft-delete). So a deleted
 * lead must be invisible to the leads job. If the filter ever broke, deleted
 * leads would continue receiving follow-up emails.
 *
 * Test steps:
 *  1. Seed a sally_leads row with:
 *       - first_contact_date 30 days ago (>= 28-day threshold for both
 *         4_week_followup and 2_month_reminder)
 *       - is_cancelled = false, training_registered = false, deleted_at = NULL
 *  2. DELETE /admin/sally/leads/:id — soft-delete the lead.
 *  3. Run runSallyCronNow().
 *  4. Assert no 4_week_followup or 2_month_reminder entries exist for that lead.
 */
const DELETED_LEAD_EMAIL = "sally-deleted-lead-test@example.com";
let deletedLeadId: number;

async function cleanupDeletedLead() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [DELETED_LEAD_EMAIL]);
  await pool.query("DELETE FROM sally_leads WHERE email = $1", [DELETED_LEAD_EMAIL]);
}

describe("DELETE /admin/sally/leads/:id — cron skips the soft-deleted lead on next run", () => {
  beforeAll(async () => {
    await cleanupDeletedLead();

    // Seed a lead that is 30 days since first contact — eligible for
    // 4_week_followup (threshold: >= 28 days) and 2_month_reminder.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO sally_leads
         (name, email, product_interest_group, first_contact_date,
          is_cancelled, training_registered)
       VALUES ('Deleted Lead Test', $1, 'spirecut', $2, false, false)
       RETURNING id`,
      [DELETED_LEAD_EMAIL, thirtyDaysAgo],
    );
    deletedLeadId = rows[0].id;
  });

  afterAll(cleanupDeletedLead);

  it("soft-deletes the lead via DELETE and sets deleted_at", async () => {
    const res = await request(app)
      .delete(`/api/admin/sally/leads/${deletedLeadId}`)
      .set("Authorization", ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Confirm the DB row has deleted_at set
    const { rows } = await pool.query<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM sally_leads WHERE id = $1",
      [deletedLeadId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it("cron run does not queue any follow-up emails for the deleted lead", async () => {
    // runLeadsJob filters WHERE deleted_at IS NULL, so the soft-deleted lead
    // must be invisible to the cron and produce no queue inserts —
    // neither 4_week_followup nor 2_month_reminder.
    await runSallyCronNow();

    const { rows: queued } = await pool.query<{ id: number; trigger_type: string }>(
      `SELECT id, trigger_type FROM sally_email_queue
       WHERE recipient_email = $1`,
      [DELETED_LEAD_EMAIL],
    );

    // No emails — pending or otherwise — should have been created for this lead.
    expect(queued).toHaveLength(0);
  });
});

/**
 * Confirm that soft-deleting a lead via DELETE /admin/sally/leads/:id
 * also cancels any already-pending emails in sally_email_queue for that lead.
 *
 * What & Why
 * ──────────
 * The cron filter (WHERE deleted_at IS NULL) prevents *new* emails from being
 * queued for a deleted lead. But if a first_contact or follow-up email was
 * already sitting in the queue as 'pending' when the lead gets deleted,
 * the old DELETE handler only set deleted_at and left those pending entries
 * untouched. An admin who deletes a lead may not realise a pending email is
 * still waiting for approval.
 *
 * DELETE /admin/sally/leads/:id must also flip any 'pending' queue rows for
 * that lead to 'cancelled'.
 *
 * Test steps:
 *  1. Seed a sally_leads row.
 *  2. Directly insert a 'pending' first_contact entry into sally_email_queue
 *     linked to that lead via related_lead_id.
 *  3. DELETE /admin/sally/leads/:id — soft-delete the lead.
 *  4. Assert the queue entry's status is now 'cancelled'.
 */
const DELETE_PENDING_LEAD_EMAIL = "sally-delete-lead-pending-test@example.com";
let deletePendingLeadId: number;
let deletePendingLeadQueueEntryId: number;

async function cleanupDeletePendingLead() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [DELETE_PENDING_LEAD_EMAIL]);
  await pool.query("DELETE FROM sally_leads WHERE email = $1", [DELETE_PENDING_LEAD_EMAIL]);
}

describe("DELETE /admin/sally/leads/:id — cancels already-pending queue entries", () => {
  beforeAll(async () => {
    await cleanupDeletePendingLead();

    // Seed a lead
    const { rows: leadRows } = await pool.query<{ id: number }>(
      `INSERT INTO sally_leads
         (name, email, product_interest_group, first_contact_date,
          is_cancelled, training_registered)
       VALUES ('Delete Pending Lead', $1, 'spirecut', CURRENT_DATE, false, false)
       RETURNING id`,
      [DELETE_PENDING_LEAD_EMAIL],
    );
    deletePendingLeadId = leadRows[0].id;

    // Seed a 'pending' first_contact email directly in the queue so it is
    // already waiting for admin approval before the lead gets soft-deleted.
    const { rows: queueRows } = await pool.query<{ id: number }>(
      `INSERT INTO sally_email_queue
         (recipient_email, subject, body, trigger_type, status, related_lead_id)
       VALUES ($1, 'First contact subject', 'First contact body', 'first_contact', 'pending', $2)
       RETURNING id`,
      [DELETE_PENDING_LEAD_EMAIL, deletePendingLeadId],
    );
    deletePendingLeadQueueEntryId = queueRows[0].id;
  });

  afterAll(cleanupDeletePendingLead);

  it("pending queue entry exists before deletion", async () => {
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM sally_email_queue WHERE id = $1",
      [deletePendingLeadQueueEntryId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
  });

  it("soft-deleting the lead also cancels the already-pending queue entry", async () => {
    const res = await request(app)
      .delete(`/api/admin/sally/leads/${deletePendingLeadId}`)
      .set("Authorization", ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The previously-pending queue entry must now be 'cancelled', not 'pending'.
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM sally_email_queue WHERE id = $1",
      [deletePendingLeadQueueEntryId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("cancelled");
  });
});

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";

vi.mock("../lib/email.js", () => ({
  getEmailDest: vi.fn().mockResolvedValue("training@example.test"),
  sendEmail: vi.fn().mockResolvedValue({ messageId: "training-confirmation-test" }),
}));

import app from "../app.js";

const ADMIN_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? "iroc-admin-2024"}`;
const TEST_EMAILS = [
  "training-confirm-create@example.test",
  "training-confirm-existing@example.test",
  "training-confirm-qualified@example.test",
  "training-confirm-empty@example.test",
  "training-confirm-email-link@example.test",
  "training-confirm-concurrent@example.test",
  "training-confirm-qualified-race@example.test",
  "training-update-url@example.test",
  "",
];

async function cleanup() {
  await pool.query("DELETE FROM training_registrations WHERE email = ANY($1::text[])", [TEST_EMAILS]);
  await pool.query("DELETE FROM iroc_leads WHERE email = ANY($1::text[])", [TEST_EMAILS]);
  await pool.query("DELETE FROM iroc_notifications WHERE message LIKE '%EmailLinkSync%'");
}

async function createRegistration(
  email: string,
  options: { status?: "pending" | "confirmed"; token?: string; city?: string } = {},
) {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO training_registrations
       (first_name, last_name, email, instrument, status, confirmation_token, medical_degree,
        specialty, institution_name, postal_code, city, country, phone, website_url, training_date_info, notes)
     VALUES
       ('Training', 'Confirmation', $1, 'spirecut', $2, $3, 'Dr. med.',
        'Orthopaedics', 'Test Clinic', '80331', $4, 'Germany', '+49 89 1234',
        'https://example.test', '2026-11-14 08:30 – Aschheim', 'Registration note')
     RETURNING id`,
    [email, options.status ?? "pending", options.token ?? null, options.city ?? "Munich"],
  );
  return rows[0].id;
}

beforeEach(cleanup);
afterAll(cleanup);

describe("training registration confirmation", () => {
  it("confirms an unconfirmed registration, creates one registered lead, and is safe to repeat", async () => {
    const registrationId = await createRegistration(TEST_EMAILS[0]);

    const first = await request(app)
      .post(`/api/admin/training-registrations/${registrationId}/confirm`)
      .set("Authorization", ADMIN_AUTH)
      .send({});

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      registrationId,
      status: "confirmed",
      leadCreated: true,
    });
    expect(first.body.confirmedAt).toEqual(expect.any(String));

    const { rows: registrationRows } = await pool.query(
      "SELECT status, confirmed_at FROM training_registrations WHERE id = $1",
      [registrationId],
    );
    expect(registrationRows[0]).toMatchObject({ status: "confirmed" });
    expect(registrationRows[0].confirmed_at).toBeTruthy();

    const { rows: leadsAfterFirst } = await pool.query(
      "SELECT status, medical_title, specialty, city, notes FROM iroc_leads WHERE email = $1",
      [TEST_EMAILS[0]],
    );
    expect(leadsAfterFirst).toHaveLength(1);
    expect(leadsAfterFirst[0]).toMatchObject({
      status: "registered",
      medical_title: "Dr. med.",
      specialty: "Orthopaedics",
      city: "Munich",
    });

    const repeated = await request(app)
      .post(`/api/admin/training-registrations/${registrationId}/confirm`)
      .set("Authorization", ADMIN_AUTH)
      .send({});

    expect(repeated.status).toBe(200);
    expect(repeated.body).toMatchObject({
      registrationId,
      status: "confirmed",
      leadCreated: false,
      leadId: first.body.leadId,
    });
    const { rows: leadsAfterRepeat } = await pool.query(
      "SELECT id FROM iroc_leads WHERE email = $1",
      [TEST_EMAILS[0]],
    );
    expect(leadsAfterRepeat).toHaveLength(1);
  });

  it("updates a matching lead only where registration data fills gaps", async () => {
    const registrationId = await createRegistration(TEST_EMAILS[1], { city: "Berlin" });
    const { rows: existingLead } = await pool.query<{ id: number }>(
      `INSERT INTO iroc_leads (first_name, last_name, email, specialty, city, status)
       VALUES ('Existing', 'Lead', $1, 'Existing specialty', NULL, 'contacted')
       RETURNING id`,
      [TEST_EMAILS[1]],
    );

    const response = await request(app)
      .post(`/api/admin/training-registrations/${registrationId}/confirm`)
      .set("Authorization", ADMIN_AUTH)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ leadId: existingLead[0].id, leadCreated: false });

    const { rows: leads } = await pool.query(
      "SELECT status, first_name, specialty, city, phone FROM iroc_leads WHERE id = $1",
      [existingLead[0].id],
    );
    expect(leads[0]).toMatchObject({
      status: "registered",
      first_name: "Existing",
      specialty: "Existing specialty",
      city: "Berlin",
      phone: "+49 89 1234",
    });
  });

  it("serializes simultaneous confirmation requests without creating duplicate leads", async () => {
    const registrationId = await createRegistration(TEST_EMAILS[5]);

    const responses = await Promise.all([
      request(app)
        .post(`/api/admin/training-registrations/${registrationId}/confirm`)
        .set("Authorization", ADMIN_AUTH)
        .send({}),
      request(app)
        .post(`/api/admin/training-registrations/${registrationId}/confirm`)
        .set("Authorization", ADMIN_AUTH)
        .send({}),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.filter((response) => response.body.leadCreated)).toHaveLength(1);
    const { rows: leads } = await pool.query(
      "SELECT id, status FROM iroc_leads WHERE email = $1",
      [TEST_EMAILS[5]],
    );
    expect(leads).toHaveLength(1);
    expect(leads[0].status).toBe("registered");
  });

  it("does not downgrade a matching qualified lead", async () => {
    const registrationId = await createRegistration(TEST_EMAILS[2]);
    await pool.query(
      `INSERT INTO iroc_leads (first_name, last_name, email, status)
       VALUES ('Qualified', 'Lead', $1, 'qualified')`,
      [TEST_EMAILS[2]],
    );

    const response = await request(app)
      .post(`/api/admin/training-registrations/${registrationId}/confirm`)
      .set("Authorization", ADMIN_AUTH)
      .send({});

    expect(response.status).toBe(200);
    const { rows: leads } = await pool.query(
      "SELECT status FROM iroc_leads WHERE email = $1",
      [TEST_EMAILS[2]],
    );
    expect(leads[0].status).toBe("qualified");
  });

  it("waits for a concurrent qualification and preserves its newer status", async () => {
    const email = TEST_EMAILS[6];
    const registrationId = await createRegistration(email);
    const { rows: seededLead } = await pool.query<{ id: number }>(
      `INSERT INTO iroc_leads (first_name, last_name, email, status)
       VALUES ('Registered', 'Lead', $1, 'registered')
       RETURNING id`,
      [email],
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Hold the lead row as a qualification operation would. The confirmation
      // must read after this commit rather than overwrite this newer state.
      await client.query("UPDATE iroc_leads SET status = 'qualified' WHERE id = $1", [seededLead[0].id]);
      let settled = false;
      const confirmation = request(app)
        .post(`/api/admin/training-registrations/${registrationId}/confirm`)
        .set("Authorization", ADMIN_AUTH)
        .send({})
        .then((response) => {
          settled = true;
          return response;
        });

      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(settled).toBe(false);
      await client.query("COMMIT");

      const response = await confirmation;
      expect(response.status).toBe(200);
      const { rows: leads } = await pool.query(
        "SELECT status FROM iroc_leads WHERE id = $1",
        [seededLead[0].id],
      );
      expect(leads[0].status).toBe("qualified");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("rejects dangerous website URLs but saves valid http and https URLs", async () => {
    const registrationId = await createRegistration("training-update-url@example.test");

    for (const websiteUrl of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      123,
      { href: "https://updated.example.test/profile" },
      ["https://updated.example.test/profile"],
    ]) {
      const response = await request(app)
        .patch(`/api/admin/training-registrations/${registrationId}`)
        .set("Authorization", ADMIN_AUTH)
        .send({ websiteUrl });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("websiteUrl must be a valid http or https URL");
    }

    for (const websiteUrl of ["", "http://updated.example.test/profile", "https://updated.example.test/profile"]) {
      const validUpdate = await request(app)
        .patch(`/api/admin/training-registrations/${registrationId}`)
        .set("Authorization", ADMIN_AUTH)
        .send({ websiteUrl });

      expect(validUpdate.status).toBe(200);
    }

    const { rows } = await pool.query(
      "SELECT website_url FROM training_registrations WHERE id = $1",
      [registrationId],
    );
    expect(rows[0].website_url).toBe("https://updated.example.test/profile");
  });

  it("rejects a registration with a blank email without confirming it", async () => {
    const registrationId = await createRegistration(TEST_EMAILS[3].replace("training-confirm-empty@example.test", ""));

    const response = await request(app)
      .post(`/api/admin/training-registrations/${registrationId}/confirm`)
      .set("Authorization", ADMIN_AUTH)
      .send({});

    expect(response.status).toBe(422);
    const { rows } = await pool.query(
      "SELECT status FROM training_registrations WHERE id = $1",
      [registrationId],
    );
    expect(rows[0].status).toBe("pending");
  });

  it("uses the same lead synchronization when a doctor confirms through the email link", async () => {
    const token = "training-confirm-email-link-token";
    await createRegistration(TEST_EMAILS[4], { token });

    const response = await request(app).get(`/api/training/confirm/${token}`);

    expect(response.status).toBe(200);
    expect(response.text).toContain("Registration confirmed");
    const { rows: leads } = await pool.query(
      "SELECT status FROM iroc_leads WHERE email = $1",
      [TEST_EMAILS[4]],
    );
    expect(leads).toHaveLength(1);
    expect(leads[0].status).toBe("registered");
  });
});
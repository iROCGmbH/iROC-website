import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import app from "../app";

const key = crypto.randomUUID().replace(/-/g, "");
const email = `concurrent-import-${key}@example.test`;
const failedImportEmail = `failed-import-${key}@example.test`;
const failureTriggerFunction = `fail_import_${key}`;
const failureTrigger = `fail_import_trigger_${key}`;
const secret = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function authorizationHeader() {
  const payload = Buffer.from(JSON.stringify({
    userId: 1,
    username: "admin",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `Bearer ${payload}.${signature}`;
}

async function cleanup() {
  await pool.query("DELETE FROM website_customers WHERE lower(email) = lower($1)", [email]);
  await pool.query("DELETE FROM training_registrations WHERE lower(email) = lower($1)", [email]);
  await pool.query("DELETE FROM website_customers WHERE lower(email) = lower($1)", [failedImportEmail]);
  await pool.query("DELETE FROM training_registrations WHERE lower(email) = lower($1)", [failedImportEmail]);
  await pool.query(`DROP TRIGGER IF EXISTS "${failureTrigger}" ON website_customers`);
  await pool.query(`DROP FUNCTION IF EXISTS "${failureTriggerFunction}"()`);
}

let registrationId: number;
let failedImportRegistrationId: number;

beforeAll(async () => {
  await cleanup();
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO training_registrations
       (first_name, last_name, email, instrument, status, medical_degree,
        institution_name, postal_code, city, country, privacy_consent)
     VALUES ('Concurrent', 'Import', $1, 'spirecut', 'confirmed', 'Dr. med.',
             'Concurrency Clinic', '80331', 'Munich', 'DE', true)
     RETURNING id`,
    [email],
  );
  registrationId = rows[0].id;
  const { rows: failedImportRows } = await pool.query<{ id: number }>(
    `INSERT INTO training_registrations
       (first_name, last_name, email, instrument, status, medical_degree,
        institution_name, postal_code, city, country, privacy_consent)
     VALUES ('Failed', 'Import', $1, 'spirecut', 'confirmed', 'Dr. med.',
             'Retry Clinic', '80331', 'Munich', 'DE', true)
     RETURNING id`,
    [failedImportEmail],
  );
  failedImportRegistrationId = failedImportRows[0].id;
});

afterAll(cleanup);

describe("registration customer import concurrency against PostgreSQL", () => {
  it("creates one customer and leaves the registration imported after simultaneous requests", async () => {
    const payload = {
      sourceRegistrationId: registrationId,
      email,
      firstName: "Concurrent",
      lastName: "Import",
      institutionName: "Concurrency Clinic",
      instrument: "spirecut",
      certifications: ["spirecut"],
    };

    const responses = await Promise.all([
      request(app).post("/api/iroc/website-customers").set("Authorization", authorizationHeader()).send(payload),
      request(app).post("/api/iroc/website-customers").set("Authorization", authorizationHeader()).send(payload),
    ]);

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    const conflict = responses.find((response) => response.status === 409);
    expect(conflict?.body.error).toMatch(/^customer_(import_in_progress|already_imported)$/);

    const customers = await pool.query<{ id: number }>(
      "SELECT id FROM website_customers WHERE lower(email) = lower($1)",
      [email],
    );
    expect(customers.rows).toHaveLength(1);

    const importedState = await pool.query<{ customer_id: number | null }>(
      `SELECT wc.id AS customer_id
       FROM training_registrations tr
       LEFT JOIN website_customers wc ON lower(tr.email) = lower(wc.email)
       WHERE tr.id = $1`,
      [registrationId],
    );
    expect(importedState.rows).toEqual([{ customer_id: customers.rows[0].id }]);
  });

  it("releases the registration lock after a failed customer creation so it can be retried", async () => {
    // This trigger makes the insert fail only after the route has acquired its
    // PostgreSQL transaction-scoped registration lock. Dropping it simulates a
    // corrected transient database failure for the administrator's retry.
    await pool.query(
      `CREATE FUNCTION "${failureTriggerFunction}"()
       RETURNS trigger
       LANGUAGE plpgsql
       AS $$
       BEGIN
         IF lower(NEW.email) = lower('${failedImportEmail}') THEN
           RAISE EXCEPTION 'forced customer import failure';
         END IF;
         RETURN NEW;
       END;
       $$`,
    );
    await pool.query(
      `CREATE TRIGGER "${failureTrigger}"
       BEFORE INSERT ON website_customers
       FOR EACH ROW EXECUTE FUNCTION "${failureTriggerFunction}"()`,
    );

    const payload = {
      sourceRegistrationId: failedImportRegistrationId,
      email: failedImportEmail,
      firstName: "Failed",
      lastName: "Import",
      institutionName: "Retry Clinic",
      instrument: "spirecut",
      certifications: ["spirecut"],
    };
    const failedResponse = await request(app)
      .post("/api/iroc/website-customers")
      .set("Authorization", authorizationHeader())
      .send(payload);
    expect(failedResponse.status).toBe(500);

    await pool.query(`DROP TRIGGER "${failureTrigger}" ON website_customers`);
    await pool.query(`DROP FUNCTION "${failureTriggerFunction}"()`);

    const retryResponse = await request(app)
      .post("/api/iroc/website-customers")
      .set("Authorization", authorizationHeader())
      .send(payload);
    expect(retryResponse.status).toBe(201);

    const customers = await pool.query<{ id: number }>(
      "SELECT id FROM website_customers WHERE lower(email) = lower($1)",
      [failedImportEmail],
    );
    expect(customers.rows).toHaveLength(1);

    const importedState = await pool.query<{ customer_id: number | null }>(
      `SELECT wc.id AS customer_id
       FROM training_registrations tr
       LEFT JOIN website_customers wc ON lower(tr.email) = lower(wc.email)
       WHERE tr.id = $1`,
      [failedImportRegistrationId],
    );
    expect(importedState.rows).toEqual([{ customer_id: customers.rows[0].id }]);
  });
});
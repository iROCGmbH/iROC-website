/**
 * Integration tests: Sally order-review finalization concurrency & reconciliation
 *
 * What & Why
 * ──────────
 * Order reviews can be triggered concurrently by the approval hook, the cron
 * tick, and the admin "re-run review" endpoint. finalizeReview() must:
 *   1. Discard a stale reviewer's result AND perform no email-queue mutation
 *      when its lease was taken over (e.g. by a manual re-run).
 *   2. On a winning "complete" verdict, atomically cancel any pending
 *      missing-info draft for the order.
 *   3. On a winning "missing_info" verdict, refresh the existing pending
 *      draft in place (new language/content) instead of inserting a duplicate.
 *
 * These tests run against the real dev database (tables created by the
 * idempotent Sally startup migrations).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  pool as bootstrapPool,
  provisionMigrationBackedTestSchema,
  withDatabaseUrlsScopedToSchema,
} from "@workspace/db";
import type { ReviewAnalysis } from "../lib/sally-order-review.js";

const EMAIL = "sally-concurrency-test@example.com";
const TEST_SCHEMA = `sally_order_review_${process.pid}_${Date.now()}`;
const sharedDatabaseUrl = process.env.DATABASE_URL_INTERNAL ?? process.env.DATABASE_URL;
if (!sharedDatabaseUrl) throw new Error("A database URL is required");

let pool: typeof bootstrapPool;
let finalizeReview: typeof import("../lib/sally-order-review.js").finalizeReview;
let buildImpressumSignature: typeof import("../lib/impressum-signature.js").buildImpressumSignature;
let orderId: number;

async function cleanup() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [EMAIL]);
  await pool.query("DELETE FROM iroc_orders WHERE contact_email = $1", [EMAIL]);
}

/** Claims the order like reviewOrder does, returning the lease timestamp as text. */
async function claim(): Promise<string> {
  const { rows } = await pool.query<{ claimed_at_text: string }>(
    `UPDATE iroc_orders
       SET sally_review_status = 'reviewing', sally_review_claimed_at = NOW()
     WHERE id = $1
     RETURNING sally_review_claimed_at::text AS claimed_at_text`,
    [orderId],
  );
  return rows[0].claimed_at_text;
}

async function getOrder() {
  const { rows } = await pool.query(
    "SELECT sally_review_status, sally_review_result, contact_language FROM iroc_orders WHERE id = $1",
    [orderId],
  );
  return rows[0];
}

async function getDrafts() {
  const { rows } = await pool.query(
    `SELECT id, status, subject, body, detected_language FROM sally_email_queue
     WHERE related_order_id = $1 AND trigger_type = 'order_missing_info' ORDER BY id`,
    [orderId],
  );
  return rows as { id: number; status: string; subject: string; body: string; detected_language: string }[];
}

const missingAnalysis = (subject: string): ReviewAnalysis => ({
  language: "de",
  complete: false,
  missing: ["Lieferadresse"],
  email_subject: subject,
  email_body: "Bitte senden Sie uns Ihre vollständige Lieferadresse.",
});

const completeAnalysis: ReviewAnalysis = {
  language: "de",
  complete: true,
  missing: [],
  email_subject: "",
  email_body: "",
};

beforeAll(async () => {
  await provisionMigrationBackedTestSchema(bootstrapPool, TEST_SCHEMA);
  await withDatabaseUrlsScopedToSchema(sharedDatabaseUrl, TEST_SCHEMA, async () => {
    vi.resetModules();
    pool = (await import("@workspace/db")).pool;
    finalizeReview = (await import("../lib/sally-order-review.js")).finalizeReview;
    buildImpressumSignature = (await import("../lib/impressum-signature.js")).buildImpressumSignature;
  });
  await cleanup();
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO iroc_orders
       (customer_type, contact_email, instrument, products, delivery_address, approval_token, status, approved_at)
     VALUES ('new', $1, 'Spirecut', 'unklar', '', 'sally-concurrency-test-token', 'approved', NOW())
     RETURNING id`,
    [EMAIL],
  );
  orderId = rows[0].id;
});

afterAll(async () => {
  await cleanup();
  await pool.end();
  await bootstrapPool.query(`DROP SCHEMA "${TEST_SCHEMA}" CASCADE`);
});

describe("finalizeReview — lease & reconciliation", () => {
  it("stale reviewer: result discarded, NO draft is created", async () => {
    const staleLease = await claim();
    // Another worker takes over the lease (e.g. manual re-run after expiry)
    await new Promise(r => setTimeout(r, 5)); // ensure NOW() differs
    const freshLease = await claim();
    expect(freshLease).not.toBe(staleLease);

    const result = await finalizeReview(orderId, EMAIL, staleLease, missingAnalysis("STALE"), "en");
    expect(result).toBeNull();

    const order = await getOrder();
    expect(order.sally_review_status).toBe("reviewing"); // untouched by the stale worker
    expect(await getDrafts()).toHaveLength(0);           // no queue mutation

    // The lease holder finalizes normally afterwards
    const winner = await finalizeReview(orderId, EMAIL, freshLease, missingAnalysis("Fehlende Angaben"), "de");
    expect(winner).toBe("missing_info");
    const drafts = await getDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe("pending");
    expect(drafts[0].subject).toBe("Fehlende Angaben");
    expect(drafts[0].body).toContain(await buildImpressumSignature("de"));
  });

  it("re-review while still missing info: pending draft refreshed in place, no duplicate", async () => {
    const draftsBefore = await getDrafts();
    expect(draftsBefore).toHaveLength(1);
    const lease = await claim();

    const result = await finalizeReview(orderId, EMAIL, lease, missingAnalysis("Missing details (EN)"), "en");
    expect(result).toBe("missing_info");

    const drafts = await getDrafts();
    expect(drafts).toHaveLength(1);                       // same row, no duplicate
    expect(drafts[0].id).toBe(draftsBefore[0].id);
    // The AI analysis is German but the authoritative required language passed
    // to finalization is English. The queue boundary must reject that conflict.
    expect(drafts[0].subject).toBe("Your iROC GmbH order – question");
    expect(drafts[0].detected_language).toBe("en");
    expect(drafts[0].status).toBe("pending");             // approval gate preserved
    expect(drafts[0].body).toContain(await buildImpressumSignature("en"));
  });

  it("fails closed when a French missing-info draft falsely declares English", async () => {
    const lease = await claim();
    const frenchButEnglish: ReviewAnalysis = {
      language: "en",
      complete: false,
      missing: ["adresse de livraison"],
      email_subject: "Informations manquantes",
      email_body: "Bonjour, merci de nous envoyer votre adresse de livraison.",
    };
    const result = await finalizeReview(orderId, EMAIL, lease, frenchButEnglish, "en");
    expect(result).toBe("missing_info");
    const drafts = await getDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].subject).toBe("Your iROC GmbH order – question");
  });

  it("complete after missing: pending draft is cancelled atomically", async () => {
    const lease = await claim();
    const result = await finalizeReview(orderId, EMAIL, lease, completeAnalysis, "de");
    expect(result).toBe("complete");

    const order = await getOrder();
    expect(order.sally_review_status).toBe("complete");
    const drafts = await getDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe("cancelled");
  });

  it("stale worker after a winning complete: cannot resurrect a missing-info draft", async () => {
    // Order is 'complete'; a worker holding an old lease tries to finalize missing_info
    const { rows } = await pool.query<{ t: string }>("SELECT (NOW() - INTERVAL '1 hour')::text AS t");
    const result = await finalizeReview(orderId, EMAIL, rows[0].t, missingAnalysis("ZOMBIE"), "de");
    expect(result).toBeNull();

    const order = await getOrder();
    expect(order.sally_review_status).toBe("complete");   // latest verdict stands
    const drafts = await getDrafts();
    expect(drafts.filter(d => d.status === "pending")).toHaveLength(0); // no pending draft
  });

  it.each(["subject", "body"])("does not queue a blank order-review %s", async (field) => {
    const lease = await claim();
    const analysis = missingAnalysis("Missing details");
    analysis[field === "subject" ? "email_subject" : "email_body"] = " \t";

    const result = await finalizeReview(orderId, EMAIL, lease, analysis, "de");

    expect(result).toBeNull();
    expect((await getDrafts()).filter(draft => draft.status === "pending")).toHaveLength(0);
  });
});

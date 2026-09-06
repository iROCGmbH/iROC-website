import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const sendEmail = vi.fn();
  const isSmtpConfigured = vi.fn();
  const getEmailDeliveryProvider = vi.fn();
  const queueItem = {
    id: 41,
    vendor_country: "Austria",
    email_to: "reviewed-supplier@example.test",
    email_subject: "Nachbestellung",
    email_body_markdown: "Bitte bestätigen Sie unsere Nachbestellung.",
    status: "pending",
    email_send_error: null as string | null,
    email_sent_at: null as string | null,
    email_message_id: null as string | null,
    send_attempt_id: null as string | null,
    failFinalization: false,
  };

  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (/SELECT id, vendor_country, email_to/i.test(sql)) {
        return { rows: queueItem.status === "pending" ? [{ ...queueItem }] : [] };
      }
      if (/UPDATE tori_reorder_queue/i.test(sql) && /status='approved'/i.test(sql)) {
        queueItem.status = "approved";
        queueItem.email_send_error = null;
        queueItem.email_sent_at = new Date().toISOString();
        queueItem.email_message_id = String(values?.[1] ?? "");
        return { rows: [{ ...queueItem }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };

  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (/SELECT email_to, email_subject/i.test(sql)) {
        return { rows: queueItem.status === "pending" ? [{ ...queueItem }] : [] };
      }
      if (/SET status='sending'/i.test(sql)) {
        if (queueItem.status !== "pending") return { rows: [] };
        queueItem.status = "sending";
        queueItem.send_attempt_id = String(values?.[1]);
        return { rows: [{ ...queueItem }] };
      }
      if (/SET status='approved'/i.test(sql)) {
        if (queueItem.failFinalization) {
          throw new Error("simulated final transaction failure");
        }
        queueItem.status = "approved";
        queueItem.email_send_error = null;
        queueItem.email_sent_at = new Date().toISOString();
        queueItem.email_message_id = String(values?.[1] ?? "");
        return { rows: [{ ...queueItem }] };
      }
      if (/SET status='unconfirmed'/i.test(sql)) {
        queueItem.status = "unconfirmed";
        queueItem.email_send_error = String(values?.[2] ?? "");
        return { rows: [] };
      }
      if (/email_send_error=\$2/i.test(sql)) {
        queueItem.email_send_error = String(values?.[1] ?? "");
      }
      return { rows: [] };
    }),
  };

  return { client, pool, queueItem, sendEmail, isSmtpConfigured, getEmailDeliveryProvider };
});

vi.mock("./iroc.js", () => ({
  requireIrocAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("@workspace/db", () => ({ pool: state.pool }));
vi.mock("../lib/email.js", () => ({
  sendEmail: state.sendEmail,
  isSmtpConfigured: state.isSmtpConfigured,
  getEmailDeliveryProvider: state.getEmailDeliveryProvider,
}));
vi.mock("../lib/email-signatures.js", () => ({
  applyEmailSignature: vi.fn(async (text: string) => ({ text, html: text, attachments: [] })),
}));

import router from "./tori.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

describe("PATCH /iroc/tori/reorder-queue/:id/approve", () => {
  beforeEach(() => {
    state.queueItem.status = "pending";
    state.queueItem.email_send_error = null;
    state.queueItem.email_sent_at = null;
    state.queueItem.email_message_id = null;
    state.queueItem.send_attempt_id = null;
    state.queueItem.failFinalization = false;
    state.sendEmail.mockReset();
    state.sendEmail.mockResolvedValue({ messageId: "supplier-message-id" });
    state.isSmtpConfigured.mockReset();
    state.isSmtpConfigured.mockResolvedValue(true);
    state.getEmailDeliveryProvider.mockReset();
    state.getEmailDeliveryProvider.mockResolvedValue("smtp");
    state.client.query.mockClear();
    state.client.release.mockClear();
    state.pool.connect.mockClear();
    state.pool.query.mockClear();
  });

  it("sends the reviewed draft with the current Tori signature and approves it", async () => {
    const response = await request(createTestApp())
      .patch("/iroc/tori/reorder-queue/41/approve");

    expect(response.status).toBe(200);
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
    expect(state.sendEmail).toHaveBeenCalledWith({
      to: "reviewed-supplier@example.test",
      subject: "Nachbestellung",
      text: "Bitte bestätigen Sie unsere Nachbestellung.",
      signatureGroup: "tori",
      signatureLanguage: "de",
      mailboxPurpose: "tori_ai",
    });
    expect(state.queueItem.status).toBe("approved");
    expect(state.queueItem.email_sent_at).toEqual(expect.any(String));
    expect(state.queueItem.email_message_id).toBe("supplier-message-id");
  });

  it("does not send again after the reorder has already been approved", async () => {
    const app = createTestApp();
    const first = await request(app).patch("/iroc/tori/reorder-queue/41/approve");
    const duplicate = await request(app).patch("/iroc/tori/reorder-queue/41/approve");

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(409);
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("quarantines an ambiguous transport failure and prevents duplicate retries", async () => {
    state.sendEmail.mockRejectedValueOnce(new Error("SMTP unavailable"));

    const failed = await request(createTestApp())
      .patch("/iroc/tori/reorder-queue/41/approve");

    expect(failed.status).toBe(502);
    expect(failed.body).toMatchObject({
      code: "TORI_REORDER_DELIVERY_UNCONFIRMED",
      retryable: false,
    });
    expect(state.queueItem.status).toBe("unconfirmed");
    expect(state.queueItem.email_send_error).toContain("Do not retry");
    expect(state.queueItem.email_sent_at).toBeNull();
    expect(state.queueItem.email_message_id).toBeNull();

    const retried = await request(createTestApp())
      .patch("/iroc/tori/reorder-queue/41/approve");

    expect(retried.status).toBe(409);
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps the reorder pending when SMTP is not configured", async () => {
    state.isSmtpConfigured.mockResolvedValueOnce(false);

    const failed = await request(createTestApp())
      .patch("/iroc/tori/reorder-queue/41/approve");

    expect(failed.status).toBe(503);
    expect(failed.body).toMatchObject({
      code: "TORI_REORDER_PRE_SEND_FAILED",
      retryable: true,
    });
    expect(state.sendEmail).not.toHaveBeenCalled();
    expect(state.queueItem.status).toBe("pending");
    expect(state.queueItem.email_send_error).toContain("can be retried");
    expect(state.queueItem.email_sent_at).toBeNull();
    expect(state.queueItem.email_message_id).toBeNull();
  });

  it("quarantines a sent message when the final local transaction fails", async () => {
    state.queueItem.failFinalization = true;

    const failed = await request(createTestApp())
      .patch("/iroc/tori/reorder-queue/41/approve");

    expect(failed.status).toBe(500);
    expect(failed.body).toMatchObject({
      code: "TORI_REORDER_DELIVERY_UNCONFIRMED",
      retryable: false,
    });
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
    expect(state.queueItem.status).toBe("unconfirmed");

    const retried = await request(createTestApp())
      .patch("/iroc/tori/reorder-queue/41/approve");
    expect(retried.status).toBe(409);
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });
});
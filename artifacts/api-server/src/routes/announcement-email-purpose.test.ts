/**
 * Route-level mailbox routing coverage for customer announcements.
 *
 * The transport tests prove that Microsoft 365 can route an announcement
 * role. This test proves that the announcement route selects that role while
 * preserving every selected customer's dynamic recipient.
 */

import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";

const { mockSendEmail } = vi.hoisted(() => ({
  mockSendEmail: vi.fn().mockResolvedValue({ messageId: "announcement-test" }),
}));

vi.mock("../lib/email", () => ({
  sendEmail: mockSendEmail,
  getEmailDest: vi.fn(),
  getEmailDeliveryProvider: vi.fn().mockResolvedValue("smtp"),
  isSmtpConfigured: vi.fn().mockResolvedValue(true),
  sendEmailConfigurationTest: vi.fn(),
}));

import app from "../app";

const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
const TEST_MARKER = `announcement-routing-${Date.now()}`;
const RECIPIENTS = [
  `${TEST_MARKER}-one@example.test`,
  `${TEST_MARKER}-two@example.test`,
];
let customerIds: number[] = [];

function makeAuth(): string {
  const payload = {
    userId: 1,
    username: "admin",
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `Bearer ${data}.${signature}`;
}

beforeAll(async () => {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO website_customers
       (email, instrument, privacy_consent, first_name, last_name)
     VALUES
       ($1, 'iroc', true, 'Announcement', 'One'),
       ($2, 'iroc', true, 'Announcement', 'Two')
     RETURNING id`,
    RECIPIENTS,
  );
  customerIds = result.rows.map((row) => row.id);
});

afterAll(async () => {
  if (customerIds.length > 0) {
    await pool.query("DELETE FROM website_customers WHERE id = ANY($1::int[])", [customerIds]);
  }
});

beforeEach(() => {
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue({ messageId: "announcement-test" });
});

describe("POST /api/iroc/announcements/send", () => {
  it("uses the announcement mailbox for every selected customer", async () => {
    const response = await request(app)
      .post("/api/iroc/announcements/send")
      .set("Authorization", makeAuth())
      .send({
        customerIds,
        subject: "Product update",
        body: "Please find our latest product update attached.",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      sent: 2,
      failed: 0,
      results: customerIds.map((customerId, index) => ({
        customerId,
        email: RECIPIENTS[index],
        status: "sent",
      })),
    });
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockSendEmail.mock.calls.map(([options]) => options)).toEqual(
      RECIPIENTS.map((email) => expect.objectContaining({
        to: email,
        subject: "Product update",
        text: "Please find our latest product update attached.",
        mailboxPurpose: "announcement",
      })),
    );
  });
});
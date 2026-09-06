import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  poolQuery: vi.fn(),
  smtpSendMail: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { select: mocks.dbSelect },
  pool: { query: mocks.poolQuery },
  settingsTable: { key: "settings.key" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_column: unknown, value: unknown) => ({ value })),
  inArray: vi.fn((_column: unknown, value: unknown) => ({ value })),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
}));

vi.mock("./email-signatures.js", () => ({
  applyEmailSignature: vi.fn(async (
    text: string,
    _group: string,
    _language: string,
    html?: string,
  ) => ({
    text,
    html,
    attachments: [],
  })),
}));

import { encryptMicrosoftToken } from "./microsoft-365.js";
import { sendEmail } from "./email.js";

function dbRows(rows: unknown[]) {
  mocks.dbSelect.mockImplementation(() => ({
    from: () => ({
      where: (condition: { value?: unknown }) => {
        if (typeof condition.value === "string" && condition.value.startsWith("email_transport_")) {
          return Promise.resolve(rows);
        }
        return Promise.resolve([
          { key: "smtp_host", value: "smtp.example.test" },
          { key: "smtp_port", value: "587" },
          { key: "smtp_user", value: "smtp@example.test" },
          { key: "smtp_pass", value: "smtp-password" },
          { key: "smtp_from", value: "SMTP Sender <smtp@example.test>" },
        ]);
      },
    }),
  }));
}

function connectedMailbox() {
  return {
    id: 7,
    email: "orders@example.test",
    access_level: "read_write",
    authorization_status: "connected",
    authorization_error: null,
    oauth_access_token: encryptMicrosoftToken("graph-access-token"),
    oauth_refresh_token: encryptMicrosoftToken("graph-refresh-token"),
    oauth_expires_at: new Date(Date.now() + 3_600_000),
  };
}

describe("automated email transport", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "email-transport-test-secret";
    mocks.dbSelect.mockReset();
    mocks.poolQuery.mockReset();
    mocks.smtpSendMail.mockReset();
    mocks.createTransport.mockReset();
    mocks.createTransport.mockReturnValue({ sendMail: mocks.smtpSendMail });
    mocks.smtpSendMail.mockResolvedValue({ messageId: "smtp-message-id" });
  });

  it("sends through the selected Microsoft 365 mailbox with dynamic recipients and attachments", async () => {
    dbRows([{ key: "email_transport_order_new", value: "microsoft365" }]);
    mocks.poolQuery.mockResolvedValueOnce({ rows: [connectedMailbox()] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers({ "content-length": "0" }),
      text: async () => "",
    }));

    await sendEmail({
      to: "customer@example.test",
      subject: "Your order",
      text: "Plain text",
      html: "<p>Your order</p>",
      replyTo: "customer@example.test",
      attachments: [{ filename: "order.pdf", content: Buffer.from("pdf"), contentType: "application/pdf" }],
      mailboxPurpose: "order_new",
    });

    expect(mocks.createTransport).not.toHaveBeenCalled();
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/me/sendMail",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.message.body).toEqual({ contentType: "HTML", content: "<p>Your order</p>" });
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "customer@example.test" } }]);
    expect(body.message.replyTo).toEqual([{ emailAddress: { address: "customer@example.test" } }]);
    expect(body.message.attachments[0]).toMatchObject({
      name: "order.pdf",
      contentType: "application/pdf",
      contentBytes: Buffer.from("pdf").toString("base64"),
    });
    vi.unstubAllGlobals();
  });

  it("uses SMTP when the role is explicitly configured as the fallback", async () => {
    dbRows([{ key: "email_transport_notifications", value: "smtp" }]);

    await sendEmail({
      to: "admin@example.test",
      subject: "Notification",
      text: "A notification",
      mailboxPurpose: "notifications",
    });

    expect(mocks.smtpSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "admin@example.test",
      subject: "Notification",
      text: "A notification",
    }));
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it("rejects an automated send without an explicit recipient", async () => {
    await expect(sendEmail({
      subject: "Notification",
      text: "A notification",
      mailboxPurpose: "notifications",
    })).rejects.toMatchObject({
      name: "EmailDestinationUnavailableError",
      mailboxPurpose: "notifications",
    });

    expect(mocks.createTransport).not.toHaveBeenCalled();
    expect(mocks.smtpSendMail).not.toHaveBeenCalled();
  });

  it("rejects an invalid delivery provider instead of switching to SMTP", async () => {
    dbRows([{ key: "email_transport_invoice", value: "shared_fallback" }]);

    await expect(sendEmail({
      to: "customer@example.test",
      subject: "Invoice",
      text: "Invoice attached",
      mailboxPurpose: "invoice",
    })).rejects.toThrow(
      "Automated email flow 'invoice' cannot be sent: mailbox role 'invoice' is unavailable",
    );

    expect(mocks.createTransport).not.toHaveBeenCalled();
    expect(mocks.smtpSendMail).not.toHaveBeenCalled();
  });

  it("reports the flow and role when the selected Microsoft mailbox is missing", async () => {
    dbRows([{ key: "email_transport_order_new", value: "microsoft365" }]);
    mocks.poolQuery.mockResolvedValueOnce({ rows: [] });

    await expect(sendEmail({
      to: "customer@example.test",
      subject: "Your order",
      text: "Please confirm",
      mailboxPurpose: "order_new",
    })).rejects.toThrow(
      "Automated email flow 'new-customer order' cannot be sent: mailbox role 'order_new' is unavailable",
    );

    expect(mocks.smtpSendMail).not.toHaveBeenCalled();
  });

  it("surfaces Microsoft authorization failures without retrying through SMTP", async () => {
    dbRows([{ key: "email_transport_invoice", value: "microsoft365" }]);
    mocks.poolQuery.mockResolvedValueOnce({ rows: [connectedMailbox()] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: async () => JSON.stringify({ error: "invalid_token" }),
    }));

    await expect(sendEmail({
      to: "customer@example.test",
      subject: "Invoice",
      text: "Invoice attached",
      mailboxPurpose: "invoice",
    })).rejects.toThrow("Microsoft Graph rejected the mailbox action");

    expect(mocks.smtpSendMail).not.toHaveBeenCalled();
    expect(mocks.poolQuery.mock.calls.some(([query]) =>
      String(query).includes("authorization_status=CASE WHEN enabled THEN 'error'"),
    )).toBe(true);
    vi.unstubAllGlobals();
  });
});
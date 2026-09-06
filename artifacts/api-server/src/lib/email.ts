import nodemailer from "nodemailer";
import { logger } from "./logger";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { applyEmailSignature, type EmailSignatureGroup, type EmailSignatureLanguage } from "./email-signatures.js";
import {
  mailboxRoleUnavailableMessage,
  sendMicrosoftEmail,
  type EmailDeliveryProvider,
  type MicrosoftMailboxPurpose,
} from "./microsoft-365.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMAIL_DESTINATION_ROLES: Record<string, MicrosoftMailboxPurpose> = {
  email_dest_contact: "website_contact",
  email_dest_order_new: "order_new",
  email_dest_order_existing: "order_existing",
  email_dest_training_spirecut: "training_spirecut",
  email_dest_training_ministem: "training_ministem",
};

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  cid?: string;
}

export class EmailDestinationUnavailableError extends Error {
  readonly settingKey: string | undefined;
  readonly mailboxPurpose: MicrosoftMailboxPurpose;

  constructor(mailboxPurpose: MicrosoftMailboxPurpose, settingKey?: string) {
    const reason = settingKey
      ? `Set a valid single recipient address in '${settingKey}'.`
      : "Provide an explicit recipient address.";
    super(mailboxRoleUnavailableMessage(mailboxPurpose, reason));
    this.name = "EmailDestinationUnavailableError";
    this.settingKey = settingKey;
    this.mailboxPurpose = mailboxPurpose;
  }
}

function isValidEmailDestination(value: string): boolean {
  return EMAIL_RE.test(value) && !value.includes(",") && !value.includes(";");
}

/** Fetch a required, role-specific email destination without a shared fallback. */
export async function getEmailDest(
  key: string,
  options?: { mailboxPurpose?: MicrosoftMailboxPurpose },
): Promise<string> {
  const mailboxPurpose = options?.mailboxPurpose ?? EMAIL_DESTINATION_ROLES[key] ?? "general";
  try {
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, key));
    const value = row?.value?.trim() ?? "";
    if (isValidEmailDestination(value)) return value;
  } catch {
    // Configuration read failures are handled as unavailable role configuration
    // below; they must never turn into a send to the shared mailbox.
  }
  throw new EmailDestinationUnavailableError(mailboxPurpose, key);
}

/** Read SMTP config from the settings table, falling back to environment variables. */
async function resolveSmtpConfig(): Promise<{
  host: string | undefined;
  port: number;
  user: string | undefined;
  pass: string | undefined;
  from: string | undefined;
}> {
  try {
    const rows = await db
      .select()
      .from(settingsTable)
      .where(inArray(settingsTable.key, ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from"]));
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value.trim()]));
    return {
      host: map["smtp_host"] || process.env.SMTP_HOST,
      port: parseInt(map["smtp_port"] || process.env.SMTP_PORT || "587"),
      user: map["smtp_user"] || process.env.SMTP_USER,
      pass: map["smtp_pass"] || process.env.SMTP_PASS,
      from: map["smtp_from"] || process.env.SMTP_FROM,
    };
  } catch {
    return {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM,
    };
  }
}

async function createTransport() {
  const { host, port, user, pass } = await resolveSmtpConfig();
  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return null;
}

export const EMAIL_DELIVERY_SETTING_PREFIX = "email_transport_";

/** Read the selected transport for an automated email role. SMTP is the safe default. */
export async function getEmailDeliveryProvider(
  purpose: MicrosoftMailboxPurpose = "general",
): Promise<EmailDeliveryProvider> {
  let configured: string | undefined;
  try {
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, `${EMAIL_DELIVERY_SETTING_PREFIX}${purpose}`));
    configured = row?.value?.trim();
  } catch {
    // Database outages must not cause a configured role to switch transports.
    // Preserve the explicit SMTP default only when no provider row exists.
    throw new Error(
      mailboxRoleUnavailableMessage(
        purpose,
        "The delivery provider configuration could not be read.",
      ),
    );
  }
  if (!configured || configured === "smtp") return "smtp";
  if (configured === "microsoft365") return "microsoft365";
  throw new Error(
    mailboxRoleUnavailableMessage(
      purpose,
      `The configured delivery provider '${configured}' is invalid. Choose SMTP or Microsoft 365.`,
    ),
  );
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
  replyTo,
  from,
  inReplyTo,
  attachments,
  signatureGroup,
  signatureLanguage,
  mailboxPurpose,
}: {
  to?: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  from?: string;
  /** Message-ID of the email being replied to, sets In-Reply-To + References headers. */
  inReplyTo?: string;
  attachments?: EmailAttachment[];
  signatureGroup?: EmailSignatureGroup;
  signatureLanguage?: EmailSignatureLanguage;
  /** Automated role whose configured Microsoft 365 mailbox should send this message. */
  mailboxPurpose: MicrosoftMailboxPurpose;
}): Promise<{ messageId: string | undefined }> {
  const recipient = to?.trim();
  if (!recipient || !isValidEmailDestination(recipient)) {
    throw new EmailDestinationUnavailableError(mailboxPurpose);
  }
  const { from: dbFrom, user } = await resolveSmtpConfig();

  const rendered = signatureGroup ? await applyEmailSignature(text, signatureGroup, signatureLanguage ?? "de", html) : null;
  const effectiveFrom = rendered?.from ?? from ?? dbFrom ?? (user ? `iROC GmbH <${user}>` : "iROC GmbH <info@i-roc.de>");
  const effectiveText = rendered?.text ?? text;
  const effectiveHtml = rendered?.html ?? html;
  const effectiveAttachments = [...(attachments ?? []), ...(rendered?.attachments ?? [])];

  if (await getEmailDeliveryProvider(mailboxPurpose) === "microsoft365") {
    try {
      await sendMicrosoftEmail({
        purpose: mailboxPurpose,
        to: recipient,
        subject,
        text: effectiveText,
        html: effectiveHtml,
        replyTo,
        inReplyTo,
        attachments: effectiveAttachments,
      });
      return { messageId: undefined };
    } catch (err) {
      // Do not silently retry through SMTP: Microsoft may have accepted a
      // message before a network/authorization error reached this process.
      logger.error({ err, purpose: mailboxPurpose, subject }, "Failed to send email via Microsoft 365");
      throw err;
    }
  }

  const transport = await createTransport();
  if (!transport) {
    logger.info({ subject, text: effectiveText, replyTo, to: recipient, attachments: effectiveAttachments.map(a => a.filename) }, "Email would be sent (SMTP not configured)");
    return { messageId: undefined };
  }

  try {
    const info = await transport.sendMail({
      from: effectiveFrom,
      to: recipient,
      subject,
       text: effectiveText,
       ...(effectiveHtml ? { html: effectiveHtml } : {}),
      replyTo,
      ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
       ...(effectiveAttachments.length ? { attachments: effectiveAttachments } : {}),
    });
    logger.info({ subject, to: recipient, messageId: info.messageId }, "Email sent");
    return { messageId: info.messageId };
  } catch (err) {
    logger.error({ err, subject }, "Failed to send email");
    throw err;
  }
}

/**
 * Send the fixed, bilingual diagnostic message used by Email Configuration.
 * Keeping this on top of sendEmail ensures mailbox selection, OAuth/Graph
 * permission checks, signatures, and signature attachments follow production.
 */
export async function sendEmailConfigurationTest({
  to,
  mailboxPurpose,
}: {
  to: string;
  mailboxPurpose: MicrosoftMailboxPurpose;
}): Promise<{ messageId: string | undefined }> {
  return sendEmail({
    to,
    subject: "iROC mailbox test / Postfachtest",
    text: [
      "This is an administrator-requested test message for the selected iROC email delivery role.",
      "Dies ist eine von einem Administrator angeforderte Testnachricht für die ausgewählte iROC-E-Mail-Versandrolle.",
      "",
      `Delivery role / Versandrolle: ${mailboxPurpose}`,
      "",
      "If you received this message, the selected delivery path is working.",
      "Wenn Sie diese Nachricht erhalten haben, funktioniert der ausgewählte Versandweg.",
    ].join("\n"),
    signatureGroup: "admin",
    signatureLanguage: "de",
    mailboxPurpose,
  });
}

/** Check whether SMTP is currently configured (DB or env). */
export async function isSmtpConfigured(): Promise<boolean> {
  const { host, user, pass } = await resolveSmtpConfig();
  return !!(host && user && pass);
}

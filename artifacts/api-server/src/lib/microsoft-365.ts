import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./logger.js";

const MICROSOFT_GRAPH_URL = "https://graph.microsoft.com/v1.0";
const DEFAULT_TENANT = "organizations";
const TOKEN_ENCRYPTION_VERSION = "v1";

export type MicrosoftMailboxAccessLevel = "read" | "read_write";
export type MicrosoftMailboxPurpose =
  | "general"
  | "website_contact"
  | "order_new"
  | "order_existing"
  | "training_spirecut"
  | "training_ministem"
  | "invoice"
  | "invoice_ai"
  | "datev"
  | "announcement"
  | "smtp"
  | "tori_ai"
  | "sally_ai"
  | "notifications";

const MAILBOX_ROLE_FLOW_LABELS: Record<MicrosoftMailboxPurpose, string> = {
  general: "general automated email",
  website_contact: "website contact",
  order_new: "new-customer order",
  order_existing: "existing-customer order",
  training_spirecut: "Spirecut training registration",
  training_ministem: "MiniStem training registration",
  invoice: "invoice",
  invoice_ai: "invoice AI",
  datev: "DATEV export",
  announcement: "customer announcement",
  smtp: "SMTP",
  tori_ai: "Tori supplier reorder",
  sally_ai: "Sally",
  notifications: "system notification",
};

export function mailboxRoleFlowLabel(purpose: MicrosoftMailboxPurpose): string {
  return MAILBOX_ROLE_FLOW_LABELS[purpose];
}

export function mailboxRoleUnavailableMessage(
  purpose: MicrosoftMailboxPurpose,
  reason: string,
): string {
  return `Automated email flow '${mailboxRoleFlowLabel(purpose)}' cannot be sent: mailbox role '${purpose}' is unavailable. ${reason}`;
}

export const MICROSOFT_EMAIL_PURPOSES: MicrosoftMailboxPurpose[] = [
  "general",
  "website_contact",
  "order_new",
  "order_existing",
  "training_spirecut",
  "training_ministem",
  "invoice",
  "invoice_ai",
  "datev",
  "announcement",
  "smtp",
  "tori_ai",
  "sally_ai",
  "notifications",
];

export type EmailDeliveryProvider = "smtp" | "microsoft365";

export interface MicrosoftOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope?: string;
}

export interface MicrosoftIdentity {
  mail?: string | null;
  userPrincipalName?: string | null;
  displayName?: string | null;
}

export interface MicrosoftEmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  cid?: string;
}

export interface MicrosoftEmailMessage {
  purpose: MicrosoftMailboxPurpose;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  inReplyTo?: string;
  attachments?: MicrosoftEmailAttachment[];
}

export class MicrosoftMailboxUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MicrosoftMailboxUnavailableError";
  }
}

export class MicrosoftOAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MicrosoftOAuthConfigError";
  }
}

export class MicrosoftOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MicrosoftOAuthError";
  }
}

export class MicrosoftGraphAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MicrosoftGraphAuthorizationError";
  }
}

function requiredEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new MicrosoftOAuthConfigError(
    `Microsoft 365 OAuth is not configured. Set ${names[0]}.`,
  );
}

export function getMicrosoftRedirectUri(): string {
  const configured = process.env.MICROSOFT_REDIRECT_URI?.trim();
  if (configured) return configured;

  const domain = process.env.REPLIT_DOMAINS
    ?.split(",")
    .map((item) => item.trim())
    .find(Boolean);
  if (!domain) {
    throw new MicrosoftOAuthConfigError(
      "Microsoft 365 OAuth is not configured. Set MICROSOFT_REDIRECT_URI.",
    );
  }
  return `https://${domain}/api/admin/microsoft-365/oauth/callback`;
}

function getOAuthConfig() {
  return {
    clientId: requiredEnv("MICROSOFT_CLIENT_ID", "MICROSOFT_365_CLIENT_ID"),
    clientSecret: requiredEnv("MICROSOFT_CLIENT_SECRET", "MICROSOFT_365_CLIENT_SECRET"),
    tenantId: process.env.MICROSOFT_TENANT_ID?.trim() || DEFAULT_TENANT,
    redirectUri: getMicrosoftRedirectUri(),
  };
}

function requestedScopes(accessLevel: MicrosoftMailboxAccessLevel): string {
  return [
    "openid",
    "profile",
    "offline_access",
    "User.Read",
    ...(accessLevel === "read_write"
      ? ["Mail.ReadWrite", "Mail.Send"]
      : ["Mail.Read"]),
  ].join(" ");
}

export function buildMicrosoftAuthorizationUrl(
  state: string,
  accessLevel: MicrosoftMailboxAccessLevel,
): string {
  const config = getOAuthConfig();
  const url = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/authorize`,
  );
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", requestedScopes(accessLevel));
  url.searchParams.set("state", state);
  return url.toString();
}

function parseTokenResponse(value: unknown): MicrosoftOAuthTokens {
  const data = value as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  };
  if (
    typeof data.access_token !== "string" ||
    typeof data.refresh_token !== "string" ||
    !data.access_token ||
    !data.refresh_token
  ) {
    throw new MicrosoftOAuthError("Microsoft did not return usable OAuth tokens.");
  }

  const expiresIn =
    typeof data.expires_in === "number" && Number.isFinite(data.expires_in)
      ? Math.max(60, data.expires_in)
      : 3600;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    scope: typeof data.scope === "string" ? data.scope : undefined,
  };
}

async function readMicrosoftError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as {
      error?: string;
      error_description?: string;
    };
    return json.error_description ?? json.error ?? `HTTP ${response.status}`;
  } catch {
    return text.slice(0, 500) || `HTTP ${response.status}`;
  }
}

async function tokenRequest(params: URLSearchParams): Promise<MicrosoftOAuthTokens> {
  const config = getOAuthConfig();
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
  );
  if (!response.ok) {
    throw new MicrosoftOAuthError(
      `Microsoft OAuth token exchange failed (${response.status}): ${await readMicrosoftError(response)}`,
    );
  }
  return parseTokenResponse(await response.json());
}

export async function exchangeMicrosoftCode(
  code: string,
  accessLevel: MicrosoftMailboxAccessLevel,
): Promise<MicrosoftOAuthTokens> {
  const config = getOAuthConfig();
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      scope: requestedScopes(accessLevel),
    }),
  );
}

export async function refreshMicrosoftAccessToken(
  refreshToken: string,
  accessLevel: MicrosoftMailboxAccessLevel,
): Promise<MicrosoftOAuthTokens> {
  const config = getOAuthConfig();
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      scope: requestedScopes(accessLevel),
    }),
  );
}

export async function getMicrosoftIdentity(accessToken: string): Promise<MicrosoftIdentity> {
  const response = await fetch(
    `${MICROSOFT_GRAPH_URL}/me?$select=mail,userPrincipalName,displayName`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 401 || response.status === 403) {
    throw new MicrosoftGraphAuthorizationError(
      `Microsoft Graph rejected the identity check (${response.status}).`,
    );
  }
  if (!response.ok) {
    throw new MicrosoftOAuthError(
      `Microsoft Graph identity check failed (${response.status}): ${await readMicrosoftError(response)}`,
    );
  }
  return (await response.json()) as MicrosoftIdentity;
}

export async function microsoftGraphRequest(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(`${MICROSOFT_GRAPH_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new MicrosoftGraphAuthorizationError(
      `Microsoft Graph rejected the mailbox action (${response.status}).`,
    );
  }
  if (!response.ok) {
    throw new MicrosoftOAuthError(
      `Microsoft Graph request failed (${response.status}): ${await readMicrosoftError(response)}`,
    );
  }
  // Graph's sendMail endpoint succeeds with 202 Accepted and no response body.
  // Parse only responses that actually contain JSON, so an accepted send is
  // never reported as a failure after Microsoft has queued it.
  if (response.status === 202 || response.status === 204) return null;
  const contentLength = response.headers.get("content-length");
  if (contentLength === "0") return null;
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

type MicrosoftSendingMailbox = {
  id: number;
  email: string;
  access_level: MicrosoftMailboxAccessLevel;
  authorization_status: string;
  authorization_error: string | null;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_expires_at: Date | string | null;
};

async function findSendingMailbox(
  purpose: MicrosoftMailboxPurpose,
): Promise<MicrosoftSendingMailbox> {
  const { rows } = await pool.query<MicrosoftSendingMailbox>(
    `SELECT id, email, access_level, authorization_status, authorization_error,
            oauth_access_token, oauth_refresh_token, oauth_expires_at
       FROM iroc_microsoft_mailboxes
      WHERE purpose=$1 AND enabled=true
      ORDER BY CASE
                 WHEN authorization_status='connected' AND access_level='read_write' THEN 0
                 WHEN authorization_status='connected' THEN 1
                 ELSE 2
               END,
               created_at ASC
      LIMIT 1`,
    [purpose],
  );
  const mailbox = rows[0];
  if (!mailbox) {
    throw new MicrosoftMailboxUnavailableError(
      mailboxRoleUnavailableMessage(
        purpose,
        "Configure and authorize an enabled Microsoft 365 mailbox for this role.",
      ),
    );
  }
  if (mailbox.authorization_status !== "connected") {
    throw new MicrosoftMailboxUnavailableError(
      mailboxRoleUnavailableMessage(
        purpose,
        mailbox.authorization_error
          ?? "Authorize the configured Microsoft 365 mailbox before sending.",
      ),
    );
  }
  if (mailbox.access_level !== "read_write") {
    throw new MicrosoftMailboxUnavailableError(
      mailboxRoleUnavailableMessage(
        purpose,
        "The mailbox is read-only. Configure it with send permission.",
      ),
    );
  }
  return mailbox;
}

async function sendingMailboxAccessToken(mailbox: MicrosoftSendingMailbox): Promise<string> {
  try {
    if (
      mailbox.oauth_access_token &&
      mailbox.oauth_expires_at &&
      new Date(mailbox.oauth_expires_at).getTime() > Date.now() + 60_000
    ) {
      return decryptMicrosoftToken(mailbox.oauth_access_token);
    }
    if (!mailbox.oauth_refresh_token) {
      throw new MicrosoftOAuthError("Mailbox has no refresh authorization.");
    }
    const refreshed = await refreshMicrosoftAccessToken(
      decryptMicrosoftToken(mailbox.oauth_refresh_token),
      mailbox.access_level,
    );
    const stored = {
      accessToken: encryptMicrosoftToken(refreshed.accessToken),
      refreshToken: encryptMicrosoftToken(refreshed.refreshToken),
      expiresAt: refreshed.expiresAt,
    };
    await pool.query(
      `UPDATE iroc_microsoft_mailboxes
          SET oauth_access_token=$1, oauth_refresh_token=$2,
              oauth_expires_at=$3, authorization_error=NULL, updated_at=NOW()
        WHERE id=$4 AND enabled=true AND authorization_status='connected'`,
      [stored.accessToken, stored.refreshToken, stored.expiresAt, mailbox.id],
    );
    return refreshed.accessToken;
  } catch (err) {
    await pool.query(
      `UPDATE iroc_microsoft_mailboxes
          SET authorization_status=CASE WHEN enabled THEN 'error' ELSE 'disabled' END,
              authorization_error=$1, updated_at=NOW()
        WHERE id=$2`,
      [
        err instanceof MicrosoftGraphAuthorizationError || err instanceof MicrosoftOAuthError
          ? err.message
          : "Microsoft 365 authorization is no longer valid.",
        mailbox.id,
      ],
    );
    throw err;
  }
}

function graphRecipients(value: string): Array<{ emailAddress: { address: string } }> {
  return value
    .split(/[;,]/)
    .map((address) => address.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

function graphAttachment(attachment: MicrosoftEmailAttachment) {
  const content = Buffer.isBuffer(attachment.content)
    ? attachment.content
    : Buffer.from(attachment.content);
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: attachment.filename,
    contentType: attachment.contentType ?? "application/octet-stream",
    contentBytes: content.toString("base64"),
    ...(attachment.cid ? { isInline: true, contentId: attachment.cid } : {}),
  };
}

/**
 * Send a message as the connected mailbox assigned to an automated email role.
 * The /me endpoint deliberately uses the authorized identity as the sender;
 * arbitrary From headers are not accepted as a safe substitute for mailbox
 * authorization.
 */
export async function sendMicrosoftEmail(message: MicrosoftEmailMessage): Promise<{ messageId: undefined }> {
  const mailbox = await findSendingMailbox(message.purpose);
  const recipients = graphRecipients(message.to);
  if (!recipients.length) {
    throw new MicrosoftMailboxUnavailableError("At least one email recipient is required.");
  }
  const replyTo = message.replyTo ? graphRecipients(message.replyTo) : [];
  const accessToken = await sendingMailboxAccessToken(mailbox);
  try {
    await microsoftGraphRequest(accessToken, "/me/sendMail", {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject: message.subject,
          body: {
            contentType: message.html ? "HTML" : "Text",
            content: message.html ?? message.text,
          },
          toRecipients: recipients,
          ...(replyTo.length ? { replyTo } : {}),
          ...(message.attachments?.length
            ? { attachments: message.attachments.map(graphAttachment) }
            : {}),
        },
        saveToSentItems: true,
      }),
    });
    logger.info(
      { purpose: message.purpose, mailboxId: mailbox.id, to: message.to },
      "Email sent via Microsoft 365",
    );
    return { messageId: undefined };
  } catch (err) {
    if (err instanceof MicrosoftGraphAuthorizationError) {
      await pool.query(
        `UPDATE iroc_microsoft_mailboxes
            SET authorization_status=CASE WHEN enabled THEN 'error' ELSE 'disabled' END,
                authorization_error=$1, updated_at=NOW()
          WHERE id=$2`,
        [err.message, mailbox.id],
      );
    }
    throw err;
  }
}

function encryptionKey(): Buffer {
  const secret =
    process.env.MICROSOFT_TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new MicrosoftOAuthConfigError(
      "Microsoft 365 OAuth is not configured. Set MICROSOFT_TOKEN_ENCRYPTION_KEY or SESSION_SECRET.",
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Tokens are encrypted before persistence. The database never receives a
 * plaintext access or refresh token, and the encrypted values are never sent
 * in an API response.
 */
export function encryptMicrosoftToken(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    TOKEN_ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptMicrosoftToken(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (
    version !== TOKEN_ENCRYPTION_VERSION ||
    !ivValue ||
    !tagValue ||
    !encryptedValue
  ) {
    throw new MicrosoftOAuthError("Stored Microsoft authorization is unreadable.");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new MicrosoftOAuthError("Stored Microsoft authorization is unreadable.");
  }
}
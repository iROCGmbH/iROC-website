/**
 * Sally IMAP inbox poller.
 *
 * Polls Sally's configured IMAP mailbox (Microsoft 365 or any IMAP server)
 * for new messages addressed to Sally's email address, then hands each one
 * to the AI reply drafter (sally-reply.ts).
 *
 * Supports two auth modes:
 *   1. Username + password (app password for M365 Basic Auth)
 *   2. OAuth2 / Modern Auth via Microsoft identity platform v2.0 (xoauth2)
 *      — activated when sally_imap_oauth_client_id / tenant_id / client_secret
 *        are all set in the settings table.
 *
 * Enable in Sally Settings: IMAP host, port, user, password/OAuth2 + toggle.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import { processInboundEmail } from "./sally-reply.js";

async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key = ANY($1)",
    [keys],
  );
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

/**
 * Fetch a Microsoft OAuth2 access token using the client-credentials flow.
 * Scope: https://outlook.office365.com/.default
 */
async function fetchMsOAuthToken(opts: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const url = `https://login.microsoftonline.com/${opts.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    "client_credentials",
    client_id:     opts.clientId,
    client_secret: opts.clientSecret,
    scope:         "https://outlook.office365.com/.default",
  });

  const response = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth2 token request failed (${response.status}): ${text}`);
  }

  const json = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!json.access_token) {
    throw new Error(`OAuth2 token missing in response: ${json.error_description ?? json.error ?? JSON.stringify(json)}`);
  }
  return json.access_token;
}

/**
 * Build the ImapFlow auth object — either xoauth2 (Modern Auth) or plain
 * user + password (Basic Auth / app password).
 */
async function buildImapAuth(opts: {
  user: string;
  pass: string;
  oauthClientId?: string;
  oauthTenantId?: string;
  oauthClientSecret?: string;
}): Promise<{ user: string; pass?: string; accessToken?: string }> {
  const { oauthClientId, oauthTenantId, oauthClientSecret } = opts;

  if (oauthClientId && oauthTenantId && oauthClientSecret) {
    const accessToken = await fetchMsOAuthToken({
      tenantId:     oauthTenantId,
      clientId:     oauthClientId,
      clientSecret: oauthClientSecret,
    });
    return { user: opts.user, accessToken };
  }

  return { user: opts.user, pass: opts.pass };
}

export async function pollSallyInbox(): Promise<void> {
  const s = await getSettings([
    "sally_imap_enabled", "sally_imap_host", "sally_imap_port",
    "sally_imap_user",    "sally_imap_pass",
    "sally_from_name",    "sally_from_email",
    "sally_imap_oauth_client_id", "sally_imap_oauth_tenant_id", "sally_imap_oauth_client_secret",
  ]);

  if (s.sally_imap_enabled !== "true") return;

  const host = s.sally_imap_host;
  const user = s.sally_imap_user;
  const pass = s.sally_imap_pass;

  // OAuth2 is active when all three OAuth settings are non-empty
  const hasOAuth = !!(
    s.sally_imap_oauth_client_id &&
    s.sally_imap_oauth_tenant_id &&
    s.sally_imap_oauth_client_secret
  );

  if (!host || !user || (!pass && !hasOAuth)) {
    logger.warn("Sally IMAP: not fully configured — skipping poll");
    return;
  }

  const port       = parseInt(s.sally_imap_port || "993", 10);
  const sallyName  = s.sally_from_name  || "Sally";
  const sallyEmail = s.sally_from_email || user;

  try {
    // Lazy-import so that a missing imapflow package doesn't crash the server
    const { ImapFlow } = await import("imapflow") as typeof import("imapflow");

    const auth = await buildImapAuth({
      user,
      pass,
      oauthClientId:     s.sally_imap_oauth_client_id,
      oauthTenantId:     s.sally_imap_oauth_tenant_id,
      oauthClientSecret: s.sally_imap_oauth_client_secret,
    });

    const client = new ImapFlow({
      host,
      port,
      secure: port === 993,
      auth,
      logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    let drafted = 0;

    try {
      // Fetch all unseen messages
      for await (const msg of client.fetch(
        { seen: false },
        { uid: true, flags: true, envelope: true, source: true },
      )) {
        const envelope = msg.envelope;

        // Mark as seen regardless so we don't reprocess on the next poll
        await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"]);

        if (!envelope) continue;

        const toAddresses = (envelope.to ?? []) as Array<{ address?: string }>;
        const isForSally  = toAddresses.some(
          t => t.address?.toLowerCase() === sallyEmail.toLowerCase(),
        );
        if (!isForSally) continue;

        const from    = ((envelope.from?.[0]) as { address?: string } | undefined)?.address ?? "";
        const subject = (envelope.subject as string | undefined) ?? "(no subject)";

        // Skip emails from Sally herself (prevents loops)
        if (!from || from.toLowerCase() === sallyEmail.toLowerCase()) continue;

        const rawSource = msg.source?.toString("utf-8") ?? "";
        const inReplyTo = (envelope as Record<string, unknown>).inReplyTo as string | undefined;
        const messageId = (envelope as Record<string, unknown>).messageId as string | undefined;

        const created = await processInboundEmail({
          inboundFrom: from,
          inboundSubject: subject,
          rawSource,
          inboundMessageId: messageId?.replace(/[<>]/g, "").trim() || undefined,
          inReplyToMessageId: inReplyTo?.replace(/[<>]/g, "").trim() || undefined,
          sallyName,
          sallyEmail,
        });
        if (created) drafted++;
      }
    } finally {
      lock.release();
    }

    await client.logout();
    if (drafted > 0) logger.info({ drafted }, "Sally IMAP: reply drafts created");
  } catch (err) {
    logger.error({ err }, "Sally IMAP: poll failed");
  }
}

/** Test the IMAP connection and return a status string. */
export async function testImapConnection(opts: {
  host: string;
  port: number;
  user: string;
  pass: string;
  oauthClientId?: string;
  oauthTenantId?: string;
  oauthClientSecret?: string;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const { ImapFlow } = await import("imapflow") as typeof import("imapflow");

    const auth = await buildImapAuth({
      user:              opts.user,
      pass:              opts.pass,
      oauthClientId:     opts.oauthClientId,
      oauthTenantId:     opts.oauthTenantId,
      oauthClientSecret: opts.oauthClientSecret,
    });

    const client = new ImapFlow({
      host: opts.host, port: opts.port,
      secure: opts.port === 993,
      auth,
      logger: false,
    });
    await client.connect();
    await client.logout();

    const mode = opts.oauthClientId && opts.oauthTenantId && opts.oauthClientSecret
      ? "OAuth2 / Modern Auth"
      : "Basic Auth";
    return { ok: true, message: `Connection successful (${mode})` };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

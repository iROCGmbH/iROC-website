import { db, pool, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage.js";
import { logger } from "./logger.js";
import { appendImpressumSignature, buildImpressumSignature } from "./impressum-signature.js";

export type EmailSignatureGroup = "admin" | "sally" | "tori";
export type EmailSignatureLanguage = "de" | "en";
export type EmailAddressSource = "smtp" | "website_setting" | "sally" | "microsoft365";
export interface EmailAddressOption { id: string; email: string; displayName: string; descriptionDe: string; descriptionEn: string; brand: "iroc" | "spirecut"; source: EmailAddressSource; }
export interface EmailSignatureColumn { id: string; titleDe: string; titleEn: string; bodyDe: string; bodyEn: string; }
export interface EmailSignatureProfile {
  group: EmailSignatureGroup; enabled: boolean; addressId: string; thankYouDe: string; thankYouEn: string;
  writerName: string; writerRoleDe: string; writerRoleEn: string; writerEmail: string; writerPhone: string;
  logoPath: string; columns: EmailSignatureColumn[];
}
const KEY = (group: EmailSignatureGroup) => `iroc.email_signature.${group}`;
const GROUPS = new Set<EmailSignatureGroup>(["admin", "sally", "tori"]);
const START = "\u2061", END = "\u2062";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_SIGNATURE_LOGO_MAX_BYTES = 512 * 1024;
export const EMAIL_SIGNATURE_LOGO_MAX_WIDTH = 600;
export const EMAIL_SIGNATURE_LOGO_MAX_HEIGHT = 200;
export const EMAIL_SIGNATURE_LOGO_LIMIT_MESSAGE =
  "Signature logo must be a PNG, JPEG, GIF, or WebP image no larger than 512 KB and 600 × 200 px. / " +
  "Das Signaturlogo muss ein PNG-, JPEG-, GIF- oder WebP-Bild mit höchstens 512 KB und 600 × 200 px sein.";

type ImageDimensions = { width: number; height: number };

function readImageDimensions(content: Buffer): ImageDimensions | null {
  if (content.length >= 24 &&
      content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) };
  }
  if (content.length >= 10 && (content.subarray(0, 6).toString("ascii") === "GIF87a" || content.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return { width: content.readUInt16LE(6), height: content.readUInt16LE(8) };
  }
  if (content.length >= 30 && content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP") {
    const kind = content.subarray(12, 16).toString("ascii");
    if (kind === "VP8X" && content.length >= 30) {
      return {
        width: 1 + content.readUIntLE(24, 3),
        height: 1 + content.readUIntLE(27, 3),
      };
    }
    const chunkDataOffset = 20;
    if (kind === "VP8 " && content.length >= chunkDataOffset + 12 &&
        content[chunkDataOffset + 3] === 0x9d && content[chunkDataOffset + 4] === 0x01 && content[chunkDataOffset + 5] === 0x2a) {
      return {
        width: content.readUInt16LE(chunkDataOffset + 6) & 0x3fff,
        height: content.readUInt16LE(chunkDataOffset + 8) & 0x3fff,
      };
    }
    if (kind === "VP8L" && content.length >= chunkDataOffset + 5 && content[chunkDataOffset] === 0x2f) {
      const bits = content.readUInt32LE(chunkDataOffset + 1);
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      };
    }
  }
  if (content.length >= 4 && content[0] === 0xff && content[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < content.length) {
      if (content[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = content[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > content.length) break;
      const segmentLength = content.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > content.length) break;
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isStartOfFrame && segmentLength >= 7) {
        return { width: content.readUInt16BE(offset + 5), height: content.readUInt16BE(offset + 3) };
      }
      offset += segmentLength;
    }
  }
  return null;
}

export function validateEmailSignatureLogoUpload(size: number, contentType: string): void {
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  if (!allowedTypes.has(contentType.toLowerCase()) || !Number.isFinite(size) || size < 1 || size > EMAIL_SIGNATURE_LOGO_MAX_BYTES) {
    throw new Error(EMAIL_SIGNATURE_LOGO_LIMIT_MESSAGE);
  }
}

export function validateEmailSignatureLogo(content: Buffer, contentType: string): void {
  validateEmailSignatureLogoUpload(content.length, contentType);
  const dimensions = readImageDimensions(content);
  if (dimensions && (dimensions.width > EMAIL_SIGNATURE_LOGO_MAX_WIDTH || dimensions.height > EMAIL_SIGNATURE_LOGO_MAX_HEIGHT)) {
    throw new Error(EMAIL_SIGNATURE_LOGO_LIMIT_MESSAGE);
  }
}

function stringField(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  if (value.length > max) throw new Error(`${field} must not exceed ${max} characters.`);
  return value.trim();
}
export function validateEmailSignatureProfile(value: unknown, expectedGroup?: EmailSignatureGroup): EmailSignatureProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Email signature profile must be an object.");
  const input = value as Record<string, unknown>;
  const group = input.group;
  if (typeof group !== "string" || !GROUPS.has(group as EmailSignatureGroup)) throw new Error("group must be admin, sally, or tori.");
  if (expectedGroup && group !== expectedGroup) throw new Error("Profile group must match the URL group.");
  if (typeof input.enabled !== "boolean") throw new Error("enabled must be a boolean.");
  const columnsValue = input.columns;
  if (!Array.isArray(columnsValue) || columnsValue.length > 4) throw new Error("columns must be an array with at most 4 entries.");
  const logoPath = stringField(input.logoPath, "logoPath", 500);
  if (logoPath && !/^\/objects\/[A-Za-z0-9._/-]+$/.test(logoPath)) throw new Error("logoPath must be empty or a valid /objects/... path.");
  const profile: EmailSignatureProfile = {
    group: group as EmailSignatureGroup, enabled: input.enabled,
    addressId: stringField(input.addressId, "addressId", 320),
    thankYouDe: stringField(input.thankYouDe, "thankYouDe", 1000), thankYouEn: stringField(input.thankYouEn, "thankYouEn", 1000),
    writerName: stringField(input.writerName, "writerName", 160), writerRoleDe: stringField(input.writerRoleDe, "writerRoleDe", 160),
    writerRoleEn: stringField(input.writerRoleEn, "writerRoleEn", 160), writerEmail: stringField(input.writerEmail, "writerEmail", 254),
    writerPhone: stringField(input.writerPhone, "writerPhone", 80), logoPath, columns: [],
  };
  if (profile.writerEmail && !EMAIL.test(profile.writerEmail)) throw new Error("writerEmail must be a valid email address.");
  profile.columns = columnsValue.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`columns[${index}] must be an object.`);
    const column = raw as Record<string, unknown>;
    return { id: stringField(column.id, `columns[${index}].id`, 80), titleDe: stringField(column.titleDe, `columns[${index}].titleDe`, 160), titleEn: stringField(column.titleEn, `columns[${index}].titleEn`, 160), bodyDe: stringField(column.bodyDe, `columns[${index}].bodyDe`, 1000), bodyEn: stringField(column.bodyEn, `columns[${index}].bodyEn`, 1000) };
  });
  if (new Set(profile.columns.map(c => c.id)).size !== profile.columns.length) throw new Error("Column ids must be unique.");
  return profile;
}
export async function getEmailSignatureProfile(group: EmailSignatureGroup): Promise<EmailSignatureProfile | null> {
  try {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, KEY(group)));
    if (!row?.value) return null;
    return validateEmailSignatureProfile(JSON.parse(row.value), group);
  } catch (error) {
    logger.warn({ group, errorName: error instanceof Error ? error.name : "UnknownError" }, "Unable to load usable email signature profile");
    return null;
  }
}
export async function saveEmailSignatureProfile(profile: EmailSignatureProfile): Promise<void> {
  await db.insert(settingsTable).values({ key: KEY(profile.group), value: JSON.stringify(profile) })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify(profile), updatedAt: new Date() } });
}
function parseAddress(raw: string): { email: string; displayName: string } | null {
  const match = raw.trim().match(/^(?:\s*"?([^"<]*)"?\s*<)?\s*([^\s<>"@]+@[^\s<>"@]+\.[^\s<>"@]+)\s*>?\s*$/);
  if (!match || !EMAIL.test(match[2])) return null;
  return { email: match[2].toLowerCase(), displayName: (match[1] || "").trim() };
}
const sourceWeight: Record<EmailAddressSource, number> = { smtp: 1, website_setting: 2, sally: 3, microsoft365: 4 };
export async function listEmailSignatureAddresses(): Promise<EmailAddressOption[]> {
  const rows = await db.select().from(settingsTable);
  const values = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const candidates: Array<[string, string | undefined, EmailAddressSource, "iroc" | "spirecut", string, string]> = [
    ["smtp_from", values.smtp_from || process.env.SMTP_FROM || "iROC GmbH <info@i-roc.de>", "smtp", "iroc", "SMTP-Absender", "SMTP sender"],
    ["smtp_user", !values.smtp_from ? (values.smtp_user || process.env.SMTP_USER) : undefined, "smtp", "iroc", "SMTP-Benutzer", "SMTP user"],
    ["iroc_announcement_from", values.iroc_announcement_from, "website_setting", "iroc", "iROC-Ankündigungen", "iROC announcements"],
    ["sally_from_email", values.sally_from_email, "sally", "iroc", "Sally CRM", "Sally CRM"],
    ["sp_contact_email_de", values.sp_contact_email_de || "Spirecut <info@spirecut.de>", "website_setting", "spirecut", "Spirecut Deutschland", "Spirecut Germany"],
    ["sp_contact_email_com", values.sp_contact_email_com || "Spirecut <info@spirecut.com>", "website_setting", "spirecut", "Spirecut International", "Spirecut international"],
  ];
  try {
    const { rows: mailboxes } = await pool.query<{ id: number; email: string; display_name: string | null }>("SELECT id, email, display_name FROM iroc_microsoft_mailboxes WHERE enabled = true");
    mailboxes.forEach(m => candidates.push([`microsoft365:${m.id}`, m.email, "microsoft365", "iroc", "Microsoft 365-Postfach", "Microsoft 365 mailbox"]));
  } catch (error) { logger.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Could not load Microsoft 365 signature addresses"); }
  const deduped = new Map<string, EmailAddressOption>();
  for (const [id, raw, source, brand, descriptionDe, descriptionEn] of candidates) {
    if (!raw) continue; const parsed = parseAddress(raw); if (!parsed) continue;
    const option = { id, email: parsed.email, displayName: parsed.displayName || parsed.email, descriptionDe, descriptionEn, brand, source };
    const existing = deduped.get(parsed.email);
    if (!existing || sourceWeight[source] > sourceWeight[existing.source]) deduped.set(parsed.email, option);
  }
  return [...deduped.values()].sort((a, b) => a.email.localeCompare(b.email));
}
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!); }
function emailTextHtml(value: string): string {
  return escapeHtml(value).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>");
}
const EMAIL_TEXT_STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#1f2937;";
const LEGAL_TEXT_STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:#4b5563;";
const RESPONSIVE_COLUMNS_STYLE = `<style type="text/css" data-iroc-email-signature-style="1">@media only screen and (max-width:600px){.iroc-signature-columns .iroc-signature-column{display:block!important;width:100%!important;padding:10px 0 0!important}.iroc-signature-columns .iroc-signature-column:first-child{padding-top:0!important}}</style>`;
function stripManaged(body: string): string {
  // The legal footer has its own marker. Remove it here so the custom block is
  // inserted *above* a freshly loaded legal footer at the final send boundary.
  return body
    .replace(new RegExp(`${START}[\\s\\S]*?${END}`, "g"), "")
    .replace(/\u2063[\s\S]*?\u2064/g, "")
    .trim();
}
function removeLegacyPersonalSignoff(body: string, group: EmailSignatureGroup): string {
  if (group === "sally") {
    return body.replace(/\n*(?:Mit freundlichen Grüßen,|Kind regards,)\n+[\s\S]*?\nSales Manager \| iROC GmbH(?:\n[^\n]+)?\s*$/gi, "").trim();
  }
  if (group === "tori") {
    return body.replace(/\n*(?:Mit freundlichen Grüßen,|Kind regards,)?\s*\n*Tori\s*[–-]\s*AI Operations Assistant,\s*(?:im Auftrag der|on behalf of) iROC GmbH\s*$/gi, "").trim();
  }
  return body;
}
function selectedText(profile: EmailSignatureProfile, language: EmailSignatureLanguage): string {
  const role = language === "de" ? profile.writerRoleDe : profile.writerRoleEn;
  const thanks = language === "de" ? profile.thankYouDe : profile.thankYouEn;
  const columns = profile.columns.map(c => `${language === "de" ? c.titleDe : c.titleEn}\n${language === "de" ? c.bodyDe : c.bodyEn}`).filter(Boolean);
  return [thanks, [profile.writerName, role, profile.writerEmail, profile.writerPhone].filter(Boolean).join("\n"), ...columns].filter(Boolean).join("\n\n");
}
export async function applyEmailSignature(body: string, group: EmailSignatureGroup, language: EmailSignatureLanguage, originalHtml?: string): Promise<{ text: string; html: string; from?: string; attachments: Array<{ filename: string; content: Buffer; contentType: string; cid: string }> }> {
  const profile = await getEmailSignatureProfile(group);
  const base = stripManaged(body);
  const cleanOriginalHtml = originalHtml
    ?.replace(/<style\b[^>]*data-iroc-email-signature-style="1"[^>]*>[\s\S]*?<\/style>/gi, "")
    ?.replace(/<div\b[^>]*data-iroc-email-signature="1"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div\b[^>]*data-iroc-legal-footer="1"[^>]*>[\s\S]*?<\/div>/gi, "")
    .trim();
  if (!profile?.enabled) {
    const text = await appendImpressumSignature(base, language);
    const legal = await buildImpressumSignature(language);
    const htmlBody = cleanOriginalHtml || `<div style="${EMAIL_TEXT_STYLE}">${emailTextHtml(base)}</div>`;
    return { text, html: `${htmlBody}<div data-iroc-legal-footer="1" style="margin-top:16px;${LEGAL_TEXT_STYLE}">${emailTextHtml(legal)}</div>`, attachments: [] };
  }
  const signature = selectedText(profile, language);
  const messageBody = removeLegacyPersonalSignoff(base, group);
  const textBeforeLegal = `${messageBody}${messageBody ? "\n\n" : ""}${START}${signature}${END}`;
  const text = await appendImpressumSignature(textBeforeLegal, language);
  let logoHtml = ""; const attachments: Array<{ filename: string; content: Buffer; contentType: string; cid: string }> = [];
  if (profile.logoPath) try {
    const storage = new ObjectStorageService(); const file = await storage.getObjectEntityFile(profile.logoPath); const response = await storage.downloadObject(file);
    if (!response.ok) throw new Error("Object download failed");
    const contentType = response.headers.get("content-type") || "image/png";
    const content = Buffer.from(await response.arrayBuffer());
    validateEmailSignatureLogo(content, contentType);
    const cid = `email-signature-${group}@iroc`;
    attachments.push({ filename: "signature-logo", content, contentType, cid });
    logoHtml = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding:12px 0 0"><img src="cid:${cid}" alt="Company logo" width="180" style="display:block;width:180px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none"></td></tr></table>`;
  } catch (error) { logger.warn({ group, errorName: error instanceof Error ? error.name : "UnknownError" }, "Could not attach email signature logo"); }
  const role = language === "de" ? profile.writerRoleDe : profile.writerRoleEn;
  const usableColumns = profile.columns.filter(c => (language === "de" ? c.titleDe || c.bodyDe : c.titleEn || c.bodyEn));
  const columnWidth = usableColumns.length ? `${(100 / usableColumns.length).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}%` : "";
  const cols = usableColumns.map(c => {
    const title = language === "de" ? c.titleDe : c.titleEn;
    const columnBody = language === "de" ? c.bodyDe : c.bodyEn;
    return `<td class="iroc-signature-column" width="${columnWidth}" style="width:${columnWidth};vertical-align:top;padding:0 10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;color:#4b5563;word-break:break-word;overflow-wrap:anywhere"><strong style="color:#1f2937">${emailTextHtml(title)}</strong>${columnBody ? `<br>${emailTextHtml(columnBody)}` : ""}</td>`;
  }).join("");
  const legal = await buildImpressumSignature(language);
  const cleanHtml = cleanOriginalHtml || `<div style="${EMAIL_TEXT_STYLE}">${emailTextHtml(messageBody)}</div>`;
  const columnsHtml = cols ? `<table class="iroc-signature-columns" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed;margin-top:12px"><tr>${cols}</tr></table>` : "";
  const html = `${cleanHtml}${columnsHtml ? RESPONSIVE_COLUMNS_STYLE : ""}<div data-iroc-email-signature="1" style="margin-top:16px;${EMAIL_TEXT_STYLE}">${emailTextHtml(language === "de" ? profile.thankYouDe : profile.thankYouEn)}<br><br><strong>${emailTextHtml(profile.writerName)}</strong>${role ? `<br>${emailTextHtml(role)}` : ""}${profile.writerEmail ? `<br>${emailTextHtml(profile.writerEmail)}` : ""}${profile.writerPhone ? `<br>${emailTextHtml(profile.writerPhone)}` : ""}${logoHtml}${columnsHtml}</div><div data-iroc-legal-footer="1" style="margin-top:16px;${LEGAL_TEXT_STYLE}">${emailTextHtml(legal)}</div>`;
  const address = (await listEmailSignatureAddresses()).find(a => a.id === profile.addressId);
  return { text, html, from: address ? `${address.displayName} <${address.email}>` : undefined, attachments };
}
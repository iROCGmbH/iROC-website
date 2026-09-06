export type RecipientLanguage = "de" | "en";

import { pool } from "@workspace/db";

const GERMAN_COUNTRIES = new Set([
  "DE",
  "DEU",
  "GERMANY",
  "DEUTSCHLAND",
  "BUNDESREPUBLIK DEUTSCHLAND",
  "AT",
  "AUT",
  "AUSTRIA",
  "ÖSTERREICH",
  "OESTERREICH",
]);

function normalizeCountry(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ");
}

export function recipientLanguageForCountry(
  country: string | null | undefined,
): RecipientLanguage {
  return GERMAN_COUNTRIES.has(normalizeCountry(country)) ? "de" : "en";
}

/** Prompt context for supplier drafts; unknown countries deliberately use English. */
export function supplierReorderLanguageContext(
  country: string | null | undefined,
): string {
  const language = recipientLanguageForCountry(country);
  return [
    `Supplier Country: ${country?.trim() || "unknown"}`,
    `Required Email Language: ${language === "de" ? "German" : "English"}`,
  ].join("\n");
}

/**
 * Resolves an external recipient from the records that own their address data.
 * Sally's CRM copies deliberately do not carry country fields: importing that
 * data would make it stale and would require a second source of truth.  An
 * unknown country is intentionally English, never German.
 */
export async function resolveRecipientLanguage(opts: {
  email?: string | null;
  websiteCustomerId?: number | null;
  preferredSource?: "lead" | "doctor" | "customer";
}): Promise<RecipientLanguage> {
  const email = opts.email?.trim() ?? "";
  const websiteCustomerId = opts.websiteCustomerId ?? null;
  const preferredSource = opts.preferredSource ?? "customer";
  const { rows } = await pool.query<{ country: string | null }>(
    `SELECT country
       FROM (
          SELECT wc.country, 0 AS priority
           FROM website_customers wc
           WHERE $2::integer IS NOT NULL AND wc.id = $2
             AND NULLIF(btrim(wc.country), '') IS NOT NULL
         UNION ALL
          SELECT l.country,
                 CASE $3 WHEN 'lead' THEN 1 WHEN 'doctor' THEN 3 ELSE 2 END AS priority
           FROM iroc_leads l
          WHERE $1 <> '' AND lower(btrim(l.email)) = lower(btrim($1))
             AND NULLIF(btrim(l.country), '') IS NOT NULL
         UNION ALL
          SELECT d.country,
                 CASE $3 WHEN 'doctor' THEN 1 WHEN 'lead' THEN 3 ELSE 2 END AS priority
           FROM trained_doctors d
          WHERE $1 <> '' AND lower(btrim(d.email)) = lower(btrim($1))
             AND NULLIF(btrim(d.country), '') IS NOT NULL
         UNION ALL
          SELECT wc.country,
                 CASE $3 WHEN 'customer' THEN 1 ELSE 2 END AS priority
           FROM website_customers wc
          WHERE $1 <> '' AND lower(btrim(wc.email)) = lower(btrim($1))
             AND NULLIF(btrim(wc.country), '') IS NOT NULL
       ) recipient
      ORDER BY priority
      LIMIT 1`,
    [email, websiteCustomerId, preferredSource],
  );
  return recipientLanguageForCountry(rows[0]?.country);
}

/** Fail-closed guard for substantive AI-generated customer mail. */
export function contentMatchesRecipientLanguage(
  subject: string,
  body: string,
  required: RecipientLanguage,
): boolean {
  const score = (value: string) => {
    const normalized = ` ${value.toLowerCase().replace(/[^\p{L}]+/gu, " ")} `;
    const german = (normalized.match(/\b(der|die|das|und|für|ihre?n?|sie|mit|freundlichen|grüßen|bestellung|rechnung|frage|rückfrage|vielen|danke|bitte|senden|uns|vollständige|lieferadresse|angaben)\b/g) ?? []).length;
    const english = (normalized.match(/\b(the|and|your|you|please|kind|regards|thank|order|invoice|dear|with|message|inquiry|delivery|details|question)\b/g) ?? []).length;
    // Common foreign-language signals make the guard fail closed even if a
    // short subject happens to contain an English/German loanword.
    const foreign = (normalized.match(/\b(bonjour|merci|cordialement|veuillez|gracias|hola|saludos|grazie|buongiorno|cordiali)\b/g) ?? []).length;
    return { required: required === "de" ? german : english, other: required === "de" ? english : german, foreign };
  };
  const subjectScore = score(subject);
  const bodyScore = score(body);
  // Both fields are customer-visible.  A blank/neutral subject or body is not
  // enough proof of the required language, so it is rewritten or replaced.
  return subjectScore.required > 0 && bodyScore.required > 0
    && subjectScore.required >= subjectScore.other && bodyScore.required >= bodyScore.other
    && subjectScore.foreign === 0 && bodyScore.foreign === 0;
}
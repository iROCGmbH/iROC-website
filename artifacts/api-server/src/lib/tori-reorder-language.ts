import type { RecipientLanguage } from "./recipient-language.js";

export interface SupplierReorderDraft {
  to: string;
  subject: string;
  email_body_markdown: string;
}

type DetectedLanguage = RecipientLanguage | "mixed" | "unknown";

const GERMAN_MARKERS = /\b(sehr geehrt|mit freundlichen grüßen|bestellung|nachbestellung|bitte|wir möchten|unsere|ihre|vereinbart|preis|menge)\b/i;
const ENGLISH_MARKERS = /\b(dear|kind regards|best regards|reorder|order|please|we would like|our|your|agreed|price|quantity)\b/i;

export function detectSupplierReorderDraftLanguage(
  draft: Pick<SupplierReorderDraft, "subject" | "email_body_markdown">,
): DetectedLanguage {
  const text = `${draft.subject}\n${draft.email_body_markdown}`;
  const hasGerman = GERMAN_MARKERS.test(text);
  const hasEnglish = ENGLISH_MARKERS.test(text);
  if (hasGerman && hasEnglish) return "mixed";
  if (hasGerman) return "de";
  if (hasEnglish) return "en";
  return "unknown";
}

export function isSupplierReorderDraftInLanguage(
  draft: Pick<SupplierReorderDraft, "subject" | "email_body_markdown">,
  language: RecipientLanguage,
): boolean {
  return detectSupplierReorderDraftLanguage(draft) === language;
}

/**
 * Allows exactly one constrained model rewrite. A retry that is still
 * conflicting, bilingual, or undetectable is never queued: use the supplied,
 * deterministic language-safe draft instead.
 */
export async function enforceSupplierReorderDraftLanguage(
  initialDraft: SupplierReorderDraft,
  language: RecipientLanguage,
  rewrite: () => Promise<SupplierReorderDraft>,
  fallback: () => SupplierReorderDraft,
): Promise<{ draft: SupplierReorderDraft; retried: boolean; fallbackUsed: boolean }> {
  if (isSupplierReorderDraftInLanguage(initialDraft, language)) {
    return { draft: initialDraft, retried: false, fallbackUsed: false };
  }

  try {
    const rewritten = await rewrite();
    if (isSupplierReorderDraftInLanguage(rewritten, language)) {
      return { draft: rewritten, retried: true, fallbackUsed: false };
    }
  } catch {
    // The fallback retains the requested language even when rewrite fails.
  }
  return { draft: fallback(), retried: true, fallbackUsed: true };
}
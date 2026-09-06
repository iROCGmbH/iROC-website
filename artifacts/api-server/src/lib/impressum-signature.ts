import { pool } from "@workspace/db";
import { IROC_SEED } from "../data/iroc-seed";
import { logger } from "./logger";

export type ImpressumSignatureLanguage = "de" | "en";

const COMPANY_ADDRESS_KEY = "iroc.impressum.body_company_address";
const CONTACT_INFO_KEY = "iroc.impressum.body_contact_info";
const SIGNATURE_KEYS = [COMPANY_ADDRESS_KEY, CONTACT_INFO_KEY] as const;
// U+2063/U+2064 are invisible Unicode format characters. They make the
// generated footer machine-replaceable without showing marker text to email
// recipients in plain-text messages.
const MANAGED_SIGNATURE_START = "\u2063";
const MANAGED_SIGNATURE_END = "\u2064";

function normalizePlainText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function seedValue(key: string, language: ImpressumSignatureLanguage): string {
  const value = IROC_SEED.find((entry) => entry.key === key)?.[language];
  if (!value) {
    throw new Error(`Missing required iROC Impressum seed value for ${key}`);
  }
  return value;
}

/**
 * Builds the current iROC legal signature directly from page_content.
 *
 * This deliberately queries the database on every invocation: signatures in
 * transactional email must reflect CMS changes immediately and must not depend
 * on the website HTTP/cache layer.
 */
export async function buildImpressumSignature(
  language: ImpressumSignatureLanguage,
): Promise<string> {
  const column = language === "de" ? "de" : "en";
  const values = new Map<string, string>();

  try {
    const { rows } = await pool.query<{ key: string; value: string | null }>(
      `SELECT key, ${column} AS value
         FROM page_content
        WHERE site = $1
          AND key = ANY($2::text[])`,
      ["iroc", SIGNATURE_KEYS],
    );

    for (const row of rows) {
      const value = row.value?.trim();
      if (SIGNATURE_KEYS.includes(row.key as (typeof SIGNATURE_KEYS)[number]) && value) {
        values.set(row.key, value);
      }
    }
  } catch (error) {
    // Do not include a database error message here: connection errors can
    // contain sensitive connection details. The seed values keep mail usable.
    logger.warn(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Unable to load iROC Impressum signature content; using seed defaults",
    );
  }

  return SIGNATURE_KEYS
    .map((key) => normalizePlainText(values.get(key) || seedValue(key, language)))
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Adds the current legal signature once to a plain-text message body.
 * Repeated calls with the same CMS content are idempotent.
 */
export async function appendImpressumSignature(
  body: string,
  language: ImpressumSignatureLanguage,
): Promise<string> {
  const signature = await buildImpressumSignature(language);
  const managedSignature = `${MANAGED_SIGNATURE_START}${signature}${MANAGED_SIGNATURE_END}`;
  const withoutManagedFooter = normalizePlainText(body).replace(
    new RegExp(`${MANAGED_SIGNATURE_START}[\\s\\S]*?${MANAGED_SIGNATURE_END}`, "g"),
    "",
  );
  const normalizedBody = stripTrailingLegacyIrocFooter(withoutManagedFooter);

  if (!normalizedBody) {
    return managedSignature;
  }

  return `${normalizedBody}\n\n${managedSignature}`;
}

/**
 * Removes only an old, trailing pre-marker iROC legal footer. The contact
 * labels and a multi-line company/address block keep this deliberately narrow
 * so ordinary text that happens to mention iROC is never removed.
 */
function stripTrailingLegacyIrocFooter(body: string): string {
  // This is the exact pre-CMS footer used by the Leads email template. Keep
  // the historic Munich address and both bare contact lines in the match so a
  // personal sign-off mentioning iROC can never be mistaken for this footer.
  const previousLeadsFooter = body.match(
    /(?:^|\n\n)(?:[─-]+\n)?iROC GmbH\nLandsberger Straße 302\n80687 München\nTel:\s*[^\n]+\ninfo@i-roc\.de\nwww\.i-roc\.de$/i,
  );
  if (previousLeadsFooter) {
    return body.slice(0, previousLeadsFooter.index).trim();
  }

  const match = body.match(/(?:^|\n\n)(iROC GmbH\n[\s\S]*)$/i);
  if (!match) return body.trim();

  const footer = match[1];
  const firstContactLine = footer.search(/^(?:Telefon|Phone):/mi);
  const companyLines = footer
    .slice(0, firstContactLine < 0 ? 0 : firstContactLine)
    .split("\n")
    .filter((line) => line.trim());
  const isKnownLegalFooter =
    companyLines.length >= 2
    && /^(?:Telefon|Phone):/mi.test(footer)
    && /^Web:/mi.test(footer)
    && /^(?:E-Mail|E-mail):/mi.test(footer);

  if (!isKnownLegalFooter) return body.trim();
  return body.slice(0, match.index).trim();
}
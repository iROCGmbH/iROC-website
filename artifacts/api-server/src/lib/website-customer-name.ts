/**
 * Titles are stored separately from a website customer's name.  Keep this
 * boundary defensive because website customers can be created by several
 * admin and import flows, not just the customer form.
 */
export const KNOWN_TITLE_PREFIXES = [
  "professor dr. med.",
  "professor dr med.",
  "prof. dr. med.",
  "prof dr med.",
  "prof. dr med",
  "prof dr med",
  "professor dr.",
  "professor dr",
  "prof. dr.",
  "prof dr.",
  "prof. dr",
  "prof dr",
  "dr. med. dent.",
  "dr med. dent.",
  "dr. med dent.",
  "dr med dent.",
  "dr.-med.",
  "dr.-med",
  "dr. med.",
  "dr med.",
  "dr. med",
  "dr med",
  "dr.-ing.",
  "dr.-ing",
  "dr. ing.",
  "dr ing.",
  "dipl.-ing.",
  "dipl.-ing",
  "dipl. ing.",
  "dipl. ing",
  "professor.",
  "professor",
  "prof.",
  "prof",
  "magister.",
  "magister",
  "mag.",
  "mag",
  "ph.d.",
  "ph.d",
  "phd",
  "m.d.",
  "m.d",
  "md",
  "m.sc.",
  "m.sc",
  "msc",
  "b.sc.",
  "b.sc",
  "bsc",
  "dr.",
  "dr",
].sort((a, b) => b.length - a.length);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripWebsiteCustomerTitlePrefix(value: unknown, title: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return value as string;

  const candidates = [
    typeof title === "string" ? title.trim() : "",
    ...KNOWN_TITLE_PREFIXES,
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let remaining = value.trim();
  // Handle accidentally repeated prefixes such as "Dr. Dr. Sarah".
  for (let pass = 0; pass < 3 && remaining; pass++) {
    const match = candidates
      .map(prefix => remaining.match(new RegExp(`^${escapeRegExp(prefix)}(?:\\s+|$)`, "iu")))
      .find(Boolean);
    if (!match) break;
    remaining = remaining.slice(match[0].length).trim();
  }

  return remaining || null;
}

/**
 * Legacy iROC customers keep the full name in one field and the academic
 * title in another. Only remove a duplicated known prefix when that separate
 * title is populated; without it, the prefix is part of the stored name.
 */
export function stripLegacyCustomerTitlePrefix(value: string, title: string | null | undefined): string {
  if (!title?.trim()) return value.trim();
  return stripWebsiteCustomerTitlePrefix(value, title) ?? value.trim();
}

type KnownTitlePrefixMatch = {
  matchedText: string;
};

function canonicalizeTitle(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/\bprofessor\b/g, "prof")
    .replace(/\bmagister\b/g, "mag")
    .replace(/[\s.-]/g, "");
}

function findKnownTitlePrefix(value: string): KnownTitlePrefixMatch | null {
  const trimmed = value.trim();
  for (const prefix of KNOWN_TITLE_PREFIXES) {
    const match = trimmed.match(new RegExp(`^${escapeRegExp(prefix)}(?:\\s+|$)`, "iu"));
    if (match) {
      return {
        matchedText: match[0].trim(),
      };
    }
  }
  return null;
}

export type LegacyCustomerTitleCleanup = {
  status: "duplicate" | "ambiguous" | "unchanged";
  originalName: string;
  cleanedName: string;
  matchedPrefix: string | null;
};

/**
 * Classifies a legacy full name for the controlled title-cleanup operation.
 *
 * Unlike the normal edit path, this deliberately requires the detected prefix
 * to correspond to the separately stored title. A title-like prefix that does
 * not agree with the title is left untouched for manual review.
 */
export function analyzeLegacyCustomerTitleCleanup(
  value: string,
  title: string | null | undefined,
): LegacyCustomerTitleCleanup {
  const originalName = value;
  const trimmedName = value.trim();
  const separateTitle = title?.trim() ?? "";
  if (!separateTitle || !trimmedName) {
    return {
      status: "unchanged",
      originalName,
      cleanedName: trimmedName,
      matchedPrefix: null,
    };
  }

  const titleKey = canonicalizeTitle(separateTitle);
  const firstMatch = findKnownTitlePrefix(trimmedName);
  if (!firstMatch) {
    return {
      status: "unchanged",
      originalName,
      cleanedName: trimmedName,
      matchedPrefix: null,
    };
  }

  if (canonicalizeTitle(firstMatch.matchedText) !== titleKey) {
    return {
      status: "ambiguous",
      originalName,
      cleanedName: trimmedName,
      matchedPrefix: firstMatch.matchedText,
    };
  }

  let cleanedName = trimmedName;
  let removedPrefix = false;
  for (let pass = 0; pass < 3; pass++) {
    const match = findKnownTitlePrefix(cleanedName);
    if (!match || canonicalizeTitle(match.matchedText) !== titleKey) break;
    const remainder = cleanedName.slice(match.matchedText.length).trim();
    if (!remainder) {
      // Do not create an empty required name; this needs manual review.
      return {
        status: "ambiguous",
        originalName,
        cleanedName: trimmedName,
        matchedPrefix: firstMatch.matchedText,
      };
    }
    cleanedName = remainder;
    removedPrefix = true;
  }

  return {
    status: removedPrefix ? "duplicate" : "unchanged",
    originalName,
    cleanedName,
    matchedPrefix: removedPrefix ? firstMatch.matchedText : null,
  };
}

export function normalizeWebsiteCustomerNameFields(fields: {
  title?: unknown;
  firstName?: unknown;
  lastName?: unknown;
}): {
  firstName?: string | null;
  lastName?: string | null;
} {
  return {
    ...(fields.firstName !== undefined && {
      firstName: stripWebsiteCustomerTitlePrefix(fields.firstName, fields.title),
    }),
    ...(fields.lastName !== undefined && {
      lastName: stripWebsiteCustomerTitlePrefix(fields.lastName, fields.title),
    }),
  };
}
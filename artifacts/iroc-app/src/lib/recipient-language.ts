export type RecipientLanguage = "de" | "en";

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

export function recipientLanguageForCountry(
  country: string | null | undefined,
): RecipientLanguage {
  const normalized = String(country ?? "")
    .trim()
    .toUpperCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ");
  return GERMAN_COUNTRIES.has(normalized) ? "de" : "en";
}
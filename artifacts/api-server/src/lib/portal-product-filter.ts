/**
 * Cellenis is the renamed legacy "other" group. It and the legacy accessory
 * keys are available to doctors certified for either core instrument.
 */
const SHARED_PORTAL_PRODUCT_GROUP_KEYS = new Set([
  "cellenis",
  "other",
  "accessories",
]);

/** MiniStem has legacy certification and product-group aliases. */
const MINISTEM_ALIASES = new Set([
  "ministem",
  "jointechlabs",
  "svf",
]);

const PORTAL_CERTIFICATIONS = new Set([
  "spirecut",
  "ministem",
  "both",
]);

function normalizePortalProductInstrument(value: string): string {
  const normalizedValue = value.trim().toLowerCase();
  return MINISTEM_ALIASES.has(normalizedValue)
    ? "ministem"
    : normalizedValue;
}

/**
 * Uses the dedicated certification list when present, while keeping existing
 * portal tokens and historic customer rows (which only have `instrument`)
 * compatible. "both" and comma-separated legacy values expand to individual
 * certifications.
 */
export function getPortalCertifications(
  certifications: readonly string[] | null | undefined,
  instrument: string | null | undefined,
): string[] {
  const source = certifications && certifications.length > 0
    ? certifications
    : instrument ? [instrument] : [];

  return [...new Set(
    source
      .flatMap((value) => value.split(","))
      .map((value) => normalizePortalProductInstrument(value))
      .flatMap((value) => value === "both" ? ["spirecut", "ministem"] : [value])
      .filter(Boolean),
  )];
}

/**
 * Product groups are either tied to one instrument or explicitly shared.
 * "both" is the only certification that grants access to every group.
 */
export function isPortalProductGroupAllowed(
  groupKey: string,
  instrument: string,
): boolean {
  const normalizedGroupKey = normalizePortalProductInstrument(groupKey);
  const normalizedInstrument = normalizePortalProductInstrument(instrument);

  if (!PORTAL_CERTIFICATIONS.has(normalizedInstrument)) return false;

  return normalizedInstrument === "both" ||
    SHARED_PORTAL_PRODUCT_GROUP_KEYS.has(normalizedGroupKey) ||
    normalizedGroupKey === normalizedInstrument;
}

/** Returns true when any of a doctor's certifications grants the group. */
export function isPortalProductGroupAllowedForCertifications(
  groupKey: string,
  certifications: readonly string[] | null | undefined,
  instrument?: string | null,
): boolean {
  return getPortalCertifications(certifications, instrument)
    .some((certification) =>
      isPortalProductGroupAllowed(groupKey, certification),
    );
}
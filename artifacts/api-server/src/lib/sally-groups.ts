/**
 * Sally CRM — product-group taxonomy.
 *
 * iROC represents three brand groups:
 *  - spirecut   : Spirecut instruments (hand surgery)
 *  - ministem   : MiniStem / Jointechlabs (MFAT / SVF)
 *  - cellenis   : Cellenis / Estar Medical (PRP, PRF, Exosomes)
 *  - ""         : General / unknown
 *
 * The canonical group ID is stored in sally_leads.product_interest_group.
 * All email templates must use the label helpers below rather than the raw ID.
 */

export type ProductGroup = "spirecut" | "ministem" | "cellenis" | "";

/** All canonical group IDs in display order. */
export const PRODUCT_GROUPS: ProductGroup[] = ["spirecut", "ministem", "cellenis", ""];

// ── Keyword sets for auto-classification ─────────────────────────────────────

const SPIRECUT_KEYWORDS = [
  "hand surg", "handchirur", "hand chirur",
  "spirecut",
  "wrist", "handgelenk", "finger", "hand surgeon",
];

const MINISTEM_KEYWORDS = [
  "mfat", "svf", "micro fat", "mikrofett", "micro-fat",
  "stromal vascular", "stromal-vascular",
  "fat transfer", "fetttransfer", "fat graft",
  "ministem", "mini stem", "jointechlabs", "joint tech",
  "adipose", "fettgewebe",
  "stem cell", "stammzell",
];

const CELLENIS_KEYWORDS = [
  "prp", "prf",
  "platelet-rich", "platelet rich",
  "thrombozyten", "thrombo",
  "exosome", "exosom",
  "cellenis", "estar medical", "estar-medical",
  "regenerative", "regenerativ",
  "growth factor", "wachstumsfaktor",
];

/** Maps a free-text specialty string to a canonical ProductGroup. */
export function specialtyToProductGroup(specialty: string | null | undefined): ProductGroup {
  if (!specialty) return "";
  const s = specialty.toLowerCase();

  if (MINISTEM_KEYWORDS.some(k => s.includes(k))) return "ministem";
  if (CELLENIS_KEYWORDS.some(k => s.includes(k))) return "cellenis";
  if (SPIRECUT_KEYWORDS.some(k => s.includes(k))) return "spirecut";

  return "";
}

// ── Bilingual label helpers ───────────────────────────────────────────────────

/** Short display name used in iROC app UI dropdowns. */
export function groupDisplayLabel(group: ProductGroup): string {
  switch (group) {
    case "spirecut": return "Spirecut (Handchirurgie / Hand Surgery)";
    case "ministem": return "MiniStem / Jointechlabs (MFAT / SVF)";
    case "cellenis": return "Cellenis / Estar Medical (PRP, PRF, Exosomen)";
    default:         return "Allgemein / General";
  }
}

/**
 * German phrase used as the email topic noun phrase, e.g.
 * "Interesse an <gDe>" or "Schulung zu <gDe>".
 */
export function groupLabelDe(group: ProductGroup): string {
  switch (group) {
    case "spirecut": return "Spirecut – präzisen Instrumenten für die Handchirurgie";
    case "ministem": return "MiniStem und Jointechlabs – MFAT- und SVF-Technologien";
    case "cellenis": return "Cellenis und Estar Medical – regenerativen Produkten wie PRP, PRF und Exosomen";
    default:         return "unseren Produkten";
  }
}

/** English equivalent of groupLabelDe. */
export function groupLabelEn(group: ProductGroup): string {
  switch (group) {
    case "spirecut": return "Spirecut – precision instruments for hand surgery";
    case "ministem": return "MiniStem and Jointechlabs – MFAT and SVF technologies";
    case "cellenis": return "Cellenis and Estar Medical – regenerative products including PRP, PRF and Exosomes";
    default:         return "our products";
  }
}

/** German subject-line noun (shorter), e.g. "Information über <gDe>". */
export function groupSubjectDe(group: ProductGroup): string {
  switch (group) {
    case "spirecut": return "Spirecut (Handchirurgie)";
    case "ministem": return "MiniStem / Jointechlabs (MFAT / SVF)";
    case "cellenis": return "Cellenis / Estar Medical (PRP, PRF, Exosomen)";
    default:         return "iROC Produkte";
  }
}

/** English subject-line noun. */
export function groupSubjectEn(group: ProductGroup): string {
  switch (group) {
    case "spirecut": return "Spirecut (hand surgery)";
    case "ministem": return "MiniStem / Jointechlabs (MFAT / SVF)";
    case "cellenis": return "Cellenis / Estar Medical (PRP, PRF, Exosomes)";
    default:         return "iROC products";
  }
}

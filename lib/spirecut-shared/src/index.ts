/**
 * Shared postoperative-form constants for Spirecut.
 *
 * Single source of truth for enumerated field keys and their labels.
 * Imported by:
 *   - API server  (validation + default config)
 *   - Patient form (rendering options)
 *   - Admin panel  (label lookup)
 *
 * TypeScript enforces that every entry in a key array has a matching
 * entry in the corresponding label map — adding a new option to the
 * array without updating the maps is a compile-time error.
 */

/** Maximum size for a hero background image uploaded from the website admin. */
export const MAX_HERO_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

/** Client-safe message returned when a hero image exceeds the upload limit. */
export const HERO_IMAGE_SIZE_LIMIT_MESSAGE =
  "Hero image must be no larger than 10 MB. / Das Hero-Bild darf höchstens 10 MB groß sein.";

/** Client-safe message returned when a hero upload is not an image. */
export const HERO_IMAGE_CONTENT_TYPE_MESSAGE =
  "Only image files can be used as hero backgrounds. / Als Hero-Hintergrund können nur Bilddateien verwendet werden.";

// ── Procedures ────────────────────────────────────────────────────────────────

export const VALID_PROCEDURES = ["ct", "tf", "both"] as const;
export type ProcedureKey = (typeof VALID_PROCEDURES)[number];

/** German display labels for the admin panel. */
export const PROCEDURE_LABELS: Record<ProcedureKey, string> = {
  ct:   "Karpaltunnelsyndrom",
  tf:   "Schnappfinger (Triggerfinger)",
  both: "Beide",
};

/** i18n keys for the patient-facing form. */
export const PROCEDURE_I18N_KEYS: Record<ProcedureKey, string> = {
  ct:   "postop.procedureCT",
  tf:   "postop.procedureTF",
  both: "postop.procedureBoth",
};

// ── Gender ────────────────────────────────────────────────────────────────────

export const VALID_GENDERS = ["male", "female", "divers"] as const;
export type GenderKey = (typeof VALID_GENDERS)[number];

/** German display labels for the admin panel. */
export const GENDER_LABELS: Record<GenderKey, string> = {
  male:   "Männlich",
  female: "Weiblich",
  divers: "Divers",
};

/** i18n keys for the patient-facing form. */
export const GENDER_I18N_KEYS: Record<GenderKey, string> = {
  male:   "postop.genders.male",
  female: "postop.genders.female",
  divers: "postop.genders.divers",
};

// ── Occupation ────────────────────────────────────────────────────────────────

export const VALID_OCCUPATIONS = ["handworker", "office", "retired"] as const;
export type OccupationKey = (typeof VALID_OCCUPATIONS)[number];

/** German display labels for the admin panel. */
export const OCCUPATION_LABELS: Record<OccupationKey, string> = {
  handworker: "Handwerker/in",
  office:     "Bürotätigkeit",
  retired:    "Rentner/in",
};

/** i18n keys for the patient-facing form. */
export const OCCUPATION_I18N_KEYS: Record<OccupationKey, string> = {
  handworker: "postop.occupations.handworker",
  office:     "postop.occupations.office",
  retired:    "postop.occupations.retired",
};

// ── Diseases ──────────────────────────────────────────────────────────────────

export const VALID_DISEASES = [
  "diabetes",
  "cholesterol",
  "bloodpressure",
  "other_metabolic",
] as const;
export type DiseaseKey = (typeof VALID_DISEASES)[number];

/** German display labels for the admin panel. */
export const DISEASE_LABELS: Record<DiseaseKey, string> = {
  diabetes:        "Diabetes Mellitus",
  cholesterol:     "Hypercholesterinämie",
  bloodpressure:   "Bluthochdruck",
  other_metabolic: "Andere Stoffwechselerkr.",
};

/** i18n keys for the patient-facing form. */
export const DISEASE_I18N_KEYS: Record<DiseaseKey, string> = {
  diabetes:        "postop.diseases.diabetes",
  cholesterol:     "postop.diseases.cholesterol",
  bloodpressure:   "postop.diseases.bloodpressure",
  other_metabolic: "postop.diseases.other_metabolic",
};

// ── Dynamic form config ───────────────────────────────────────────────────────
// When the admin hasn't saved a custom config, the API returns null and
// both the patient form and admin panel fall back to DEFAULT_POSTOP_FORM_CONFIG.

/** A single selectable option in a dropdown or checkbox list. */
export type PostopFormOption = {
  /** Stored key — used as the value in DB. Never changes after creation. */
  key: string;
  /** German label shown on the patient form and in the admin panel. */
  labelDe: string;
  /** English label shown when lang === 'en'. */
  labelEn: string;
};

/** Complete configuration for the postoperative feedback form. */
export type PostopFormConfig = {
  /** Surgical procedure options shown in the required procedure dropdown. */
  procedures: PostopFormOption[];
  /** Age range strings shown in the optional age dropdown, e.g. "20–29". */
  ageRanges: string[];
  /** Gender options shown as radio buttons. */
  genders: PostopFormOption[];
  /** Occupation options shown in the occupation dropdown. */
  occupations: PostopFormOption[];
  /** Background disease checkboxes. */
  diseases: PostopFormOption[];
  /** Which optional question sections are rendered on the patient form. */
  visibleSections: {
    ageRange:   boolean;
    gender:     boolean;
    occupation: boolean;
    diseases:   boolean;
    experience: boolean;
    handPicker: boolean;
  };
};

/** Returns the current calendar month in the format used by the postop form. */
export function getCurrentPostopMonth(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Factory to get the built-in defaults. Always returns a fresh deep copy. */
export function getDefaultPostopFormConfig(): PostopFormConfig {
  return {
    procedures: [
      { key: "ct",   labelDe: "Karpaltunnelsyndrom",           labelEn: "Carpal Tunnel Syndrome" },
      { key: "tf",   labelDe: "Schnappfinger (Triggerfinger)", labelEn: "Trigger Finger" },
      { key: "both", labelDe: "Beide",                         labelEn: "Both" },
    ],
    ageRanges: ["20–29", "30–39", "40–49", "50–59", "60–69", "70+"],
    genders: [
      { key: "male",   labelDe: "Männlich", labelEn: "Male" },
      { key: "female", labelDe: "Weiblich", labelEn: "Female" },
      { key: "divers", labelDe: "Divers",   labelEn: "Non-binary / Other" },
    ],
    occupations: [
      { key: "handworker", labelDe: "Handwerker/in", labelEn: "Manual Worker" },
      { key: "office",     labelDe: "Bürotätigkeit", labelEn: "Office Work" },
      { key: "retired",    labelDe: "Rentner/in",    labelEn: "Retired" },
    ],
    diseases: [
      { key: "diabetes",        labelDe: "Diabetes Mellitus",         labelEn: "Diabetes Mellitus" },
      { key: "cholesterol",     labelDe: "Hypercholesterinämie",      labelEn: "Hypercholesterolaemia" },
      { key: "bloodpressure",   labelDe: "Bluthochdruck",             labelEn: "High Blood Pressure" },
      { key: "other_metabolic", labelDe: "Andere Stoffwechselerkr.",  labelEn: "Other Metabolic Disorder" },
    ],
    visibleSections: {
      ageRange:   true,
      gender:     true,
      occupation: true,
      diseases:   true,
      experience: true,
      handPicker: true,
    },
  };
}

/** Convenience constant — use `getDefaultPostopFormConfig()` when you need a mutable copy. */
export const DEFAULT_POSTOP_FORM_CONFIG: PostopFormConfig = getDefaultPostopFormConfig();

export * from "./chatbot";
export * from "./doctor-search";
export * from "./patient";
export * from "./payment-terms";

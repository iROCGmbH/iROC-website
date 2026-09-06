import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(amount: string | number) {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "€0.00";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(num);
}

/** Human-readable labels for every known invoice type, keyed by the raw DB value. */
export const INVOICE_TYPE_LABELS: Record<string, { de: string; en: string }> = {
  domestic:         { de: "Inland",             en: "Domestic" },
  eu:               { de: "EU",                 en: "EU" },
  export:           { de: "Export",             en: "Export" },
  noneu:            { de: "Nicht-EU",           en: "Non-EU" },
  "lecture-eu":     { de: "Vortrag EU",         en: "Lecture EU" },
  "lecture-noneu":  { de: "Vortrag Nicht-EU",   en: "Lecture Non-EU" },
};

/** Returns the localised label for an invoice type, or the raw value if unknown. */
export function getInvoiceTypeLabel(type: string | undefined | null, lang: "de" | "en"): string {
  if (!type) return "";
  return INVOICE_TYPE_LABELS[type]?.[lang] ?? type;
}

export function formatDate(dateString: string) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

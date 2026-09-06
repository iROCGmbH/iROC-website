/** Stable payment-term values shared by iROC invoice creation and rendering. */
export const PAYMENT_TERM_CODES = [
  "prepayment", "immediate", "net7", "net14", "net30", "net60", "custom",
] as const;
export type PaymentTermCode = (typeof PAYMENT_TERM_CODES)[number];
export type InvoiceLanguage = "de" | "en";

const days: Record<Exclude<PaymentTermCode, "custom">, number> = {
  prepayment: 0, immediate: 0, net7: 7, net14: 14, net30: 30, net60: 60,
};

export function normalizePaymentTermCode(value: string | null | undefined): PaymentTermCode {
  const key = value?.trim().toLowerCase().replace(/[\s_-]+/g, "") ?? "";
  if (key === "immediate" || /sofort|immediately/.test(key)) return "immediate";
  if (key === "net7" || /7tage|7days/.test(key)) return "net7";
  if (key === "net14" || /14tage|14days/.test(key)) return "net14";
  if (key === "net30" || /30tage|30days/.test(key)) return "net30";
  if (key === "net60" || /60tage|60days/.test(key)) return "net60";
  if (key === "custom" || /individ|custom/.test(key)) return "custom";
  return "prepayment";
}

function addDays(issueDate: string, numberOfDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(issueDate);
  if (!match) return issueDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + numberOfDays));
  return date.toISOString().slice(0, 10);
}

/** Validates a real calendar date without timezone conversion. */
export function isValidInvoiceDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function formatInvoiceDueDate(date: string, language: InvoiceLanguage): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  if (language === "de") return `${match[3]}.${match[2]}.${match[1]}`;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

export function resolvePaymentTerms(input: {
  issueDate: string;
  paymentTermCode?: string | null;
  paymentTerms?: string | null;
  dueDate?: string | null;
  language?: string | null;
}): { paymentTermCode: PaymentTermCode; dueDate: string; description: string } {
  const language: InvoiceLanguage = input.language === "en" ? "en" : "de";
  const explicitCode = input.paymentTermCode?.trim();
  const inferredCode = normalizePaymentTermCode(input.paymentTerms);
  // Never rewrite a persisted legacy deadline.  It is standard only where the
  // recognized/inferred term independently calculates to exactly that date.
  const paymentTermCode = !explicitCode && input.dueDate?.trim()
    ? (addDays(input.issueDate, days[inferredCode as Exclude<PaymentTermCode, "custom">] ?? 0) === input.dueDate
      ? inferredCode
      : "custom")
    : normalizePaymentTermCode(explicitCode ?? input.paymentTerms);
  const dueDate = paymentTermCode === "custom"
    ? input.dueDate ?? ""
    : addDays(input.issueDate, days[paymentTermCode as Exclude<PaymentTermCode, "custom">] ?? 0);
  const due = formatInvoiceDueDate(dueDate, language);
  const descriptions: Record<PaymentTermCode, Record<InvoiceLanguage, string>> = {
    prepayment: { de: `Vorkasse, rein netto ohne Abzug. Fällig am ${due}.`, en: `Payment in advance, net without deduction. Due on ${due}.` },
    immediate: { de: `Sofort fällig, rein netto ohne Abzug. Fällig am ${due}.`, en: `Due immediately, net without deduction. Due on ${due}.` },
    net7: { de: `Zahlbar innerhalb von 7 Tagen, rein netto ohne Abzug. Fällig am ${due}.`, en: `Payable within 7 days, net without deduction. Due on ${due}.` },
    net14: { de: `Zahlbar innerhalb von 14 Tagen, rein netto ohne Abzug. Fällig am ${due}.`, en: `Payable within 14 days, net without deduction. Due on ${due}.` },
    net30: { de: `Zahlbar innerhalb von 30 Tagen, rein netto ohne Abzug. Fällig am ${due}.`, en: `Payable within 30 days, net without deduction. Due on ${due}.` },
    net60: { de: `Zahlbar innerhalb von 60 Tagen, rein netto ohne Abzug. Fällig am ${due}.`, en: `Payable within 60 days, net without deduction. Due on ${due}.` },
    custom: { de: `Zahlbar rein netto ohne Abzug. Fällig am ${due}.`, en: `Payable net without deduction. Due on ${due}.` },
  };
  return { paymentTermCode, dueDate, description: descriptions[paymentTermCode][language] };
}
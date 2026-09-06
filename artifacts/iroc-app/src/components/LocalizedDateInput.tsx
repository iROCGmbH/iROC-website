import { formatInvoiceDueDate } from "@workspace/spirecut-shared";
import { Input } from "@/components/ui/input";

type InvoiceLanguage = "de" | "en";

interface LocalizedDateInputProps {
  value: string;
  onChange: (value: string) => void;
  language: InvoiceLanguage;
  required?: boolean;
  ariaLabel: string;
}

/**
 * Keeps the native ISO date input for form state and the shared calendar
 * provider, while showing the selected date in the invoice language instead
 * of the browser's locale.
 */
export function LocalizedDateInput({
  value,
  onChange,
  language,
  required = false,
  ariaLabel,
}: LocalizedDateInputProps) {
  const displayValue = value
    ? formatInvoiceDueDate(value, language)
    : language === "de"
      ? "TT.MM.JJJJ"
      : "MM/DD/YYYY";

  return (
    <div className="relative flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm">
      <span className={value ? "text-foreground" : "text-muted-foreground"} aria-hidden="true">
        {displayValue}
      </span>
      <Input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        aria-label={ariaLabel}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

type PickerType = "date" | "month";

type OpenPicker = {
  input: HTMLInputElement;
  type: PickerType;
  min: string;
  max: string;
  required: boolean;
  viewYear: number;
  viewMonth: number;
};

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  pointerEvents: "auto",
};

const panelStyle: CSSProperties = {
  position: "fixed",
  width: 304,
  maxWidth: "calc(100vw - 16px)",
  padding: 12,
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#ffffff",
  boxShadow: "0 18px 48px rgba(15, 23, 42, 0.22)",
  color: "#111827",
};

const navigationButtonStyle: CSSProperties = {
  width: 32,
  height: 32,
  border: 0,
  borderRadius: 8,
  background: "transparent",
  color: "#374151",
  cursor: "pointer",
  fontSize: 22,
  lineHeight: 1,
};

const actionButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: 8,
  padding: "7px 10px",
  background: "transparent",
  color: "#374151",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

function normalizeLanguage() {
  return document.documentElement.lang.toLowerCase().startsWith("de") ? "de" : "en";
}

function toIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toIsoMonth(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function readValue(type: PickerType, value: string) {
  const parts = value.split("-").map(Number);
  if (
    (type === "date" && (parts.length !== 3 || parts.some(Number.isNaN))) ||
    (type === "month" && (parts.length !== 2 || parts.some(Number.isNaN)))
  ) {
    return null;
  }

  const [year, month, day = 1] = parts;
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function isAllowed(value: string, min: string, max: string) {
  return (!min || value >= min) && (!max || value <= max);
}

function writeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function pickerPosition(input: HTMLInputElement) {
  const rect = input.getBoundingClientRect();
  return {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 312)),
    top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 360)),
  };
}

function controlsLanguageChange() {
  window.dispatchEvent(new Event("localized-date-picker-language-change"));
}

function stopPortalEventPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

/**
 * Replaces browser-controlled date/month popups with an explicit bilingual
 * picker. Existing native inputs remain in the form, so controlled state,
 * browser validation, react-hook-form registration, names, min/max, and
 * existing CSS continue to work without changing every individual form.
 */
export function LocalizedDatePickerProvider({ children }: { children: ReactNode }) {
  const [openPicker, setOpenPicker] = useState<OpenPicker | null>(null);

  const openFor = useCallback((input: HTMLInputElement) => {
    const type = input.type as PickerType;
    if ((type !== "date" && type !== "month") || input.disabled || input.readOnly) return;

    const valueDate = readValue(type, input.value) ?? new Date();
    setOpenPicker({
      input,
      type,
      min: input.min,
      max: input.max,
      required: input.required,
      viewYear: valueDate.getFullYear(),
      viewMonth: valueDate.getMonth(),
    });
  }, []);

  useEffect(() => {
    const findDateInput = (target: EventTarget | null) => {
      const element = target instanceof Element ? target.closest("input") : null;
      if (!(element instanceof HTMLInputElement)) return null;
      return element.type === "date" || element.type === "month" ? element : null;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const input = findDateInput(event.target);
      if (!input) return;
      event.preventDefault();
      input.focus({ preventScroll: true });
      openFor(input);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!["Enter", " ", "ArrowDown"].includes(event.key)) return;
      const input = findDateInput(event.target);
      if (!input) return;
      event.preventDefault();
      openFor(input);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [openFor]);

  return (
    <>
      {children}
      {openPicker && (
        <Picker
          picker={openPicker}
          onClose={() => setOpenPicker(null)}
          onChangeView={(viewYear, viewMonth) =>
            setOpenPicker((current) =>
              current ? { ...current, viewYear, viewMonth } : current,
            )
          }
        />
      )}
    </>
  );
}

function Picker({
  picker,
  onClose,
  onChangeView,
}: {
  picker: OpenPicker;
  onClose: () => void;
  onChangeView: (year: number, month: number) => void;
}) {
  const language = normalizeLanguage();
  const locale = language === "de" ? "de-DE" : "en-US";
  const selected = readValue(picker.type, picker.input.value);
  const position = pickerPosition(picker.input);
  const labels = language === "de"
    ? { today: "Heute", currentMonth: "Aktueller Monat", clear: "Löschen", previous: "Vorheriger Monat", next: "Nächster Monat" }
    : { today: "Today", currentMonth: "Current month", clear: "Clear", previous: "Previous month", next: "Next month" };

  const select = (value: string) => {
    if (!isAllowed(value, picker.min, picker.max)) return;
    writeInputValue(picker.input, value);
    onClose();
  };

  const updateMonth = (delta: number) => {
    const next = new Date(picker.viewYear, picker.viewMonth + delta, 1);
    onChangeView(next.getFullYear(), next.getMonth());
  };

  const clear = () => {
    writeInputValue(picker.input, "");
    onClose();
  };

  return createPortal(
    <div data-localized-date-picker style={overlayStyle} onPointerDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={picker.type === "month" ? labels.currentMonth : labels.today}
        style={{ ...panelStyle, left: position.left, top: position.top }}
        onPointerDown={stopPortalEventPropagation}
        onPointerUp={stopPortalEventPropagation}
        onMouseDown={stopPortalEventPropagation}
        onMouseUp={stopPortalEventPropagation}
        onTouchStart={stopPortalEventPropagation}
        onTouchEnd={stopPortalEventPropagation}
        onClick={stopPortalEventPropagation}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <button type="button" aria-label={labels.previous} style={navigationButtonStyle} onClick={() => updateMonth(picker.type === "month" ? -12 : -1)}>‹</button>
          <strong style={{ fontSize: 14 }}>
            {picker.type === "month"
              ? String(picker.viewYear)
              : new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(picker.viewYear, picker.viewMonth, 1))}
          </strong>
          <button type="button" aria-label={labels.next} style={navigationButtonStyle} onClick={() => updateMonth(picker.type === "month" ? 12 : 1)}>›</button>
        </div>

        {picker.type === "month" ? (
          <MonthGrid
            locale={locale}
            year={picker.viewYear}
            selected={selected}
            min={picker.min}
            max={picker.max}
            onSelect={select}
          />
        ) : (
          <DateGrid
            language={language}
            year={picker.viewYear}
            month={picker.viewMonth}
            selected={selected}
            min={picker.min}
            max={picker.max}
            onSelect={select}
          />
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #e5e7eb", marginTop: 10, paddingTop: 8 }}>
          <button
            type="button"
            style={actionButtonStyle}
            onClick={() => {
              const today = new Date();
              const value = picker.type === "month"
                ? toIsoMonth(today.getFullYear(), today.getMonth())
                : toIsoDate(today.getFullYear(), today.getMonth(), today.getDate());
              select(value);
            }}
          >
            {picker.type === "month" ? labels.currentMonth : labels.today}
          </button>
          <button type="button" style={actionButtonStyle} onClick={clear} disabled={picker.required && !picker.input.value}>
            {labels.clear}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MonthGrid({
  locale,
  year,
  selected,
  min,
  max,
  onSelect,
}: {
  locale: string;
  year: number;
  selected: Date | null;
  min: string;
  max: string;
  onSelect: (value: string) => void;
}) {
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(year, index, 1))),
    [locale, year],
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
      {months.map((label, month) => {
        const value = toIsoMonth(year, month);
        const isSelected = selected?.getFullYear() === year && selected.getMonth() === month;
        const disabled = !isAllowed(value, min, max);
        return (
          <button
            key={value}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(value)}
            style={{
              border: 0,
              borderRadius: 8,
              padding: "9px 5px",
              background: isSelected ? "#C41230" : "transparent",
              color: isSelected ? "#ffffff" : disabled ? "#9ca3af" : "#374151",
              cursor: disabled ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: isSelected ? 700 : 500,
              opacity: disabled ? 0.55 : 1,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function DateGrid({
  language,
  year,
  month,
  selected,
  min,
  max,
  onSelect,
}: {
  language: "de" | "en";
  year: number;
  month: number;
  selected: Date | null;
  min: string;
  max: string;
  onSelect: (value: string) => void;
}) {
  const weekStartsMonday = language === "de";
  const weekdays = weekStartsMonday
    ? ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
    : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const firstDay = new Date(year, month, 1).getDay();
  const offset = weekStartsMonday ? (firstDay + 6) % 7 : firstDay;
  const days = new Date(year, month + 1, 0).getDate();

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2, marginBottom: 3 }}>
        {weekdays.map((weekday) => (
          <span key={weekday} style={{ padding: "5px 0", color: "#6b7280", fontSize: 11, fontWeight: 700, textAlign: "center" }}>{weekday}</span>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2 }}>
        {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length: days }, (_, index) => {
          const day = index + 1;
          const value = toIsoDate(year, month, day);
          const isSelected = selected?.getFullYear() === year && selected.getMonth() === month && selected.getDate() === day;
          const disabled = !isAllowed(value, min, max);
          return (
            <button
              key={value}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(value)}
              style={{
                aspectRatio: "1",
                border: 0,
                borderRadius: 8,
                background: isSelected ? "#C41230" : "transparent",
                color: isSelected ? "#ffffff" : disabled ? "#9ca3af" : "#374151",
                cursor: disabled ? "not-allowed" : "pointer",
                fontSize: 13,
                fontWeight: isSelected ? 700 : 500,
                opacity: disabled ? 0.55 : 1,
              }}
            >
              {day}
            </button>
          );
        })}
      </div>
    </>
  );
}

export function notifyLocalizedDatePickerLanguageChanged() {
  if (typeof window !== "undefined") controlsLanguageChange();
}
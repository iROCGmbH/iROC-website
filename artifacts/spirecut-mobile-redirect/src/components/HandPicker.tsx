/**
 * HandPicker — SVG interactive hand diagram.
 * Shows left and right hand (palmar view). Each hand has 6 clickable zones:
 * thumb, index, middle, ring, little (finger), wrist.
 * Selected zones are highlighted in the primary brand colour.
 * Part IDs are prefixed with "left_" or "right_".
 */

import { useTranslation } from "react-i18next";

export const HAND_PART_KEYS = [
  { key: "thumb",  abbr: "D"  },
  { key: "index",  abbr: "Z"  },
  { key: "middle", abbr: "M"  },
  { key: "ring",   abbr: "R"  },
  { key: "little", abbr: "K"  },
  { key: "wrist",  abbr: "HG" },
] as const;

export type HandPartKey = typeof HAND_PART_KEYS[number]["key"];

// German fallback labels — used by handPartLabel (exported for Admin export/display)
const DE_LABELS: Record<string, string> = {
  thumb: "Daumen", index: "Zeigefinger", middle: "Mittelfinger",
  ring: "Ringfinger", little: "Kleiner Finger", wrist: "Handgelenk",
};

/** Returns a German label for a part id — compatible with Array.map(handPartLabel). */
export function handPartLabel(partId: string): string {
  const [side, ...rest] = partId.split("_");
  const key = rest.join("_") as HandPartKey;
  const sideLabel = side === "left" ? "Links" : "Rechts";
  const partLabel = DE_LABELS[key] ?? key;
  return `${sideLabel}: ${partLabel}`;
}

/** Returns a translated label for a part id (for use inside React components). */
export function handPartLabelT(partId: string, t: (key: string) => string): string {
  const [side, ...rest] = partId.split("_");
  const key = rest.join("_") as HandPartKey;
  return `${side === "left" ? t("hand.left") : t("hand.right")}: ${t(`hand.${key}`)}`;
}

// Keep HAND_PARTS for backward-compatibility (used by PostoperativeEntwicklung via handPartLabel)
export const HAND_PARTS = HAND_PART_KEYS.map(({ key, abbr }) => ({
  key,
  label: key, // will be translated at render time
  abbr,
}));

// ── Zone geometry ──────────────────────────────────────────────────────────────
// ViewBox: 0 0 120 240  (all dimensions in SVG units)
// labelX/Y = text anchor centre inside the zone (for the abbreviation badge)
interface Zone { key: HandPartKey; x: number; y: number; w: number; h: number; rx: number; abbr: string; lx: number; ly: number; }

// RIGHT hand — palmar view, thumb on viewer's LEFT (anatomically correct)
const RIGHT: Zone[] = [
  { key:"thumb",  x:  0, y:115, w:22, h: 65, rx:9, abbr:"D",  lx: 11, ly:136 },
  { key:"index",  x: 20, y: 20, w:20, h: 95, rx:8, abbr:"Z",  lx: 30, ly: 51 },
  { key:"middle", x: 42, y:  8, w:20, h:107, rx:8, abbr:"M",  lx: 52, ly: 43 },
  { key:"ring",   x: 65, y: 18, w:20, h: 97, rx:8, abbr:"R",  lx: 75, ly: 50 },
  { key:"little", x: 88, y: 33, w:20, h: 82, rx:8, abbr:"K",  lx: 98, ly: 60 },
  { key:"wrist",  x: 28, y:185, w:64, h: 50, rx:9, abbr:"HG", lx: 60, ly:210 },
];

// LEFT hand — palmar view, thumb on viewer's RIGHT (anatomically correct)
// x_left = 120 − x_right − w  (mirror in 120 px viewBox)
const LEFT: Zone[] = [
  { key:"little", x: 12, y: 33, w:20, h: 82, rx:8, abbr:"K",  lx: 22, ly: 60 },
  { key:"ring",   x: 35, y: 18, w:20, h: 97, rx:8, abbr:"R",  lx: 45, ly: 50 },
  { key:"middle", x: 58, y:  8, w:20, h:107, rx:8, abbr:"M",  lx: 68, ly: 43 },
  { key:"index",  x: 80, y: 20, w:20, h: 95, rx:8, abbr:"Z",  lx: 90, ly: 51 },
  { key:"thumb",  x: 98, y:115, w:22, h: 65, rx:9, abbr:"D",  lx:109, ly:136 },
  { key:"wrist",  x: 28, y:185, w:64, h: 50, rx:9, abbr:"HG", lx: 60, ly:210 },
];

// ── Single-hand SVG ────────────────────────────────────────────────────────────
function HandSVG({
  side, selected, onToggle,
}: {
  side: "left" | "right";
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const zones = side === "right" ? RIGHT : LEFT;
  const isOn = (key: string) => selected.includes(`${side}_${key}`);

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">
        {side === "left" ? t("hand.leftHand") : t("hand.rightHand")}
      </span>

      <svg
        viewBox="0 0 120 240"
        className="w-28 sm:w-32 h-auto select-none touch-manipulation"
        aria-label={side === "left" ? t("hand.leftHand") : t("hand.rightHand")}
      >
        {/* Palm background (non-interactive) */}
        <rect x="12" y="110" width="96" height="80" rx="16"
          fill="#f3f4f6" stroke="#e5e7eb" strokeWidth="1.5" />
        {/* Wrist-to-palm connector fill */}
        <rect x="28" y="180" width="64" height="10" fill="#f3f4f6" />

        {zones.map(({ key, x, y, w, h, rx, abbr, lx, ly }) => {
          const active = isOn(key);
          const id = `${side}_${key}`;
          return (
            <g
              key={key}
              onClick={() => onToggle(id)}
              style={{ cursor: "pointer" }}
              role="button"
              aria-pressed={active}
              aria-label={t(`hand.${key}`)}
            >
              {/* Hit area (slightly larger for touch) */}
              <rect x={x - 2} y={y - 2} width={w + 4} height={h + 4} rx={rx + 2} fill="transparent" />

              {/* Zone body */}
              <rect
                x={x} y={y} width={w} height={h} rx={rx}
                fill={active ? "#C41230" : "#e2e8f0"}
                stroke={active ? "#9b0f25" : "#cbd5e1"}
                strokeWidth={active ? 2 : 1.5}
                style={{ transition: "fill .15s, stroke .15s" }}
              />

              {/* Shine overlay when active */}
              {active && (
                <rect x={x} y={y} width={w} height={h * 0.45} rx={rx}
                  fill="white" opacity="0.12" style={{ pointerEvents: "none" }} />
              )}

              {/* Abbreviation label */}
              <text
                x={lx} y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={key === "wrist" ? 7 : 8}
                fontWeight="700"
                fontFamily="system-ui, -apple-system, sans-serif"
                fill={active ? "white" : "#64748b"}
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {abbr}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Public component ───────────────────────────────────────────────────────────
export interface HandPickerProps {
  selected: string[];            // e.g. ["left_thumb", "right_wrist"]
  onChange: (parts: string[]) => void;
}

export function HandPicker({ selected, onChange }: HandPickerProps) {
  const { t } = useTranslation();
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
        {HAND_PART_KEYS.map(({ abbr, key }) => (
          <span key={abbr} className="whitespace-nowrap">
            <span className="font-bold text-gray-700">{abbr}</span> = {t(`hand.${key}`)}
          </span>
        ))}
      </div>

      {/* Both hands */}
      <div className="flex gap-4 sm:gap-8 justify-center flex-wrap">
        <HandSVG side="left"  selected={selected} onToggle={toggle} />
        <HandSVG side="right" selected={selected} onToggle={toggle} />
      </div>

      {/* Selected-parts badges */}
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(id => (
            <span
              key={id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold"
            >
              {handPartLabelT(id, t)}
              <button
                type="button"
                onClick={() => toggle(id)}
                className="ml-0.5 leading-none hover:text-primary/60"
                aria-label={t("hand.remove")}
              >×</button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center">
          {t("hand.tapHint")}
        </p>
      )}
    </div>
  );
}

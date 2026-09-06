import { useState, useEffect } from "react";
import { usePostopFormConfig } from "@/hooks/use-postop-form-config";
import { getDefaultPostopFormConfig, type PostopFormConfig, type PostopFormOption } from "@workspace/spirecut-shared";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Save, Plus, Trash2, ChevronUp, ChevronDown, RotateCcw, Loader2 } from "lucide-react";

// ── Key slugifier ─────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// ── Section labels ─────────────────────────────────────────────────────────────

type OptionSection = "procedures" | "genders" | "occupations" | "diseases";

const SECTION_META: Record<OptionSection, { de: string; en: string; desc: string }> = {
  procedures:  { de: "Eingriffe",            en: "Procedures",          desc: "Surgical procedures shown in the required dropdown." },
  genders:     { de: "Geschlecht",           en: "Gender",              desc: "Gender options shown as radio buttons (optional)." },
  occupations: { de: "Berufsgruppen",        en: "Occupations",         desc: "Occupation options in the optional dropdown." },
  diseases:    { de: "Grunderkrankungen",    en: "Background Diseases", desc: "Pre-existing conditions shown as checkboxes (optional)." },
};

const VISIBLE_SECTION_META: Record<keyof PostopFormConfig["visibleSections"], { de: string; en: string }> = {
  ageRange:   { de: "Altersgruppe",                en: "Age Range" },
  gender:     { de: "Geschlecht",                  en: "Gender" },
  occupation: { de: "Berufsgruppe",                en: "Occupation" },
  diseases:   { de: "Grunderkrankungen",           en: "Background Diseases" },
  experience: { de: "Erfahrungsbericht / Zitat",   en: "Experience / Quote" },
  handPicker: { de: "Körperteil (Hand-Auswahl)",   en: "Operated Body Part (Hand Picker)" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function PostopFormEditor() {
  const { lang } = useLanguage();
  const { toast } = useToast();
  const { config: savedConfig, saveConfig } = usePostopFormConfig();

  const [local, setLocal] = useState<PostopFormConfig>(savedConfig);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty) setLocal(savedConfig);
  }, [savedConfig, dirty]);

  const update = (next: PostopFormConfig) => { setLocal(next); setDirty(true); };

  // ── Visible sections ────────────────────────────────────────────────────────

  const toggleVisible = (key: keyof PostopFormConfig["visibleSections"]) => {
    update({ ...local, visibleSections: { ...local.visibleSections, [key]: !local.visibleSections[key] } });
  };

  // ── Option list operations ──────────────────────────────────────────────────

  const moveOption = (section: OptionSection, idx: number, dir: -1 | 1) => {
    const arr = [...local[section]] as PostopFormOption[];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    update({ ...local, [section]: arr });
  };

  const updateOptionLabel = (section: OptionSection, idx: number, field: "labelDe" | "labelEn", value: string) => {
    const arr = (local[section] as PostopFormOption[]).map((o, i) =>
      i === idx ? { ...o, [field]: value } : o
    );
    update({ ...local, [section]: arr });
  };

  const deleteOption = (section: OptionSection, key: string) => {
    update({ ...local, [section]: (local[section] as PostopFormOption[]).filter(o => o.key !== key) });
  };

  const addOption = (section: OptionSection, opt: PostopFormOption) => {
    const existing = (local[section] as PostopFormOption[]).map(o => o.key);
    if (existing.includes(opt.key)) {
      toast({ variant: "destructive", title: lang === "de" ? `Schlüssel „${opt.key}" bereits vorhanden` : `Key "${opt.key}" already exists` });
      return false;
    }
    update({ ...local, [section]: [...(local[section] as PostopFormOption[]), opt] });
    return true;
  };

  // ── Age ranges ──────────────────────────────────────────────────────────────

  const moveAgeRange = (idx: number, dir: -1 | 1) => {
    const arr = [...local.ageRanges];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    update({ ...local, ageRanges: arr });
  };

  const deleteAgeRange = (idx: number) => {
    update({ ...local, ageRanges: local.ageRanges.filter((_, i) => i !== idx) });
  };

  const addAgeRange = (value: string): boolean => {
    if (!value.trim()) return false;
    if (local.ageRanges.includes(value.trim())) {
      toast({ variant: "destructive", title: lang === "de" ? "Wert bereits vorhanden" : "Value already exists" });
      return false;
    }
    update({ ...local, ageRanges: [...local.ageRanges, value.trim()] });
    return true;
  };

  // ── Save / reset ────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveConfig(local);
      setDirty(false);
      toast({ title: lang === "de" ? "Formular-Einstellungen gespeichert" : "Form settings saved" });
    } catch (err) {
      toast({ variant: "destructive", title: lang === "de" ? "Fehler beim Speichern" : "Save failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => { update(getDefaultPostopFormConfig()); };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {lang === "de"
            ? "Antwortoptionen für das Patientenformular verwalten. Änderungen gelten sofort nach dem Speichern."
            : "Manage answer options for the patient form. Changes take effect immediately after saving."}
        </p>
        <div className="flex gap-2 items-center shrink-0">
          <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" />
            {lang === "de" ? "Standard" : "Defaults"}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {lang === "de" ? "Speichern" : "Save"}
          </Button>
        </div>
      </div>

      {dirty && (
        <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
          ⚠ {lang === "de" ? "Ungespeicherte Änderungen" : "Unsaved changes"}
        </p>
      )}

      {/* Visible sections card */}
      <div className="border rounded-xl bg-card p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-sm">{lang === "de" ? "Sichtbare Fragen" : "Visible Questions"}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {lang === "de" ? "Optionale Fragen ein- oder ausblenden. Pflichtfelder (Eingriff, OP-Monat, Bewertung) können nicht ausgeblendet werden." : "Show or hide optional questions. Required fields (procedure, op-month, rating) cannot be hidden."}
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {(Object.keys(VISIBLE_SECTION_META) as (keyof PostopFormConfig["visibleSections"])[]).map(key => {
            const meta = VISIBLE_SECTION_META[key];
            const isOn = local.visibleSections[key];
            return (
              <label key={key} className="flex items-center gap-3 py-2 px-3 rounded-lg border bg-card cursor-pointer hover:bg-muted/40 transition-colors">
                <div
                  onClick={() => toggleVisible(key)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${isOn ? "bg-primary" : "bg-muted"}`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${isOn ? "translate-x-4" : "translate-x-0"}`} />
                </div>
                <span className="text-sm flex-1">{lang === "de" ? meta.de : meta.en}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Option list sections */}
      {(["procedures", "genders", "occupations", "diseases"] as OptionSection[]).map(section => (
        <OptionListCard
          key={section}
          section={section}
          lang={lang}
          items={local[section] as PostopFormOption[]}
          onMove={(idx, dir) => moveOption(section, idx, dir)}
          onUpdateLabel={(idx, field, val) => updateOptionLabel(section, idx, field, val)}
          onDelete={(key) => deleteOption(section, key)}
          onAdd={(opt) => addOption(section, opt)}
        />
      ))}

      {/* Age ranges card */}
      <AgeRangesCard
        lang={lang}
        items={local.ageRanges}
        onMove={moveAgeRange}
        onDelete={deleteAgeRange}
        onAdd={addAgeRange}
      />
    </div>
  );
}

// ── OptionListCard ─────────────────────────────────────────────────────────────

function OptionListCard({
  section, lang, items, onMove, onUpdateLabel, onDelete, onAdd,
}: {
  section: OptionSection;
  lang: string;
  items: PostopFormOption[];
  onMove: (idx: number, dir: -1 | 1) => void;
  onUpdateLabel: (idx: number, field: "labelDe" | "labelEn", value: string) => void;
  onDelete: (key: string) => void;
  onAdd: (opt: PostopFormOption) => boolean;
}) {
  const meta = SECTION_META[section];
  const [newDe, setNewDe] = useState("");
  const [newEn, setNewEn] = useState("");
  const [newKey, setNewKey] = useState("");

  const handleAdd = () => {
    if (!newDe.trim()) return;
    const key = newKey.trim() || slugify(newDe);
    if (!key) return;
    const ok = onAdd({ key, labelDe: newDe.trim(), labelEn: newEn.trim() || newDe.trim() });
    if (ok) { setNewDe(""); setNewEn(""); setNewKey(""); }
  };

  return (
    <div className="border rounded-xl bg-card overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 border-b flex items-center gap-2">
        <h3 className="font-semibold text-sm flex-1">{lang === "de" ? meta.de : meta.en}</h3>
        <Badge variant="secondary" className="text-xs tabular-nums">{items.length}</Badge>
      </div>

      {/* Items */}
      {items.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground italic">
          {lang === "de" ? "Keine Einträge." : "No entries."}
        </p>
      ) : (
        <div className="divide-y">
          {items.map((item, idx) => (
            <div key={item.key} className="flex items-center gap-2 px-3 py-2">
              {/* Reorder */}
              <div className="flex flex-col gap-0 shrink-0">
                <button onClick={() => onMove(idx, -1)} disabled={idx === 0} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25">
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onMove(idx, 1)} disabled={idx === items.length - 1} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              {/* Key */}
              <code className="text-xs bg-muted px-2 py-1 rounded font-mono text-muted-foreground shrink-0 max-w-[120px] truncate" title={item.key}>
                {item.key}
              </code>
              {/* Labels */}
              <Input
                value={item.labelDe}
                onChange={e => onUpdateLabel(idx, "labelDe", e.target.value)}
                className="h-7 text-sm flex-1 min-w-0"
                placeholder="DE"
                title="Label (Deutsch)"
              />
              <Input
                value={item.labelEn}
                onChange={e => onUpdateLabel(idx, "labelEn", e.target.value)}
                className="h-7 text-sm flex-1 min-w-0"
                placeholder="EN"
                title="Label (English)"
              />
              {/* Delete */}
              <button onClick={() => onDelete(item.key)} className="p-1.5 text-muted-foreground hover:text-destructive shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add row */}
      <div className="border-t px-3 py-3 bg-muted/10 space-y-2">
        <p className="text-xs text-muted-foreground font-medium">{lang === "de" ? "Neuer Eintrag" : "New entry"}</p>
        <div className="flex items-center gap-2">
          <Input
            value={newDe}
            onChange={e => { setNewDe(e.target.value); if (!newKey) setNewKey(slugify(e.target.value)); }}
            placeholder={lang === "de" ? "Label (DE) *" : "Label (DE) *"}
            className="h-7 text-sm flex-1 min-w-0"
          />
          <Input
            value={newEn}
            onChange={e => setNewEn(e.target.value)}
            placeholder="Label (EN)"
            className="h-7 text-sm flex-1 min-w-0"
          />
          <Input
            value={newKey}
            onChange={e => setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            placeholder="key"
            className="h-7 text-sm w-28 font-mono shrink-0"
            title={lang === "de" ? "Datenbankschlüssel (auto)" : "Database key (auto)"}
          />
          <Button size="sm" variant="outline" onClick={handleAdd} disabled={!newDe.trim()} className="h-7 gap-1 shrink-0">
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── AgeRangesCard ──────────────────────────────────────────────────────────────

function AgeRangesCard({
  lang, items, onMove, onDelete, onAdd,
}: {
  lang: string;
  items: string[];
  onMove: (idx: number, dir: -1 | 1) => void;
  onDelete: (idx: number) => void;
  onAdd: (value: string) => boolean;
}) {
  const [newVal, setNewVal] = useState("");

  const handleAdd = () => {
    const ok = onAdd(newVal);
    if (ok) setNewVal("");
  };

  return (
    <div className="border rounded-xl bg-card overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 border-b flex items-center gap-2">
        <h3 className="font-semibold text-sm flex-1">{lang === "de" ? "Altersgruppen" : "Age Ranges"}</h3>
        <Badge variant="secondary" className="text-xs tabular-nums">{items.length}</Badge>
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground italic">
          {lang === "de" ? "Keine Einträge." : "No entries."}
        </p>
      ) : (
        <div className="divide-y">
          {items.map((val, idx) => (
            <div key={idx} className="flex items-center gap-2 px-3 py-2">
              <div className="flex flex-col gap-0 shrink-0">
                <button onClick={() => onMove(idx, -1)} disabled={idx === 0} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25">
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onMove(idx, 1)} disabled={idx === items.length - 1} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <span className="flex-1 text-sm px-2">{val}</span>
              <button onClick={() => onDelete(idx)} className="p-1.5 text-muted-foreground hover:text-destructive shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="border-t px-3 py-3 bg-muted/10 space-y-2">
        <p className="text-xs text-muted-foreground font-medium">{lang === "de" ? "Neue Altersgruppe" : "New age range"}</p>
        <div className="flex items-center gap-2">
          <Input
            value={newVal}
            onChange={e => setNewVal(e.target.value)}
            placeholder={lang === "de" ? 'z. B. "75+"' : 'e.g. "75+"'}
            className="h-7 text-sm flex-1"
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
          />
          <Button size="sm" variant="outline" onClick={handleAdd} disabled={!newVal.trim()} className="h-7 gap-1 shrink-0">
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

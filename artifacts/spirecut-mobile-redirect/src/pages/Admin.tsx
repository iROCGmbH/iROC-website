import { useState, useRef, useEffect, useCallback } from "react";
import { invalidateSpirecutSettingsCache, toEmbedUrl } from "@/hooks/useSpirecutSettings";
import {
  Upload, CheckCircle, AlertCircle, LogOut, Image, Loader2,
  Trash2, Link2, Instagram, Youtube, Linkedin, TableProperties, Save, FileDown, Settings,
  EyeOff, Eye,
} from "lucide-react";
import * as XLSX from "xlsx";
import { invalidateMediaCache, HIDDEN_SENTINEL } from "@/hooks/useMedia";
import { handPartLabel } from "@/components/HandPicker";
import { invalidateSocialCache } from "@/hooks/useSocialLinks";
import { TikTokIcon, FacebookIcon } from "@/components/SocialIcons";
import {
  DISEASE_LABELS,
  PROCEDURE_LABELS,
  OCCUPATION_LABELS,
  GENDER_LABELS,
  type DiseaseKey,
  type GenderKey,
  type OccupationKey,
  type ProcedureKey,
} from "@workspace/spirecut-shared";

const BASE = import.meta.env.BASE_URL;

/** Returns true when value is empty (allowed) or a syntactically valid URL. */
function isValidOptionalUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

type SpKey = "sp_video_ct_url" | "sp_video_tf_url" | "sp_contact_email_de" | "sp_contact_email_com"
           | "sp_video_praktisch_1_url" | "sp_video_praktisch_2_url"
           | "sp_video_praktisch_1_title" | "sp_video_praktisch_2_title";
const SP_KEY_DEFAULTS: Record<SpKey, string> = {
  sp_video_ct_url:              "https://www.youtube.com/embed/jDStbSFduO8?rel=0",
  sp_video_tf_url:              "https://www.youtube.com/embed/QbOlsFMTbJo?rel=0",
  sp_contact_email_de:          "info@spirecut.de",
  sp_contact_email_com:         "info@spirecut.com",
  sp_video_praktisch_1_url:     "",
  sp_video_praktisch_2_url:     "",
  sp_video_praktisch_1_title:   "",
  sp_video_praktisch_2_title:   "",
};

// ── Media slots ───────────────────────────────────────────────────────────────
const MEDIA_SLOTS = [
  { key: "hero-home",     label: "Startseite – Hero-Bild",          description: "Hintergrundbild der Startseite",              fallback: `${BASE}spirecut-hero.jpg` },
  { key: "instrument-ct", label: "Karpaltunnel – Instrument",        description: "Produktbild CT-Sono-Instrument",              fallback: `${BASE}sono-instrument-ct.png` },
  { key: "instrument-tf", label: "Schnappfinger – Instrument",       description: "Produktbild TF-Sono-Instrument",              fallback: `${BASE}sono-instrument-tf.png` },
  { key: "hero-ct",       label: "Karpaltunnelsyndrom – Hero-Bild",  description: "Bild oben auf der Karpaltunnelsyndrom-Seite", fallback: `${BASE}kts-hero-a.jpg` },
  { key: "hero-tf",       label: "Schnappfinger – Hero-Bild",        description: "Bild oben auf der Schnappfinger-Seite",       fallback: `${BASE}tf-hero-a.jpg` },
];

type MediaMap = Record<string, string>;

function resolveUrl(key: string, media: MediaMap, fallback: string): string {
  const raw = media[key];
  if (!raw || raw === HIDDEN_SENTINEL) return fallback;
  if (raw.startsWith("/objects/")) return `/api/storage${raw}`;
  return raw;
}

// ── Social platforms ──────────────────────────────────────────────────────────
const SOCIAL_PLATFORMS = [
  { key: "instagram", label: "Instagram", Icon: ({ className }: { className?: string }) => <Instagram className={className} />, placeholder: "https://www.instagram.com/…" },
  { key: "youtube",   label: "YouTube",   Icon: ({ className }: { className?: string }) => <Youtube className={className} />,   placeholder: "https://www.youtube.com/…"   },
  { key: "linkedin",  label: "LinkedIn",  Icon: ({ className }: { className?: string }) => <Linkedin className={className} />,  placeholder: "https://www.linkedin.com/…"  },
  { key: "tiktok",    label: "TikTok",    Icon: TikTokIcon,                                                                     placeholder: "https://www.tiktok.com/…"    },
  { key: "facebook",  label: "Facebook",  Icon: FacebookIcon,                                                                   placeholder: "https://www.facebook.com/…"  },
];

// ── Postop types ──────────────────────────────────────────────────────────────

/** Tailwind colour classes for procedure badge chips. Extend when new procedures are added to VALID_PROCEDURES. */
const PROCEDURE_CHIP_COLORS: Record<ProcedureKey, string> = {
  ct:   "bg-blue-50 text-blue-700",
  tf:   "bg-green-50 text-green-700",
  both: "bg-purple-50 text-purple-700",
};

interface PostopRow {
  id: string;
  procedure: ProcedureKey;
  operationMonth: string;
  rating: number;
  ageRange?: string;
  gender?: string;
  occupation?: string;
  diseases?: string[];
  operatedParts?: string[];
  experience?: string;
  submittedAt: string;
}


// ─────────────────────────────────────────────────────────────────────────────
export default function Admin() {
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem("sp_admin_token"));
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [tab, setTab] = useState<"images" | "social" | "postop" | "settings">("images");
  const [lang, setLang] = useState<"de" | "en">("de");
  const t = useCallback((de: string, en: string) => lang === "de" ? de : en, [lang]);

  // Image state
  const [media, setMedia] = useState<MediaMap>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [uploadResult, setUploadResult] = useState<Record<string, "ok" | "error">>({});

  // Social state
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [socialEdits, setSocialEdits] = useState<Record<string, string>>({});
  const [socialSaving, setSocialSaving] = useState<Record<string, boolean>>({});
  const [socialResult, setSocialResult] = useState<Record<string, "ok" | "error">>({});
  const [socialUrlErrors, setSocialUrlErrors] = useState<Record<string, string>>({});

  // Postop state
  const [postopRows, setPostopRows] = useState<PostopRow[]>([]);
  const [postopLoading, setPostopLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  // Settings state — contact email (existing)
  const [contactEmail, setContactEmail] = useState("");
  const [contactEmailEdit, setContactEmailEdit] = useState("");
  const [contactEmailSaving, setContactEmailSaving] = useState(false);
  const [contactEmailResult, setContactEmailResult] = useState<"ok" | "error" | null>(null);
  // Settings state — new sp keys (video URLs + contact emails)
  const [spVals, setSpVals] = useState<Record<SpKey, string>>({ ...SP_KEY_DEFAULTS });
  const [spEdits, setSpEdits] = useState<Record<SpKey, string>>({ ...SP_KEY_DEFAULTS });
  const [spSaving, setSpSaving] = useState<Record<string, boolean>>({});
  const [spResult, setSpResult] = useState<Record<string, "ok" | "error" | null>>({});
  const [spUrlErrors, setSpUrlErrors] = useState<Record<string, string>>({});
  const SP_VIDEO_KEYS: SpKey[] = ["sp_video_ct_url", "sp_video_tf_url", "sp_video_praktisch_1_url", "sp_video_praktisch_2_url"];

  useEffect(() => {
    if (!token) return;
    fetch("/api/patient-media").then((r) => r.json()).then(setMedia).catch(() => {});
    fetch("/api/patient-social")
      .then((r) => r.json())
      .then((data: Record<string, string>) => { setSocials(data); setSocialEdits(data); })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (tab !== "postop" || !token) return;
    setPostopLoading(true);
    fetch("/api/admin/patient-postop", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json()).then(setPostopRows)
      .catch(() => {})
      .finally(() => setPostopLoading(false));
  }, [tab, token]);

  useEffect(() => {
    if (tab !== "settings" || !token) return;
    fetch("/api/admin/email-settings", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((rows: { key: string; email: string }[]) => {
        const found = rows.find((r) => r.key === "email_dest_contact");
        const val = found?.email ?? "";
        setContactEmail(val);
        setContactEmailEdit(val);
      })
      .catch(() => {});
    // Load sp settings (video URLs + contact emails)
    fetch("/api/patient-settings")
      .then((r) => r.ok ? r.json() : {})
      .then((data: Record<string, string>) => {
        setSpVals((s) => ({ ...s, ...data }));
        setSpEdits((s) => ({ ...s, ...data }));
      })
      .catch(() => {});
  }, [tab, token]);

  // ── Login ──────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true); setLoginError("");
    try {
      const res = await fetch("/api/admin/verify", { headers: { Authorization: `Bearer ${password}` } });
      if (res.ok) { sessionStorage.setItem("sp_admin_token", password); setToken(password); }
      else setLoginError(t("Falsches Passwort. Bitte versuchen Sie es erneut.", "Wrong password. Please try again."));
    } catch { setLoginError(t("Verbindungsfehler. Bitte prüfen Sie Ihre Verbindung.", "Connection error. Please check your connection.")); }
    finally { setLoginLoading(false); }
  };

  const handleLogout = () => { sessionStorage.removeItem("sp_admin_token"); setToken(null); };

  // ── Image upload ───────────────────────────────────────────────────────────
  const handleUpload = async (key: string, file: File) => {
    if (!token) return;
    setUploading((u) => ({ ...u, [key]: true }));
    setUploadResult((r) => { const n = { ...r }; delete n[key]; return n; });
    try {
      const { uploadURL, objectPath } = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      }).then((r) => { if (!r.ok) throw new Error(); return r.json(); });
      await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file })
        .then((r) => { if (!r.ok) throw new Error(); });
      await fetch("/api/admin/patient-media", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key, url: objectPath }),
      }).then((r) => { if (!r.ok) throw new Error(); });
      setMedia((m) => ({ ...m, [key]: objectPath }));
      invalidateMediaCache();
      setUploadResult((r) => ({ ...r, [key]: "ok" }));
    } catch { setUploadResult((r) => ({ ...r, [key]: "error" })); }
    finally { setUploading((u) => ({ ...u, [key]: false })); }
  };

  const handleDeleteMedia = async (key: string) => {
    if (!token) return;
    await fetch(`/api/admin/patient-media/${key}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    setMedia((m) => { const n = { ...m }; delete n[key]; return n; });
    invalidateMediaCache();
  };

  const handleHideMedia = async (key: string) => {
    if (!token) return;
    await fetch("/api/admin/patient-media", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ key, url: HIDDEN_SENTINEL }),
    });
    setMedia((m) => ({ ...m, [key]: HIDDEN_SENTINEL }));
    invalidateMediaCache();
  };

  // ── Social save ─────────────────────────────────────────────────────────────
  const handleSaveSocial = async (key: string) => {
    if (!token) return;
    const url = socialEdits[key]?.trim() ?? "";
    // Validate — empty is allowed (clears the link), but non-empty must be a valid URL
    if (!isValidOptionalUrl(url)) {
      setSocialUrlErrors((e) => ({ ...e, [key]: t("Ungültige URL – bitte eine vollständige URL eingeben (z. B. https://…)", "Invalid URL – please enter a full URL (e.g. https://…)") }));
      return;
    }
    setSocialUrlErrors((e) => { const n = { ...e }; delete n[key]; return n; });
    if (!url) return;
    setSocialSaving((s) => ({ ...s, [key]: true }));
    setSocialResult((r) => { const n = { ...r }; delete n[key]; return n; });
    try {
      await fetch("/api/admin/patient-social", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key, url }),
      }).then((r) => { if (!r.ok) throw new Error(); });
      setSocials((s) => ({ ...s, [key]: url }));
      invalidateSocialCache();
      setSocialResult((r) => ({ ...r, [key]: "ok" }));
    } catch { setSocialResult((r) => ({ ...r, [key]: "error" })); }
    finally { setSocialSaving((s) => ({ ...s, [key]: false })); }
  };

  // ── Postop delete ───────────────────────────────────────────────────────────
  const handleDeletePostop = async (id: string) => {
    if (!token) return;
    await fetch(`/api/admin/patient-postop/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    setPostopRows((rows) => rows.filter((r) => r.id !== id));
    setSelectedIds((s) => { const n = new Set(s); n.delete(id); return n; });
  };

  const handleDeleteSelected = async () => {
    if (!token || selectedIds.size === 0) return;
    await Promise.all(
      [...selectedIds].map((id) =>
        fetch(`/api/admin/patient-postop/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
      )
    );
    setPostopRows((rows) => rows.filter((r) => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
  };

  const handleDeleteAll = async () => {
    if (!token) return;
    await Promise.all(
      postopRows.map((row) =>
        fetch(`/api/admin/patient-postop/${row.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
      )
    );
    setPostopRows([]);
    setSelectedIds(new Set());
    setConfirmDeleteAll(false);
  };

  const toggleSelect = (id: string) =>
    setSelectedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleSelectAll = () =>
    setSelectedIds((s) => s.size === postopRows.length ? new Set() : new Set(postopRows.map((r) => r.id)));

  // ── Spirecut settings save (video URLs + contact emails) ───────────────────
  const handleSaveSpSetting = async (key: SpKey) => {
    if (!token) return;
    // Validate URL fields before sending
    if (SP_VIDEO_KEYS.includes(key)) {
      const v = spEdits[key]?.trim() ?? "";
      if (!isValidOptionalUrl(v)) {
        setSpUrlErrors((e) => ({ ...e, [key]: t("Ungültige URL – bitte eine vollständige URL eingeben (z. B. https://…)", "Invalid URL – please enter a full URL (e.g. https://…)") }));
        return;
      }
      // Reject non-YouTube URLs — toEmbedUrl returns "" for anything that isn't YouTube
      if (v && toEmbedUrl(v) === "") {
        setSpUrlErrors((e) => ({ ...e, [key]: t("Nur YouTube-Links werden unterstützt – bitte eine youtube.com- oder youtu.be-URL eingeben.", "Only YouTube links are supported – please enter a youtube.com or youtu.be URL.") }));
        return;
      }
      setSpUrlErrors((e) => { const n = { ...e }; delete n[key]; return n; });
    }
    setSpSaving((s) => ({ ...s, [key]: true }));
    setSpResult((r) => ({ ...r, [key]: null }));
    try {
      const res = await fetch("/api/admin/spirecut-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key, value: spEdits[key] }),
      });
      if (!res.ok) throw new Error();
      setSpVals((s) => ({ ...s, [key]: spEdits[key] }));
      invalidateSpirecutSettingsCache();
      setSpResult((r) => ({ ...r, [key]: "ok" }));
    } catch {
      setSpResult((r) => ({ ...r, [key]: "error" }));
    } finally {
      setSpSaving((s) => ({ ...s, [key]: false }));
    }
  };

  // ── Contact email save ──────────────────────────────────────────────────────
  const handleSaveContactEmail = async () => {
    if (!token) return;
    const email = contactEmailEdit.trim();
    setContactEmailSaving(true);
    setContactEmailResult(null);
    try {
      const res = await fetch("/api/admin/email-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key: "email_dest_contact", email }),
      });
      if (!res.ok) throw new Error();
      setContactEmail(email);
      setContactEmailResult("ok");
    } catch {
      setContactEmailResult("error");
    } finally {
      setContactEmailSaving(false);
    }
  };

  // ── Excel export ────────────────────────────────────────────────────────────
  const handleExportExcel = (scope: "selected" | "all" = "all") => {
    const source = scope === "selected" && selectedIds.size > 0
      ? postopRows.filter((r) => selectedIds.has(r.id))
      : postopRows;
    const rows = source.map((row) => ({
      "Eingangsdatum": new Date(row.submittedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }),
      "Eingangszeit": new Date(row.submittedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
      "Eingriff": PROCEDURE_LABELS[row.procedure] ?? row.procedure,
      "OP-Monat": row.operationMonth
        ? new Date(row.operationMonth + "T00:00:00Z").toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" })
        : "",
      "Bewertung (1–5)": row.rating,
      "Altersgruppe": row.ageRange ? `${row.ageRange} Jahre` : "",
      "Geschlecht": row.gender ? (GENDER_LABELS[row.gender as GenderKey] ?? row.gender) : "",
      "Berufliche Tätigkeit": row.occupation ? (OCCUPATION_LABELS[row.occupation as OccupationKey] ?? row.occupation) : "",
      "Operierte Bereiche": row.operatedParts && row.operatedParts.length > 0
        ? row.operatedParts.map(handPartLabel).join("; ")
        : "",
      "Vorerkrankungen": row.diseases && row.diseases.length > 0
        ? row.diseases.map((d) => DISEASE_LABELS[d as DiseaseKey] ?? d).join("; ")
        : "",
      "Erfahrungsbericht": row.experience ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    // Auto column widths
    const colWidths = Object.keys(rows[0] ?? {}).map((key) => ({
      wch: Math.max(key.length, ...rows.map((r) => String((r as Record<string,unknown>)[key] ?? "").length)) + 2,
    }));
    ws["!cols"] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Postoperative Daten");
    const date = new Date().toISOString().slice(0, 10);
    const suffix = scope === "selected" && selectedIds.size > 0 ? `-auswahl` : "";
    XLSX.writeFile(wb, `spirecut-postop-${date}${suffix}.xlsx`);
  };

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <img src={`${BASE}spirecut-logo-nobg.png`} alt="Spirecut" className="h-8 mx-auto mb-6 object-contain" />
            <h1 className="text-2xl font-bold text-gray-900 mb-1">{t("Medien-Administration", "Media Administration")}</h1>
            <p className="text-sm text-gray-500">{t("Bitte geben Sie das Admin-Passwort ein.", "Please enter the admin password.")}</p>
          </div>
          {/* Language toggle on login screen */}
          <div className="flex justify-center mb-6">
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs font-semibold">
              {(["de", "en"] as const).map((l) => (
                <button key={l} onClick={() => setLang(l)}
                  className={`px-3 py-1 rounded-md transition-colors ${lang === l ? "bg-white shadow text-gray-900" : "text-gray-400 hover:text-gray-600"}`}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={t("Passwort", "Password")} autoComplete="current-password" required autoFocus
              className="w-full border border-gray-300 rounded px-4 py-3 text-sm focus:outline-none focus:border-primary" />
            {loginError && (
              <p className="text-sm text-red-600 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" /> {loginError}
              </p>
            )}
            <button type="submit" disabled={loginLoading}
              className="w-full h-11 text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors rounded">
              {loginLoading ? t("Wird geprüft…", "Checking…") : t("Anmelden", "Sign in")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Admin panel ───────────────────────────────────────────────────────────
  return (
    <div className="bg-gray-50 min-h-[70vh]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={`${BASE}spirecut-logo-nobg.png`} alt="Spirecut" className="h-7 object-contain" />
            <span className="text-sm font-semibold text-gray-700">{t("Medien-Administration", "Media Administration")}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs font-semibold">
              {(["de", "en"] as const).map((l) => (
                <button key={l} onClick={() => setLang(l)}
                  className={`px-2.5 py-1 rounded-md transition-colors ${lang === l ? "bg-white shadow text-gray-900" : "text-gray-400 hover:text-gray-600"}`}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600 transition-colors">
              <LogOut className="h-4 w-4" /> {t("Abmelden", "Sign out")}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 overflow-x-auto">
        <div className="container mx-auto px-4 lg:px-8 flex gap-0 min-w-max sm:min-w-0">
          {([
            { id: "images",   label: t("Bilder", "Images"),                           Icon: Image           },
            { id: "social",   label: "Social Media",                                  Icon: Link2           },
            { id: "postop",   label: t("Postoperative Daten", "Postoperative Data"),  Icon: TableProperties },
            { id: "settings", label: t("Einstellungen", "Settings"),                  Icon: Settings        },
          ] as const).map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-5 py-4 text-sm font-medium border-b-2 transition-colors ${
                tab === id ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="container mx-auto px-4 lg:px-8 py-10">

        {/* ── Images ─────────────────────────────────────────────────────────── */}
        {tab === "images" && (
          <>
            <p className="text-sm text-gray-500 mb-8">{t("Laden Sie neue Bilder hoch um die Standardbilder zu ersetzen. Gelöschte Einstellungen verwenden automatisch das Standardbild.", "Upload new images to replace the defaults. Deleted settings automatically fall back to the default image.")}</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {MEDIA_SLOTS.map((slot) => (
                <MediaCard key={slot.key} slot={slot} t={t}
                  currentUrl={resolveUrl(slot.key, media, slot.fallback)}
                  hasOverride={!!media[slot.key] && media[slot.key] !== HIDDEN_SENTINEL}
                  isHidden={media[slot.key] === HIDDEN_SENTINEL}
                  isUploading={!!uploading[slot.key]}
                  result={uploadResult[slot.key]}
                  onUpload={(file) => handleUpload(slot.key, file)}
                  onDelete={() => handleDeleteMedia(slot.key)}
                  onHide={() => handleHideMedia(slot.key)}
                  onUnhide={() => handleDeleteMedia(slot.key)} />
              ))}
            </div>
          </>
        )}

        {/* ── Social Media ────────────────────────────────────────────────────── */}
        {tab === "social" && (
          <>
            <p className="text-sm text-gray-500 mb-8">{t("Passen Sie die Links der Social-Media-Icons in der oberen Navigationsleiste an.", "Update the links for the social media icons in the top navigation bar.")}</p>
            <div className="max-w-lg space-y-5">
              {SOCIAL_PLATFORMS.map(({ key, label, Icon, placeholder }) => (
                <div key={key} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <Icon className="h-5 w-5 text-gray-500" />
                    <span className="font-semibold text-gray-800 text-sm">{label}</span>
                  </div>
                  <div className="flex gap-2">
                    <input type="url"
                      value={socialEdits[key] ?? socials[key] ?? ""}
                      onChange={(e) => setSocialEdits((s) => ({ ...s, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className={`flex-1 border rounded px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-primary min-w-0 ${socialUrlErrors[key] ? "border-red-400" : "border-gray-300"}`} />
                    <button onClick={() => handleSaveSocial(key)} disabled={socialSaving[key]} title={t("Speichern", "Save")}
                      className="h-9 px-4 flex items-center gap-1.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors rounded shrink-0">
                      {socialSaving[key] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    </button>
                  </div>
                  {socialUrlErrors[key] && (
                    <p className="flex items-center gap-1 text-xs text-red-600 mt-2"><AlertCircle className="h-3.5 w-3.5" /> {socialUrlErrors[key]}</p>
                  )}
                  {!socialUrlErrors[key] && socialResult[key] === "ok" && (
                    <p className="flex items-center gap-1 text-xs text-green-600 mt-2"><CheckCircle className="h-3.5 w-3.5" /> {t("Gespeichert", "Saved")}</p>
                  )}
                  {!socialUrlErrors[key] && socialResult[key] === "error" && (
                    <p className="flex items-center gap-1 text-xs text-red-600 mt-2"><AlertCircle className="h-3.5 w-3.5" /> {t("Fehler beim Speichern", "Error saving")}</p>
                  )}
                  {socials[key] && (
                    <p className="text-xs text-gray-400 mt-2 truncate">
                      {t("Aktuell:", "Current:")} <a href={socials[key]} target="_blank" rel="noopener noreferrer" className="hover:text-primary">{socials[key]}</a>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Postop table ─────────────────────────────────────────────────────── */}
        {tab === "postop" && (
          <>
            <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-sm text-gray-500">{t("Anonym eingereichte postoperative Rückmeldungen von Patienten.", "Anonymously submitted postoperative patient feedback.")}</p>
                <span className="text-xs bg-gray-200 text-gray-600 px-2.5 py-1 rounded-full font-medium">{postopRows.length} {t("Einträge", "entries")}</span>
                {selectedIds.size > 0 && (
                  <span className="text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full font-semibold">{selectedIds.size} {t("ausgewählt", "selected")}</span>
                )}
              </div>
              {postopRows.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Export buttons */}
                  {selectedIds.size > 0 ? (
                    <>
                      <button onClick={() => handleExportExcel("selected")}
                        className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-primary border border-primary hover:bg-red-50 transition-colors rounded">
                        <FileDown className="h-3.5 w-3.5" /> Auswahl exportieren
                      </button>
                      <button onClick={() => handleExportExcel("all")}
                        className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-primary hover:bg-primary/90 transition-colors rounded">
                        <FileDown className="h-3.5 w-3.5" /> Alle exportieren
                      </button>
                    </>
                  ) : (
                    <button onClick={() => handleExportExcel("all")}
                      className="flex items-center gap-1.5 h-8 px-4 text-xs font-semibold text-white bg-primary hover:bg-primary/90 transition-colors rounded">
                      <FileDown className="h-3.5 w-3.5" /> Excel exportieren
                    </button>
                  )}
                  {/* Delete buttons */}
                  {selectedIds.size > 0 && (
                    <button onClick={handleDeleteSelected}
                      className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-red-600 border border-red-300 hover:bg-red-50 transition-colors rounded">
                      <Trash2 className="h-3.5 w-3.5" /> Auswahl löschen
                    </button>
                  )}
                  <button onClick={() => setConfirmDeleteAll(true)}
                    className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-red-600 border border-red-300 hover:bg-red-50 transition-colors rounded">
                    <Trash2 className="h-3.5 w-3.5" /> Alle löschen
                  </button>
                </div>
              )}
            </div>

            {/* Confirm delete-all dialog */}
            {confirmDeleteAll && (
              <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                <p className="text-sm text-red-700 font-medium">{t(`Alle ${postopRows.length} Einträge unwiderruflich löschen?`, `Permanently delete all ${postopRows.length} entries?`)}</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDeleteAll(false)}
                    className="h-8 px-4 text-xs font-semibold text-gray-600 border border-gray-300 hover:bg-gray-100 transition-colors rounded">
                    {t("Abbrechen", "Cancel")}
                  </button>
                  <button onClick={handleDeleteAll}
                    className="h-8 px-4 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors rounded">
                    {t("Ja, alle löschen", "Yes, delete all")}
                  </button>
                </div>
              </div>
            )}

            {postopLoading ? (
              <div className="flex items-center justify-center gap-2 text-gray-500 text-sm py-12">
                <Loader2 className="h-5 w-5 animate-spin" /> {t("Daten werden geladen…", "Loading data…")}
              </div>
            ) : postopRows.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-xl border border-gray-200">
                {t("Noch keine Einreichungen vorhanden.", "No submissions yet.")}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="px-4 py-3 w-8">
                          <input type="checkbox"
                            checked={postopRows.length > 0 && selectedIds.size === postopRows.length}
                            ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < postopRows.length; }}
                            onChange={toggleSelectAll}
                            className="w-3.5 h-3.5 accent-primary cursor-pointer" />
                        </th>
                        {[
                          t("Eingang", "Date"), t("Eingriff", "Procedure"), t("Operiert", "Operated"), t("OP-Monat", "Op Month"), t("Bewertung", "Rating"),
                          t("Altersgruppe", "Age Group"), t("Geschlecht", "Gender"), t("Beruf", "Occupation"), t("Vorerkrankungen", "Pre-conditions"), t("Erfahrung", "Experience"), ""
                        ].map((h) => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {postopRows.map((row) => (
                        <tr key={row.id} className={`transition-colors ${selectedIds.has(row.id) ? "bg-red-50/60" : "hover:bg-gray-50"}`}>
                          {/* Checkbox */}
                          <td className="px-4 py-3 w-8">
                            <input type="checkbox"
                              checked={selectedIds.has(row.id)}
                              onChange={() => toggleSelect(row.id)}
                              className="w-3.5 h-3.5 accent-primary cursor-pointer" />
                          </td>
                          {/* Date */}
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                            {new Date(row.submittedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
                            <span className="block text-gray-400">
                              {new Date(row.submittedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </td>
                          {/* Procedure */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PROCEDURE_CHIP_COLORS[row.procedure] ?? "bg-gray-100 text-gray-700"}`}>
                              {PROCEDURE_LABELS[row.procedure] ?? row.procedure}
                            </span>
                          </td>
                          {/* Operated parts */}
                          <td className="px-4 py-3 text-xs max-w-[160px]">
                            {row.operatedParts && row.operatedParts.length > 0 ? (
                              <div className="flex flex-col gap-0.5">
                                {row.operatedParts.map((p) => (
                                  <span key={p} className="inline-block bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap font-medium">
                                    {handPartLabel(p)}
                                  </span>
                                ))}
                              </div>
                            ) : <span className="text-gray-300">–</span>}
                          </td>
                          {/* OP month */}
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                            {row.operationMonth
                              ? new Date(row.operationMonth + "T00:00:00Z").toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" })
                              : "–"}
                          </td>
                          {/* Rating */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <RatingStars rating={row.rating} />
                          </td>
                          {/* Age */}
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                            {row.ageRange ? `${row.ageRange} J.` : <span className="text-gray-300">–</span>}
                          </td>
                          {/* Gender */}
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                            {row.gender ? GENDER_LABELS[row.gender as GenderKey] ?? row.gender : <span className="text-gray-300">–</span>}
                          </td>
                          {/* Occupation */}
                          <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                            {row.occupation ? OCCUPATION_LABELS[row.occupation as OccupationKey] ?? row.occupation : <span className="text-gray-300">–</span>}
                          </td>
                          {/* Diseases */}
                          <td className="px-4 py-3 text-gray-600 text-xs max-w-[180px]">
                            {row.diseases && row.diseases.length > 0
                              ? row.diseases.map((d) => (
                                <span key={d} className="inline-block bg-orange-50 text-orange-700 text-[10px] px-1.5 py-0.5 rounded mr-1 mb-1 whitespace-nowrap">
                                  {DISEASE_LABELS[d as DiseaseKey] ?? d}
                                </span>
                              ))
                              : <span className="text-gray-300">–</span>}
                          </td>
                          {/* Experience */}
                          <td className="px-4 py-3 text-gray-600 text-xs max-w-[160px]">
                            <p className="truncate">{row.experience || <span className="text-gray-300">–</span>}</p>
                          </td>
                          {/* Delete */}
                          <td className="px-4 py-3 whitespace-nowrap text-right">
                            <button onClick={() => handleDeletePostop(row.id)} title={t("Löschen", "Delete")}
                              className="text-gray-300 hover:text-red-500 transition-colors">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
        {/* ── Settings ──────────────────────────────────────────────────────────── */}
        {tab === "settings" && (
          <>
            <p className="text-sm text-gray-500 mb-8">{t("Konfigurieren Sie systemweite Einstellungen für die Patientenwebsite.", "Configure site-wide settings for the patient website.")}</p>
            <div className="max-w-lg space-y-6">

              {/* ── Video URL — CT ── */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Settings className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-semibold text-gray-800 text-sm">{t("Video – Karpaltunnelsyndrom", "Video – Carpal Tunnel Syndrome")}</span>
                </div>
                <p className="text-xs text-gray-400 mb-4">
                  {t('YouTube-Embed-URL für das CT-Erklärungsvideo auf der Seite \u201EWie es funktioniert\u201C.', 'YouTube embed URL for the CT explanation video on the \u201CHow It Works\u201D page.')}
                  {spVals.sp_video_ct_url && <span className="block mt-1 font-mono text-[10px] text-gray-500 truncate">{spVals.sp_video_ct_url}</span>}
                </p>
                <div className="flex gap-2">
                  <input type="url" value={spEdits.sp_video_ct_url ?? ""}
                    onChange={(e) => {
                      setSpEdits((s) => ({ ...s, sp_video_ct_url: e.target.value }));
                      setSpResult((r) => ({ ...r, sp_video_ct_url: null }));
                      setSpUrlErrors((er) => { const n = { ...er }; delete n.sp_video_ct_url; return n; });
                    }}
                    placeholder={SP_KEY_DEFAULTS.sp_video_ct_url}
                    className={`flex-1 border rounded px-3 py-2 text-sm font-mono text-gray-700 focus:outline-none focus:border-primary min-w-0 ${spUrlErrors.sp_video_ct_url ? "border-red-400" : "border-gray-300"}`} />
                  <button onClick={() => handleSaveSpSetting("sp_video_ct_url")} disabled={spSaving.sp_video_ct_url}
                    className="h-9 px-4 flex items-center gap-1.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors rounded shrink-0">
                    {spSaving.sp_video_ct_url ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </button>
                </div>
                {spUrlErrors.sp_video_ct_url && <p className="flex items-center gap-1 text-xs text-red-600 mt-2"><AlertCircle className="h-3.5 w-3.5" /> {spUrlErrors.sp_video_ct_url}</p>}
                {!spUrlErrors.sp_video_ct_url && spResult.sp_video_ct_url === "ok" && <p className="flex items-center gap-1 text-xs text-green-600 mt-2"><CheckCircle className="h-3.5 w-3.5" /> {t("Gespeichert", "Saved")}</p>}
                {!spUrlErrors.sp_video_ct_url && spResult.sp_video_ct_url === "error" && <p className="flex items-center gap-1 text-xs text-red-600 mt-2"><AlertCircle className="h-3.5 w-3.5" /> {t("Fehler", "Error")}</p>}
              </div>

              {/* ── Video URL — TF ── */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Settings className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-semibold text-gray-800 text-sm">{t("Video – Schnappfinger", "Video – Trigger Finger")}</span>
                </div>
                <p className="text-xs text-gray-400 mb-4">
                  {t('YouTube-Embed-URL für das TF-Erklärungsvideo auf der Seite \u201EWie es funktioniert\u201C.', 'YouTube embed URL for the TF explanation video on the \u201CHow It Works\u201D page.')}
                  {spVals.sp_video_tf_url && <span className="block mt-1 font-mono text-[10px] text-gray-500 truncate">{spVals.sp_video_tf_url}</span>}
                </p>
                <div className="flex gap-2">
                  <input type="url" value={spEdits.sp_video_tf_url ?? ""}
                    onChange={(e) => {
                      setSpEdits((s) => ({ ...s, sp_video_tf_url: e.target.value }));
                      setSpResult((r) => ({ ...r, sp_video_tf_url: null }));
                      setSpUrlErrors((er) => { const n = { ...er }; delete n.sp_video_tf_url; return n; });
                    }}
                    placeholder={SP_KEY_DEFAULTS.sp_video_tf_url}
                    className={`flex-1 border rounded px-3 py-2 text-sm font-mono text-gray-700 focus:outline-none focus:border-primary min-w-0 ${spUrlErrors.sp_video_tf_url ? "border-red-400" : "border-gray-300"}`} />
                  <button onClick={() => handleSaveSpSetting("sp_video_tf_url")} disabled={spSaving.sp_video_tf_url}
                    className="h-9 px-4 flex items-center gap-1.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors rounded shrink-0">
                    {spSaving.sp_video_tf_url ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </button>
                </div>
                {spUrlErrors.sp_video_tf_url && <p className="flex items-center gap-1 text-xs text-red-600 mt-2"><AlertCircle className="h-3.5 w-3.5" /> {spUrlErrors.sp_video_tf_url}</p>}
                {!spUrlErrors.sp_video_tf_url && spResult.sp_video_tf_url === "ok" && <p className="flex items-center gap-1 text-xs text-green-600 mt-2"><CheckCircle className="h-3.5 w-3.5" /> {t("Gespeichert", "Saved")}</p>}
                {!spUrlErrors.sp_video_tf_url && spResult.sp_video_tf_url === "error" && <p className="flex items-center gap-1 text-xs text-red-600 mt-2"><AlertCircle className="h-3.5 w-3.5" /> {t("Fehler", "Error")}</p>}
              </div>

              {/* ── Video 1 — Praktische Info ── */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-semibold text-gray-800 text-sm">{t("Video 1 – Praktische Informationen", "Video 1 – Practical Information")}</span>
                </div>
                {/* Title */}
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1">{t("Titel (wird über dem Video angezeigt)", "Title (shown above the video)")}</p>
                  <div className="flex gap-2">
                    <input type="text" value={spEdits.sp_video_praktisch_1_title ?? ""}
                      onChange={(e) => { setSpEdits((s) => ({ ...s, sp_video_praktisch_1_title: e.target.value })); setSpResult((r) => ({ ...r, sp_video_praktisch_1_title: null })); }}
                      placeholder={t("z. B. Karpaltunnelsyndrom – Eingriff", "e.g. Carpal Tunnel – Procedure")}
                      className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-primary min-w-0" />
                    <button onClick={() => handleSaveSpSetting("sp_video_praktisch_1_title")} disabled={spSaving.sp_video_praktisch_1_title}
                      className="h-9 px-4 flex items-center gap-1.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors rounded shrink-0">
                      {spSaving.sp_video_praktisch_1_title ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    </button>
                  </div>
                  {spResult.sp_video_praktisch_1_title === "ok" && <p className="flex items-center gap-1 text-xs text-green-600 mt-1"><CheckCircle className="h-3.5 w-3.5" /> {t("Gespeichert", "Saved")}</p>}
                  {spResult.sp_video_praktisch_1_title === "error" && <p className="flex items-center gap-1 text-xs text-red-600 mt-1"><AlertCircle className="h-3.5 w-3.5" /> {t("Fehler", "Error")}</p>}
                </div>
                {/* URL */}
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1">{t("YouTube-URL", "YouTube URL")}</p>
                  <div className="flex gap-2">
                    <input type="url" value={spEdits.sp_video_praktisch_1_url ?? ""}
                      onChange={(e) => { setSpEdits((s) => ({ ...s, sp_video_praktisch_1_url: e.target.value })); setSpResult((r) => ({ ...r, sp_video_praktisch_1_url: null })); setSpUrlErrors((er) => { const n = { ...er }; delete n.sp_video_praktisch_1_url; return n; }); }}
                      placeholder="https://www.youtube.com/embed/…"
                      className={`flex-1 border rounded px-3 py-2 text-sm font-mono text-gray-700 focus:outline-none focus:border-primary min-w-0 ${spUrlErrors.sp_video_praktisch_1_url ? "border-red-400" : "border-gray-300"}`} />
                    <button onClick={() => handleSaveSpSetting("sp_video_praktisch_1_url")} disabled={spSaving.sp_video_praktisch_1_url}
                      className="h-9 px-4 flex items-center gap-1.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors rounded shrink-0">
                      {spSaving.sp_video_praktisch_1_url ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    </button>
                  </div>
                  {spUrlErrors.sp_video_praktisch_1_url && <p className="flex items-center gap-1 text-xs text-red-600 mt-1"><AlertCircle className="h-3.5 w-3.5" /> {spUrlErrors.sp_video_praktisch_1_url}</p>}
                  {!spUrlErrors.sp_video_praktisch_1_url && spResult.sp_video_praktisch_1_url === "ok" && <p className="flex items-center gap-1 text-xs text-green-600 mt-1"><CheckCircle className="h-3.5 w-3.5" /> {t("Gespeichert", "Saved")}</p>}
                  {!spUrlErrors.sp_video_praktisch_1_url && spResult.sp_video_praktisch_1_url === "error" && <p className="flex items-center gap-1 text-xs text-red-600 mt-1"><AlertCircle className="h-3.5 w-3.5" /> {t("Fehler", "Error")}</p>}
                </div>
              </div>

              {/* ── Video 2 — Praktische Info ── */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-semibold text-gray-800 text-sm">{t("Video 2 – Praktische Informationen", "Video 2 – Practical Information")}</span>
                </div>
                {/* Title */}
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1">{t("Titel (wird über dem Video angezeigt)", "Title (shown above the video)")}</p>
                  <div className="flex gap-2">
                    <input type="text" value={spEdits.sp_video_praktisch_2_title ?? ""}
                      onChange={(e) => { setSpEdits((s) => ({ ...s, sp_video_praktisch_2_title: e.target.value })); setSpResult((r) => ({ ...r, sp_video_praktisch_2_title: null })); }}
                      placeholder={t("z. B. Schnappfinger – Eingriff", "e.g. Trigger Finger – Procedure")}
                      className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-primary min-w-0" />
                    <button onClick={() => handleSaveSpSetting("sp_video_praktisch_2_title")} disabled={spSaving.sp_video_praktisch_2_title}
                      className="h-9 px-4 flex items-center gap-1.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors rounded shrink-0">
                      {spSaving.sp_video_praktisch_2_title ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    </button>
                  </div>
                  {spResult.sp_video_praktisch_2_title === "ok" && <p className="flex items-center gap-1 text-xs text-green-600 mt-1"><CheckCircle className="h-3.5 w-3.5" /> {t("Gespeichert", "Saved")}</p>}
                  {spResult.sp_video_praktisch_2_title === "error" && <p className="flex items-center gap-1 text-xs text-red-600 mt-1"><AlertCircle className="h-3.5 w-3.5" /> {t("Fehler", "Error")}</p>}
                </div>
                {/* URL */}
                <div>
                  <p className="text-xs text-gray-500 font-medium mb-1">{t("YouTube-URL", "YouTube URL")}</p>
                  <div className="flex gap-2">
                    <input type="url" value={spEdits.sp_video_praktisch_2_url ?? ""}
                      onChange={(e) => { setSpEdits((s) => ({ ...s, sp_video_praktisch_2_url: e.target.value })); setSpResult((r) => ({ ...r, sp_video_praktisch_2_url: null })); setSpUrlErrors((er) => { const n = { ...er }; delete n.sp_video_praktisch_2_url; return n; }); }}
                      placeholder="https://www.youtube.com/embed/…"
                      className={`flex-1 border rounded px-3 py-2 text-sm font-mono text-gray-700 focus:outline-none focus:border-primary min-w-0 ${spUrlErrors.sp_video_praktisch_2_url ? "border-red-400" : "border-gray-300"}`} />
                    <button onClick={() => handleSaveSpSetting("sp_video_praktisch_2_url")} disabled={spSaving.sp_video_praktisch_2_url}
                      className="h-9 px-4 flex items-center gap-1.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors rounded shrink-0">
                      {spSaving.sp_video_praktisch_2_url ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    </button>
                  </div>
                  {spUrlErrors.sp_video_praktisch_2_url && <p className="flex items-center gap-1 text-xs text-red-600 mt-1"><AlertCircle className="h-3.5 w-3.5" /> {spUrlErrors.sp_video_praktisch_2_url}</p>}
                  {!spUrlErrors.sp_video_praktisch_2_url && spResult.sp_video_praktisch_2_url === "ok" && <p className="flex items-center gap-1 text-xs text-green-600 mt-1"><CheckCircle className="h-3.5 w-3.5" /> {t("Gespeichert", "Saved")}</p>}
                  {!spUrlErrors.sp_video_praktisch_2_url && spResult.sp_video_praktisch_2_url === "error" && <p className="flex items-center gap-1 text-xs text-red-600 mt-1"><AlertCircle className="h-3.5 w-3.5" /> {t("Fehler", "Error")}</p>}
                </div>
              </div>

              {/* ── Contact email — .de ── */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Settings className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-semibold text-gray-800 text-sm">{t("Kontakt-E-Mail (Spirecut .de)", "Contact Email (Spirecut .de)")}</span>
                </div>
                <p className="text-xs text-gray-400 mb-4">
                  {t("Angezeigte E-Mail-Adresse für Deutschland/Österreich in Footer und Kontaktseite.", "Displayed email address for Germany/Austria in footer and contact page.")}
                  {spVals.sp_contact_email_de && <span className="block mt-1 text-gray-600 font-medium">{spVals.sp_contact_email_de}</span>}
                </p>
                <div className="flex gap-2">
                  <input type="email" value={spEdits.sp_contact_email_de ?? ""}
                    onChange={(e) => { setSpEdits((s) => ({ ...s, sp_contact_email_de: e.target.value })); setSpResult((r) => ({ ...r, sp_contact_email_de: null })); }}
                    placeholder={SP_KEY_DEFAULTS.sp_contact_email_de}
                    className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-primary min-w-0" />
                  <button onClick={() => handleSaveSpSetting("sp_contact_email_de")} disabled={spSaving.sp_contact_email_de}
                    className="h-9 px-4 flex items-center gap-1.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors rounded shrink-0">
                    {spSaving.sp_contact_email_de ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </button>
                </div>
                {spResult.sp_contact_email_de === "ok" && <p className="flex items-center gap-1 text-xs text-green-600 mt-2"><CheckCircle className="h-3.5 w-3.5" /> {t("Gespeichert", "Saved")}</p>}
                {spResult.sp_contact_email_de === "error" && <p className="flex items-center gap-1 text-xs text-red-600 mt-2"><AlertCircle className="h-3.5 w-3.5" /> {t("Fehler", "Error")}</p>}
              </div>

              {/* ── Contact email — .com ── */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Settings className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-semibold text-gray-800 text-sm">{t("Kontakt-E-Mail (Spirecut .com)", "Contact Email (Spirecut .com)")}</span>
                </div>
                <p className="text-xs text-gray-400 mb-4">
                  {t("Angezeigte E-Mail-Adresse für internationale Anfragen in Footer und Kontaktseite.", "Displayed email address for international enquiries in footer and contact page.")}
                  {spVals.sp_contact_email_com && <span className="block mt-1 text-gray-600 font-medium">{spVals.sp_contact_email_com}</span>}
                </p>
                <div className="flex gap-2">
                  <input type="email" value={spEdits.sp_contact_email_com ?? ""}
                    onChange={(e) => { setSpEdits((s) => ({ ...s, sp_contact_email_com: e.target.value })); setSpResult((r) => ({ ...r, sp_contact_email_com: null })); }}
                    placeholder={SP_KEY_DEFAULTS.sp_contact_email_com}
                    className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-primary min-w-0" />
                  <button onClick={() => handleSaveSpSetting("sp_contact_email_com")} disabled={spSaving.sp_contact_email_com}
                    className="h-9 px-4 flex items-center gap-1.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors rounded shrink-0">
                    {spSaving.sp_contact_email_com ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </button>
                </div>
                {spResult.sp_contact_email_com === "ok" && <p className="flex items-center gap-1 text-xs text-green-600 mt-2"><CheckCircle className="h-3.5 w-3.5" /> {t("Gespeichert", "Saved")}</p>}
                {spResult.sp_contact_email_com === "error" && <p className="flex items-center gap-1 text-xs text-red-600 mt-2"><AlertCircle className="h-3.5 w-3.5" /> {t("Fehler", "Error")}</p>}
              </div>

              {/* ── Contact form recipient email (existing) ── */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Settings className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-semibold text-gray-800 text-sm">{t("Kontaktformular – Empfänger-E-Mail", "Contact Form – Recipient Email")}</span>
                </div>
                <p className="text-xs text-gray-400 mb-4">
                  {t("Eingehende Nachrichten vom Kontaktformular werden an diese Adresse weitergeleitet.", "Incoming messages from the contact form are forwarded to this address.")}
                  {contactEmail && (
                    <span className="block mt-1">{t("Aktuell:", "Current:")} <span className="text-gray-600 font-medium">{contactEmail}</span></span>
                  )}
                </p>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={contactEmailEdit}
                    onChange={(e) => { setContactEmailEdit(e.target.value); setContactEmailResult(null); }}
                    placeholder={t("empfaenger@beispiel.de", "recipient@example.com")}
                    className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-primary min-w-0"
                  />
                  <button
                    onClick={handleSaveContactEmail}
                    disabled={contactEmailSaving || !contactEmailEdit.trim()}
                    className="h-9 px-4 flex items-center gap-1.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors rounded shrink-0"
                  >
                    {contactEmailSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </button>
                </div>
                {contactEmailResult === "ok" && (
                  <p className="flex items-center gap-1 text-xs text-green-600 mt-2"><CheckCircle className="h-3.5 w-3.5" /> {t("Gespeichert", "Saved")}</p>
                )}
                {contactEmailResult === "error" && (
                  <p className="flex items-center gap-1 text-xs text-red-600 mt-2"><AlertCircle className="h-3.5 w-3.5" /> {t("Fehler beim Speichern", "Error saving")}</p>
                )}
              </div>

            </div>
          </>
        )}

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function RatingStars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} className={`h-3.5 w-3.5 ${n <= rating ? "text-amber-400" : "text-gray-200"}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
      <span className="ml-1 text-xs text-gray-500">{rating}/5</span>
    </div>
  );
}

interface MediaCardProps {
  slot: { key: string; label: string; description: string };
  t: (de: string, en: string) => string;
  currentUrl: string; hasOverride: boolean; isHidden: boolean; isUploading: boolean;
  result?: "ok" | "error";
  onUpload: (file: File) => void;
  onDelete: () => void;
  onHide: () => void;
  onUnhide: () => void;
}

function MediaCard({ slot, t, currentUrl, hasOverride, isHidden, isUploading, result, onUpload, onDelete, onHide, onUnhide }: MediaCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={`bg-white rounded-xl border overflow-hidden shadow-sm ${isHidden ? "border-gray-300 opacity-75" : "border-gray-200"}`}>
      {/* Preview */}
      <div className="aspect-video bg-gray-100 relative overflow-hidden">
        {isHidden ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gray-100">
            <EyeOff className="h-8 w-8 text-gray-300" />
            <span className="text-xs text-gray-400 font-medium">{t("Bild ausgeblendet", "Image hidden")}</span>
          </div>
        ) : (
          <img src={currentUrl} alt={slot.label} className="w-full h-full object-cover" />
        )}
        {/* Badge */}
        {isHidden && (
          <div className="absolute top-2 right-2 bg-gray-500 text-white text-xs px-2 py-0.5 rounded font-medium">{t("Ausgeblendet", "Hidden")}</div>
        )}
        {hasOverride && !isHidden && (
          <div className="absolute top-2 right-2 bg-primary text-white text-xs px-2 py-0.5 rounded font-medium">{t("Überschrieben", "Overridden")}</div>
        )}
      </div>

      <div className="p-5">
        <div className="flex items-start gap-2 mb-1">
          <Image className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-gray-900">{slot.label}</p>
            <p className="text-xs text-gray-400">{slot.description}</p>
          </div>
        </div>

        {result === "ok" && <p className="flex items-center gap-1 text-xs text-green-600 mt-3"><CheckCircle className="h-3.5 w-3.5" /> {t("Erfolgreich hochgeladen", "Uploaded successfully")}</p>}
        {result === "error" && <p className="flex items-center gap-1 text-xs text-red-600 mt-3"><AlertCircle className="h-3.5 w-3.5" /> {t("Fehler beim Hochladen", "Upload error")}</p>}

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <input ref={inputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />

          {/* Upload button — always available */}
          <button onClick={() => inputRef.current?.click()} disabled={isUploading}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 text-xs font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors rounded">
            {isUploading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("Lädt…", "Uploading…")}</> : <><Upload className="h-3.5 w-3.5" /> {t("Hochladen", "Upload")}</>}
          </button>

          {/* Hide / Unhide toggle */}
          {isHidden ? (
            <button onClick={onUnhide} title={t("Bild wieder einblenden", "Show image again")}
              className="h-9 px-3 flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded transition-colors shrink-0">
              <Eye className="h-3.5 w-3.5" /> {t("Einblenden", "Show")}
            </button>
          ) : (
            <button onClick={onHide} title={t("Bild auf der Website ausblenden", "Hide image on the website")}
              className="h-9 w-9 flex items-center justify-center text-gray-400 hover:text-gray-600 border border-gray-200 hover:border-gray-400 rounded transition-colors shrink-0">
              <EyeOff className="h-4 w-4" />
            </button>
          )}

          {/* Delete override (restore default) */}
          {hasOverride && !isHidden && (
            <button onClick={onDelete} title={t("Standard wiederherstellen", "Restore default")}
              className="h-9 w-9 flex items-center justify-center text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-200 rounded transition-colors shrink-0">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {isHidden && (
          <p className="text-xs text-gray-400 mt-3">
            {t('Dieses Bild wird auf der Website nicht angezeigt. Laden Sie ein neues Bild hoch oder klicken Sie auf \u201EEinblenden\u201C um das Standardbild wiederherzustellen.',
               'This image is not shown on the website. Upload a new image or click \u201CShow\u201D to restore the default.')}
          </p>
        )}
      </div>
    </div>
  );
}

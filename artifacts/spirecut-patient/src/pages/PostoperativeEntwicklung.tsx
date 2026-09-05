import { useState, useMemo, useEffect } from "react";
import { HandPicker } from "@/components/HandPicker";
import { useTranslation } from "react-i18next";
import {
  type PostopFormConfig,
  DEFAULT_POSTOP_FORM_CONFIG,
  getCurrentPostopMonth,
} from "@workspace/spirecut-shared";

// ── Stats types ───────────────────────────────────────────────────────────────

interface PostopStats {
  total: number;
  averageRating: number | null;
  ratingDistribution: Record<string, number>;
  byProcedure: Record<string, number>;
  quotes: Array<{ text: string; procedure: string; rating: number }>;
}

// ── Config fetch hook ─────────────────────────────────────────────────────────

function usePostopConfig(): PostopFormConfig {
  const [config, setConfig] = useState<PostopFormConfig>(DEFAULT_POSTOP_FORM_CONFIG);
  useEffect(() => {
    fetch("/api/patient-postop-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PostopFormConfig | null) => { if (data) setConfig(data); })
      .catch(() => {}); // fall back to built-in defaults
  }, []);
  return config;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PostoperativeEntwicklung() {
  const { t } = useTranslation();
  const config = usePostopConfig();
  const whyItems = t("postop.whyItems", { returnObjects: true }) as string[];

  return (
    <div className="flex flex-col w-full bg-white">
      {/* Stats section */}
      <StatsSection config={config} />

      <div className="container mx-auto px-4 lg:px-8 py-16 max-w-4xl">
        <h1 className="text-4xl font-bold text-gray-900 mb-3">{t("postop.title")}</h1>
        <div className="w-10 h-0.5 bg-primary mb-10" />

        <div className="grid lg:grid-cols-2 gap-12">
          <div>
            <p className="text-gray-600 leading-relaxed mb-5">{t("postop.para1")}</p>
            <p className="text-gray-600 leading-relaxed mb-5">{t("postop.para2")}</p>
            <p className="text-gray-600 leading-relaxed mb-8">{t("postop.para3")}</p>
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-6">
              <h3 className="font-bold text-gray-900 mb-3">{t("postop.whyTitle")}</h3>
              <ul className="space-y-2.5 text-sm text-gray-600">
                {whyItems.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <span className="text-primary font-bold shrink-0">·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <PostopForm config={config} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stats section ─────────────────────────────────────────────────────────────

function StatsSection({ config }: { config: PostopFormConfig }) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<PostopStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/patient-postop-stats")
      .then((r) => {
        if (!r.ok) throw new Error("non-ok");
        return r.json();
      })
      .then((data) => {
        if (
          data &&
          typeof data.total === "number" &&
          data.ratingDistribution &&
          typeof data.ratingDistribution === "object" &&
          data.byProcedure &&
          typeof data.byProcedure === "object" &&
          Array.isArray(data.quotes)
        ) {
          setStats(data as PostopStats);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!stats || stats.total < 5) return null;

  const maxDistCount = Math.max(...Object.values(stats.ratingDistribution));

  return (
    <div className="bg-gray-50 border-b border-gray-200">
      <div className="container mx-auto px-4 lg:px-8 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <p className="text-xs font-semibold tracking-widest text-primary uppercase mb-1">
            {t("postop.stats.eyebrow")}
          </p>
          <h2 className="text-2xl font-bold text-gray-900">{t("postop.stats.title")}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {t("postop.stats.basedOn", { count: stats.total })}
          </p>
        </div>

        {/* Key numbers */}
        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          {/* Average rating */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t("postop.stats.avgRating")}
            </p>
            <div className="flex items-end gap-2">
              <span className="text-4xl font-bold text-gray-900">
                {stats.averageRating?.toFixed(1) ?? "—"}
              </span>
              <span className="text-gray-400 text-lg mb-1">/ 5</span>
            </div>
            <StarRow rating={stats.averageRating ?? 0} />
          </div>

          {/* Submissions */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t("postop.stats.totalSubmissions")}
            </p>
            <span className="text-4xl font-bold text-gray-900">{stats.total}</span>
            <p className="text-sm text-gray-500 mt-1">{t("postop.stats.patientsFeedback")}</p>
          </div>

          {/* By procedure — driven by current config */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {t("postop.stats.byProcedure")}
            </p>
            <div className="space-y-1.5 mt-1">
              {config.procedures.map((proc) => (
                <div key={proc.key} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{proc.labelDe}</span>
                  <span className="font-semibold text-gray-900">{stats.byProcedure[proc.key] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Rating distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
            {t("postop.stats.ratingDist")}
          </p>
          <div className="space-y-2">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = stats.ratingDistribution[String(star)] ?? 0;
              const pct = maxDistCount > 0 ? (count / maxDistCount) * 100 : 0;
              return (
                <div key={star} className="flex items-center gap-3 text-sm">
                  <span className="text-gray-500 w-3 text-right shrink-0">{star}</span>
                  <StarIcon className="h-3.5 w-3.5 text-amber-400 shrink-0" filled />
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-gray-500 w-6 text-right shrink-0">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Quotes */}
        {stats.quotes.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
              {t("postop.stats.quotesTitle")}
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {stats.quotes.map((q, i) => {
                const procLabel = config.procedures.find(p => p.key === q.procedure)?.labelDe ?? q.procedure;
                return (
                  <blockquote key={i} className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-3">
                    <StarRow rating={q.rating} size="sm" />
                    <p className="text-sm text-gray-700 leading-relaxed italic">„{q.text}"</p>
                    <footer className="text-xs text-gray-400 mt-auto">
                      {procLabel} · {t("postop.stats.anonymousPatient")}
                    </footer>
                  </blockquote>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function StarIcon({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? 0 : 1.5}>
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  );
}

function StarRow({ rating, size = "md" }: { rating: number; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <div className="flex gap-0.5 mt-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} className={`${cls} ${n <= Math.round(rating) ? "text-amber-400" : "text-gray-200"}`} filled={n <= Math.round(rating)} />
      ))}
    </div>
  );
}

// ── Generate a simple arithmetic challenge: a + b where a ∈ [2,9], b ∈ [2,9]
function makeChallenge() {
  const a = Math.floor(Math.random() * 8) + 2;
  const b = Math.floor(Math.random() * 8) + 2;
  return { a, b, answer: a + b };
}

function PostopForm({ config }: { config: PostopFormConfig }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [captchaInput, setCaptchaInput] = useState("");
  const [captchaError, setCaptchaError] = useState(false);
  const challenge = useMemo(() => makeChallenge(), []);

  const [form, setForm] = useState({
    procedure: "",
    operationMonth: "",
    rating: 0,
    ageRange: "",
    gender: "",
    occupation: "",
    diseases: [] as string[],
    operatedParts: [] as string[],
    experience: "",
    shareQuote: false,
  });

  const toggleDisease = (value: string) => {
    setForm((f) => ({
      ...f,
      diseases: f.diseases.includes(value)
        ? f.diseases.filter((d) => d !== value)
        : [...f.diseases, value],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.procedure || !form.operationMonth || !form.rating) return;
    if (parseInt(captchaInput, 10) !== challenge.answer) {
      setCaptchaError(true);
      return;
    }
    setCaptchaError(false);
    setStatus("sending");
    try {
      const res = await fetch("/api/patient-postop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          procedure: form.procedure,
          operationMonth: form.operationMonth,
          rating: form.rating,
          ageRange: form.ageRange,
          gender: form.gender,
          occupation: form.occupation,
          diseases: form.diseases,
          operatedParts: form.operatedParts,
          experience: form.experience,
          shareQuote: form.shareQuote,
        }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div className="p-6 bg-green-50 border border-green-200 rounded-xl text-center">
        <p className="text-green-800 font-semibold">{t("postop.successTitle")}</p>
        <p className="text-green-700 text-sm mt-1">{t("postop.successMsg")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Procedure (required — always shown) */}
      <FormField label={t("postop.procedureLabel")} required>
        <select
          required
          value={form.procedure}
          onChange={(e) => setForm((f) => ({ ...f, procedure: e.target.value }))}
          className={selectCls}
        >
          <option value="">{t("postop.procedurePlaceholder")}</option>
          {config.procedures.map((proc) => (
            <option key={proc.key} value={proc.key}>{proc.labelDe}</option>
          ))}
        </select>
      </FormField>

      {/* Operated body parts — hand picker (optional, configurable) */}
      {config.visibleSections.handPicker && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            {t("postop.handLabel")}
            <span className="text-gray-400 font-normal ml-1">{t("postop.handOptional")}</span>
          </label>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <HandPicker
              selected={form.operatedParts}
              onChange={(parts) => setForm((f) => ({ ...f, operatedParts: parts }))}
            />
          </div>
        </div>
      )}

      {/* Operation month (required — always shown) */}
      <FormField label={t("postop.monthLabel")} required>
        <input
          type="month"
          required
          max={getCurrentPostopMonth()}
          value={form.operationMonth}
          onChange={(e) => setForm((f) => ({ ...f, operationMonth: e.target.value }))}
          className={inputCls}
        />
      </FormField>

      {/* Rating (required — always shown) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t("postop.ratingLabel")} <span className="text-red-500">*</span>{" "}
          <span className="text-gray-400 font-normal">{t("postop.ratingHint")}</span>
        </label>
        <div className="flex gap-4">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="flex flex-col items-center gap-1.5 cursor-pointer">
              <input
                type="radio" name="rating" value={n} required
                checked={form.rating === n}
                onChange={() => setForm((f) => ({ ...f, rating: n }))}
                className="accent-primary w-4 h-4"
              />
              <span className="text-sm text-gray-600">{n}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Divider before optional questions */}
      <div className="border-t border-gray-100 pt-2">
        <p className="text-xs text-gray-400 mb-4">{t("postop.optionalDivider")}</p>
      </div>

      {/* Age range (optional, configurable) */}
      {config.visibleSections.ageRange && config.ageRanges.length > 0 && (
        <FormField label={t("postop.ageLabel")}>
          <select
            value={form.ageRange}
            onChange={(e) => setForm((f) => ({ ...f, ageRange: e.target.value }))}
            className={selectCls}
          >
            <option value="">{t("postop.procedurePlaceholder")}</option>
            {config.ageRanges.map((r) => (
              <option key={r} value={r}>{r} {t("postop.ageSuffix")}</option>
            ))}
          </select>
        </FormField>
      )}

      {/* Gender (optional, configurable) */}
      {config.visibleSections.gender && config.genders.length > 0 && (
        <FormField label={t("postop.genderLabel")}>
          <div className="flex gap-4 flex-wrap">
            {config.genders.map(({ key, labelDe }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input
                  type="radio" name="gender" value={key}
                  checked={form.gender === key}
                  onChange={() => setForm((f) => ({ ...f, gender: key }))}
                  className="accent-primary w-4 h-4"
                />
                {labelDe}
              </label>
            ))}
          </div>
        </FormField>
      )}

      {/* Occupation (optional, configurable) */}
      {config.visibleSections.occupation && config.occupations.length > 0 && (
        <FormField label={t("postop.occupationLabel")}>
          <select
            value={form.occupation}
            onChange={(e) => setForm((f) => ({ ...f, occupation: e.target.value }))}
            className={selectCls}
          >
            <option value="">{t("postop.procedurePlaceholder")}</option>
            {config.occupations.map(({ key, labelDe }) => (
              <option key={key} value={key}>{labelDe}</option>
            ))}
          </select>
        </FormField>
      )}

      {/* Background diseases (optional, configurable) */}
      {config.visibleSections.diseases && config.diseases.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{t("postop.diseasesLabel")}</label>
          <div className="space-y-2.5">
            {config.diseases.map(({ key, labelDe }) => (
              <label key={key} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={form.diseases.includes(key)}
                  onChange={() => toggleDisease(key)}
                  className="accent-primary w-4 h-4 rounded"
                />
                <span className="text-sm text-gray-700 group-hover:text-primary transition-colors">{labelDe}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Experience text (optional, configurable) */}
      {config.visibleSections.experience && (
        <FormField label={t("postop.experienceLabel")} hint={t("postop.experienceHint")}>
          <textarea
            rows={4}
            value={form.experience}
            onChange={(e) => setForm((f) => ({ ...f, experience: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-primary resize-none"
            placeholder={t("postop.experiencePlaceholder")}
          />
        </FormField>
      )}

      {/* Consent to share as quote — only shown when experience text is filled */}
      {config.visibleSections.experience && form.experience.trim().length >= 20 && (
        <label className="flex items-start gap-3 cursor-pointer group rounded-xl border border-primary/20 bg-primary/5 p-4">
          <input
            type="checkbox"
            checked={form.shareQuote}
            onChange={(e) => setForm((f) => ({ ...f, shareQuote: e.target.checked }))}
            className="accent-primary w-4 h-4 mt-0.5 shrink-0 rounded"
          />
          <div>
            <span className="text-sm font-medium text-gray-800">{t("postop.shareQuoteLabel")}</span>
            <p className="text-xs text-gray-500 mt-0.5">{t("postop.shareQuoteHint")}</p>
          </div>
        </label>
      )}

      <p className="text-xs text-gray-400">{t("postop.privacyNote")}</p>

      {/* Human check */}
      <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
        <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <svg className="h-4 w-4 text-primary shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          {t("postop.captchaTitle")}
        </p>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 shrink-0">
            {t("postop.captchaLabel", { a: challenge.a, b: challenge.b }).split("<bold>")[0]}
            <span className="font-bold text-gray-900">{challenge.a} + {challenge.b}</span>
            {t("postop.captchaLabel", { a: challenge.a, b: challenge.b }).split("</bold>")[1]}
          </label>
          <input
            type="number" min="0" max="99"
            value={captchaInput}
            onChange={(e) => { setCaptchaInput(e.target.value); setCaptchaError(false); }}
            placeholder={t("postop.captchaPlaceholder")}
            className={`w-24 border rounded px-3 py-1.5 text-sm text-gray-700 focus:outline-none ${captchaError ? "border-red-400 bg-red-50 focus:border-red-400" : "border-gray-300 focus:border-primary"}`}
          />
        </div>
        {captchaError && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
            {t("postop.captchaError")}
          </p>
        )}
      </div>

      {status === "error" && (
        <p className="text-sm text-red-600">{t("postop.submitError")}</p>
      )}

      <button
        type="submit"
        disabled={status === "sending"}
        className="h-11 px-7 text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors rounded"
      >
        {status === "sending" ? t("postop.sending") : t("postop.submit")}
      </button>
    </form>
  );
}

const inputCls = "w-full border border-gray-300 rounded px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-primary";
const selectCls = `${inputCls} bg-white`;

function FormField({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {hint && <span className="text-gray-400 font-normal ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

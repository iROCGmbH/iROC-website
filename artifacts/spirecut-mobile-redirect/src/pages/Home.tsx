import { ArrowRight, CheckCircle2, MapPin, Stethoscope, MessageCircle, ChevronDown } from "lucide-react";
import { Link } from "wouter";
import { useMedia } from "@/hooks/useMedia";
import { useTranslation } from "react-i18next";
import { Fragment, useState, useEffect } from "react";

const BASE = import.meta.env.BASE_URL;

function renderInlineEmphasis(content: string) {
  return content.split(/(<strong>.*?<\/strong>)/g).map((part, index) => {
    const match = part.match(/^<strong>(.*?)<\/strong>$/);
    return match ? <strong key={index}>{match[1]}</strong> : <Fragment key={index}>{part}</Fragment>;
  });
}

export default function Home() {
  const { t } = useTranslation();
  const heroUrl = useMedia("hero-home", `${BASE}spirecut-hero.jpg`);
  const topInstrumentCtUrl = useMedia("instrument-ct-top", `${BASE}sono-instrument-ct.png`, "instrument-ct");
  const topInstrumentTfUrl = useMedia("instrument-tf-top", `${BASE}sono-instrument-tf.png`, "instrument-tf");
  const conditionInstrumentCtUrl = useMedia("instrument-ct-condition", `${BASE}sono-instrument-ct.png`, "instrument-ct");
  const conditionInstrumentTfUrl = useMedia("instrument-tf-condition", `${BASE}sono-instrument-tf.png`, "instrument-tf");

  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <section className="app-rise relative overflow-hidden px-4 py-7 sm:px-8 lg:px-12 lg:py-10">
        {/* Admin-configurable background image */}
        {heroUrl && (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-45"
              style={{ backgroundImage: `url(${heroUrl})` }}
            />
            {/* Gradient: solid white on left for text legibility → semi-transparent on right */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(196,18,48,.14),transparent_25%),radial-gradient(circle_at_10%_90%,rgba(61,135,119,.13),transparent_28%),linear-gradient(135deg,#f8f1e7_0%,#edf2ed_100%)]" />
          </>
        )}
        <div className="relative z-10 mx-auto max-w-[1400px] overflow-hidden rounded-[2rem] border border-[#e8ddd0] px-6 py-9 sm:px-10 sm:py-12 lg:px-14 lg:py-14">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_.72fr]">
            <div>
              <p className="mb-4 inline-flex rounded-full border border-[#d6e0d8] bg-[#f9fbf7]/80 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-[#53786c]">{t("appNav.patientArea")}</p>
              <h1 className="app-display text-4xl lg:text-6xl font-extrabold text-foreground leading-[1.06] tracking-[-.055em] mb-6">
                {t("home.heroTitle")}
              </h1>
              <p className="text-gray-600 leading-relaxed mb-5">{t("home.heroPara1")}</p>
              <p className="text-gray-600 leading-relaxed mb-5">{t("home.heroPara2")}</p>
              <p className="text-gray-600 leading-relaxed mb-8">{t("home.heroPara3")}</p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/praktische-informationen">
                    <span className="app-pressable inline-flex items-center gap-2 h-12 px-6 text-sm font-semibold bg-primary text-white shadow-[0_10px_24px_rgba(150,45,58,.2)] hover:bg-primary/90 transition-colors rounded-xl cursor-pointer">
                    {t("home.ctaPraktisch")} <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
                <Link href="/arzt-finden">
                    <span className="app-pressable inline-flex items-center gap-2 h-12 px-6 text-sm font-semibold text-foreground border border-[#d5c7b9] bg-[#fffaf4]/70 hover:bg-primary/5 transition-colors rounded-xl cursor-pointer">
                    <MapPin className="h-4 w-4" /> {t("home.ctaArzt")}
                  </span>
                </Link>
              </div>
              <FeedbackStrip />
            </div>

            {/* Instrument images — only rendered when not hidden via admin */}
            {(topInstrumentCtUrl !== null || topInstrumentTfUrl !== null) && (
              <div className="flex justify-center">
                <div className="flex gap-4 items-stretch">
                  {topInstrumentCtUrl !== null && (
                    <div className="bg-gray-50 rounded-2xl p-6 flex items-center justify-center shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                      <img
                        src={topInstrumentCtUrl}
                        alt={t("home.instrumentCtAlt")}
                        className="h-48 w-48 object-contain"
                      />
                    </div>
                  )}
                  {topInstrumentTfUrl !== null && (
                    <div className="bg-gray-50 rounded-2xl p-6 flex items-center justify-center shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                      <img
                        src={topInstrumentTfUrl}
                        alt={t("home.instrumentTfAlt")}
                        className="h-48 w-48 object-contain"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="app-rise-delay mx-auto grid w-full max-w-[1400px] gap-4 px-4 pb-10 sm:px-8 lg:grid-cols-[1.15fr_.85fr] lg:px-12">
        <div className="rounded-2xl border border-[#e7ddd1] bg-[#fffaf4] p-5 sm:p-6">
          <div className="mb-5 flex items-start justify-between">
            <div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-foreground/40">{t("home.dashboardOverview")}</p><h2 className="app-display mt-2 text-xl font-bold">{t("home.dashboardOverviewBody")}</h2></div>
            <Stethoscope className="h-5 w-5 text-[#557c70]" />
          </div>
          <Link href="/praktische-informationen"><span className="app-pressable flex cursor-pointer items-center gap-4 rounded-xl bg-[#f4eee5] p-3"><span className="flex h-11 w-11 items-center justify-center rounded-full border-4 border-[#9db8ab] text-xs font-bold text-[#53786c]">01</span><span className="text-sm"><b>{t("home.dashboardLearn")}</b><small className="mt-0.5 block text-foreground/50">{t("home.dashboardLearnBody")}</small></span><ArrowRight className="ml-auto h-4 w-4 text-primary" /></span></Link>
        </div>
        <div className="rounded-2xl bg-[#253a3d] p-5 text-[#f8f2e9] sm:p-6">
          <div className="mb-8 flex items-center justify-between"><MessageCircle className="h-5 w-5 text-[#e5b0aa]" /><span className="text-xs text-white/45">{t("home.dashboardAnytime")}</span></div>
          <h2 className="app-display text-xl font-bold">{t("home.dashboardPrompt")}</h2>
          <details className="group mt-5">
            <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-[#efb1aa] [&::-webkit-details-marker]:hidden">
              {t("home.dashboardExplore")}
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid gap-2 border-t border-white/15 pt-3">
              <Link href="/karpaltunnelsyndrom">
                <span className="app-pressable flex cursor-pointer items-center justify-between rounded-lg bg-white/10 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/15">
                  {t("home.ctTitle")}
                  <ArrowRight className="h-4 w-4 shrink-0 text-[#efb1aa]" />
                </span>
              </Link>
              <Link href="/schnappfinger">
                <span className="app-pressable flex cursor-pointer items-center justify-between rounded-lg bg-white/10 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/15">
                  {t("home.tfTitle")}
                  <ArrowRight className="h-4 w-4 shrink-0 text-[#efb1aa]" />
                </span>
              </Link>
            </div>
          </details>
        </div>
      </section>

      {/* What is percutaneous hand surgery */}
      <section className="py-16 bg-[#f4eee5] border-y border-[#e8ded2]">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-6">{t("home.whatTitle")}</h2>
              <p className="text-gray-600 leading-relaxed mb-4">{renderInlineEmphasis(t("home.whatPara1"))}</p>
              <p className="text-gray-600 leading-relaxed mb-4">{renderInlineEmphasis(t("home.whatPara2"))}</p>
              <p className="text-gray-600 leading-relaxed">{renderInlineEmphasis(t("home.whatPara3"))}</p>
            </div>
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-6">{t("home.advantagesTitle")}</h2>
              <ul className="space-y-3">
                {(t("home.advantages", { returnObjects: true }) as string[]).map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-gray-700 text-sm">{item}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 p-5 border border-primary/20 rounded-xl bg-primary/5">
                <p className="text-sm text-gray-600 italic">{t("home.quote")}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Two conditions */}
      <section className="py-16">
        <div className="container mx-auto px-4 lg:px-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-3 text-center">{t("home.conditionsTitle")}</h2>
          <div className="w-10 h-0.5 bg-primary mx-auto mb-12" />

          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            <div className="border border-gray-200 rounded-xl p-8 hover:border-primary/30 hover:shadow-sm transition-all group">
              {conditionInstrumentCtUrl !== null && (
                <div className="h-40 flex items-center justify-center mb-6 bg-gray-50 rounded-lg">
                  <img src={conditionInstrumentCtUrl} alt={t("home.ctInstrumentAlt")} className="h-32 object-contain" />
                </div>
              )}
              <h3 className="text-xl font-bold text-gray-900 mb-3">{t("home.ctTitle")}</h3>
              <p className="text-gray-500 text-sm mb-5 leading-relaxed">{t("home.ctDesc")}</p>
              <Link href="/karpaltunnelsyndrom">
                <span className="inline-flex items-center gap-1.5 text-primary font-semibold text-sm hover:gap-3 transition-all cursor-pointer">
                  {t("home.learnMore")} <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            </div>

            <div className="border border-gray-200 rounded-xl p-8 hover:border-primary/30 hover:shadow-sm transition-all group">
              {conditionInstrumentTfUrl !== null && (
                <div className="h-40 flex items-center justify-center mb-6 bg-gray-50 rounded-lg">
                  <img src={conditionInstrumentTfUrl} alt={t("home.tfInstrumentAlt")} className="h-32 object-contain" />
                </div>
              )}
              <h3 className="text-xl font-bold text-gray-900 mb-3">{t("home.tfTitle")}</h3>
              <p className="text-gray-500 text-sm mb-5 leading-relaxed">{t("home.tfDesc")}</p>
              <Link href="/schnappfinger">
                <span className="inline-flex items-center gap-1.5 text-primary font-semibold text-sm hover:gap-3 transition-all cursor-pointer">
                  {t("home.learnMore")} <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <TestimonialsBlock />

      {/* Trust bar */}
      <section className="py-10 bg-gray-50 border-t border-gray-100">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="flex flex-wrap justify-center items-center gap-8 lg:gap-12">
            <img src={`${BASE}siegel-swiss.png`} alt={t("footer.certificates.swiss")} className="h-12 object-contain grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all" />
            <img src={`${BASE}siegel-fda.png`} alt={t("footer.certificates.fda")} className="h-12 object-contain grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all" />
            <img src={`${BASE}siegel-ce.png`} alt={t("footer.certificates.ce")} className="h-10 object-contain grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all" />
            <img src={`${BASE}siegel-iso.png`} alt={t("footer.certificates.iso")} className="h-12 object-contain grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all" />
            <img src={`${BASE}siegel-patented.png`} alt={t("footer.certificates.patented")} className="h-12 object-contain grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all" />
          </div>
        </div>
      </section>

    </div>
  );
}

// ── Shared postop data hook ────────────────────────────────────────────────

interface Quote {
  text: string;
  procedure: string;
  rating: number;
}

interface PostopData {
  total: number;
  averageRating: number | null;
  quotes: Quote[];
}

function usePostopData() {
  const [data, setData] = useState<PostopData | null>(null);

  useEffect(() => {
    fetch("/api/patient-postop-stats")
      .then((r) => {
        if (!r.ok) throw new Error("non-ok");
        return r.json();
      })
      .then((d) => {
        if (d && typeof d.total === "number") {
          setData({
            total: d.total,
            averageRating: typeof d.averageRating === "number" ? d.averageRating : null,
            quotes: Array.isArray(d.quotes) ? d.quotes : [],
          });
        }
      })
      .catch(() => {/* hide on error */});
  }, []);

  return data;
}

// ── Feedback strip ────────────────────────────────────────────────────────────

export function FeedbackStrip() {
  const { t } = useTranslation();
  const data = usePostopData();

  if (!data || data.total < 5 || data.averageRating === null) return null;

  return (
    <p className="mt-5 text-sm text-gray-500">
      {t("home.feedbackStrip", { rating: data.averageRating, count: data.total })}
    </p>
  );
}

// ── Testimonials block ────────────────────────────────────────────────────────

export function TestimonialsBlock() {
  const { t } = useTranslation();
  const data = usePostopData();
  const [idx, setIdx] = useState(0);

  const quotes = data?.quotes ?? [];
  const visible = quotes.slice(0, 2);

  useEffect(() => {
    if (quotes.length <= 1) return;
    const timer = setInterval(() => {
      setIdx((i) => (i + 1) % Math.max(1, quotes.length - 1));
    }, 6000);
    return () => clearInterval(timer);
  }, [quotes.length]);

  if (!data || quotes.length === 0) return null;

  // When there are more than 2 quotes, rotate which pair is shown
  const displayQuotes = quotes.length <= 2
    ? visible
    : [quotes[idx % quotes.length], quotes[(idx + 1) % quotes.length]];

  const procedureLabel = (proc: string) =>
    proc === "ct"
      ? t("home.ctTitle")
      : proc === "tf"
      ? t("home.tfTitle")
      : proc;

  const stars = (rating: number) => "★".repeat(rating) + "☆".repeat(5 - rating);

  return (
    <section className="py-16 bg-primary/5 border-t border-primary/10">
      <div className="container mx-auto px-4 lg:px-8">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
          {t("home.testimonialsTitle")}
        </h2>
        <div className="w-8 h-0.5 bg-primary mx-auto mb-10" />
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {displayQuotes.map((q, i) => (
            <blockquote
              key={i}
              className="bg-white rounded-xl p-6 shadow-sm border border-primary/10 flex flex-col gap-4"
            >
              <p className="text-gray-700 text-sm leading-relaxed italic before:content-['\u201e'] after:content-['\u201c']">
                {q.text}
              </p>
              <footer className="flex items-center justify-between mt-auto pt-2 border-t border-gray-100">
                <span className="text-xs text-gray-400">{procedureLabel(q.procedure)}</span>
                <span className="text-primary text-sm tracking-tight" aria-label={`${q.rating} von 5 Sternen`}>
                  {stars(q.rating)}
                </span>
              </footer>
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  );
}

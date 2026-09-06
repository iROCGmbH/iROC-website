import { Link } from "wouter";
import { ArrowRight, Activity, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { useMedia } from "@/hooks/useMedia";
import { useTranslation } from "react-i18next";

const BASE = import.meta.env.BASE_URL;

export default function Schnappfinger() {
  const { t } = useTranslation();
  const heroUrl = useMedia("hero-tf", `${BASE}tf-hero-user.png`);

  return (
    <div className="flex flex-col w-full bg-white">
      {/* Hero */}
      <section className="relative py-20 lg:py-28 bg-gray-50 border-b border-gray-100 overflow-hidden">
        <div className="container mx-auto px-4 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="max-w-2xl">
              <div className="inline-block px-3 py-1 rounded bg-primary/10 text-primary text-sm font-semibold mb-5">
                {t("tf.badge")}
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 leading-tight mb-5 hyphens-auto">
                {t("tf.heroTitle")}
              </h1>
              <p className="text-lg text-gray-600 mb-8 leading-relaxed">{t("tf.heroDesc")}</p>
              <Link href="/arzt-finden">
                <span className="inline-flex items-center gap-2 h-12 px-7 text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-colors rounded cursor-pointer">
                  {t("tf.findDoctor")} <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            </div>
            {heroUrl && (
              <div className="relative">
                <div className="aspect-[4/3] rounded-xl overflow-hidden shadow-xl">
                  <img
                    src={heroUrl}
                    alt={t("tf.heroImageAlt")}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Symptoms */}
      <section className="py-20 lg:py-24">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold text-gray-900 mb-4 text-center">{t("tf.whatTitle")}</h2>
            <div className="w-10 h-0.5 bg-primary mx-auto mb-10" />
            <p className="text-lg text-gray-600 mb-6 leading-relaxed text-center">{t("tf.whatDesc")}</p>

            <div className="bg-gray-50 border border-gray-100 p-8 lg:p-10 rounded-xl mt-10">
              <h3 className="text-lg font-bold text-gray-900 mb-5 flex items-center">
                <Activity className="mr-2.5 text-primary h-5 w-5" /> {t("tf.symptomsTitle")}
              </h3>
              <ul className="grid sm:grid-cols-2 gap-3.5">
                {(t("tf.symptoms", { returnObjects: true }) as string[]).map((symptom, idx) => (
                  <li key={idx} className="flex items-start">
                    <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mr-3 mt-0.5">
                      <ArrowUpRight className="h-3 w-3 text-primary" />
                    </div>
                    <span className="text-gray-700 text-sm font-medium">{symptom}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Treatment Comparison */}
      <section className="py-20 lg:py-24 bg-gray-900 text-white">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="max-w-3xl mx-auto text-center mb-14">
            <h2 className="text-3xl font-bold text-white mb-4">{t("tf.treatmentTitle")}</h2>
            <p className="text-gray-400">{t("tf.treatmentSubtitle")}</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            <div className="bg-white/5 p-8 rounded-xl border border-white/10">
              <h3 className="text-base font-bold text-gray-300 mb-5 uppercase tracking-wider">{t("tf.classicTitle")}</h3>
              <ul className="space-y-3.5 text-gray-400 text-sm">
                {(t("tf.classicItems", { returnObjects: true }) as string[]).map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-1 h-1 bg-gray-600 rounded-full mt-2 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white p-8 rounded-xl border-2 border-primary shadow-xl relative">
              <div className="absolute -top-3.5 left-6 bg-primary text-white px-4 py-1 rounded text-xs font-bold uppercase tracking-wider">
                {t("tf.modernBadge")}
              </div>
              <h3 className="text-base font-bold text-gray-900 mb-5 uppercase tracking-wider">{t("tf.modernTitle")}</h3>
              <ul className="space-y-3.5 text-sm">
                {(t("tf.modernItems", { returnObjects: true }) as [string, string][]).map(([label, desc], i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-gray-700"><strong className="text-gray-900">{label}:</strong> {desc}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Next Step */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4 lg:px-8 text-center max-w-3xl">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">{t("tf.ctaTitle")}</h2>
          <p className="text-gray-500 mb-10">{t("tf.ctaDesc")}</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/arzt-finden">
              <span className="inline-flex items-center justify-center gap-2 h-13 px-8 py-3.5 text-base font-semibold text-white bg-primary hover:bg-primary/90 transition-colors rounded cursor-pointer">
                {t("tf.findNearby")} <ArrowRight className="h-5 w-5" />
              </span>
            </Link>
            <Link href="/so-funktioniert-es">
              <span className="inline-flex items-center justify-center h-13 px-8 py-3.5 text-base font-semibold text-primary border border-primary hover:bg-primary/5 transition-colors rounded cursor-pointer">
                {t("tf.watchVideo")}
              </span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

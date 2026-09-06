import { Link } from "wouter";
import { ArrowRight, PlayCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSpirecutSettings, toEmbedUrl } from "@/hooks/useSpirecutSettings";

interface VideoSlotProps {
  label: string;
  embedUrl: string;
  title: string;
}

function VideoSlot({ label, embedUrl, title }: VideoSlotProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-300">{label}</h3>
      <div className="aspect-video bg-gray-800 rounded-xl overflow-hidden shadow-2xl border border-white/10">
        {embedUrl ? (
          <iframe
            width="100%"
            height="100%"
            src={embedUrl}
            title={title}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-3 text-gray-500"
            data-testid="video-unavailable"
          >
            <PlayCircle className="h-12 w-12 opacity-40" />
            <span className="text-sm">{t("how.videoUnavailable")}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HowItWorks() {
  const { t } = useTranslation();
  const sp = useSpirecutSettings();
  const steps = t("how.steps", { returnObjects: true }) as Array<{ step: string; title: string; desc: string }>;

  return (
    <div className="flex flex-col w-full bg-white">
      {/* Hero */}
      <section className="relative py-20 lg:py-24 bg-gray-50 border-b border-gray-100">
        <div className="container mx-auto px-4 lg:px-8 text-center max-w-4xl">
          <h1 className="text-4xl lg:text-5xl font-bold text-gray-900 leading-tight mb-5">
            {t("how.heroTitle")}
          </h1>
          <div className="w-10 h-0.5 bg-primary mx-auto mb-6" />
          <p className="text-lg text-gray-600 leading-relaxed max-w-2xl mx-auto">
            {t("how.heroDesc")}
          </p>
        </div>
      </section>

      {/* Step by step */}
      <section className="py-20 lg:py-24">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="max-w-4xl mx-auto">
            {steps.map((s, idx, arr) => (
              <div key={idx} className="flex flex-col md:flex-row gap-6 md:gap-12 items-start relative mb-14 last:mb-0">
                {idx !== arr.length - 1 && (
                  <div className="hidden md:block absolute left-5 top-14 bottom-[-3.5rem] w-px bg-gray-200" />
                )}
                <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center shrink-0 z-10 text-white font-bold text-sm">
                  {s.step}
                </div>
                <div className="pt-1.5">
                  <h3 className="text-xl font-bold text-gray-900 mb-2">{s.title}</h3>
                  <p className="text-gray-600 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Videos */}
      <section className="py-24 bg-gray-900 text-white">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="text-3xl font-bold text-white mb-4">{t("how.videoTitle")}</h2>
            <p className="text-gray-400">{t("how.videoDesc")}</p>
          </div>

          <div className="grid lg:grid-cols-2 gap-10 max-w-6xl mx-auto">
            <VideoSlot
              label={t("how.videoMethod")}
              embedUrl={toEmbedUrl(sp.sp_video_ct_url)}
              title={t("how.videoMethodIframeTitle")}
            />
            <VideoSlot
              label={t("how.videoTF")}
              embedUrl={toEmbedUrl(sp.sp_video_tf_url)}
              title={t("how.videoTFIframeTitle")}
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4 lg:px-8 text-center max-w-3xl">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">{t("how.ctaTitle")}</h2>
          <p className="text-gray-500 mb-8">{t("how.ctaDesc")}</p>
          <Link href="/arzt-finden">
            <span className="inline-flex items-center gap-2 h-13 px-9 py-3.5 text-base font-semibold text-white bg-primary hover:bg-primary/90 transition-colors rounded cursor-pointer shadow-sm">
              {t("how.ctaBtn")} <ArrowRight className="h-5 w-5" />
            </span>
          </Link>
        </div>
      </section>
    </div>
  );
}

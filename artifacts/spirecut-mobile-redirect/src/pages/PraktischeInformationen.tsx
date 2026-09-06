import { useTranslation } from "react-i18next";
import { useSpirecutSettings, toEmbedUrl } from "@/hooks/useSpirecutSettings";

export default function PraktischeInformationen() {
  const { t } = useTranslation();
  const sp = useSpirecutSettings();
  const beforeItems = t("praktisch.beforeItems", { returnObjects: true }) as string[];
  const afterItems = t("praktisch.afterItems", { returnObjects: true }) as [string, string][];

  const video1 = toEmbedUrl(sp.sp_video_praktisch_1_url);
  const video2 = toEmbedUrl(sp.sp_video_praktisch_2_url);
  const hasVideos = video1 || video2;
  const video1Title = sp.sp_video_praktisch_1_title || t("praktisch.video1Title");
  const video2Title = sp.sp_video_praktisch_2_title || t("praktisch.video2Title");

  return (
    <div className="flex flex-col w-full bg-white">
      <div className="container mx-auto px-4 lg:px-8 py-16 max-w-4xl">
        <h1 className="text-4xl font-bold text-gray-900 mb-3">{t("praktisch.title")}</h1>
        <div className="w-10 h-0.5 bg-primary mb-10" />

        <p className="text-gray-600 leading-relaxed mb-6">{t("praktisch.intro")}</p>

        <Section title={t("praktisch.generalTitle")}>
          <p>{t("praktisch.generalIntro")}</p>

          <SubSection label={t("praktisch.percutaneous")}>
            <p>{t("praktisch.percutaneousDesc")}</p>
          </SubSection>

          <SubSection label={t("praktisch.ultrasound")}>
            <p>{t("praktisch.ultrasoundDesc")}</p>
          </SubSection>

          <SubSection label={t("praktisch.spirecut")}>
            <p>{t("praktisch.spirecutDesc")}</p>
          </SubSection>
        </Section>

        <Section title={t("praktisch.beforeTitle")}>
          <p className="mb-4">{t("praktisch.beforeIntro")}</p>
          <ul className="space-y-3 text-gray-600">
            {beforeItems.map((item, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-primary font-bold shrink-0">·</span> {item}
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("praktisch.anaesthesiaTitle")}>
          <p>{t("praktisch.anaesthesiaDesc")}</p>
        </Section>

        <Section title={t("praktisch.duringTitle")}>
          <p className="mb-4">{t("praktisch.duringPara1")}</p>
          <p>{t("praktisch.duringPara2")}</p>
        </Section>

        <Section title={t("praktisch.afterTitle")}>
          <ul className="space-y-3 text-gray-600">
            {afterItems.map(([label, desc], i) => (
              <li key={i} className="flex gap-3">
                <span className="text-primary font-bold shrink-0">·</span>
                <span><strong>{label}</strong> {desc}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {/* Video section — only shown when at least one URL is configured */}
      {hasVideos && (
        <section className="py-20 bg-gray-900 text-white">
          <div className="container mx-auto px-4 lg:px-8 max-w-5xl">
            <h2 className="text-3xl font-bold mb-2">{t("praktisch.videosTitle")}</h2>
            <div className="w-10 h-0.5 bg-primary mb-10" />
            <div className={`grid gap-10 ${video1 && video2 ? 'lg:grid-cols-2' : 'max-w-2xl'}`}>
              {video1 && (
                <div className="space-y-3">
                  <h3 className="text-base font-semibold text-gray-300">{video1Title}</h3>
                  <div className="aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-white/10">
                    <iframe
                      width="100%"
                      height="100%"
                      src={video1}
                      title={video1Title}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                </div>
              )}
              {video2 && (
                <div className="space-y-3">
                  <h3 className="text-base font-semibold text-gray-300">{video2Title}</h3>
                  <div className="aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-white/10">
                    <iframe
                      width="100%"
                      height="100%"
                      src={video2}
                      title={video2Title}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-10">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">{title}</h2>
      <div className="w-6 h-0.5 bg-primary mb-5" />
      <div className="text-gray-600 leading-relaxed space-y-4">{children}</div>
    </div>
  );
}

function SubSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="font-semibold text-gray-800 mb-1">{label}</p>
      <div className="text-gray-600 leading-relaxed">{children}</div>
    </div>
  );
}

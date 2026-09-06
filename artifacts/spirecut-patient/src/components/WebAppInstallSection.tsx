import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSpirecutSettings } from "@/hooks/useSpirecutSettings";

const BASE = import.meta.env.BASE_URL;

function QRBlock({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, url, {
      width: 180,
      margin: 1,
      color: { dark: "#16324f", light: "#ffffff" },
    });
  }, [url]);

  return <canvas ref={canvasRef} className="rounded-sm" aria-label={url} />;
}

export function WebAppInstallSection() {
  const { t } = useTranslation();
  const { sp_webapp_url } = useSpirecutSettings();
  const currentWebsiteUrl =
    typeof window === "undefined"
      ? BASE
      : new URL(BASE, window.location.origin).toString();
  const websiteUrl = sp_webapp_url || currentWebsiteUrl;

  const iosSteps = t("home.webApp.iosSteps", { returnObjects: true }) as string[];
  const androidSteps = t("home.webApp.androidSteps", { returnObjects: true }) as string[];

  return (
    <section className="py-16 bg-white border-t border-gray-100">
      <div className="container mx-auto px-4 lg:px-8 max-w-5xl">
        <div className="text-center mb-12">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">
            {t("home.webApp.label")}
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            {t("home.webApp.title")}
          </h2>
          <p className="text-gray-500 max-w-2xl mx-auto leading-relaxed">
            {t("home.webApp.description")}
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-10 items-start">
          <div className="flex flex-col items-center bg-gray-50 rounded-2xl p-8 border border-gray-200 shadow-sm">
            <p className="text-sm font-semibold text-gray-700 mb-5">
              {t("home.webApp.scan")}
            </p>
            <div className="p-4 bg-white rounded-xl shadow-inner border border-gray-100">
              <QRBlock url={websiteUrl} />
            </div>
            <a
              href={websiteUrl}
              className="mt-4 text-xs text-primary hover:underline break-all text-center"
            >
              {websiteUrl}
            </a>
          </div>

          <div className="space-y-8">
            <InstructionList
              title={t("home.webApp.iosTitle")}
              steps={iosSteps}
              accentClass="bg-gray-900"
              numberClass="bg-primary/10 text-primary"
            />
            <InstructionList
              title={t("home.webApp.androidTitle")}
              steps={androidSteps}
              accentClass="bg-[#3ddc84]"
              numberClass="bg-[#3ddc84]/20 text-[#1a7a40]"
            />
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-10">
          {t("home.webApp.desktop")}
        </p>
      </div>
    </section>
  );
}

function InstructionList({
  title,
  steps,
  accentClass,
  numberClass,
}: {
  title: string;
  steps: string[];
  accentClass: string;
  numberClass: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-8 h-8 rounded-full ${accentClass} flex items-center justify-center shrink-0`}>
          <Smartphone className="w-4 h-4 text-white" />
        </div>
        <span className="font-semibold text-gray-900">{title}</span>
      </div>
      <ol className="space-y-3 pl-10">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm text-gray-600">
            <span className={`mt-0.5 w-5 h-5 rounded-full ${numberClass} font-bold text-xs flex items-center justify-center shrink-0`}>
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
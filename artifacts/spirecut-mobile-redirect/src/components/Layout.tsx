import { ReactNode } from "react";
import { Navigation } from "./Navigation";
import { Footer } from "./Footer";
import { ScrollRestoration } from "./ScrollRestoration";
import { useTranslation } from "react-i18next";
import { PatientGate } from "./PatientGate";

interface LayoutProps {
  children: ReactNode;
}

// Slim doctor announcement bar — fixed at very top of every page
function DoctorBar() {
  const { t } = useTranslation();
  return (
    <div className="fixed top-0 left-0 right-0 z-[60] min-h-9 bg-[#253a3d] flex items-center justify-center gap-3 px-4 py-2 text-xs">
      <span className="text-[#f5efe6] font-medium">{t("doctorBar.question")}</span>
      <a
        href="https://www.i-roc.de"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 font-bold text-white bg-primary hover:bg-primary/90 transition-colors px-3 py-1 rounded-lg whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        {t("doctorBar.cta")}
      </a>
    </div>
  );
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <PatientGate />
      <ScrollRestoration />
      {/* Doctor bar: ~32px */}
      <DoctorBar />
      {/* Nav sits below the doctor bar (top-[32px]) — see Navigation.tsx */}
      <Navigation />
      <main className="flex-1 pt-[106px] lg:ml-[252px]">
        {children}
      </main>
      <div className="lg:ml-[252px]"><Footer /></div>
    </div>
  );
}

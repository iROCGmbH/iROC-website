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
    <div className="fixed top-0 left-0 right-0 z-[60] bg-black flex items-center justify-center gap-4 px-4 py-2 text-sm">
      <span className="text-white font-medium">{t("doctorBar.question")}</span>
      <a
        href="https://www.i-roc.de"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 font-bold text-black bg-primary hover:bg-primary/90 transition-colors px-3 py-0.5 rounded whitespace-nowrap"
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
      {/* mobile:  doctor bar (32) + top bar (32) + logo row (80) + tab strip (44) ≈ 188px */}
      {/* xl+:     doctor bar (32) + top bar (32) + logo row (80)                  ≈ 144px */}
      <main className="flex-1 pt-[144px]">
        {children}
      </main>
      <Footer />
    </div>
  );
}

import { useTranslation } from "react-i18next";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { i18n } = useTranslation();
  const current = i18n.language === "en" ? "en" : "de";

  return (
    <div className={`flex items-center gap-0 text-xs font-bold ${className}`}>
      <button
        onClick={() => i18n.changeLanguage("de")}
        className={`px-2 py-0.5 rounded-l border transition-colors ${
          current === "de"
            ? "bg-primary text-white border-primary"
            : "text-gray-500 border-gray-300 hover:text-primary hover:border-primary/50 bg-white"
        }`}
        aria-label="Deutsch"
      >
        DE
      </button>
      <button
        onClick={() => i18n.changeLanguage("en")}
        className={`px-2 py-0.5 rounded-r border-t border-b border-r transition-colors ${
          current === "en"
            ? "bg-primary text-white border-primary"
            : "text-gray-500 border-gray-300 hover:text-primary hover:border-primary/50 bg-white"
        }`}
        aria-label="English"
      >
        EN
      </button>
    </div>
  );
}

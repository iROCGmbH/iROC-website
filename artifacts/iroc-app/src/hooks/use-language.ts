import { useState, useEffect, useCallback } from "react";

type Language = "en" | "de";

const listeners = new Set<() => void>();

let currentLang: Language = (localStorage.getItem("iroc_lang") as Language) || "en";

function syncDocumentLanguage(language: Language) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
  }
}

syncDocumentLanguage(currentLang);

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function useLanguage() {
  const [lang, setLangState] = useState<Language>(currentLang);

  useEffect(() => {
    const handleSync = () => setLangState(currentLang);
    listeners.add(handleSync);
    return () => { listeners.delete(handleSync); };
  }, []);

  const setLang = useCallback((newLang: Language) => {
    localStorage.setItem("iroc_lang", newLang);
    currentLang = newLang;
    syncDocumentLanguage(newLang);
    emitChange();
  }, []);

  const toggleLang = useCallback(() => {
    const next: Language = currentLang === "de" ? "en" : "de";
    localStorage.setItem("iroc_lang", next);
    currentLang = next;
    syncDocumentLanguage(next);
    emitChange();
  }, []);

  return { lang, setLang, toggleLang };
}

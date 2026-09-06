import "@testing-library/jest-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Minimal i18n setup for tests — uses the same keys as the real app but
// returns them verbatim so assertions can match on the key name.
i18n.use(initReactI18next).init({
  resources: {
    de: {
      translation: {
        "home.testimonialsTitle": "Was unsere Patienten sagen",
        "home.ctTitle": "Karpaltunnelsyndrom",
        "home.tfTitle": "Schnappfinger (Triggerfinger)",
        "home.feedbackStrip": "⭐ {{rating}} / 5 — {{count}} Patienten",
        "notFound.title": "404",
        "notFound.desc": "Diese Seite wurde nicht gefunden.",
        "notFound.back": "Zur Startseite",
      },
    },
  },
  lng: "de",
  fallbackLng: "de",
  interpolation: { escapeValue: false },
});

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Lang = 'de' | 'en';

const STORAGE_KEY = 'spirecut_lang';

// ─── Translations ─────────────────────────────────────────────────────────────

const translations = {
  de: {
    nav: {
      home: 'Startseite',
      findDoctor: 'Arzt finden',
      faq: 'FAQ',
      ct: 'Karpaltunnelsyndrom',
      ctShort: 'Karpaltunnel',
      tf: 'Schnappfinger',
      tfShort: 'Schnappfinger',
      howItWorks: 'So funktioniert es',
      postop: 'Postop. Bericht',
    },
    home: {
      heroTitle: 'Perkutane Handchirurgie',
      heroSubtitle: 'Ohne Schnitt. Unter Ultraschall. Schnell wieder fit.',
      heroPara: 'Spirecut® ermöglicht minimalinvasive Behandlungen von Karpaltunnelsyndrom und Schnappfinger — präzise, ohne Hautschnitt.',
      conditionsTitle: 'Behandelte Beschwerden',
      ctTitle: 'Karpaltunnelsyndrom',
      ctDesc: 'Kribbeln, Taubheit oder Schmerzen in den Fingern? Das Spirecut-Verfahren bietet schnelle Linderung.',
      tfTitle: 'Schnappfinger',
      tfDesc: 'Ein Finger blockiert oder schnappt beim Beugen? Präzise Ringbandspaltung ohne Skalpell.',
      learnMore: 'Mehr erfahren',
      advantagesTitle: 'Vorteile im Überblick',
      advantages: [
        'Kein Hautschnitt',
        'Keine Naht, keine Narbe',
        'Sofortige Rückkehr in den Alltag',
        'Ultraschallkontrolle für maximale Sicherheit',
      ],
      howItWorksTitle: 'So funktioniert es',
      howItWorksDesc: 'Erfahren Sie, wie der Eingriff Schritt für Schritt abläuft.',
      howItWorksBtn: 'Ablauf anzeigen',
      postopTitle: 'Ihre Erfahrung teilen',
      postopDesc: 'Hatten Sie den Eingriff? Teilen Sie Ihren Verlauf anonym.',
      postopBtn: 'Bericht abgeben',
      findDoctorBtn: 'Arzt finden',
      logoAccessibilityLabel: 'Spirecut',
      footerCopyright: (year: number) => `© ${year} Spirecut AG`,
    },
    ct: {
      badge: 'Patienteninformation',
      heroTitle: 'Karpaltunnelsyndrom',
      heroDesc: 'Sanfte Behandlung ohne Operation — mit dem Spirecut®-Verfahren.',
      whatTitle: 'Was ist das Karpaltunnelsyndrom?',
      whatDesc: 'Der Karpaltunnel ist ein enger Kanal im Bereich der Handwurzel, durch den Sehnen und der mittlere Armnerv verlaufen. Wenn das Gewebe anschwillt, drückt dies auf den Nerv.',
      symptomsTitle: 'Typische Symptome',
      symptoms: [
        'Nächtliches Einschlafen der Hand',
        'Kribbeln in Daumen, Zeige- und Mittelfinger',
        'Schmerzen, die bis in den Arm ausstrahlen',
        'Morgendliche Steifigkeit der Finger',
        'Schwäche beim Greifen',
        'Verlust des Tastgefühls',
      ],
      treatmentTitle: 'Die Spirecut® Behandlung',
      classicTitle: 'Klassische Operation',
      classicItems: [
        'Schnitt in der Handfläche (ca. 2–3 cm)',
        'Dauerhafte, sichtbare Narbe',
        'Längere Heilungsphase (oft Wochen)',
        'Gips oder Schiene häufig notwendig',
      ],
      modernTitle: 'Spirecut® Methode',
      modernItems: [
        ['Kein Schnitt', 'Zugang über eine winzige Punktion'],
        ['Keine Narbe', 'Perfektes kosmetisches Ergebnis'],
        ['Schnelle Heilung', 'Alltag oft am nächsten Tag möglich'],
        ['Ultraschallkontrolle', 'Maximale Sicherheit'],
        ['Kein Gips', 'Nur ein kleines Pflaster'],
      ],
      ctaTitle: 'Wieder schmerzfrei greifen?',
      ctaDesc: 'Lassen Sie sich von einem zertifizierten Facharzt beraten.',
      findNearby: 'Arzt in der Nähe finden',
      howItWorks: 'Wie der Eingriff abläuft',
    },
    tf: {
      badge: 'Patienteninformation',
      heroTitle: 'Schnappfinger (Triggerfinger)',
      heroDesc: 'Befreiung ohne Schnitt — mit der Spirecut®-Methode.',
      whatTitle: 'Was ist ein Schnappfinger?',
      whatDesc: 'Der Schnappfinger entsteht durch eine Verdickung der Beugesehne oder des Ringbandes. Die Sehne kann nicht mehr reibungslos gleiten und verhakt sich.',
      symptomsTitle: 'Typische Symptome',
      symptoms: [
        'Schmerzhaftes Schnappen beim Beugen',
        'Kleiner, schmerzhafter Knoten an der Handfläche',
        'Morgensteifigkeit im betroffenen Finger',
        'Der Finger bleibt in gebeugter Position hängen',
        'Schmerzen an der Basis des Fingers',
      ],
      treatmentTitle: 'Ringbandspaltung mit Spirecut®',
      classicTitle: 'Klassische Operation',
      classicItems: [
        'Hautschnitt in der Handfläche',
        'Naht und Verband erforderlich',
        'Gefahr schmerzhafter Narben',
        'Eingeschränkte Handnutzung für Wochen',
      ],
      modernTitle: 'Spirecut® Sono-Instrument',
      modernItems: [
        ['Kein Skalpell', 'Nur ein winziger Nadeleinstich'],
        ['Unter Ultraschall', 'Millimetergenaue Spaltung'],
        ['Sofortige Bewegung', 'Der Finger ist oft sofort frei'],
        ['Keine Nähte', 'Nur ein Pflaster'],
      ],
      ctaTitle: 'Bereit für einen schnappfreien Alltag?',
      ctaDesc: 'Das Spirecut-Verfahren dauert nur wenige Minuten.',
      findNearby: 'Arzt in der Nähe finden',
      watchVideo: 'Ablauf anzeigen',
    },
    how: {
      heroTitle: 'So funktioniert die Spirecut® Behandlung',
      heroDesc: 'Sicher, präzise und vollständig ohne offenen Hautschnitt dank modernster Ultraschall-Technologie.',
      steps: [
        {
          step: '01',
          title: 'Diagnostik und Aufklärung',
          desc: 'Der Arzt untersucht Ihre Hand mit einem hochauflösenden Ultraschallgerät und bespricht den Eingriff im Detail.',
        },
        {
          step: '02',
          title: 'Örtliche Betäubung',
          desc: 'Der Eingriff erfolgt ambulant. Die betreffende Stelle wird lokal betäubt — Sie sind wach, aber ohne Schmerzen.',
        },
        {
          step: '03',
          title: 'Eingriff unter Ultraschall',
          desc: 'Das feine Spirecut-Instrument wird durch einen Nadelstich eingeführt. Der Arzt verfolgt jeden Schritt live auf dem Ultraschallbild.',
        },
        {
          step: '04',
          title: 'Nach der Behandlung',
          desc: 'Keine Naht erforderlich. Nur ein kleines Pflaster. Sie können die Praxis kurz danach verlassen.',
        },
      ],
      ctaTitle: 'Überzeugt? Arzt finden.',
      ctaBtn: 'Zertifizierte Praxen anzeigen',
      facts: {
        duration: 'Unter 30 Min.',
        guidance: 'Ultraschall',
        recovery: 'Am 1. Tag zurück',
      },
    },
    faq: {
      heroTitle: 'Häufige Fragen',
      heroDesc: 'Alles, was Patienten vor dem Eingriff wissen möchten.',
      items: [
        {
          q: 'Ist Spirecut® schmerzhaft?',
          a: 'Nein. Der Eingriff wird unter örtlicher Betäubung durchgeführt. Sie spüren keinen Schmerz, allenfalls ein leichtes Druckgefühl.',
        },
        {
          q: 'Wie lange dauert der Eingriff?',
          a: 'Das eigentliche Verfahren dauert meist nur wenige Minuten. Mit Vorbereitung und Betäubung rechnen Sie mit etwa 30–45 Minuten.',
        },
        {
          q: 'Wann kann ich die Hand wieder normal benutzen?',
          a: 'Viele Patienten können alltägliche Tätigkeiten schon am nächsten Tag wieder ausführen. Schwere körperliche Belastungen sollten einige Tage gemieden werden.',
        },
        {
          q: 'Brauche ich eine Überweisung?',
          a: 'Das hängt von Ihrer Krankenversicherung ab. Die meisten zertifizierten Praxen können Sie direkt kontaktieren.',
        },
        {
          q: 'Ist Spirecut® von der Krankenkasse erstattet?',
          a: 'Private Krankenversicherungen übernehmen die Kosten in der Regel. Bei gesetzlich Versicherten hängt es von der Kasse ab — oft als Selbstzahlerleistung (IGeL). Bitte fragen Sie direkt in der Praxis.',
        },
        {
          q: 'Was sind die Risiken?',
          a: 'Wie bei jedem Eingriff gibt es Risiken wie leichte Blutungen. Durch die ständige Ultraschallkontrolle ist das Risiko einer Nervenverletzung äußerst gering.',
        },
        {
          q: 'Bleibt eine Narbe zurück?',
          a: 'Nein. Das Instrument ist so fein, dass nur ein kleiner Stich entsteht (ca. 1 mm). Es wird nicht geschnitten und nicht genäht.',
        },
      ],
      notFound: 'Ihre Frage war nicht dabei?',
      notFoundDesc: 'Ein zertifizierter Arzt kann alle weiteren Fragen in einem persönlichen Beratungsgespräch beantworten.',
      contactDoctor: 'Arzt finden',
    },
    findDoctor: {
      heroTitle: 'Arzt finden',
      heroDesc: 'Finden Sie eine zertifizierte Praxis in Ihrer Nähe.',
      loading: 'Ärzte werden geladen…',
      error: 'Die Arztliste konnte momentan nicht geladen werden.',
      retry: 'Erneut versuchen',
      practiceWebsite: 'Zur Praxis-Website',
      countryAll: 'Alle Länder',
      germany: 'Deutschland',
      austria: 'Österreich',
      otherCountries: 'Weitere Länder',
      filterLabel: 'Land',
      noDoctors: 'Keine Ärzte gefunden.',
      searchPlaceholder: 'Stadt, Name oder PLZ…',
      postalPlaceholder: 'PLZ für die Umkreissuche',
      radiusLabel: 'Umkreis',
      searchButton: 'Suchen',
      clearSearch: 'Suche löschen',
      postalNotFound: 'Diese PLZ konnte nicht gefunden werden. Bitte überprüfen Sie Ihre Eingabe.',
      resultsSummary: (count: number, radius: number, postal: string) =>
        `${count} Praxen im Umkreis von ${radius} km um PLZ ${postal}`,
      noNearbyDoctors: 'Keine Praxen gefunden. Versuchen Sie einen größeren Suchradius.',
      countries: {
        DE: 'Deutschland',
        AT: 'Österreich',
        CH: 'Schweiz',
        FR: 'Frankreich',
        BE: 'Belgien',
        NL: 'Niederlande',
      },
    },
    postop: {
      title: 'Postoperativer Verlauf',
      subtitle: 'Teilen Sie Ihre Erfahrung anonym.',
      para: 'Patientenrückmeldungen sind äußerst wertvoll, um das medizinische Wissen zu verbessern.',
      procedureLabel: 'Welcher Eingriff wurde durchgeführt?',
      procedurePlaceholder: 'Bitte wählen…',
      monthPlaceholder: 'Monat',
      yearPlaceholder: 'Jahr',
      requiredFieldsError: 'Bitte alle Pflichtfelder ausfüllen.',
      optional: '(optional)',
      procedureCT: 'Karpaltunnelsyndrom',
      procedureTF: 'Schnappfinger (Triggerfinger)',
      procedureBoth: 'Beide',
      monthLabel: 'Wann wurde der Eingriff durchgeführt?',
      ratingLabel: 'Wie beurteilen Sie das Ergebnis?',
      ratingHint: '(1 = sehr schlecht, 5 = ausgezeichnet)',
      optionalDivider: 'Optionale Angaben',
      ageLabel: 'Altersgruppe',
      ageSuffix: 'Jahre',
      genderLabel: 'Geschlecht',
      genders: { male: 'Männlich', female: 'Weiblich', divers: 'Divers' },
      occupationLabel: 'Berufliche Tätigkeit',
      occupations: {
        handworker: 'Handwerker/in',
        office: 'Bürotätigkeit',
        retired: 'Rentner/in',
      },
      diseasesLabel: 'Vorerkrankungen',
      diseases: {
        diabetes: 'Diabetes Mellitus',
        cholesterol: 'Hypercholesterinämie',
        bloodpressure: 'Bluthochdruck',
        other_metabolic: 'Andere Stoffwechselerkrankung',
      },
      experienceLabel: 'Ihre Erfahrung',
      experiencePlaceholder: 'Beschreiben Sie Ihren Heilungsverlauf…',
      shareQuoteLabel: 'Ich stimme zu, dass mein Erfahrungsbericht anonym veröffentlicht wird.',
      privacyNote: 'Ihre Antworten werden anonym gespeichert. Keine personenbezogenen Daten.',
      captchaTitle: 'Sicherheitsprüfung',
      captchaLabel: (a: number, b: number) => `Was ist ${a} + ${b}?`,
      captchaPlaceholder: 'Antwort',
      captchaError: 'Falsche Antwort – bitte versuchen Sie es erneut.',
      submitError: 'Übermittlung fehlgeschlagen. Bitte erneut versuchen.',
      sending: 'Wird gesendet…',
      submit: 'Anonym absenden',
      successTitle: 'Vielen Dank!',
      successMsg: 'Ihre Erfahrung wurde anonym übermittelt.',
    },
    errorFallback: {
      title: 'Etwas ist schiefgelaufen',
      message: 'Bitte laden Sie die App neu, um fortzufahren.',
      tryAgain: 'Erneut versuchen',
    },
    notFound: {
      title: 'Diese Seite existiert nicht.',
      goHome: 'Zur Startseite',
      screenTitle: 'Hoppla!',
    },
    languageToggle: {
      switchTo: (language: string) => `Zu ${language} wechseln`,
    },
    months: [
      'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
    ],
  },

  en: {
    nav: {
      home: 'Home',
      findDoctor: 'Find a Doctor',
      faq: 'FAQ',
      ct: 'Carpal Tunnel Syndrome',
      ctShort: 'Carpal Tunnel',
      tf: 'Trigger Finger',
      tfShort: 'Trigger Finger',
      howItWorks: 'How it works',
      postop: 'Postop. Report',
    },
    home: {
      heroTitle: 'Percutaneous Hand Surgery',
      heroSubtitle: 'No incision. Ultrasound-guided. Back to life fast.',
      heroPara: 'Spirecut® enables minimally invasive treatment of carpal tunnel syndrome and trigger finger — precise, without a skin incision.',
      conditionsTitle: 'Conditions Treated',
      ctTitle: 'Carpal Tunnel Syndrome',
      ctDesc: 'Tingling, numbness or pain in the fingers? The Spirecut procedure offers fast relief.',
      tfTitle: 'Trigger Finger',
      tfDesc: 'A finger that locks or snaps when bending? Precise ring ligament release without a scalpel.',
      learnMore: 'Learn more',
      advantagesTitle: 'Key Advantages',
      advantages: [
        'No skin incision',
        'No sutures, no scar',
        'Immediate return to daily activities',
        'Ultrasound guidance for maximum safety',
      ],
      howItWorksTitle: 'How it works',
      howItWorksDesc: 'Discover the step-by-step procedure.',
      howItWorksBtn: 'See the procedure',
      postopTitle: 'Share your experience',
      postopDesc: 'Had the procedure? Share your recovery anonymously.',
      postopBtn: 'Submit a report',
      findDoctorBtn: 'Find a doctor',
      logoAccessibilityLabel: 'Spirecut',
      footerCopyright: (year: number) => `© ${year} Spirecut AG`,
    },
    ct: {
      badge: 'Patient Information',
      heroTitle: 'Carpal Tunnel Syndrome',
      heroDesc: 'Gentle treatment without surgery — with the Spirecut® procedure.',
      whatTitle: 'What is carpal tunnel syndrome?',
      whatDesc: 'The carpal tunnel is a narrow channel at the wrist through which tendons and the median nerve pass. When tissue swells, it compresses the nerve.',
      symptomsTitle: 'Typical Symptoms',
      symptoms: [
        'Nocturnal numbness of the hand',
        'Tingling in thumb, index and middle finger',
        'Pain radiating into the arm',
        'Morning stiffness of the fingers',
        'Weakness when gripping',
        'Loss of sensation',
      ],
      treatmentTitle: 'The Spirecut® Treatment',
      classicTitle: 'Conventional Surgery',
      classicItems: [
        'Incision in the palm (approx. 2–3 cm)',
        'Permanent, visible scar',
        'Longer recovery (often weeks)',
        'Cast or splint often necessary',
      ],
      modernTitle: 'Spirecut® Method',
      modernItems: [
        ['No incision', 'Access via a tiny puncture'],
        ['No scar', 'Perfect cosmetic outcome'],
        ['Fast recovery', 'Daily activities often next day'],
        ['Ultrasound guidance', 'Maximum safety'],
        ['No cast', 'Just a small plaster'],
      ],
      ctaTitle: 'Want to grip without pain?',
      ctaDesc: 'Get advice from a certified specialist.',
      findNearby: 'Find a Doctor Near You',
      howItWorks: 'How the procedure works',
    },
    tf: {
      badge: 'Patient Information',
      heroTitle: 'Trigger Finger',
      heroDesc: 'Release without an incision — with the Spirecut® method.',
      whatTitle: 'What is a trigger finger?',
      whatDesc: 'Trigger finger is caused by a thickening of the flexor tendon or annular ligament. The tendon catches and can no longer glide smoothly.',
      symptomsTitle: 'Typical Symptoms',
      symptoms: [
        'Painful snapping when bending',
        'A small, tender nodule at the palm',
        'Morning stiffness in the affected finger',
        'The finger remains stuck in a bent position',
        'Pain at the base of the finger',
      ],
      treatmentTitle: 'Annular Ligament Release with Spirecut®',
      classicTitle: 'Conventional Surgery',
      classicItems: [
        'Skin incision in the palm',
        'Sutures and dressing required',
        'Risk of painful scars',
        'Restricted hand use for weeks',
      ],
      modernTitle: 'Spirecut® Sono Instrument',
      modernItems: [
        ['No scalpel', 'Just a tiny needle puncture'],
        ['Under ultrasound', 'Millimetre-precise release'],
        ['Immediate movement', 'Finger often free right away'],
        ['No sutures', 'Just a plaster'],
      ],
      ctaTitle: 'Ready for a snap-free daily life?',
      ctaDesc: 'The Spirecut procedure takes only a few minutes.',
      findNearby: 'Find a Doctor Near You',
      watchVideo: 'See the procedure',
    },
    how: {
      heroTitle: 'How the Spirecut® Treatment Works',
      heroDesc: 'Safe, precise and entirely without an open skin incision, thanks to state-of-the-art ultrasound technology.',
      steps: [
        {
          step: '01',
          title: 'Diagnosis & Consultation',
          desc: 'The physician examines your hand with a high-resolution ultrasound device and discusses the procedure in detail.',
        },
        {
          step: '02',
          title: 'Local Anaesthesia',
          desc: 'The procedure is outpatient. The area is locally anaesthetised — you are awake but feel no pain.',
        },
        {
          step: '03',
          title: 'The Procedure Under Ultrasound',
          desc: 'The fine Spirecut instrument is introduced through a tiny puncture. The physician follows every step live on the ultrasound image.',
        },
        {
          step: '04',
          title: 'After the Treatment',
          desc: 'No suturing required. Just a small plaster. You can leave the practice shortly afterwards.',
        },
      ],
      ctaTitle: 'Convinced? Find a doctor.',
      ctaBtn: 'Show Certified Practices',
      facts: {
        duration: 'Under 30 min',
        guidance: 'Ultrasound',
        recovery: 'Back on day 1',
      },
    },
    faq: {
      heroTitle: 'Frequently Asked Questions',
      heroDesc: 'Everything patients want to know before the procedure.',
      items: [
        {
          q: 'Is Spirecut® painful?',
          a: 'No. The procedure is performed under local anaesthesia. You feel no pain, at most a slight pressure.',
        },
        {
          q: 'How long does the procedure take?',
          a: 'The actual Spirecut procedure takes only a few minutes. Allow about 30–45 minutes for the whole visit.',
        },
        {
          q: 'When can I use my hand normally again?',
          a: 'Many patients can resume daily tasks the very next day. Avoid heavy physical strain for a few days.',
        },
        {
          q: 'Do I need a referral?',
          a: 'It depends on your insurance. Most certified practices can be contacted directly.',
        },
        {
          q: 'Is Spirecut® covered by insurance?',
          a: 'Private insurers typically cover the full cost. For statutory insurance, it is often billed as a self-pay service. Ask at the practice directly.',
        },
        {
          q: 'What are the risks?',
          a: 'As with any procedure, minor bleeding can occur. Continuous ultrasound guidance makes the risk of nerve injury extremely low.',
        },
        {
          q: 'Will there be a scar?',
          a: 'No. The instrument is so fine that only a tiny puncture remains (approx. 1 mm). No cutting, no sutures, no visible scar.',
        },
      ],
      notFound: 'Your question not listed?',
      notFoundDesc: 'A certified physician can answer all further questions in a personal consultation.',
      contactDoctor: 'Find a doctor',
    },
    findDoctor: {
      heroTitle: 'Find a Doctor',
      heroDesc: 'Find a certified practice near you.',
      loading: 'Loading doctors…',
      error: 'The doctor list could not be loaded at the moment.',
      retry: 'Try again',
      practiceWebsite: 'Visit Practice Website',
      countryAll: 'All Countries',
      germany: 'Germany',
      austria: 'Austria',
      otherCountries: 'Other Countries',
      filterLabel: 'Country',
      noDoctors: 'No doctors found.',
      searchPlaceholder: 'City, name or postcode…',
      postalPlaceholder: 'Postal code for nearby search',
      radiusLabel: 'Radius',
      searchButton: 'Search',
      clearSearch: 'Clear search',
      postalNotFound: 'This postal code could not be found. Please check your input.',
      resultsSummary: (count: number, radius: number, postal: string) =>
        `${count} practices within ${radius} km of postal code ${postal}`,
      noNearbyDoctors: 'No practices found. Try increasing the search radius.',
      countries: {
        DE: 'Germany',
        AT: 'Austria',
        CH: 'Switzerland',
        FR: 'France',
        BE: 'Belgium',
        NL: 'Netherlands',
      },
    },
    postop: {
      title: 'Postoperative Progress',
      subtitle: 'Share your experience anonymously.',
      para: 'Patient feedback is extremely valuable for improving medical knowledge.',
      procedureLabel: 'Which procedure was performed?',
      procedurePlaceholder: 'Please select…',
      monthPlaceholder: 'Month',
      yearPlaceholder: 'Year',
      requiredFieldsError: 'Please fill in all required fields.',
      optional: '(optional)',
      procedureCT: 'Carpal Tunnel Syndrome',
      procedureTF: 'Trigger Finger',
      procedureBoth: 'Both',
      monthLabel: 'When was the procedure performed?',
      ratingLabel: 'How do you rate the outcome?',
      ratingHint: '(1 = very poor, 5 = excellent)',
      optionalDivider: 'Optional Details',
      ageLabel: 'Age group',
      ageSuffix: 'years',
      genderLabel: 'Gender',
      genders: { male: 'Male', female: 'Female', divers: 'Other' },
      occupationLabel: 'Occupation',
      occupations: {
        handworker: 'Manual worker',
        office: 'Office work',
        retired: 'Retired',
      },
      diseasesLabel: 'Pre-existing conditions',
      diseases: {
        diabetes: 'Diabetes Mellitus',
        cholesterol: 'Hypercholesterolaemia',
        bloodpressure: 'High blood pressure',
        other_metabolic: 'Other metabolic disorder',
      },
      experienceLabel: 'Your experience',
      experiencePlaceholder: 'Describe your recovery…',
      shareQuoteLabel: 'I consent to my experience being published anonymously.',
      privacyNote: 'Your answers are stored anonymously. No personal data is collected.',
      captchaTitle: 'Security check',
      captchaLabel: (a: number, b: number) => `What is ${a} + ${b}?`,
      captchaPlaceholder: 'Answer',
      captchaError: 'Wrong answer — please try again.',
      submitError: 'Submission failed. Please try again.',
      sending: 'Sending…',
      submit: 'Submit anonymously',
      successTitle: 'Thank you!',
      successMsg: 'Your experience has been submitted anonymously.',
    },
    errorFallback: {
      title: 'Something went wrong',
      message: 'Please reload the app to continue.',
      tryAgain: 'Try Again',
    },
    notFound: {
      title: "This screen doesn't exist.",
      goHome: 'Go to home screen!',
      screenTitle: 'Oops!',
    },
    languageToggle: {
      switchTo: (language: string) => `Switch to ${language}`,
    },
    months: [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ],
  },
} as const;

export type Translations = typeof translations.de;

// ─── Context ──────────────────────────────────────────────────────────────────

interface LanguageContextValue {
  lang: Lang;
  t: Translations;
  setLang: (lang: Lang) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('de');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'de' || stored === 'en') setLangState(stored);
    });
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    AsyncStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = translations[lang] as unknown as Translations;

  return (
    <LanguageContext.Provider value={{ lang, t, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}

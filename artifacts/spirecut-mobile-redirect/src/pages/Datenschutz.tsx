import { useTranslation } from "react-i18next";
import { useSpirecutSettings } from "@/hooks/useSpirecutSettings";

export default function Datenschutz() {
  const { i18n } = useTranslation();
  const sp = useSpirecutSettings();
  const isEnglish = i18n.language === "en";

  return (
    <div className="py-20 bg-white min-h-[60vh]">
      <div className="container mx-auto px-4 lg:px-8 max-w-3xl">
        {isEnglish && (
          <div className="mb-8 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
            This page is only available in German. / Diese Seite ist nur auf Deutsch verfügbar.
          </div>
        )}
        <h1 className="text-4xl font-bold text-primary mb-12">Datenschutzerklärung</h1>

        <div className="prose prose-blue max-w-none text-primary/80">
          <h2 className="text-2xl font-bold text-primary mt-8 mb-4">1. Datenschutz auf einen Blick</h2>
          <h3 className="text-xl font-bold mt-4 mb-2">Allgemeine Hinweise</h3>
          <p>
            Die folgenden Hinweise geben einen einfachen Überblick darüber, was mit Ihren personenbezogenen Daten passiert, wenn Sie diese Website besuchen. Personenbezogene Daten sind alle Daten, mit denen Sie persönlich identifiziert werden können.
          </p>

          <h3 className="text-xl font-bold mt-4 mb-2">Datenerfassung auf dieser Website</h3>
          <p>
            <strong>Wer ist verantwortlich für die Datenerfassung auf dieser Website?</strong><br/>
            Die Datenverarbeitung auf dieser Website erfolgt durch den Websitebetreiber. Dessen Kontaktdaten können Sie dem Abschnitt „Hinweis zur Verantwortlichen Stelle" in dieser Datenschutzerklärung entnehmen.
          </p>
          <p>
            <strong>Wie erfassen wir Ihre Daten?</strong><br/>
            Ihre Daten werden zum einen dadurch erhoben, dass Sie uns diese mitteilen. Hierbei kann es sich z. B. um Daten handeln, die Sie in ein Kontaktformular eingeben.
          </p>
          <p>
            Andere Daten werden automatisch oder nach Ihrer Einwilligung beim Besuch der Website durch unsere IT-Systeme erfasst. Das sind vor allem technische Daten (z. B. Internetbrowser, Betriebssystem oder Uhrzeit des Seitenaufrufs). Die Erfassung dieser Daten erfolgt automatisch, sobald Sie diese Website betreten.
          </p>

          <h2 className="text-2xl font-bold text-primary mt-8 mb-4">2. Hosting</h2>
          <p>Wir hosten die Inhalte unserer Website bei folgendem Anbieter: (Platzhalter)</p>

          <h2 className="text-2xl font-bold text-primary mt-8 mb-4">3. Allgemeine Hinweise und Pflichtinformationen</h2>
          <h3 className="text-xl font-bold mt-4 mb-2">Datenschutz</h3>
          <p>
            Die Betreiber dieser Seiten nehmen den Schutz Ihrer persönlichen Daten sehr ernst. Wir behandeln Ihre personenbezogenen Daten vertraulich und entsprechend der gesetzlichen Datenschutzvorschriften sowie dieser Datenschutzerklärung.
          </p>

          <h3 className="text-xl font-bold mt-4 mb-2">Hinweis zur verantwortlichen Stelle</h3>
          <p>
            Die verantwortliche Stelle für die Datenverarbeitung auf dieser Website ist:<br /><br />
            iROC GmbH<br />
            St.-Emmeram-Str. 26<br />
            85609 Aschheim<br />
            <br />
            Telefon: +49 89 4625993 70<br />
            E-Mail: <a href={`mailto:${sp.sp_contact_email_de}`}>{sp.sp_contact_email_de}</a>
          </p>
        </div>
      </div>
    </div>
  );
}

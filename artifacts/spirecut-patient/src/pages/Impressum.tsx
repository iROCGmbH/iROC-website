import { useTranslation } from "react-i18next";
import { useSpirecutSettings } from "@/hooks/useSpirecutSettings";

export default function Impressum() {
  const { i18n } = useTranslation();
  const sp = useSpirecutSettings();
  const isEnglish = i18n.language === "en";

  return (
    <div className="py-20 bg-white min-h-[60vh]">
      <div className="container mx-auto px-4 lg:px-8 max-w-3xl">
        <h1 className="text-4xl font-bold text-primary mb-12">
          {isEnglish ? "Legal Notice" : "Impressum"}
        </h1>

        <div className="prose prose-blue max-w-none text-primary/80">
          <p className="font-bold">
            {isEnglish
              ? "Information pursuant to § 5 TMG (German Telemedia Act)"
              : "Angaben gemäß § 5 TMG"}
          </p>

          <p>
            iROC GmbH<br />
            St.-Emmeram-Str. 26<br />
            85609 Aschheim
          </p>

          <p>
            <strong>{isEnglish ? "Represented by:" : "Vertreten durch:"}</strong><br />
            {isEnglish ? "Management: " : "Geschäftsführung: "}
            Dr. Edan Manos, Dr. Daniel Filesch
          </p>

          <p>
            <strong>{isEnglish ? "Contact:" : "Kontakt:"}</strong><br />
            {isEnglish ? "Phone: " : "Telefon: "}+49 89 4625993 70<br />
            {isEnglish ? "Email: " : "E-Mail: "}
            <a href={`mailto:${sp.sp_contact_email_de}`}>{sp.sp_contact_email_de}</a>
          </p>

          <p>
            <strong>
              {isEnglish
                ? "Consumer dispute resolution / Universal arbitration board"
                : "Verbraucherstreitbeilegung/Universalschlichtungsstelle"}
            </strong><br />
            {isEnglish
              ? "We are not willing or obliged to participate in dispute resolution proceedings before a consumer arbitration board."
              : "Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen."}
          </p>

          <h2 className="text-2xl font-bold text-primary mt-8 mb-4">
            {isEnglish ? "Liability for content" : "Haftung für Inhalte"}
          </h2>
          <p>
            {isEnglish
              ? "As a service provider, we are responsible for our own content on these pages in accordance with § 7 (1) TMG and general laws. However, pursuant to §§ 8 to 10 TMG, we as a service provider are not obliged to monitor transmitted or stored third-party information or to investigate circumstances that indicate illegal activity."
              : "Als Diensteanbieter sind wir gemäß § 7 Abs.1 TMG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen."}
          </p>
          <p>
            {isEnglish
              ? "Obligations to remove or block the use of information under general laws remain unaffected. However, liability in this respect is only possible from the point in time at which knowledge of a specific infringement of the law is obtained. Upon becoming aware of any such legal infringements, we will remove this content immediately."
              : "Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. Bei Bekanntwerden von entsprechenden Rechtsverletzungen werden wir diese Inhalte umgehend entfernen."}
          </p>

          <h2 className="text-2xl font-bold text-primary mt-8 mb-4">
            {isEnglish ? "Liability for links" : "Haftung für Links"}
          </h2>
          <p>
            {isEnglish
              ? "Our website contains links to external third-party websites over whose content we have no influence. Therefore, we cannot assume any liability for this external content. The respective provider or operator of the pages is always responsible for the content of the linked pages. The linked pages were checked for possible legal violations at the time of linking. Illegal content was not recognisable at the time of linking."
              : "Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich. Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße überprüft. Rechtswidrige Inhalte waren zum Zeitpunkt der Verlinkung nicht erkennbar."}
          </p>
        </div>
      </div>
    </div>
  );
}

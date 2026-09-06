import { useLanguage } from '@/contexts/LanguageContext';
import { DynamicSections } from '@/components/DynamicSections';

export default function Impressum() {
  const { t } = useLanguage();

  return (
    <div className="py-20 bg-white min-h-screen">
      <div className="container mx-auto px-4 max-w-3xl prose prose-slate">
        <h1 className="text-4xl font-bold mb-8">{t('Impressum', 'Legal Notice')}</h1>

        {/* ── Company information ──────────────────────────────────────────── */}
        <h2>{t('Angaben gemäß § 5 TMG', 'Company Information (§ 5 TMG)')}</h2>
        <p style={{ whiteSpace: 'pre-line' }}>
          {t(
            'iROC GmbH\nInnovative & Regenerative medical Oriented Consultation\nSt.-Emmeram-Str. 26\n85609 Aschheim\nDeutschland',
            'iROC GmbH\nInnovative & Regenerative medical Oriented Consultation\nSt.-Emmeram-Str. 26\n85609 Aschheim\nGermany'
          )}
        </p>

        {/* ── Managing directors ──────────────────────────────────────────── */}
        <h2>{t('Geschäftsführung', 'Managing Directors')}</h2>
        <p style={{ whiteSpace: 'pre-line' }}>
          {t(
            'Edan Manos\nDaniel A. Filesch',
            'Edan Manos\nDaniel A. Filesch'
          )}
        </p>

        {/* ── Contact ─────────────────────────────────────────────────────── */}
        <h2>{t('Kontakt', 'Contact')}</h2>
        <p style={{ whiteSpace: 'pre-line' }}>
          {t(
            'Telefon: +49 89 4625993 70\nFax: +49 89 21530 334\nE-Mail: info@i-roc.de\nWeb: https://i-roc.de',
            'Phone: +49 89 4625993 70\nFax: +49 89 21530 334\nE-mail: info@i-roc.de\nWeb: https://i-roc.de'
          )}
        </p>

        {/* ── Commercial register ─────────────────────────────────────────── */}
        <h2>{t('Registereintrag', 'Commercial Register')}</h2>
        <p style={{ whiteSpace: 'pre-line' }}>
          {t(
            'Eintragung im Handelsregister.\nRegistergericht: Amtsgericht München\nRegisternummer: HRB 303391',
            'Entry in the commercial register.\nRegistration court: Munich Local Court (Amtsgericht München)\nRegistration number: HRB 303391'
          )}
        </p>

        {/* ── VAT and EORI ───────────────────────────────────────────────── */}
        <h2>{t('Umsatzsteuer-ID', 'VAT Identification Number')}</h2>
        <p style={{ whiteSpace: 'pre-line' }}>
          {t(
            'Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz:\nDE455583037',
            'VAT identification number in accordance with § 27 a of the German VAT Act:\nDE455583037\nEORI: DE990485776181558',
          )}
        </p>

        {/* ── Professional liability insurance (placeholder until data provided) */}
        <h2>{t('Berufshaftpflichtversicherung', 'Professional Liability Insurance')}</h2>
        <p style={{ whiteSpace: 'pre-line' }}>
          {t('(Wird nachgetragen)', '(To be added)')}
        </p>

        {/* ── Bank details ────────────────────────────────────────────────── */}
        <h2>{t('Bankverbindung', 'Bank Details')}</h2>
        <p style={{ whiteSpace: 'pre-line' }}>
          {t(
            'MERKUR PRIVATBANK München\nBIC/SWIFT: GENODEF1M06\nIBAN: DE85 7013 0800 0001 1395 50\nEORI: DE990485776181558',
            'MERKUR PRIVATBANK München\nBIC/SWIFT: GENODEF1M06\nIBAN: DE85 7013 0800 0001 1395 50\nEORI: DE990485776181558'
          )}
        </p>

        <hr className="my-8" />

        {/* ── EU dispute resolution ───────────────────────────────────────── */}
        <h2>{t('EU-Streitschlichtung', 'EU Dispute Resolution')}</h2>
        <p style={{ whiteSpace: 'pre-line' }}>
          {t(
            'Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:\nhttps://ec.europa.eu/consumers/odr/\n\nUnsere E-Mail-Adresse finden Sie oben im Impressum.',
            'The European Commission provides a platform for online dispute resolution (ODR):\nhttps://ec.europa.eu/consumers/odr/\n\nOur email address can be found above in the legal notice.'
          )}
        </p>

        {/* ── Consumer dispute resolution ─────────────────────────────────── */}
        <h2>{t('Verbraucherstreitbeilegung/Universalschlichtungsstelle', 'Consumer Dispute Resolution')}</h2>
        <p>
          {t(
            'Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.',
            'We are neither willing nor obliged to participate in dispute resolution proceedings before a consumer arbitration body.'
          )}
        </p>

        <hr className="my-8" />

        {/* ── Disclaimer ──────────────────────────────────────────────────── */}
        <h2>{t('Haftungsausschluss / Rechtlicher Hinweis', 'Disclaimer / Legal Notice')}</h2>
        <p>
          {t(
            'Die Inhalte dieser Website wurden sorgfältig geprüft, sind ausschließlich zu Informationszwecken bestimmt und stellen in keiner Weise Ersatz für eine professionelle Beratung oder Behandlung durch den ausgebildeten Arzt dar. Eine Garantie für die Vollständigkeit, Richtigkeit und Aktualität der Inhalte wird nicht übernommen.',
            'The content of this website has been carefully reviewed and is intended for informational purposes only. It does not in any way replace professional advice or treatment by a qualified physician. No guarantee is given for the completeness, accuracy or currency of the content.'
          )}
        </p>
        <p>
          {t(
            'Für Inhalte verlinkter Websites sind ausschließlich deren Betreiber verantwortlich; jegliche Haftung unsererseits wird daher ausgeschlossen.',
            'The operators of linked websites are solely responsible for their content; any liability on our part is therefore excluded.'
          )}
        </p>

        {/* ── Copyright ───────────────────────────────────────────────────── */}
        <h2>{t('Copyright', 'Copyright')}</h2>
        <p>
          {t(
            'Die unter www.i-roc.de zugänglich gemachten Darstellungen und Inhalte sind urheberrechtlich geschützt. Alle Rechte liegen bei der iROC GmbH, sofern nicht andere Rechteinhaber genannt werden. Die – auch nur teilweise – Nutzung und/oder Weitergabe von Inhalten, Darstellungen oder Bildern der Website ohne vorherige Genehmigung der Rechteinhaber ist rechtswidrig.',
            'The representations and content made available at www.i-roc.de are protected by copyright. All rights belong to iROC GmbH unless other rights holders are named. The use and/or distribution of any content, representations or images from this website — even in part — without the prior permission of the rights holders is unlawful.'
          )}
        </p>

        {/* Admin-added custom sections appear below the standard content */}
        <DynamicSections page="impressum" />
      </div>
    </div>
  );
}

import { useLanguage } from '@/contexts/LanguageContext';
import { DynamicSections } from '@/components/DynamicSections';

type Text = { de: string; en: string };
type Clause = { label: Text; body: Text };
type Section = { title: Text; clauses: Clause[] };

const sections: Section[] = [
  {
    title: { de: '1. Geltung und Anwendungsbereich', en: '1. Scope and Applicability' },
    clauses: [
      { label: { de: '1.1. Geltung:', en: '1.1. Applicability:' }, body: { de: 'Es finden ausschließlich diese AVB Anwendung. Geschäftsbedingungen des Kunden, insbesondere Einkaufsbedingungen, werden nicht anerkannt, sofern deren Geltung nicht ausdrücklich in Textform bestätigt wurde.', en: "These GTC apply exclusively. The customer's terms and conditions, in particular purchasing conditions, are not recognised unless their applicability has been expressly confirmed in text form." } },
      { label: { de: '1.2. B2B-Fokus:', en: '1.2. B2B Focus:' }, body: { de: 'Die Liefergegenstände sind ausschließlich für Unternehmer bestimmt. Geschäfte mit Verbrauchern werden ausgeschlossen.', en: 'The goods supplied are intended exclusively for business customers. Transactions with consumers are excluded.' } },
      { label: { de: '1.3. Anwendungsbereich:', en: '1.3. Scope:' }, body: { de: 'Diese Bedingungen der iROC GmbH, St. Emmeram Str. 26, 85609 Aschheim, regeln exklusiv sämtliche Verkäufe, Leistungen (einschließlich Lizenzen und Service) sowie Ansprüche zwischen der iROC GmbH und ihren Geschäftspartnern.', en: 'These conditions of iROC GmbH, St. Emmeram Str. 26, 85609 Aschheim, exclusively govern all sales, services (including licences and service agreements) and claims between iROC GmbH and its business partners.' } },
    ],
  },
  {
    title: { de: '2. Vertragsschluss und Bestellungen', en: '2. Contract Formation and Orders' },
    clauses: [
      { label: { de: '2.1. Unverbindlichkeit:', en: '2.1. Non-binding offers:' }, body: { de: 'Angebote der iROC GmbH sind freibleibend und unverbindlich, sofern sie nicht ausdrücklich als verbindlich gekennzeichnet sind.', en: 'Offers from iROC GmbH are subject to change and non-binding unless expressly designated as binding.' } },
      { label: { de: '2.2. Annahme:', en: '2.2. Acceptance:' }, body: { de: 'Bestellungen des Kunden gelten als verbindliches Vertragsangebot. Der Vertrag kommt erst durch die schriftliche Auftragsbestätigung der iROC GmbH oder durch die Auslieferung der Ware zustande.', en: "The customer's orders constitute a binding offer to enter into a contract. The contract is only concluded upon written order confirmation by iROC GmbH or upon delivery of the goods." } },
      { label: { de: '2.3. Mindestbestellwert:', en: '2.3. Minimum order value:' }, body: { de: 'Die iROC GmbH behält sich das Recht vor, einen Mindestbestellwert pro Auftrag festzulegen. Bei Unterschreitung kann ein Mindermengenenzuschlag erhoben werden.', en: 'iROC GmbH reserves the right to set a minimum order value per order. A small-order surcharge may be levied if this is not met.' } },
    ],
  },
  {
    title: { de: '3. Preise und Zahlungsbedingungen', en: '3. Prices and Payment Terms' },
    clauses: [
      { label: { de: '3.1. Nettopreise:', en: '3.1. Net prices:' }, body: { de: 'Alle Preise verstehen sich in Euro ab Werk (EXW Aschheim) zuzüglich der jeweils gültigen gesetzlichen Umsatzsteuer, Verpackungs- und Versandkosten.', en: 'All prices are in euros ex works (EXW Aschheim), plus the applicable statutory VAT and packaging and shipping costs.' } },
      { label: { de: '3.2. Fälligkeit:', en: '3.2. Due date:' }, body: { de: 'Rechnungen sind innerhalb von 30 Tagen ab Rechnungsdatum ohne Abzug zur Zahlung fällig, sofern keine abweichende Vereinbarung getroffen wurde.', en: 'Invoices are due for payment within 30 days of the invoice date without deduction, unless a different arrangement has been agreed.' } },
      { label: { de: '3.3. Zahlungsverzug:', en: '3.3. Late payment:' }, body: { de: 'Bei Zahlungsverzug gelten die gesetzlichen Regelungen für Verzugszinsen im Geschäftsverkehr (aktuell 9 Prozentpunkte über dem Basiszinssatz).', en: 'In the event of late payment, the statutory provisions for default interest in commercial transactions apply (currently 9 percentage points above the base interest rate).' } },
    ],
  },
  {
    title: { de: '4. Lieferung, Lieferfristen und Gefahrübergang', en: '4. Delivery, Delivery Periods and Transfer of Risk' },
    clauses: [
      { label: { de: '4.1. Gefahrübergang:', en: '4.1. Transfer of risk:' }, body: { de: 'Die Lieferung erfolgt ab Werk (EXW Aschheim). Die Gefahr des zufälligen Untergangs geht mit der Übergabe an den Transporteur auf den Kunden über.', en: 'Delivery is ex works (EXW Aschheim). The risk of accidental loss passes to the customer upon handover to the carrier.' } },
      { label: { de: '4.2. Lieferfristen:', en: '4.2. Delivery periods:' }, body: { de: 'Von iROC GmbH genannte Lieferfristen sind unverbindliche Schätzungen, es sei denn, ein fester Liefertermin wurde ausdrücklich schriftlich vereinbart.', en: 'Delivery periods stated by iROC GmbH are non-binding estimates unless a firm delivery date has been expressly agreed in writing.' } },
      { label: { de: '4.3. Teillieferungen:', en: '4.3. Partial deliveries:' }, body: { de: 'Die iROC GmbH ist zu Teillieferungen berechtigt, sofern dies für den Kunden zumutbar ist.', en: 'iROC GmbH is entitled to make partial deliveries provided this is reasonable for the customer.' } },
    ],
  },
  {
    title: { de: '5. Eigentumsvorbehalt', en: '5. Retention of Title' },
    clauses: [
      { label: { de: '5.1. Vorbehalt:', en: '5.1. Retention:' }, body: { de: 'Die gelieferte Ware bleibt bis zur vollständigen Bezahlung sämtlicher Forderungen aus der Geschäftsbeziehung im Eigentum der iROC GmbH.', en: 'The delivered goods remain the property of iROC GmbH until all claims arising from the business relationship have been paid in full.' } },
      { label: { de: '5.2. Verbot der Weiterveräußerung:', en: '5.2. Prohibition of Resale:' }, body: { de: 'Der Kunde darf die Ware nicht an Dritte, einschließlich anderer Unternehmen oder gewerblicher Einrichtungen, weiterveräußern, sofern nicht zuvor die schriftliche Zustimmung der iROC GmbH erteilt wurde.', en: 'The customer is not permitted to resell the goods to third parties, including other businesses or commercial entities, unless prior written consent has been granted by iROC GmbH.' } },
    ],
  },
  {
    title: { de: '6. Keine Rücknahmeverpflichtung', en: '6. No Repurchase Obligation' },
    clauses: [
      { label: { de: '6.1. Ausschluss der Rücknahme:', en: '6.1. Exclusion of Repurchase:' }, body: { de: 'Die iROC GmbH ist nicht verpflichtet, unbenutzte, ungeöffnete oder versiegelte Produkte zurückzunehmen, zurückzukaufen oder gutzuschreiben, es sei denn, für das konkrete Geschäft wurde ausdrücklich eine gesonderte schriftliche Vereinbarung geschlossen.', en: 'iROC GmbH is under no obligation to take back, buy back, or credit unused, unopened, or sealed products, unless a separate written agreement has been explicitly concluded for the specific transaction.' } },
    ],
  },
  {
    title: { de: '7. Gewährleistung und Mängelrüge', en: '7. Warranty and Notice of Defects' },
    clauses: [
      { label: { de: '7.1. Untersuchungs- und Rügepflicht:', en: '7.1. Duty to inspect and notify:' }, body: { de: 'Der Kunde hat die Ware unverzüglich nach Erhalt zu untersuchen. Offensichtliche Mängel müssen der iROC GmbH innerhalb von 5 Werktagen nach Lieferung schriftlich angezeigt werden.', en: 'The customer must inspect the goods immediately upon receipt. Obvious defects must be reported to iROC GmbH in writing within 5 working days of delivery.' } },
      { label: { de: '7.2. Nacherfüllung:', en: '7.2. Subsequent performance:' }, body: { de: 'Bei berechtigten Mängeln erfolgt die Nacherfüllung nach Wahl der iROC GmbH durch Nachbesserung oder Ersatzlieferung.', en: 'In the event of justified defects, subsequent performance shall be carried out at the discretion of iROC GmbH by repair or replacement delivery.' } },
      { label: { de: '7.3. Verjährung:', en: '7.3. Limitation period:' }, body: { de: 'Die Verjährungsfrist für Mängelansprüche beträgt 12 Monate ab Ablieferung der Ware.', en: 'The limitation period for warranty claims is 12 months from delivery of the goods.' } },
    ],
  },
  {
    title: { de: '8. Haftung und Schadensersatz', en: '8. Liability and Damages' },
    clauses: [
      { label: { de: '8.1. Grundsatz:', en: '8.1. General:' }, body: { de: 'Die iROC GmbH haftet unbeschränkt für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit, die auf einer vorsätzlichen oder fahrlässigen Pflichtverletzung der iROC GmbH oder eines ihrer gesetzlichen Vertreter oder Erfüllungsgehilfen beruhen.', en: 'iROC GmbH is liable without limitation for damages arising from injury to life, limb or health that are based on an intentional or negligent breach of duty by iROC GmbH or one of its legal representatives or vicarious agents.' } },
      { label: { de: '8.2. Sonstige Schäden:', en: '8.2. Other damages:' }, body: { de: 'Für sonstige Schäden haftet die iROC GmbH nur, sofern diese auf einer vorsätzlichen oder grob fahrlässigen Pflichtverletzung der iROC GmbH oder eines ihrer gesetzlichen Vertreter oder Erfüllungsgehilfen beruhen.', en: 'For other damages, iROC GmbH is only liable if they are based on an intentional or grossly negligent breach of duty by iROC GmbH or one of its legal representatives or vicarious agents.' } },
      { label: { de: '8.3. Leichte Fahrlässigkeit:', en: '8.3. Slight negligence:' }, body: { de: 'Bei leicht fahrlässiger Verletzung wesentlicher Vertragspflichten (Kardinalpflichten) ist die Haftung der iROC GmbH auf den vertragstypischen, vorhersehbaren Schaden begrenzt. Wesentliche Vertragspflichten sind solche, deren Erfüllung die ordnungsgemäße Durchführung des Vertrages überhaupt erst ermöglicht und auf deren Einhaltung der Kunde regelmäßig vertrauen darf.', en: 'In the event of a slightly negligent breach of material contractual obligations (cardinal obligations), the liability of iROC GmbH is limited to the foreseeable damage typical of the contract. Material contractual obligations are those whose fulfilment makes the proper performance of the contract possible in the first place and on whose compliance the customer may regularly rely.' } },
      { label: { de: '8.4. Ausschluss:', en: '8.4. Exclusion:' }, body: { de: 'Der Kunde ist für die fachgerechte Lagerung, Anwendung und Handhabung der gelieferten medizinischen Produkte nach den jeweils gültigen gesetzlichen und fachlichen Standards verantwortlich. Eine Haftung der iROC GmbH für Schäden, die durch unsachgemäße Anwendung, Nichtbeachtung von Gebrauchsanweisungen oder unzulässige Modifikationen durch den Kunden entstehen, ist ausgeschlossen.', en: 'The customer is responsible for the proper storage, use and handling of the delivered medical products in accordance with the applicable legal and professional standards. Any liability of iROC GmbH for damages arising from improper use, failure to follow instructions for use or unauthorised modifications by the customer is excluded.' } },
      { label: { de: '8.5. Haftung:', en: '8.5. Statutory liability:' }, body: { de: 'Die Haftung nach dem Produkthaftungsgesetz sowie zwingende gesetzliche Haftungsvorschriften bleiben von den vorstehenden Haftungsbeschränkungen unberührt.', en: 'Liability under the German Product Liability Act and mandatory statutory liability provisions remain unaffected by the above limitations.' } },
    ],
  },
  {
    title: { de: '9. Erfüllungsort, Gerichtsstand und anwendbares Recht', en: '9. Place of Performance, Jurisdiction and Applicable Law' },
    clauses: [
      { label: { de: '9.1. Erfüllungsort:', en: '9.1. Place of performance:' }, body: { de: 'Erfüllungsort für alle Verpflichtungen aus dem Vertragsverhältnis ist der Sitz der iROC GmbH in 85609 Aschheim.', en: 'The place of performance for all obligations arising from the contractual relationship is the registered office of iROC GmbH in 85609 Aschheim.' } },
      { label: { de: '9.2. Gerichtsstand:', en: '9.2. Jurisdiction:' }, body: { de: 'Ausschließlicher Gerichtsstand für alle Streitigkeiten aus oder im Zusammenhang mit diesem Vertrag ist das für Aschheim zuständige Gericht (München), sofern der Kunde Kaufmann ist.', en: 'The exclusive place of jurisdiction for all disputes arising from or in connection with this contract is the court responsible for Aschheim (Munich), provided the customer is a merchant.' } },
      { label: { de: '9.3. Recht:', en: '9.3. Governing law:' }, body: { de: 'Es gilt ausschließlich das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts (CISG).', en: 'The law of the Federal Republic of Germany applies exclusively, to the exclusion of the UN Convention on Contracts for the International Sale of Goods (CISG).' } },
    ],
  },
  {
    title: { de: '10. Salvatorische Klausel', en: '10. Severability Clause' },
    clauses: [
      { label: { de: '10.1. Gültigkeit:', en: '10.1. Validity:' }, body: { de: 'Sollten einzelne Bestimmungen dieser AVB unwirksam oder undurchführbar sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen davon unberührt. Die Parteien werden die unwirksame Klausel durch eine rechtlich zulässige Regelung ersetzen, die dem wirtschaftlichen Zweck am nächsten kommt.', en: 'Should individual provisions of these GTC be or become invalid or unenforceable, the validity of the remaining provisions shall not be affected. The parties shall replace the invalid clause with a legally permissible provision that comes closest to the commercial purpose intended.' } },
    ],
  },
];

export default function Agb() {
  const { t } = useLanguage();

  return (
    <div className="py-20 bg-white min-h-screen">
      <div className="container mx-auto px-4 max-w-4xl prose prose-slate">
        <h1 className="text-4xl font-bold mb-8">
          {t('Allgemeine Verkaufsbedingungen (AVB) der iROC GmbH', 'General Terms and Conditions of Sale (GTC) of iROC GmbH')}
        </h1>
        <div className="space-y-8 text-slate-700">
          {sections.map((section) => (
            <section key={section.title.en}>
              <h2 className="text-xl font-bold">{t(section.title.de, section.title.en)}</h2>
              {section.clauses.map((clause) => (
                <p key={clause.label.en}>
                  <strong>{t(clause.label.de, clause.label.en)}</strong>{' '}
                  {t(clause.body.de, clause.body.en)}
                </p>
              ))}
            </section>
          ))}
        </div>
        <DynamicSections page="agb" />
      </div>
    </div>
  );
}
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { CheckCircle2, ChevronRight, FileText, Syringe, Activity } from 'lucide-react';
import spirecutLogo from '@assets/Spirecut_Logo_no_bg_1784563396698.JPG';
import patentImg from '@assets/Spirecut-Patent_1784563396850.jpg';
import instrumentsShot from '@assets/spirecut_instruments_product_shot.jpeg';
import ctInstrument from '@assets/spirecut_ct_instrument_detail.jpeg';
import tfInstrument from '@assets/spirecut_tf_instrument_detail.jpeg';
import procedureTf from '@assets/spirecut_procedure_tf_hand.jpeg';
import procedureAnatomy from '@assets/spirecut_procedure_anatomy.jpeg';
import { useVideoUrl } from '@/hooks/useVideoUrl';
import { useWebsiteSettings } from '@/hooks/useWebsiteSettings';
import { ExternalLink } from 'lucide-react';

function SpirecutVideoSection() {
  const { t } = useLanguage();
  const videoUrl = useVideoUrl('spirecut');
  if (!videoUrl) return null;
  return (
    <section className="py-16 bg-slate-50">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold mb-3">
            {t('Spirecut® in Aktion', 'Spirecut® in Action')}
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            {t(
              'Sehen Sie, wie die Spirecut-Methode bei Karpaltunnelsyndrom und Schnappfinger angewendet wird.',
              'See how the Spirecut method is applied for carpal tunnel syndrome and trigger finger.'
            )}
          </p>
        </div>
        <div className="relative w-full rounded-2xl overflow-hidden shadow-xl border bg-black aspect-video">
          <iframe
            src={videoUrl}
            title={t('Spirecut®-Video', 'Spirecut® video')}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 w-full h-full"
          />
        </div>
        <p className="text-center text-xs text-muted-foreground mt-4">
          {t('Spirecut® bei Karpaltunnelsyndrom und Schnappfinger — Videodemo', 'Spirecut® for Carpal Tunnel Syndrome and Trigger Finger — Video Demo')}
        </p>
      </div>
    </section>
  );
}

export default function Spirecut() {
  const { t } = useLanguage();
  const { ws_spirecut_company_url } = useWebsiteSettings();

  return (
    <div className="flex flex-col w-full bg-white">
      {/* Product Header */}
      <section className="py-20 border-b bg-muted/20">
        <div className="container mx-auto px-4 max-w-6xl flex flex-col md:flex-row items-center gap-12">
          <div className="flex-1">
            <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-white mb-6">
              {t('Minimalinvasive Chirurgie', 'Minimally Invasive Surgery')}
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">Spirecut®</h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-xl">
              {t(
                'Ultraschallgesteuerte minimalinvasive Sono-Instrumente® für die Handchirurgie. Patentiert und CE-zertifiziert.',
                'Ultrasound-guided minimally invasive Sono-Instruments® for hand surgery. Patented and CE-certified.'
              )}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
              <Button asChild size="lg">
                <Link href="/order">{t('Instrument bestellen', 'Order Instrument')}</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/training/spirecut">{t('Zur Schulung anmelden', 'Register for Training')}</Link>
              </Button>
              {ws_spirecut_company_url && (
                <Button asChild variant="outline" size="lg">
                  <a href={ws_spirecut_company_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                    <ExternalLink className="w-4 h-4" />
                    {t('Hersteller-Website', 'Manufacturer Website')}
                  </a>
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 w-full flex justify-center">
            <img src={spirecutLogo} alt="Spirecut Logo" className="w-full max-w-md mix-blend-multiply" />
          </div>
        </div>
      </section>

      {/* Instruments Product Shot */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3">{t('Die Sono-Instrumente®', 'The Sono-Instruments®')}</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              {t(
                'Perkutane ultraschallgesteuerte Instrumente für die Durchtrennung des Karpaltunnels und des Ringbandes. Einmalprodukte im sterilen Einzel-Kit.',
                'Percutaneous sonography-guided instruments for carpal tunnel and trigger finger release. Single-use sterile kits.'
              )}
            </p>
          </div>
          <div className="rounded-2xl overflow-hidden border shadow-sm bg-slate-50">
            <img
              src={instrumentsShot}
              alt={t('Spirecut Sono-Instrumente® – CTS und TF', 'Spirecut Sono-Instruments® – CTS and TF')}
              className="w-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* Overview & Benefits */}
      <section className="py-20 bg-muted/10">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-6">{t('Eine Revolution in der Handchirurgie', 'A Revolution in Hand Surgery')}</h2>
              <p className="text-lg text-muted-foreground mb-6">
                {t(
                  'Spirecut bietet Sono-Instrumente®, die entwickelt wurden, um Schnappfinger und Karpaltunnelsyndrom ohne Hautinzision zu behandeln. Das Verfahren ist echogesteuert, sicher und ermöglicht eine sofortige Wiederaufnahme der Aktivität.',
                  'Spirecut offers Sono-Instruments® designed to treat trigger finger and carpal tunnel syndrome without skin incision. The procedure is echo-guided, safe, and allows immediate resumption of activity.'
                )}
              </p>
              <ul className="space-y-4 mb-8">
                {[
                  t('Keine Hautinzision notwendig', 'No skin incision required'),
                  t('Lokalanästhesie in der Arztpraxis', 'Local anaesthesia in the doctor\'s office'),
                  t('Sofortige Rückkehr zur normalen Aktivität', 'Immediate return to normal activity'),
                  t('Keine Narbenbildung, reduzierte postoperative Pflege', 'No scarring, reduced postoperative care'),
                  t('Gleichzeitige Behandlung mehrerer Finger möglich', 'Simultaneous treatment of multiple fingers possible'),
                ].map((benefit, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <CheckCircle2 className="w-6 h-6 text-primary shrink-0 mt-0.5" />
                    <span className="font-medium">{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white p-8 rounded-2xl border shadow-sm">
              <h3 className="text-xl font-bold mb-6 border-b pb-4">{t('Verfügbare Produkte', 'Available Products')}</h3>
              <div className="space-y-6">
                <div>
                  <h4 className="font-bold text-lg flex items-center gap-2"><Syringe className="w-5 h-5 text-primary" /> {t('Schnappfinger-Sono-Instrument® (TF)', 'Trigger Finger Sono-Instrument® (TF)')}</h4>
                  <p className="text-muted-foreground text-sm mt-1">{t('Für die perkutane Durchtrennung des A1-Ringbandes.', 'For percutaneous release of the A1 annular pulley.')}</p>
                </div>
                <div>
                  <h4 className="font-bold text-lg flex items-center gap-2"><Activity className="w-5 h-5 text-primary" /> {t('Karpaltunnel-Sono-Instrument® (CTS)', 'Carpal Tunnel Sono-Instrument® (CTS)')}</h4>
                  <p className="text-muted-foreground text-sm mt-1">{t('Für die perkutane Durchtrennung des Retinaculum flexorum.', 'For percutaneous release of the flexor retinaculum.')}</p>
                </div>
                <div>
                  <h4 className="font-bold text-lg flex items-center gap-2"><FileText className="w-5 h-5 text-primary" /> Sono-Pack®</h4>
                  <p className="text-muted-foreground text-sm mt-1">{t('Verbrauchsmaterialien für optimale Ultraschall-Bedingungen.', 'Consumables for optimal ultrasound conditions.')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Instrument Detail Section */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4 max-w-6xl">
          <h2 className="text-3xl font-bold text-center mb-4">
            {t('Instrumenten-Anatomie', 'Instrument Anatomy')}
          </h2>
          <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
            {t(
              'Jedes Sono-Instrument® ist ein Einmalprodukt im sterilen Kit mit fünf präzise konstruierten Komponenten: Schneidspitze, Spiralrille, Schaft, Durchmesser 1,5 mm und ergonomischer Griff.',
              'Each Sono-Instrument® is a single-use sterile kit with five precisely engineered components: cutting tip, spiral groove, rod, 1.5 mm diameter, and ergonomic handle.'
            )}
          </p>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-slate-50 rounded-2xl border p-6">
              <div className="text-sm font-semibold text-primary mb-3 uppercase tracking-wider">{t('Karpaltunnel-Sono-Instrument® (CT)', 'Carpal Tunnel Sono-Instrument® (CT)')}</div>
              <img
                src={ctInstrument}
                alt={t('Karpaltunnel-Sono-Instrument® – CT', 'Carpal Tunnel Sono-Instrument® – CT')}
                className="w-full object-contain"
              />
              <p className="text-sm text-muted-foreground mt-4">
                {t(
                  'Für den Karpaltunnel anatomisch optimierter Schaft. Die Schneidspitze mit lateralen Flanschen erhöht die Echogenität unter Ultraschall.',
                  'Rod optimised for carpal tunnel anatomy. The cutting tip with lateral flanges enhances echogenicity under ultrasound.'
                )}
              </p>
            </div>
            <div className="bg-slate-50 rounded-2xl border p-6">
              <div className="text-sm font-semibold text-primary mb-3 uppercase tracking-wider">{t('Schnappfinger-Sono-Instrument® (TF)', 'Trigger Finger Sono-Instrument® (TF)')}</div>
              <img
                src={tfInstrument}
                alt={t('Schnappfinger-Sono-Instrument® – TF', 'Trigger Finger Sono-Instrument® – TF')}
                className="w-full object-contain"
              />
              <p className="text-sm text-muted-foreground mt-4">
                {t(
                  'Für die digitale Flexorscheide optimierter Schaft. Spiralrille visualisiert das Instrument unter Sonographie und gibt Auskunft über die Rotationsausrichtung.',
                  'Rod optimised for the digital flexor sheath. The spiral groove visualises the instrument under sonography and indicates rotational alignment.'
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Procedure Illustrations */}
      <section className="py-20 bg-muted/10">
        <div className="container mx-auto px-4 max-w-6xl">
          <h2 className="text-3xl font-bold text-center mb-4">
            {t('Das Verfahren', 'The Procedure')}
          </h2>
          <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
            {t(
              'Das Instrument wird durch einen 14 Gauge IV-Katheter eingeführt und unter Echtzeit-Sonographie gesteuert. Keine Hautinzision. Die Freigabe erfolgt durch rotierende Schnittbewegungen in der Sagittalebene.',
              'The instrument is introduced via a 14 Gauge IV catheter and guided under real-time sonography. No skin incision. Release is performed by rotating crocheting movements in the sagittal plane.'
            )}
          </p>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="rounded-2xl overflow-hidden border shadow-sm bg-white">
              <img
                src={procedureTf}
                alt={t('Spirecut TF Verfahren – Handchirurgie Illustration', 'Spirecut TF Procedure – Hand Surgery Illustration')}
                className="w-full object-cover"
              />
              <div className="p-4 border-t">
                <p className="text-sm text-muted-foreground font-medium">
                  {t('Einführung des TF-Instruments durch einen Katheter an der Basis des Fingers', 'Introduction of the TF instrument via catheter at the base of the finger')}
                </p>
              </div>
            </div>
            <div className="rounded-2xl overflow-hidden border shadow-sm bg-white">
              <img
                src={procedureAnatomy}
                alt={t('Spirecut anatomische Schnittillustration', 'Spirecut anatomical cross-section illustration')}
                className="w-full object-cover"
              />
              <div className="p-4 border-t">
                <p className="text-sm text-muted-foreground font-medium">
                  {t('Anatomischer Querschnitt: Durchtrennung des A1-Ringbandes unter Ultraschallkontrolle', 'Anatomical cross-section: release of the A1 annular pulley under ultrasound guidance')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* YouTube Video */}
      <SpirecutVideoSection />

      {/* Patent & Certification */}
      <section className="py-20 bg-primary text-white">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <img src={patentImg} alt="Spirecut Patent" className="rounded-xl shadow-2xl border-4 border-white/10" />
            </div>
            <div>
              <h2 className="text-3xl font-bold mb-6">{t('Patentiert und CE-Gekennzeichnet', 'Patented and CE Marked')}</h2>
              <p className="text-lg text-white/80 mb-6 leading-relaxed">
                {t(
                  'Die Instrumente wurden in der Schweiz entwickelt und patentiert. Sie erfüllen alle europäischen Medizinprodukte-Standards (CE-Kennzeichnung) und sind FDA-registriert. Wir bei iROC sind stolz darauf, exklusiver Vertriebspartner und Schulungsanbieter für Spirecut im deutschsprachigen Raum zu sein.',
                  'The instruments were developed and patented in Switzerland. They meet all European medical device standards (CE marking) and are FDA-registered. We at iROC are proud to be the exclusive distributor and training provider for Spirecut in the German-speaking region.'
                )}
              </p>
              <Button asChild variant="outline" className="bg-white/10 text-white border-white/30 hover:bg-white/20">
                <Link href="/doctors" className="flex items-center gap-2">
                  {t('Liste zertifizierter Ärzte ansehen', 'View list of certified doctors')} <ChevronRight className="w-4 h-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { CheckCircle2, ChevronRight, Dna, Microscope, HeartPulse } from 'lucide-react';
import ministemImg from '@assets/MiniStem_1784563417154.png';
import { useVideoUrl } from '@/hooks/useVideoUrl';
import { useWebsiteSettings } from '@/hooks/useWebsiteSettings';
import { ExternalLink } from 'lucide-react';

function MiniStemVideoSection() {
  const { t } = useLanguage();
  const videoUrl = useVideoUrl('ministem');
  if (!videoUrl) return null;
  return (
    <section className="py-16 bg-slate-50">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold mb-3">
            {t('MiniStem® in Aktion', 'MiniStem® in Action')}
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            {t(
              'Sehen Sie das MiniStem®-System in der klinischen Anwendung.',
              'See the MiniStem® system in clinical application.'
            )}
          </p>
        </div>
        <div className="relative w-full rounded-2xl overflow-hidden shadow-xl border bg-black aspect-video">
          <iframe
            src={videoUrl}
            title={t('MiniStem®-Video', 'MiniStem® video')}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 w-full h-full"
          />
        </div>
        <p className="text-center text-xs text-muted-foreground mt-4">
          {t('MiniStem® — Videodemo', 'MiniStem® — Video Demo')}
        </p>
      </div>
    </section>
  );
}

export default function MiniStem() {
  const { t } = useLanguage();
  const { ws_ministem_company_url } = useWebsiteSettings();

  return (
    <div className="flex flex-col w-full bg-white">
      {/* Product Header */}
      <section className="py-20 border-b bg-muted/20">
        <div className="container mx-auto px-4 max-w-6xl flex flex-col md:flex-row items-center gap-12">
          <div className="flex-1">
            <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-white mb-6">
              {t('Regenerative Medizin', 'Regenerative Medicine')}
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">MiniStem®</h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-xl">
              {t(
                'Point-of-Care regenerative Orthobiologie. Microfat und SVF (Stromal Vascular Fraction) Stammzelltherapie direkt in Ihrer Praxis.',
                'Point-of-care regenerative orthobiology. Microfat and SVF (Stromal Vascular Fraction) stem cell therapy right in your practice.'
              )}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
              <Button asChild size="lg">
                <Link href="/order">{t('System bestellen', 'Order System')}</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/training/ministem">{t('Zur Schulung anmelden', 'Register for Training')}</Link>
              </Button>
              {ws_ministem_company_url && (
                <Button asChild variant="outline" size="lg">
                  <a href={ws_ministem_company_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                    <ExternalLink className="w-4 h-4" />
                    {t('Hersteller-Website', 'Manufacturer Website')}
                  </a>
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 w-full flex justify-center">
            <img src={ministemImg} alt={t('MiniStem®-Produkt', 'MiniStem® product')} className="w-full max-w-md" />
          </div>
        </div>
      </section>

      {/* Overview & Benefits */}
      <section className="py-20">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-6">{t('Die Kraft der eigenen Zellen', 'The Power of Your Own Cells')}</h2>
              <p className="text-lg text-muted-foreground mb-6">
                {t(
                  'MiniStem von Jointechlabs Inc. ermöglicht eine standardisierte, geschlossene und schnelle Gewinnung von Microfat und SVF aus dem Fettgewebe des Patienten. Diese Therapie wird zur Behandlung von Arthrose, Sehnenverletzungen und degenerativen Gelenkerkrankungen eingesetzt.',
                  'MiniStem by Jointechlabs Inc. enables standardized, closed, and rapid harvesting of Microfat and SVF from the patient\'s adipose tissue. This therapy is used to treat osteoarthritis, tendon injuries, and degenerative joint diseases.'
                )}
              </p>
              
              <ul className="space-y-4 mb-8">
                {[
                  t('Geschlossenes System (Point-of-Care)', 'Closed system (Point-of-Care)'),
                  t('Einfache Handhabung in der Praxis', 'Easy handling in the practice'),
                  t('Hohe Vitalität und Ausbeute an Stammzellen', 'High viability and yield of stem cells'),
                  t('Autologes Verfahren - keine Abstoßungsreaktion', 'Autologous procedure - no rejection'),
                ].map((benefit, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <CheckCircle2 className="w-6 h-6 text-primary shrink-0" />
                    <span className="font-medium">{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
            
            <div className="grid gap-6">
              <div className="bg-white p-6 rounded-2xl border shadow-sm flex gap-4">
                <Dna className="w-10 h-10 text-primary shrink-0" />
                <div>
                  <h4 className="font-bold text-lg">{t('Microfat & SVF', 'Microfat & SVF')}</h4>
                  <p className="text-muted-foreground text-sm mt-1">{t('Gewinnung der Stromal Vascular Fraction (SVF) ohne enzymatische Verdauung.', 'Harvesting of Stromal Vascular Fraction (SVF) without enzymatic digestion.')}</p>
                </div>
              </div>
              <div className="bg-white p-6 rounded-2xl border shadow-sm flex gap-4">
                <Microscope className="w-10 h-10 text-primary shrink-0" />
                <div>
                  <h4 className="font-bold text-lg">{t('Wissenschaftlich belegt', 'Scientifically proven')}</h4>
                  <p className="text-muted-foreground text-sm mt-1">{t('Klinische Studien belegen die Wirksamkeit bei Gelenkverschleiß.', 'Clinical studies prove efficacy in joint degeneration.')}</p>
                </div>
              </div>
              <div className="bg-white p-6 rounded-2xl border shadow-sm flex gap-4">
                <HeartPulse className="w-10 h-10 text-primary shrink-0" />
                <div>
                  <h4 className="font-bold text-lg">{t('Patientenkomfort', 'Patient comfort')}</h4>
                  <p className="text-muted-foreground text-sm mt-1">{t('Minimaler Eingriff zur Fettabsaugung unter Lokalanästhesie.', 'Minimal intervention for liposuction under local anesthesia.')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* YouTube Video */}
      <MiniStemVideoSection />

      {/* Call to Action */}
      <section className="py-24 bg-muted/40 text-center">
        <div className="container mx-auto px-4 max-w-3xl">
          <h2 className="text-3xl font-bold mb-6">{t('Bereit für die Zukunft der Orthopädie?', 'Ready for the future of orthopedics?')}</h2>
          <p className="text-lg text-muted-foreground mb-8">
            {t(
              'Erweitern Sie Ihr Praxisangebot um fortschrittliche regenerative Therapien. Wir bieten umfassende Schulungen und Support.',
              'Expand your practice offerings with advanced regenerative therapies. We provide comprehensive training and support.'
            )}
          </p>
          <Button asChild size="lg" className="h-14 px-8">
            <Link href="/training/ministem" className="flex items-center gap-2">
              {t('MiniStem Schulung buchen', 'Book MiniStem Training')} <ChevronRight className="w-5 h-5" />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

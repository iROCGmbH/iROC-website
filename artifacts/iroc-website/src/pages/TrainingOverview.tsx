import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { GraduationCap, ArrowRight } from 'lucide-react';
import spirecutLogo from '@assets/Spirecut_Logo_no_bg_1784563396698.JPG';
import ministemImg from '@assets/MiniStem_1784563417154.png';

export default function TrainingOverview() {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col w-full bg-white">
      <section className="py-20 border-b bg-primary text-white">
        <div className="container mx-auto px-4 max-w-5xl text-center">
          <GraduationCap className="w-16 h-16 mx-auto mb-6 opacity-80" />
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
            {t('iROC Schulungsakademie', 'iROC Training Academy')}
          </h1>
          <p className="text-xl text-primary-foreground/80 max-w-2xl mx-auto">
            {t(
              'Werden Sie zertifizierter Anwender. Wir bieten spezialisierte Hands-on-Workshops für unsere medizinischen Instrumente.',
              'Become a certified user. We offer specialized hands-on workshops for our medical instruments.'
            )}
          </p>
        </div>
      </section>

      <section className="py-24">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="grid md:grid-cols-2 gap-12">
            
            {/* Spirecut Training */}
            <div className="bg-white border rounded-3xl overflow-hidden shadow-sm hover:shadow-xl transition-all flex flex-col">
              <div className="p-8 border-b bg-slate-50 flex justify-center items-center h-48">
                <img src={spirecutLogo} alt="Spirecut" className="max-h-full mix-blend-multiply" />
              </div>
              <div className="p-8 flex flex-col flex-1">
                <h2 className="text-2xl font-bold mb-4">{t('Spirecut Zertifizierung', 'Spirecut Certification')}</h2>
                <p className="text-muted-foreground mb-8 flex-1">
                  {t(
                    'Erlernen Sie die ultraschallgesteuerte Technik zur Spaltung des Ringbandes und des Retinaculum flexorum am anatomischen Präparat.',
                    'Learn the ultrasound-guided technique for dividing the pulley and flexor retinaculum on anatomical specimens.'
                  )}
                </p>
                <ul className="space-y-3 text-sm mb-8 bg-muted/30 p-4 rounded-xl">
                  <li><strong>{t('Format:', 'Format:')}</strong> {t('Praktischer Workshop (Wet-Lab)', 'Hands-on Workshop (Wet-Lab)')}</li>
                  <li><strong>{t('Dauer:', 'Duration:')}</strong> {t('1 Tag', '1 Day')}</li>
                  <li><strong>{t('Zielgruppe:', 'Target group:')}</strong> {t('Handchirurgen, Orthopäden', 'Hand surgeons, orthopedists')}</li>
                </ul>
                <Button asChild size="lg" className="w-full">
                  <Link href="/training/spirecut">
                    {t('Termine & Anmeldung', 'Dates & Registration')} <ArrowRight className="ml-2 w-4 h-4" />
                  </Link>
                </Button>
              </div>
            </div>

            {/* MiniStem Training */}
            <div className="bg-white border rounded-3xl overflow-hidden shadow-sm hover:shadow-xl transition-all flex flex-col">
              <div className="p-8 border-b bg-slate-50 flex justify-center items-center h-48">
                <img src={ministemImg} alt="MiniStem" className="max-h-full" />
              </div>
              <div className="p-8 flex flex-col flex-1">
                <h2 className="text-2xl font-bold mb-4">{t('MiniStem Zertifizierung', 'MiniStem Certification')}</h2>
                <p className="text-muted-foreground mb-8 flex-1">
                  {t(
                    'Trainieren Sie die Entnahme von Fettgewebe und die Aufbereitung von Microfat und SVF für die orthobiologische Anwendung.',
                    'Train the harvesting of adipose tissue and the preparation of Microfat and SVF for orthobiological application.'
                  )}
                </p>
                <ul className="space-y-3 text-sm mb-8 bg-muted/30 p-4 rounded-xl">
                  <li><strong>{t('Format:', 'Format:')}</strong> {t('Hands-on Workshop & Theorie', 'Hands-on Workshop & Theory')}</li>
                  <li><strong>{t('Dauer:', 'Duration:')}</strong> {t('1 Tag', '1 Day')}</li>
                  <li><strong>{t('Zielgruppe:', 'Target group:')}</strong> {t('Orthopäden, Sportmediziner', 'Orthopedists, sports physicians')}</li>
                </ul>
                <Button asChild size="lg" className="w-full">
                  <Link href="/training/ministem">
                    {t('Termine & Anmeldung', 'Dates & Registration')} <ArrowRight className="ml-2 w-4 h-4" />
                  </Link>
                </Button>
              </div>
            </div>

          </div>
        </div>
      </section>
    </div>
  );
}

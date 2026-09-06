import { useGetTrainingDates } from '@workspace/api-client-react';
import TrainingRegistrationForm from '@/components/TrainingRegistrationForm';
import { TrainingRegistrationInputInstrument } from '@workspace/api-client-react';
import { useLanguage } from '@/contexts/LanguageContext';

export default function MiniStemTraining() {
  const { t } = useLanguage();
  const { data: dates = [] } = useGetTrainingDates({ query: { queryKey: ['trainingDates'] } });
  const ministemDates = dates.filter(d => d.instrument === 'ministem' && d.isActive);

  return (
    <div className="py-20 bg-muted/10 min-h-screen">
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="text-2xl sm:text-4xl font-bold mb-4">
          MiniStem® {t('Schulungsanmeldung', 'Training Registration')}
        </h1>
        <p className="text-muted-foreground mb-8">
          {t(
            'Erlernen Sie in unseren Praxisschulungen die Anwendung des MiniStem®-Systems zur Gewinnung und Aufbereitung von MFAT und SVF – Schritt für Schritt, sicher und effizient. Erweitern Sie Ihr Behandlungsspektrum um moderne regenerative Therapieansätze.',
            'Learn how to use the MiniStem® system for harvesting and processing MFAT and SVF in our hands-on training courses — step by step, safe and efficient. Expand your treatment options with cutting-edge regenerative therapies.'
          )}
        </p>

        {/* Fee & cancellation info */}
        <div className="space-y-3 mb-10">
          <div className="bg-primary/5 border border-primary/20 rounded-xl px-6 py-4 flex items-start gap-4">
            <span className="text-2xl mt-0.5">💶</span>
            <div>
              <p className="font-semibold text-base">
                {t('Teilnahmegebühr: 650 €', 'Training fee: €650')}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t(
                  'Die Gebühr wird vollständig auf Ihre erste Bestellung von Behandlungskits angerechnet.',
                  'The fee is fully credited against your first order of treatment kits.'
                )}
              </p>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 flex items-start gap-4">
            <span className="text-2xl mt-0.5">⚠️</span>
            <div>
              <p className="font-semibold text-sm text-amber-800">
                {t('Stornierungsbedingungen', 'Cancellation policy')}
              </p>
              <p className="text-sm text-amber-700 mt-0.5">
                {t(
                  'Bei Absage innerhalb von 14 Tagen vor dem Schulungstermin oder Nichterscheinen werden Materialkosten berechnet, da Schulungsmaterialien individuell für jeden Teilnehmer bestellt werden.',
                  'Cancellations within 14 days of the training date or no-shows will incur material costs, as training materials are ordered individually for each participant.'
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-8 rounded-2xl border shadow-sm">
          <TrainingRegistrationForm
            instrument={TrainingRegistrationInputInstrument.ministem}
            dates={ministemDates}
          />
        </div>
      </div>
    </div>
  );
}

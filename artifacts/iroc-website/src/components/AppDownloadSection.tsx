import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWebsiteSettings } from '@/hooks/useWebsiteSettings';
import { Smartphone } from 'lucide-react';

const DEFAULT_PORTAL_URL = 'https://portal.i-roc.de';

function QRBlock({ url, color }: { url: string; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // QR code drawing depends on the browser Canvas API, which jsdom does not
    // implement. Unit tests still exercise the surrounding content and link.
    if (import.meta.env.MODE === 'test') return;
    if (!canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, url, {
      width: 180,
      margin: 1,
      color: { dark: color, light: '#ffffff' },
    }).catch((error: unknown) => {
      console.error('Unable to render portal QR code.', error);
    });
  }, [url, color]);

  return <canvas ref={canvasRef} className="rounded-sm" />;
}

export function AppDownloadSection() {
  const { t } = useLanguage();
  const { ws_webapp_url } = useWebsiteSettings();
  const portalUrl = ws_webapp_url || DEFAULT_PORTAL_URL;

  return (
    <section className="py-20 bg-white border-t border-gray-100">
      <div className="container mx-auto px-4 max-w-5xl">

        {/* Heading */}
        <div className="text-center mb-14">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">
            {t('Für Ärzte', 'For Doctors')}
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            {t('iROC Arztportal als App nutzen', 'Use the iROC Doctor Portal as an App')}
          </h2>
          <p className="text-gray-500 max-w-xl mx-auto">
            {t(
              'Das iROC Ärzteportal ist direkt im Browser verfügbar – und lässt sich auf jedem Smartphone wie eine native App installieren. Kein App Store, keine Installation.',
              'The iROC Doctor Portal runs in your browser and can be installed on any smartphone like a native app — no App Store, no download required.'
            )}
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-10 items-start">

          {/* QR Code card */}
          <div className="flex flex-col items-center bg-gray-50 rounded-2xl p-8 border border-gray-200 shadow-sm">
            <p className="text-sm font-semibold text-gray-700 mb-5">
              {t('Mit dem Smartphone scannen', 'Scan with your smartphone')}
            </p>
            <div className="p-4 bg-white rounded-xl shadow-inner border border-gray-100">
              <QRBlock url={portalUrl} color="#002244" />
            </div>
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 text-xs text-gray-400 break-all hover:text-primary hover:underline text-center"
            >
              {portalUrl}
            </a>
          </div>

          {/* Step-by-step instructions */}
          <div className="space-y-8">

            {/* iOS */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center shrink-0">
                  <Smartphone className="w-4 h-4 text-white" />
                </div>
                <span className="font-semibold text-gray-900">{t('iPhone / iPad (Safari)', 'iPhone / iPad (Safari)')}</span>
              </div>
              <ol className="space-y-3 pl-10">
                {[
                  t('QR-Code scannen oder Link im Safari öffnen', 'Scan the QR code or open the link in Safari'),
                  t('Auf das Teilen-Symbol tippen (Quadrat mit Pfeil nach oben)', 'Tap the Share icon (square with upward arrow)'),
                  t('„Zum Home-Bildschirm" wählen', 'Select "Add to Home Screen"'),
                  t('Namen bestätigen und auf „Hinzufügen" tippen', 'Confirm the name and tap "Add"'),
                ].map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm text-gray-600">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>

            {/* Android */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-[#3ddc84] flex items-center justify-center shrink-0">
                  <Smartphone className="w-4 h-4 text-white" />
                </div>
                <span className="font-semibold text-gray-900">{t('Android (Chrome)', 'Android (Chrome)')}</span>
              </div>
              <ol className="space-y-3 pl-10">
                {[
                  t('QR-Code scannen oder Link in Chrome öffnen', 'Scan the QR code or open the link in Chrome'),
                  t('Auf „App installieren" tippen – Chrome zeigt automatisch eine Aufforderung an', 'Tap "Install App" — Chrome shows a prompt automatically'),
                  t('Alternativ: Dreipunkt-Menü → „Zum Startbildschirm hinzufügen"', 'Or: three-dot menu → "Add to Home Screen"'),
                ].map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm text-gray-600">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-[#3ddc84]/20 text-[#1a7a40] font-bold text-xs flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>

          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-12">
          {t(
            'Das Portal funktioniert auch direkt im Browser auf jedem Desktop-Computer.',
            'The portal also works directly in any desktop browser.'
          )}
        </p>

      </div>
    </section>
  );
}

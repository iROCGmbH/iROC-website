import { useState, useEffect, useRef } from 'react';
import { X, Download } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';

const DISMISS_KEY = 'iroc_install_banner_dismissed';
const DISMISS_DAYS = 14;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as NavigatorWithStandalone).standalone === true
  );
}
function isDismissed() {
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  return Date.now() < Number(raw);
}

export function InstallBanner() {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<'android-native' | null>(null);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || isDismissed()) return;

    // Android Chrome: capture the native install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      setPlatform('android-native');
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (!visible) return;

    const handler = () => {
      setVisible(false);
      deferredPrompt.current = null;
      localStorage.removeItem(DISMISS_KEY);
    };
    window.addEventListener('appinstalled', handler);

    return () => window.removeEventListener('appinstalled', handler);
  }, [visible]);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400000));
  };

  const triggerInstall = async () => {
    const prompt = deferredPrompt.current;
    if (!prompt) return;

    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome !== 'accepted') {
        dismiss();
        return;
      }
      setVisible(false);
      localStorage.removeItem(DISMISS_KEY);
    } catch {
      // The browser has already consumed this one-shot event. Hide the banner
      // rather than leaving an install action that can no longer do anything.
      dismiss();
    } finally {
      // A beforeinstallprompt event may only be used once. Never leave a
      // visible banner with an exhausted prompt after a browser error.
      deferredPrompt.current = null;
    }
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-[5.5rem] left-4 right-4 z-50 bg-slate-900/95 backdrop-blur-xl text-white rounded-3xl shadow-2xl border border-white/10 overflow-hidden"
      style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-start gap-4 p-5">
        {/* App icon */}
        <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center shrink-0 font-bold text-2xl select-none shadow-inner border border-white/20">
          i
        </div>

        <div className="flex-1 min-w-0 py-0.5">
          <p className="font-semibold text-[15px] leading-snug">
            {t('iROC app installieren', 'Install iROC app')}
          </p>

          {platform === 'android-native' ? (
            <p className="text-sm text-white/70 mt-1">
              {t('Einmal installieren – kein Browser mehr nötig.', 'Install once — no browser needed.')}
            </p>
          ) : null}
        </div>

        <button
          onClick={dismiss}
          className="p-1.5 -mr-1 -mt-1 rounded-full bg-white/10 hover:bg-white/20 transition-colors shrink-0"
          aria-label={t('Schließen', 'Close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Native Android install button */}
      {platform === 'android-native' && (
        <div className="px-5 pb-5 pt-1 flex gap-3">
          <Button
            size="default"
            className="flex-1 bg-white text-slate-900 hover:bg-slate-100 font-semibold h-11 rounded-xl"
            onClick={triggerInstall}
          >
            <Download className="w-4 h-4 mr-2" />
            {t('Jetzt installieren', 'Install Now')}
          </Button>
          <Button
            size="default"
            variant="ghost"
            className="text-white/70 hover:text-white hover:bg-white/10 font-medium h-11 px-5 rounded-xl"
            onClick={dismiss}
          >
            {t('Später', 'Later')}
          </Button>
        </div>
      )}
    </div>
  );
}

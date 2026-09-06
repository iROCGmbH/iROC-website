import { useState, useEffect } from 'react';
import { useWebsiteSettings } from '@/hooks/useWebsiteSettings';
import logoNew from '@assets/image_1784723755135.png';

const SESSION_KEY = 'iroc_medical_gate_passed';

const DEFAULT_TITLE_DE = 'Diese Website richtet sich ausschließlich an Ärzte und medizinische Fachkräfte.';
const DEFAULT_TITLE_EN = 'This website is intended exclusively for medical doctors and healthcare professionals.';
const DEFAULT_BODY_DE  = 'Sind Sie kein Arzt oder keine medizinische Fachkraft? Dann besuchen Sie bitte unsere Patientenwebsite.';
const DEFAULT_BODY_EN  = 'Are you not a medical doctor or healthcare professional? Please visit our patient website instead.';
const DEFAULT_LINK_URL = 'https://www.spirecut.de';

export function MedicalGate() {
  const ws = useWebsiteSettings();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (ws.ws_gate_enabled !== 'false' && !sessionStorage.getItem(SESSION_KEY)) {
      setVisible(true);
    }
  }, [ws.ws_gate_enabled]);

  if (!visible) return null;

  const titleDe = ws.ws_gate_title_de || DEFAULT_TITLE_DE;
  const titleEn = ws.ws_gate_title_en || DEFAULT_TITLE_EN;
  const bodyDe  = ws.ws_gate_body_de  || DEFAULT_BODY_DE;
  const bodyEn  = ws.ws_gate_body_en  || DEFAULT_BODY_EN;
  const linkUrl = ws.ws_gate_link_url || DEFAULT_LINK_URL;
  const linkHost = (() => { try { return new URL(linkUrl).hostname.replace(/^www\./, ''); } catch { return linkUrl; } })();

  function handleContinue() {
    sessionStorage.setItem(SESSION_KEY, '1');
    setVisible(false);
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="medical-gate-title"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl overflow-hidden">

        {/* Header band */}
        <div className="bg-primary px-8 py-5 flex flex-col items-center gap-2">
          {ws.ws_logo_url ? (
            <div className="h-9 flex items-center bg-white/15 rounded px-2">
              <img src={ws.ws_logo_url} alt="iROC GmbH" className="max-h-full w-auto object-contain" />
            </div>
          ) : (
            <img src={logoNew} alt="iROC GmbH" className="h-9 w-auto" />
          )}
          <p className="text-primary-foreground/80 text-[10px] tracking-widest uppercase font-semibold">
            Medizinischer Fachbereich &nbsp;·&nbsp; Medical Professional Area
          </p>
        </div>

        {/* Body */}
        <div className="px-8 py-7 text-center space-y-4">
          {/* Warning icon */}
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-50 border-2 border-amber-300 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-amber-500">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>

          {/* DE + EN titles */}
          <div id="medical-gate-title" className="space-y-1">
            <p className="text-base font-bold text-gray-900 leading-snug">{titleDe}</p>
            <p className="text-sm font-semibold text-gray-500 leading-snug">{titleEn}</p>
          </div>

          {/* DE + EN body */}
          <div className="space-y-1 text-sm leading-relaxed">
            <p className="text-gray-700">{bodyDe}</p>
            <p className="text-gray-400 text-xs">{bodyEn}</p>
          </div>

          {/* Link for non-doctors */}
          <a
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            <span>Zur Patientenwebsite / Visit patient website: <strong>{linkHost}</strong></span>
          </a>
        </div>

        {/* Confirm button */}
        <div className="px-8 pb-7 flex flex-col items-center gap-2">
          <button
            onClick={handleContinue}
            className="w-full rounded-xl bg-primary py-3 px-6 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {'Ja, ich bin Arzt\u00a0/\u00a0\u00c4rztin\u00a0\u2014\u00a0Weiter'}
            <span className="opacity-60 font-normal">{'\u00a0\u00a0/ Yes, I am a doctor \u2014 Continue'}</span>
          </button>
          <p className="text-[11px] text-gray-400 text-center">
            {'Mit dem Klick best\u00e4tigen Sie, dass Sie medizinisches Fachpersonal sind.\u00a0'}
            <span className="opacity-70">{'/ By continuing you confirm you are a healthcare professional.'}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

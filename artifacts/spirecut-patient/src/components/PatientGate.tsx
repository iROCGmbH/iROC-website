import { useState, useEffect } from 'react';
import { useSpirecutSettings } from '@/hooks/useSpirecutSettings';

const SESSION_KEY = 'spirecut_patient_gate_passed';

const DEFAULT_TITLE_DE = 'Diese Website richtet sich an Patienten und Interessierte.';
const DEFAULT_TITLE_EN = 'This website is intended for patients and interested individuals.';
const DEFAULT_BODY_DE  = 'Sind Sie Arzt oder medizinisches Fachpersonal? Dann besuchen Sie bitte die iROC GmbH Website.';
const DEFAULT_BODY_EN  = 'Are you a medical doctor or healthcare professional? Please visit the iROC GmbH website instead.';
const DEFAULT_LINK_URL = 'https://www.i-roc.de';

export function PatientGate() {
  const sp = useSpirecutSettings();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (sp.sp_gate_enabled !== 'false' && !sessionStorage.getItem(SESSION_KEY)) {
      setVisible(true);
    }
  }, [sp.sp_gate_enabled]);

  if (!visible) return null;

  const titleDe = sp.sp_gate_title_de || DEFAULT_TITLE_DE;
  const titleEn = sp.sp_gate_title_en || DEFAULT_TITLE_EN;
  const bodyDe  = sp.sp_gate_body_de  || DEFAULT_BODY_DE;
  const bodyEn  = sp.sp_gate_body_en  || DEFAULT_BODY_EN;
  const linkUrl = sp.sp_gate_link_url || DEFAULT_LINK_URL;
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
      aria-labelledby="patient-gate-title"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl overflow-hidden">

        {/* Header band */}
        <div className="bg-rose-50 border-b border-rose-100 px-8 py-5 flex flex-col items-center gap-2">
          <span className="text-gray-900 font-bold tracking-widest text-2xl">
            {'Spirecut\u00ae'}
          </span>
          <p className="text-primary/80 text-[10px] tracking-widest uppercase font-semibold">
            {'Patienteninformation \u00b7 Patient Information'}
          </p>
        </div>

        {/* Body */}
        <div className="px-8 py-7 text-center space-y-4">
          {/* Info icon */}
          <div className="mx-auto w-12 h-12 rounded-full bg-blue-50 border-2 border-blue-300 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-blue-500">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>

          {/* DE + EN titles */}
          <div id="patient-gate-title" className="space-y-1">
            <p className="text-base font-bold text-gray-900 leading-snug">{titleDe}</p>
            <p className="text-sm font-semibold text-gray-500 leading-snug">{titleEn}</p>
          </div>

          {/* DE + EN body */}
          <div className="space-y-1 text-sm leading-relaxed">
            <p className="text-gray-700">{bodyDe}</p>
            <p className="text-gray-400 text-xs">{bodyEn}</p>
          </div>

          {/* Link for medical professionals */}
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
            <span>{'Ärztewebsite / Doctor website: '}<strong>{linkHost}</strong></span>
          </a>
        </div>

        {/* Confirm button */}
        <div className="px-8 pb-7 flex flex-col items-center gap-2">
          <button
            onClick={handleContinue}
            className="w-full rounded-xl bg-primary py-3 px-6 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {'Ja, ich bin Patient\u00a0/\u00a0Patientin\u00a0\u2014\u00a0Weiter'}
            <span className="opacity-60 font-normal">{'\u00a0\u00a0/ Yes, I am a patient \u2014 Continue'}</span>
          </button>
          <p className="text-[11px] text-gray-400 text-center">
            {'Mit dem Klick bestätigen Sie, dass Sie Patient oder Interessierte/r sind.\u00a0'}
            <span className="opacity-70">{'/ By continuing you confirm you are a patient or visitor.'}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

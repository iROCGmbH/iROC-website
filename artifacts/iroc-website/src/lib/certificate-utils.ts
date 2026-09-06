export type CertInstrument = 'spirecut' | 'ministem';
export type CertLang = 'de' | 'en';

export function formatCertDate(iso: string, lang: CertLang = 'de'): string {
  try {
    const locale = lang === 'en' ? 'en-GB' : 'de-DE';
    return new Date(iso).toLocaleDateString(locale, {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Format trainingDateInfo while leaving already-localized text unchanged. */
export function formatTrainingDateInfo(
  info: string | null,
  lang: CertLang = 'de',
): string | null {
  if (!info) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(info) ? formatCertDate(info, lang) : info;
}
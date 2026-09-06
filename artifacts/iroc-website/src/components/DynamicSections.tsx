import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

interface CmsEntry {
  key: string;
  type: 'heading' | 'paragraph';
  text: string;
}

interface Props {
  page: string;
}

/**
 * Renders any custom sections the admin has added via "Add section" in the CMS.
 * Custom entries have keys matching `iroc.{page}.custom_h_{ts}` (heading)
 * or `iroc.{page}.custom_p_{ts}` (paragraph), sorted chronologically.
 */
export function DynamicSections({ page }: Props) {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<CmsEntry[]>([]);

  const load = useCallback(() => {
    fetch('/api/content/iroc')
      .then((r) => r.json())
      .then(
        (data: Record<string, { de: string; en: string; page: string }>) => {
          const prefix = `iroc.${page}.custom_`;
          const filtered = Object.entries(data)
            .filter(([key]) => key.startsWith(prefix))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, v]) => ({
              key,
              type: key.includes('.custom_h_')
                ? ('heading' as const)
                : ('paragraph' as const),
              text: t(v.de, v.en || v.de),
            }));
          setEntries(filtered);
        }
      )
      .catch(() => {});
  }, [page, t]);

  useEffect(() => {
    load();
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('iroc-cms-content-invalidate');
    bc.onmessage = () => load();
    return () => bc.close();
  }, [load]);

  if (entries.length === 0) return null;

  return (
    <>
      {entries.map((entry) =>
        entry.type === 'heading' ? (
          <h2 key={entry.key}>{entry.text}</h2>
        ) : (
          <p key={entry.key} style={{ whiteSpace: 'pre-line' }}>
            {entry.text}
          </p>
        )
      )}
    </>
  );
}

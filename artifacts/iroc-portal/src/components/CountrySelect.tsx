/**
 * CountrySelect — searchable combobox for country selection (portal copy).
 * Stores ISO 3166-1 alpha-2 codes (e.g. "DE"), displays full names.
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { Input } from './ui/input';

const ISO_CODES = [
  'AF','AL','DZ','AD','AO','AR','AM','AU','AT','AZ',
  'BS','BH','BD','BE','BY','BZ','BJ','BT','BO','BA','BW','BR','BN','BG',
  'KH','CM','CA','CF','TD','CL','CN','CO','CR','HR','CU','CY','CZ',
  'DK','DO',
  'EC','EG','EE','ET',
  'FI','FR',
  'GE','DE','GH','GR','GT','GN',
  'HT','HN','HK','HU',
  'IS','IN','ID','IR','IQ','IE','IL','IT',
  'JM','JP','JO',
  'KZ','KE','KW',
  'LV','LB','LS','LY','LI','LT','LU',
  'MG','MY','MV','ML','MT','MX','MD','MC','MN','ME','MA','MZ','MM',
  'NA','NP','NL','NZ','NI','NE','NG','MK','NO',
  'OM',
  'PK','PA','PY','PE','PH','PL','PT',
  'QA',
  'RO','RU','RW',
  'SA','SN','RS','SC','SG','SK','SI','SO','ZA','ES','LK','SE','CH','SY',
  'TW','TZ','TH','TG','TO','TT','TN','TR','TM',
  'UG','UA','AE','GB','US','UY','UZ',
  'VE','VN',
  'YE',
  'ZM','ZW',
];

interface CountrySelectProps {
  value: string;
  onChange: (code: string) => void;
  lang?: string;
  placeholder?: string;
  className?: string;
}

export function CountrySelect({ value, onChange, lang = 'en', placeholder, className }: CountrySelectProps) {
  const locale = lang === 'de' ? 'de' : 'en';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const displayNames = useMemo(
    () => new Intl.DisplayNames([locale], { type: 'region' }),
    [locale],
  );

  const countries = useMemo(
    () => ISO_CODES.map(code => ({ code, name: displayNames.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name, locale)),
    [displayNames, locale],
  );

  const filtered = useMemo(() => {
    if (!query) return countries;
    const q = query.toLowerCase();
    return countries.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [countries, query]);

  const selected = countries.find(c => c.code === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      {open ? (
        <Input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={lang === 'de' ? 'Suchen…' : 'Search…'}
          className="bg-white"
          onBlur={() => setTimeout(() => { setOpen(false); setQuery(''); }, 150)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {selected ? `${selected.code} — ${selected.name}` : (placeholder ?? (lang === 'de' ? 'Land wählen' : 'Select country'))}
        </button>
      )}
      {open && filtered.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
          {filtered.map(c => (
            <li
              key={c.code}
              className="px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm"
              onMouseDown={e => { e.preventDefault(); onChange(c.code); setOpen(false); setQuery(''); }}
            >
              <span className="font-mono text-xs text-muted-foreground mr-2">{c.code}</span>{c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

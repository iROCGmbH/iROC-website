/**
 * CountrySelect — searchable combobox for country selection.
 * Stores ISO 3166-1 alpha-2 codes (e.g. "DE"), displays full names in the viewer's language.
 * Searches by both ISO code and country name substring.
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { Input } from './ui/input';

// ISO 3166-1 alpha-2 codes — all UN-recognised states + commonly used territories
const ISO_CODES = [
  'AF','AX','AL','DZ','AD','AO','AI','AQ','AG','AR','AM','AW','AU','AT','AZ',
  'BS','BH','BD','BB','BY','BE','BZ','BJ','BM','BT','BO','BA','BW','BV','BR','BN','BG','BF','BI',
  'CV','KH','CM','CA','KY','CF','TD','CL','CN','CX','CC','CO','KM','CG','CD','CK','CR','HR','CU','CW','CY','CZ',
  'DK','DJ','DM','DO',
  'EC','EG','SV','GQ','ER','EE','SZ','ET',
  'FK','FO','FJ','FI','FR','GF','PF','TF',
  'GA','GM','GE','DE','GH','GI','GR','GL','GD','GP','GU','GT','GG','GN','GW','GY',
  'HT','HM','HN','HK','HU',
  'IS','IN','ID','IR','IQ','IE','IM','IL','IT',
  'JM','JP','JE','JO',
  'KZ','KE','KI','KP','KR','KW','KG',
  'LA','LV','LB','LS','LR','LY','LI','LT','LU',
  'MO','MG','MW','MY','MV','ML','MT','MH','MQ','MR','MU','YT','MX','FM','MD','MC','MN','ME','MS','MA','MZ','MM',
  'NA','NR','NP','NL','NC','NZ','NI','NE','NG','NU','NF','MK','MP','NO',
  'OM',
  'PK','PW','PS','PA','PG','PY','PE','PH','PN','PL','PT','PR',
  'QA',
  'RE','RO','RU','RW',
  'BL','SH','KN','LC','MF','PM','VC','WS','SM','ST','SA','SN','RS','SC','SL','SG','SX','SK','SI','SB','SO','ZA','GS','SS','ES','LK','SD','SR','SJ','SE','CH','SY',
  'TW','TJ','TZ','TH','TL','TG','TK','TO','TT','TN','TR','TM','TC','TV',
  'UG','UA','AE','GB','US','UM','UY','UZ',
  'VU','VE','VN','VG','VI',
  'WF','EH',
  'YE',
  'ZM','ZW',
];

interface CountrySelectProps {
  value: string;            // ISO alpha-2 code stored in form
  onChange: (code: string) => void;
  lang?: string;            // 'de' | 'en'
  placeholder?: string;
  className?: string;
  inputId?: string;
}

export function CountrySelect({ value, onChange, lang = 'en', placeholder, className, inputId }: CountrySelectProps) {
  const locale = lang === 'de' ? 'de' : 'en';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const displayNames = useMemo(
    () => new Intl.DisplayNames([locale], { type: 'region' }),
    [locale],
  );

  const countries = useMemo(
    () => ISO_CODES.map(code => ({
      code,
      name: displayNames.of(code) ?? code,
      label: `${code} — ${displayNames.of(code) ?? code}`,
    })).sort((a, b) => a.name.localeCompare(b.name, locale)),
    [displayNames, locale],
  );

  const filtered = useMemo(() => {
    if (!query) return countries;
    const q = query.toLowerCase();
    return countries.filter(c =>
      c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }, [query, countries]);

  const selected = countries.find(c => c.code.toUpperCase() === value?.toUpperCase());
  const displayValue = open ? query : (selected?.label ?? value ?? '');

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <Input
        id={inputId}
        value={displayValue}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(''); setOpen(true); }}
        placeholder={placeholder ?? (lang === 'de' ? 'Land suchen …' : 'Search country …')}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${inputId ?? 'country'}-options`}
      />
      {open && filtered.length > 0 && (
        <div id={`${inputId ?? 'country'}-options`} role="listbox" className="absolute z-50 w-full max-h-52 overflow-y-auto bg-background border rounded-md shadow-lg mt-1 text-sm">
          {filtered.slice(0, 80).map(c => (
            <button
              key={c.code}
              type="button"
              role="option"
              aria-selected={c.code === value}
              className={`w-full text-left px-3 py-1.5 hover:bg-muted ${c.code === value ? 'bg-muted font-medium' : ''}`}
              onMouseDown={e => {
                e.preventDefault();
                onChange(c.code);
                setQuery('');
                setOpen(false);
              }}
            >
              <span className="font-mono text-xs text-muted-foreground mr-2">{c.code}</span>
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import { differenceInDays, parseISO } from 'date-fns';
import { ChevronDown, Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface TrainingDate {
  id: number;
  date: string;
  time?: string | null;
  location: string;
  availableSpots: number;
  maxParticipants: number;
  isActive: boolean;
}

interface Props {
  dates: TrainingDate[];
  value: number | '';
  onChange: (id: number | '') => void;
  placeholder: string;
  error?: string;
}

interface AvailabilityInfo {
  label: string;
  dotClass: string;
  textClass: string;
  bgClass: string;
  disabled: boolean;
}

export default function TrainingDateSelect({ dates, value, onChange, placeholder, error }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function getAvailability(spots: number, maxParticipants: number, registrationClosed: boolean): AvailabilityInfo {
    if (spots === 0) return {
      label: t('Ausgebucht', 'Fully booked'),
      dotClass: 'bg-gray-400',
      textClass: 'text-gray-400',
      bgClass: 'bg-gray-50',
      disabled: true,
    };
    if (registrationClosed) return {
      label: t('Anmeldefrist abgelaufen', 'Registration closed'),
      dotClass: 'bg-gray-400',
      textClass: 'text-gray-400',
      bgClass: 'bg-gray-50',
      disabled: true,
    };
    const pct = maxParticipants > 0 ? (spots / maxParticipants) * 100 : 100;
    if (pct < 20) return {
      label: t('Fast ausgebucht', 'Almost Full'),
      dotClass: 'bg-red-500',
      textClass: 'text-red-600',
      bgClass: 'bg-red-50',
      disabled: false,
    };
    if (pct <= 60) return {
      label: t('Begrenzt verfügbar', 'Limited Availability'),
      dotClass: 'bg-amber-400',
      textClass: 'text-amber-600',
      bgClass: 'bg-amber-50',
      disabled: false,
    };
    return {
      label: t('Verfügbar', 'Available'),
      dotClass: 'bg-green-500',
      textClass: 'text-green-600',
      bgClass: 'bg-green-50',
      disabled: false,
    };
  }

  const sorted = [...dates].sort((a, b) => a.date.localeCompare(b.date));
  const selected = sorted.find(d => d.id === value);

  function formatDate(iso: string) {
    return parseISO(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex h-11 w-full items-center justify-between rounded-md border px-3 py-2 text-sm bg-background transition-colors
          ${error ? 'border-destructive' : 'border-input'}
          ${open ? 'ring-2 ring-ring ring-offset-0' : ''}
          hover:bg-muted/30`}
      >
        {selected ? (
          <span className="flex items-center gap-2 min-w-0">
            {(() => {
              const days = differenceInDays(parseISO(selected.date), new Date());
              const av = getAvailability(selected.availableSpots, selected.maxParticipants, days <= 21);
              return <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${av.dotClass}`} />;
            })()}
            <span className="truncate">
              {formatDate(selected.date)} – {selected.location}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown list */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg overflow-hidden">
          <ul className="max-h-72 overflow-y-auto py-1">
            {sorted.map(date => {
              const days = differenceInDays(parseISO(date.date), new Date());
              const av = getAvailability(date.availableSpots, date.maxParticipants, days <= 21);
              const isSelected = date.id === value;

              return (
                <li key={date.id}>
                  <button
                    type="button"
                    disabled={av.disabled}
                    onClick={() => { onChange(date.id); setOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors
                      ${av.disabled
                        ? 'opacity-40 cursor-not-allowed'
                        : 'cursor-pointer hover:bg-muted/50'}
                      ${isSelected ? 'bg-muted' : ''}`}
                  >
                    {/* Colored dot */}
                    <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${av.dotClass}`} />

                    {/* Date + location */}
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">
                        {formatDate(date.date)}{date.time ? ` ${date.time}` : ''}
                      </span>
                      <span className="text-muted-foreground"> – {date.location}</span>
                    </span>

                    {/* Availability badge */}
                    <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${av.bgClass} ${av.textClass}`}>
                      {av.label}
                    </span>

                    {/* Check mark for selected */}
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                </li>
              );
            })}
            {sorted.length === 0 && (
              <li className="px-3 py-4 text-sm text-muted-foreground text-center">
                {t('Keine Termine verfügbar', 'No dates available')}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

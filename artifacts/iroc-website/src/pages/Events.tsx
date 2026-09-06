import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { CalendarClock, ExternalLink } from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

interface EventItem {
  id: number;
  title: string;
  titleDe: string | null;
  description: string | null;
  descriptionDe: string | null;
  mediaUrl: string | null;
  mediaType: string;
  externalUrl: string;
  eventDate: string;
  endDate: string | null;
  location: string | null;
  specialtyFocus: string | null;
  isCongressEvent: boolean;
}

function formatDateRange(start: string, end: string | null, lang: 'DE' | 'EN') {
  const locale = lang === 'DE' ? 'de-DE' : 'en-GB';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
  const s = new Date(start).toLocaleDateString(locale, opts);
  if (!end || end === start) return s;
  return `${s} – ${new Date(end).toLocaleDateString(locale, opts)}`;
}

function EventCard({ event, lang }: { event: EventItem; lang: 'DE' | 'EN' }) {
  const title = (lang === 'DE' && event.titleDe) ? event.titleDe : event.title;
  const desc = (lang === 'DE' && event.descriptionDe) ? event.descriptionDe : event.description;

  return (
    <a
      href={event.externalUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col bg-white rounded-2xl overflow-hidden border shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer"
    >
      {/* Media */}
      <div className="relative w-full aspect-video bg-slate-100 overflow-hidden">
        {event.mediaUrl ? (
          event.mediaType === 'video' ? (
            <iframe
              src={event.mediaUrl}
              title={title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
          ) : (
            <img
              src={event.mediaUrl}
              alt={title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
            <CalendarClock className="w-16 h-16 text-primary/30" />
          </div>
        )}

        {/* Overlay arrow on hover */}
        <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 transition-colors flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-3 shadow-lg">
            <ExternalLink className="w-6 h-6 text-primary" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 flex flex-col flex-1">
        <div className="flex items-center gap-2 text-xs text-primary font-semibold mb-1">
          <CalendarClock className="w-4 h-4" />
          {formatDateRange(event.eventDate, event.endDate ?? null, lang)}
        </div>
        {event.location && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>
            </svg>
            {event.location}
          </div>
        )}
        <h3 className="text-lg font-bold mb-2 group-hover:text-primary transition-colors leading-snug">
          {title}
        </h3>
        {desc && (
          <p className="text-sm text-muted-foreground leading-relaxed flex-1">{desc}</p>
        )}
        <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-primary">
          {lang === 'DE' ? 'Mehr erfahren' : 'Learn more'}
          <ExternalLink className="w-4 h-4" />
        </div>
      </div>
    </a>
  );
}

export default function Events() {
  const { t, language } = useLanguage();
  const [events, setEvents] = useState<EventItem[] | null>(null);

  useEffect(() => {
    fetch(`${BASE_URL}/api/events`)
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => setEvents([]));
  }, []);

  return (
    <div className="min-h-screen bg-muted/10 py-20">
      <div className="container mx-auto px-4 max-w-6xl">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-primary bg-primary/10 rounded-full px-4 py-1.5 mb-6">
            <CalendarClock className="w-4 h-4" />
            {t('Veranstaltungen', 'Events')}
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            {t('Kommende Veranstaltungen', 'Upcoming Events')}
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            {t(
              'Schulungen, Kongresse und Fachveranstaltungen rund um iROC-Produkte.',
              'Training sessions, congresses and specialist events around iROC products.',
            )}
          </p>
        </div>

        {/* Content */}
        {events === null ? (
          // Loading skeleton
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl border overflow-hidden animate-pulse">
                <div className="aspect-video bg-slate-200" />
                <div className="p-6 space-y-3">
                  <div className="h-3 w-24 bg-slate-200 rounded" />
                  <div className="h-5 w-3/4 bg-slate-200 rounded" />
                  <div className="h-3 w-full bg-slate-200 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          // No events
          <div className="text-center py-32">
            <div className="w-24 h-24 rounded-full bg-primary/5 flex items-center justify-center mx-auto mb-6">
              <CalendarClock className="w-12 h-12 text-primary/30" />
            </div>
            <h2 className="text-2xl font-bold text-muted-foreground mb-2">
              {t('Stay Tuned…', 'Stay Tuned…')}
            </h2>
            <p className="text-muted-foreground">
              {t(
                'Aktuell sind keine Veranstaltungen geplant. Schauen Sie bald wieder vorbei.',
                'No events are currently planned. Check back soon.',
              )}
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {events.map((ev) => (
              <EventCard key={ev.id} event={ev} lang={language} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

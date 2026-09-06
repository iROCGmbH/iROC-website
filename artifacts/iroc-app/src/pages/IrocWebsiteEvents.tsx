import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CalendarClock, CalendarPlus, Trash2, Loader2, Globe,
  ImageIcon, Video, ChevronDown, ChevronUp,
} from 'lucide-react';
import { adminGet, adminPost, adminDelete } from '@/lib/admin-fetch';

const QK = ['iroc-events'];

interface AdminEvent {
  id: number;
  title: string;
  titleDe: string | null;
  description: string | null;
  descriptionDe: string | null;
  mediaUrl: string | null;
  mediaType: string;
  externalUrl: string;
  eventDate: string;
  isActive: boolean;
  expired: boolean;
}

interface NewEventDraft {
  title: string;
  titleDe: string;
  description: string;
  descriptionDe: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  externalUrl: string;
  eventDate: string;
}

const EMPTY_DRAFT: NewEventDraft = {
  title: '', titleDe: '', description: '', descriptionDe: '',
  mediaUrl: '', mediaType: 'image', externalUrl: '', eventDate: '',
};

function formatEventDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}

function AddEventForm({ token, onCreated }: { token: string; onCreated: () => void }) {
  const { toast } = useToast();
  const { lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NewEventDraft>(EMPTY_DRAFT);

  const set = (k: keyof NewEventDraft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      adminPost('/api/admin/events', token, {
        ...draft,
        mediaUrl: draft.mediaUrl.trim() || undefined,
      }),
    onSuccess: () => {
      toast({ title: lang === 'de' ? 'Event erstellt' : 'Event created' });
      setDraft(EMPTY_DRAFT);
      setOpen(false);
      onCreated();
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error', description: err.message }),
  });

  const valid = draft.title.trim() && draft.externalUrl.trim() && draft.eventDate;

  return (
    <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-6 py-5 flex items-center gap-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="p-2 bg-green-50 rounded-lg">
          <CalendarPlus className="w-5 h-5 text-green-600" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold">
            {lang === 'de' ? 'Neues Event hinzufügen' : 'Add New Event'}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {lang === 'de'
              ? 'Event mit Bild / Video und Link zur externen Seite'
              : 'Event with image / video and link to external page'}
          </p>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t p-6 space-y-5">
          {/* Title row */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Titel (EN) *</label>
              <Input value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder="Event title" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Titel (DE)</label>
              <Input value={draft.titleDe} onChange={(e) => set('titleDe', e.target.value)} placeholder="Veranstaltungstitel" />
            </div>
          </div>

          {/* Description row */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {lang === 'de' ? 'Beschreibung (EN)' : 'Description (EN)'}
              </label>
              <textarea
                value={draft.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Short description…"
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {lang === 'de' ? 'Beschreibung (DE)' : 'Description (DE)'}
              </label>
              <textarea
                value={draft.descriptionDe}
                onChange={(e) => set('descriptionDe', e.target.value)}
                placeholder="Kurzbeschreibung…"
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          {/* Media row */}
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {lang === 'de' ? 'Medientyp' : 'Media Type'}
              </label>
              <select
                value={draft.mediaType}
                onChange={(e) => set('mediaType', e.target.value as 'image' | 'video')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="image">{lang === 'de' ? 'Bild (Image URL)' : 'Image (Image URL)'}</option>
                <option value="video">Video (YouTube embed)</option>
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {draft.mediaType === 'video'
                  ? (lang === 'de' ? 'YouTube-Link / Embed-URL' : 'YouTube Link / Embed URL')
                  : (lang === 'de' ? 'Bild-URL' : 'Image URL')}
              </label>
              <Input
                value={draft.mediaUrl}
                onChange={(e) => set('mediaUrl', e.target.value)}
                placeholder={draft.mediaType === 'video' ? 'https://www.youtube.com/watch?v=…' : 'https://example.com/image.jpg'}
              />
            </div>
          </div>

          {/* External URL + date row */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {lang === 'de' ? 'Externe Website' : 'External Website'}{' '}
                * <span className="text-primary normal-case font-normal">({lang === 'de' ? 'Link bei Klick' : 'Link on click'})</span>
              </label>
              <Input
                value={draft.externalUrl}
                onChange={(e) => set('externalUrl', e.target.value)}
                placeholder="https://example.com/event"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {lang === 'de' ? 'Event-Datum' : 'Event Date'}{' '}
                * <span className="text-muted-foreground font-normal normal-case">
                  ({lang === 'de' ? '7 Tage danach automatisch ausgeblendet' : 'automatically hidden 7 days after'})
                </span>
              </label>
              <Input
                type="date"
                value={draft.eventDate}
                onChange={(e) => set('eventDate', e.target.value)}
              />
            </div>
          </div>

          {/* Preview */}
          {draft.mediaUrl && (
            <div className="border rounded-xl overflow-hidden">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-4 pt-3 pb-2">
                {lang === 'de' ? 'Vorschau' : 'Preview'}
              </p>
              {draft.mediaType === 'image' ? (
                <img
                  src={draft.mediaUrl}
                  alt="preview"
                  className="w-full max-h-48 object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="aspect-video">
                  <iframe
                    src={draft.mediaUrl.replace('watch?v=', 'embed/').replace('youtu.be/', 'www.youtube.com/embed/')}
                    className="w-full h-full"
                    allowFullScreen
                  />
                </div>
              )}
            </div>
          )}

          <Button
            className="w-full"
            disabled={!valid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> {lang === 'de' ? 'Erstelle…' : 'Creating…'}</>
              : <><CalendarPlus className="w-4 h-4 mr-2" /> {lang === 'de' ? 'Event erstellen' : 'Create Event'}</>}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function IrocWebsiteEvents() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: events, isLoading } = useQuery<AdminEvent[]>({
    queryKey: QK,
    queryFn: () => adminGet<AdminEvent[]>('/api/admin/events', token!),
    enabled: !!token,
  });

  const del = useMutation({
    mutationFn: (id: number) => adminDelete(`/api/admin/events/${id}`, token!),
    onSuccess: () => {
      toast({ title: lang === 'de' ? 'Event gelöscht' : 'Event deleted' });
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: () => toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Löschen' : 'Error deleting' }),
  });

  if (!token) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Events</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {lang === 'de'
            ? 'Verwalte die Events auf der iROC-Website'
            : 'Manage events shown on the iROC website'}
        </p>
      </div>

      <div className="space-y-8">
        {/* Add form */}
        <AddEventForm token={token} onCreated={() => qc.invalidateQueries({ queryKey: QK })} />

        {/* List */}
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 pt-6 pb-4 border-b flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <CalendarClock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{lang === 'de' ? 'Alle Events' : 'All Events'}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {lang === 'de'
                  ? 'Abgelaufene Events werden auf der Website automatisch nach 7 Tagen ausgeblendet'
                  : 'Expired events are automatically hidden on the website after 7 days'}
              </p>
            </div>
            <span className="ml-auto text-sm bg-muted rounded-full px-3 py-0.5 font-medium">
              {events?.length ?? 0}
            </span>
          </div>

          {isLoading && (
            <div className="p-8 text-center text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {lang === 'de' ? 'Laden…' : 'Loading…'}
            </div>
          )}

          {!isLoading && (!events || events.length === 0) && (
            <div className="p-12 text-center text-muted-foreground">
              <CalendarClock className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="font-medium">{lang === 'de' ? 'Noch keine Events' : 'No events yet'}</p>
            </div>
          )}

          {events && events.length > 0 && (
            <div className="divide-y">
              {events.map((ev) => (
                <div key={ev.id} className="p-5 flex gap-4 items-start">
                  {/* Thumbnail */}
                  <div className="w-24 h-16 rounded-lg overflow-hidden bg-slate-100 shrink-0 flex items-center justify-center">
                    {ev.mediaUrl && ev.mediaType === 'image' ? (
                      <img src={ev.mediaUrl} alt="" className="w-full h-full object-cover" />
                    ) : ev.mediaUrl && ev.mediaType === 'video' ? (
                      <Video className="w-8 h-8 text-slate-400" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-slate-300" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-sm truncate">{ev.title}</span>
                      {ev.expired ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium shrink-0">
                          {lang === 'de' ? 'Abgelaufen' : 'Expired'}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium shrink-0">
                          {lang === 'de' ? 'Aktiv' : 'Active'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                      <CalendarClock className="w-3.5 h-3.5" />
                      {formatEventDate(ev.eventDate)}
                    </div>
                    <a
                      href={ev.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1 truncate max-w-xs"
                    >
                      <Globe className="w-3 h-3 shrink-0" />
                      {ev.externalUrl}
                    </a>
                    {ev.titleDe && (
                      <p className="text-xs text-muted-foreground mt-0.5 italic">{ev.titleDe}</p>
                    )}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-destructive hover:bg-destructive/10 border-destructive/20"
                    disabled={del.isPending}
                    onClick={() => del.mutate(ev.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useSiteUrls } from '@/hooks/use-site-urls';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar, Plus, Trash2, Loader2, Globe, Pencil, X } from 'lucide-react';
import { adminPost, adminDelete, adminPatch } from '@/lib/admin-fetch';


interface TrainingDate {
  id: number;
  instrument: string;
  date: string;
  time: string | null;
  location: string;
  locationDetail: string | null;
  maxParticipants: number;
  notes: string | null;
  isActive: boolean;
}

const QK = ['iroc-training-dates'];

const fieldCls = 'flex flex-col gap-1';
const labelCls = 'text-xs font-semibold text-muted-foreground uppercase tracking-wide';
const inputCls = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function IrocWebsiteTraining() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { irocUrl } = useSiteUrls();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TrainingDate | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const { data: dates = [], isLoading } = useQuery({
    queryKey: QK,
    queryFn: () => fetch(`/api/training/dates`).then((r) => r.json()) as Promise<TrainingDate[]>,
  });

  const addDate = useMutation({
    mutationFn: (data: Record<string, unknown>) => adminPost('/api/admin/training-dates', token!, data),
    onSuccess: () => {
      toast({ title: lang === 'de' ? 'Schulungstermin hinzugefügt' : 'Training date added' });
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: () => toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Erstellen' : 'Error creating' }),
  });

  const delDate = useMutation({
    mutationFn: (id: number) => adminDelete(`/api/admin/training-dates/${id}`, token!),
    onSuccess: () => {
      toast({ title: lang === 'de' ? 'Gelöscht' : 'Deleted' });
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: () => toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Löschen' : 'Error deleting' }),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    addDate.mutate({
      instrument: fd.get('instrument') as string,
      date: fd.get('date') as string,
      time: (fd.get('time') as string) || null,
      location: fd.get('location') as string,
      locationDetail: (fd.get('locationDetail') as string) || null,
      maxParticipants: parseInt(fd.get('maxParticipants') as string) || 20,
      notes: (fd.get('notes') as string) || null,
    });
    (e.target as HTMLFormElement).reset();
  };

  const handleEditSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing || !token) return;
    setEditSaving(true);
    const fd = new FormData(e.currentTarget);
    try {
      await adminPatch(`/api/admin/training-dates/${editing.id}`, token, {
        instrument: fd.get('instrument') as string,
        date: fd.get('date') as string,
        time: (fd.get('time') as string) || null,
        location: fd.get('location') as string,
        locationDetail: (fd.get('locationDetail') as string) || null,
        maxParticipants: parseInt(fd.get('maxParticipants') as string) || 20,
        notes: (fd.get('notes') as string) || null,
      });
      setEditing(null);
      qc.invalidateQueries({ queryKey: QK });
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' });
    } finally {
      setEditSaving(false);
    }
  };

  const byInstrument = {
    spirecut: dates.filter((d) => d.instrument === 'spirecut'),
    ministem: dates.filter((d) => d.instrument === 'ministem'),
  };

  const selectCls = `${inputCls}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg"><Calendar className="w-5 h-5 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'Schulungstermine' : 'Training Dates'}</h1>
          <p className="text-sm text-muted-foreground">{lang === 'de' ? 'Kommende Schulungstermine verwalten' : 'Manage upcoming training dates'}</p>
        </div>
        <a href={`${irocUrl}/training`} target="_blank" rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
          <Globe className="w-4 h-4" />{lang === 'de' ? 'Website öffnen →' : 'Open Website →'}
        </a>
      </div>

      {/* Add form */}
      <div className="bg-card border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4 text-primary font-semibold">
          <Plus className="w-4 h-4" /> {lang === 'de' ? 'Neuen Termin hinzufügen' : 'Add New Date'}
        </div>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className={fieldCls}>
            <label className={labelCls}>Instrument</label>
            <select name="instrument" required className={selectCls}>
              <option value="spirecut">Spirecut®</option>
              <option value="ministem">MiniStem®</option>
            </select>
          </div>
          <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Datum' : 'Date'}</label><Input name="date" type="date" required /></div>
          <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Uhrzeit (optional)' : 'Time (optional)'}</label><Input name="time" type="time" /></div>
          <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Ort' : 'Location'}</label><Input name="location" required placeholder={lang === 'de' ? 'z.B. München' : 'e.g. Munich'} /></div>
          <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Zusatzinfo (optional)' : 'Detail (optional)'}</label><Input name="locationDetail" placeholder={lang === 'de' ? 'z.B. Klinik XY' : 'e.g. Clinic XY'} /></div>
          <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Max. Teilnehmer' : 'Max Participants'}</label><Input name="maxParticipants" type="number" min={1} defaultValue={20} required /></div>
          <div className="col-span-2 md:col-span-3 flex flex-col gap-1">
            <label className={labelCls}>{lang === 'de' ? 'Notizen (optional)' : 'Notes (optional)'}</label>
            <Input name="notes" />
          </div>
          <div className="col-span-2 md:col-span-3">
            <Button type="submit" disabled={addDate.isPending} className="gap-2">
              {addDate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {lang === 'de' ? 'Termin hinzufügen' : 'Add date'}
            </Button>
          </div>
        </form>
      </div>

      {/* Date list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {(['spirecut', 'ministem'] as const).map((instrument) => (
            <div key={instrument} className="bg-card border rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b bg-muted/30 flex items-center gap-2">
                <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${instrument === 'spirecut' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                  {instrument === 'spirecut' ? 'Spirecut®' : 'MiniStem®'}
                </span>
                <span className="text-sm text-muted-foreground">{byInstrument[instrument].length} {lang === 'de' ? 'Termine' : 'dates'}</span>
              </div>
              {byInstrument[instrument].length === 0 ? (
                <p className="text-center py-8 text-sm text-muted-foreground">{lang === 'de' ? 'Keine Termine' : 'No dates'}</p>
              ) : (
                <div className="divide-y">
                  {byInstrument[instrument]
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((d) => (
                      <div key={d.id} className="flex items-center gap-3 px-5 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">
                            {new Date(d.date + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}
                            {d.time && <span className="ml-2 text-xs text-muted-foreground">{d.time} Uhr</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {d.location}{d.locationDetail ? ` · ${d.locationDetail}` : ''} · max. {d.maxParticipants}
                          </p>
                          {d.notes && <p className="text-xs text-amber-700 mt-0.5">{d.notes}</p>}
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(d)}
                          className="text-muted-foreground hover:text-foreground shrink-0" title={lang === 'de' ? 'Bearbeiten' : 'Edit'}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm"
                          onClick={() => { if (confirm(lang === 'de' ? 'Löschen?' : 'Delete?')) delDate.mutate(d.id); }}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{lang === 'de' ? 'Termin bearbeiten' : 'Edit Training Date'}</h2>
              <button onClick={() => setEditing(null)}><X className="w-5 h-5" /></button>
            </div>
            <form key={editing.id} onSubmit={handleEditSave} className="grid grid-cols-2 gap-4">
              <div className={`${fieldCls} col-span-2`}>
                <label className={labelCls}>Instrument *</label>
                <select name="instrument" defaultValue={editing.instrument} required className={inputCls}>
                  <option value="spirecut">Spirecut®</option>
                  <option value="ministem">MiniStem®</option>
                </select>
              </div>
              <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Datum' : 'Date'} *</label><input name="date" type="date" defaultValue={editing.date} required className={inputCls} /></div>
              <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Uhrzeit' : 'Time'}</label><input name="time" type="time" defaultValue={editing.time ?? ''} className={inputCls} /></div>
              <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Ort' : 'Location'} *</label><input name="location" defaultValue={editing.location} required className={inputCls} /></div>
              <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Zusatzinfo' : 'Detail'}</label><input name="locationDetail" defaultValue={editing.locationDetail ?? ''} className={inputCls} /></div>
              <div className={`${fieldCls} col-span-2`}><label className={labelCls}>{lang === 'de' ? 'Max. Teilnehmer' : 'Max Participants'} *</label><input name="maxParticipants" type="number" min={1} defaultValue={editing.maxParticipants} required className={inputCls} /></div>
              <div className={`${fieldCls} col-span-2`}><label className={labelCls}>{lang === 'de' ? 'Notizen' : 'Notes'}</label><input name="notes" defaultValue={editing.notes ?? ''} className={inputCls} /></div>
              <div className="col-span-2 flex gap-2 pt-1">
                <Button type="submit" disabled={editSaving}>{lang === 'de' ? 'Speichern' : 'Save'}</Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>{lang === 'de' ? 'Abbrechen' : 'Cancel'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

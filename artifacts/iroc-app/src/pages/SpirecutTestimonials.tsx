import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Video, Plus, Edit2, Trash2, EyeOff, Check, X, MoveUp, MoveDown, Save, Loader2, AlertCircle
} from 'lucide-react';

interface Testimonial {
  id: number;
  titleDe: string;
  titleEn: string;
  descriptionDe: string;
  descriptionEn: string;
  patientLabel: string;
  procedureDe: string;
  procedureEn: string;
  videoUrl: string;
  displayOrder: number;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function SpirecutTestimonials() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();

  const [items, setItems] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState<number | 'new' | null>(null);
  const [formData, setFormData] = useState<Partial<Testimonial>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/patient-testimonials', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setItems(data);
    } catch (_error) {
      setError(lang === 'de' ? 'Fehler beim Laden der Daten.' : 'Error loading data.');
    } finally {
      setLoading(false);
    }
  }, [token, lang]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = () => {
    setFormData({
      titleDe: '',
      titleEn: '',
      descriptionDe: '',
      descriptionEn: '',
      patientLabel: '',
       procedureDe: '',
       procedureEn: '',
      videoUrl: '',
      displayOrder: items.length > 0 ? Math.max(...items.map((i) => i.displayOrder)) + 1 : 0,
      published: false,
    });
    setIsEditing('new');
  };

  const handleEdit = (item: Testimonial) => {
    setFormData(item);
    setIsEditing(item.id);
  };

  const handleCancel = () => {
    setIsEditing(null);
    setFormData({});
  };

  const handleChange = <K extends keyof Testimonial>(field: K, value: Testimonial[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const getYouTubeEmbedUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const youtubeHosts = new Set([
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'music.youtube.com',
        'youtube-nocookie.com',
        'www.youtube-nocookie.com',
      ]);
      let videoId: string | null = null;
      if (host === 'youtu.be' || host === 'www.youtu.be') {
        videoId = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
      } else if (youtubeHosts.has(host) && parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v');
      } else if (youtubeHosts.has(host)) {
        const [first, id] = parsed.pathname.split('/').filter(Boolean);
        if (['embed', 'shorts', 'live'].includes(first ?? '')) videoId = id ?? null;
      }
      if (videoId && /^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
        return `https://www.youtube-nocookie.com/embed/${videoId}`;
      }
    } catch {
      // ignore
    }
    return null;
  };

  const validateForm = () => {
    if (!formData.titleDe?.trim() || !formData.titleEn?.trim()) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Titel ist ein Pflichtfeld (DE & EN).' : 'Title is required (DE & EN).' });
      return false;
    }
    if (!formData.videoUrl?.trim()) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Video-URL ist erforderlich.' : 'Video URL is required.' });
      return false;
    }
    if (!getYouTubeEmbedUrl(formData.videoUrl)) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Ungültige YouTube-URL.' : 'Invalid YouTube URL.' });
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!token || !validateForm()) return;
    setIsSubmitting(true);
    
    try {
      const isNew = isEditing === 'new';
      const url = isNew ? '/api/admin/patient-testimonials' : `/api/admin/patient-testimonials/${isEditing}`;
      const method = isNew ? 'POST' : 'PATCH';

      const payload = {
        titleDe: formData.titleDe,
        titleEn: formData.titleEn,
        descriptionDe: formData.descriptionDe || '',
        descriptionEn: formData.descriptionEn || '',
        patientLabel: formData.patientLabel || '',
         procedureDe: formData.procedureDe || '',
         procedureEn: formData.procedureEn || '',
        videoUrl: formData.videoUrl,
        displayOrder: Number(formData.displayOrder) || 0,
        published: !!formData.published,
      };

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Save failed');
      
      toast({ title: lang === 'de' ? 'Gespeichert.' : 'Saved successfully.' });
      setIsEditing(null);
      setFormData({});
      load();
    } catch (_error) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Speichern.' : 'Error saving.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/patient-testimonials/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Delete failed');
      toast({ title: lang === 'de' ? 'Gelöscht.' : 'Deleted successfully.' });
      setShowDeleteConfirm(null);
      load();
    } catch (_error) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Löschen.' : 'Error deleting.' });
    }
  };

  const togglePublish = async (item: Testimonial) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/patient-testimonials/${item.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ published: !item.published }),
      });
      if (!res.ok) throw new Error('Update failed');
      load();
    } catch (_error) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Aktualisieren.' : 'Error updating.' });
    }
  };

  const updateOrder = async (id: number, newOrder: number, refresh = true) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/patient-testimonials/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ displayOrder: newOrder }),
      });
      if (!res.ok) throw new Error('Update failed');
      if (refresh) await load();
    } catch (_error) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Aktualisieren.' : 'Error updating.' });
    }
  };

  const moveItem = async (index: number, direction: 'up' | 'down') => {
    const item = sortedItems[index];
    const adjacent = sortedItems[index + (direction === 'up' ? -1 : 1)];
    if (!item || !adjacent) return;

    try {
      await Promise.all([
        updateOrder(item.id, adjacent.displayOrder, false),
        updateOrder(adjacent.id, item.displayOrder, false),
      ]);
      await load();
    } catch {
      // updateOrder shows a bilingual error toast for failed requests.
    }
  };

  if (loading && !items.length) {
    return (
      <div className="flex justify-center p-12 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  // Sort items by displayOrder
  const sortedItems = [...items].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Video className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">
              {lang === 'de' ? 'Patientenerfahrungen' : 'Patient Stories'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {lang === 'de'
                ? 'Verwalten Sie Video-Erfahrungsberichte für die Spirecut-Website.'
                : 'Manage video testimonials for the Spirecut website.'}
            </p>
          </div>
        </div>
        {!isEditing && (
          <Button onClick={handleAdd} className="gap-2">
            <Plus className="h-4 w-4" />
            {lang === 'de' ? 'Neuer Bericht' : 'New Story'}
          </Button>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md flex items-center gap-2 text-sm">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {isEditing && (
        <div className="bg-card border rounded-xl p-6 shadow-sm space-y-6">
          <h2 className="text-lg font-semibold">
            {isEditing === 'new'
              ? (lang === 'de' ? 'Neuer Erfahrungsbericht' : 'New Patient Story')
              : (lang === 'de' ? 'Erfahrungsbericht bearbeiten' : 'Edit Patient Story')}
          </h2>
          
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-blue-700 mb-1 block">Titel (DE) *</label>
                <Input
                  value={formData.titleDe || ''}
                  onChange={(e) => handleChange('titleDe', e.target.value)}
                  placeholder="z.B. Schnelle Genesung nach Karpaltunnel-Eingriff"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-blue-700 mb-1 block">Beschreibung (DE)</label>
                <Textarea
                  value={formData.descriptionDe || ''}
                  onChange={(e) => handleChange('descriptionDe', e.target.value)}
                  placeholder="Optionaler Begleittext..."
                  rows={3}
                />
              </div>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-emerald-700 mb-1 block">Title (EN) *</label>
                <Input
                  value={formData.titleEn || ''}
                  onChange={(e) => handleChange('titleEn', e.target.value)}
                  placeholder="e.g. Fast recovery after Carpal Tunnel procedure"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-emerald-700 mb-1 block">Description (EN)</label>
                <Textarea
                  value={formData.descriptionEn || ''}
                  onChange={(e) => handleChange('descriptionEn', e.target.value)}
                  placeholder="Optional description text..."
                  rows={3}
                />
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6 pt-4 border-t">
            <div className="space-y-1">
              <label className="text-sm font-medium">{lang === 'de' ? 'Patient (Optional)' : 'Patient (Optional)'}</label>
              <Input
                value={formData.patientLabel || ''}
                onChange={(e) => handleChange('patientLabel', e.target.value)}
                placeholder={lang === 'de' ? 'z.B. Maria S., 52 Jahre' : 'e.g. Maria S., 52 years'}
              />
            </div>
             <div className="space-y-1">
               <label className="text-sm font-medium">Eingriff / Kategorie (DE)</label>
              <Input
                 value={formData.procedureDe || ''}
                 onChange={(e) => handleChange('procedureDe', e.target.value)}
                placeholder={lang === 'de' ? 'z.B. Karpaltunnelsyndrom' : 'e.g. Carpal Tunnel Syndrome'}
              />
            </div>
             <div className="space-y-1">
               <label className="text-sm font-medium">Procedure / Category (EN)</label>
               <Input
                 value={formData.procedureEn || ''}
                 onChange={(e) => handleChange('procedureEn', e.target.value)}
                 placeholder="e.g. Carpal Tunnel Syndrome"
               />
             </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{lang === 'de' ? 'Anzeigereihenfolge' : 'Display Order'}</label>
              <Input
                type="number"
                min="0"
                value={formData.displayOrder ?? 0}
                onChange={(e) => handleChange('displayOrder', parseInt(e.target.value, 10))}
              />
            </div>
          </div>

          <div className="space-y-1 pt-2">
            <label className="text-sm font-medium">YouTube Video URL *</label>
            <Input
              value={formData.videoUrl || ''}
              onChange={(e) => handleChange('videoUrl', e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
            {formData.videoUrl && !getYouTubeEmbedUrl(formData.videoUrl) && (
              <p className="text-xs text-destructive mt-1">
                {lang === 'de' ? 'Keine gültige YouTube-URL erkannt.' : 'No valid YouTube URL detected.'}
              </p>
            )}
            {formData.videoUrl && getYouTubeEmbedUrl(formData.videoUrl) && (
              <p className="text-xs text-green-600 mt-1">
                {lang === 'de' ? 'Gültige YouTube-URL.' : 'Valid YouTube URL.'}
              </p>
            )}
          </div>
          
          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="published-toggle"
              checked={!!formData.published}
              onChange={(e) => handleChange('published', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="published-toggle" className="text-sm font-medium select-none cursor-pointer">
              {lang === 'de' ? 'Öffentlich sichtbar' : 'Published publicly'}
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-6 border-t">
            <Button variant="ghost" onClick={handleCancel} disabled={isSubmitting}>
              {lang === 'de' ? 'Abbrechen' : 'Cancel'}
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting} className="gap-2">
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <Save className="h-4 w-4" />
              {lang === 'de' ? 'Speichern' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      {!isEditing && sortedItems.length === 0 && !loading && (
        <div className="text-center py-12 bg-card border rounded-xl shadow-sm">
          <Video className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-foreground">
            {lang === 'de' ? 'Keine Berichte vorhanden' : 'No stories found'}
          </h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            {lang === 'de' ? 'Fügen Sie den ersten Erfahrungsbericht hinzu.' : 'Add the first patient story.'}
          </p>
          <Button onClick={handleAdd} variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            {lang === 'de' ? 'Bericht hinzufügen' : 'Add Story'}
          </Button>
        </div>
      )}

      {!isEditing && sortedItems.length > 0 && (
        <div className="grid gap-4">
          {sortedItems.map((item, index) => (
            <div key={item.id} className="bg-card border rounded-xl p-4 shadow-sm flex flex-col md:flex-row gap-4 items-start md:items-center">
              
              <div className="relative shrink-0 w-full md:w-48 aspect-video bg-muted rounded-md overflow-hidden border border-border/50">
                {getYouTubeEmbedUrl(item.videoUrl) ? (
                  <iframe
                    src={getYouTubeEmbedUrl(item.videoUrl)!}
                     title={lang === 'de' ? item.titleDe : item.titleEn}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    tabIndex={-1}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <Video className="h-8 w-8 opacity-20" />
                  </div>
                )}
                {!item.published && (
                  <div className="absolute inset-0 bg-background/80 backdrop-blur-[1px] flex items-center justify-center">
                    <Badge variant="secondary" className="gap-1 shadow-sm">
                      <EyeOff className="h-3 w-3" /> {lang === 'de' ? 'Entwurf' : 'Draft'}
                    </Badge>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-base truncate" title={item.titleDe}>
                    {lang === 'de' ? item.titleDe : item.titleEn}
                  </h3>
                  {item.published && (
                    <Badge variant="success" className="text-[10px] uppercase px-1.5 py-0">
                      {lang === 'de' ? 'Online' : 'Live'}
                    </Badge>
                  )}
                </div>
                
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {lang === 'de' ? item.descriptionDe : item.descriptionEn}
                </p>
                
                <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                  {item.patientLabel && (
                    <span className="font-medium text-foreground/80">{item.patientLabel}</span>
                  )}
                   {(lang === 'de' ? item.procedureDe : item.procedureEn) && (
                     <span className="bg-muted px-2 py-0.5 rounded-sm">{lang === 'de' ? item.procedureDe : item.procedureEn}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 md:flex-col md:items-end w-full md:w-auto mt-4 md:mt-0 pt-4 md:pt-0 border-t md:border-0">
                {showDeleteConfirm === item.id ? (
                  <div className="flex items-center gap-2 bg-destructive/10 p-1.5 rounded-lg border border-destructive/20 w-full md:w-auto justify-end">
                    <span className="text-xs font-medium text-destructive px-2">
                      {lang === 'de' ? 'Sicher?' : 'Sure?'}
                    </span>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowDeleteConfirm(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="destructive" className="h-7 w-7 p-0" onClick={() => handleDelete(item.id)}>
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        disabled={index === 0}
                        onClick={() => moveItem(index, 'up')}
                        title={lang === 'de' ? 'Nach oben' : 'Move up'}
                      >
                        <MoveUp className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        disabled={index === sortedItems.length - 1}
                        onClick={() => moveItem(index, 'down')}
                        title={lang === 'de' ? 'Nach unten' : 'Move down'}
                      >
                        <MoveDown className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="flex items-center gap-2 ml-auto">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => togglePublish(item)}
                        className={item.published ? 'text-amber-600 border-amber-200 hover:bg-amber-50' : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50'}
                      >
                        {item.published
                          ? (lang === 'de' ? 'Verbergen' : 'Unpublish')
                          : (lang === 'de' ? 'Veröffentlichen' : 'Publish')}
                      </Button>
                      
                      <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => handleEdit(item)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      
                      <Button size="icon" variant="outline" className="h-9 w-9 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setShowDeleteConfirm(item.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                )}
              </div>

            </div>
          ))}
        </div>
      )}
    </div>
  );
}

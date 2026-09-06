import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useSiteUrls } from '@/hooks/use-site-urls';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  BookOpen, Plus, Trash2, Loader2, Globe, FileText, Video, Link as LinkIcon,
  GraduationCap, Pencil, X, Upload, Image as ImageIcon, File,
  BarChart2, ClipboardList, Receipt, Stethoscope,
} from 'lucide-react';
import { adminPost, adminDelete, adminPatch } from '@/lib/admin-fetch';

const QK = ['iroc-resources'];

interface Resource {
  id: number;
  title: string;
  titleDe: string | null;
  description: string | null;
  type: string;
  instrument: string;
  url: string;
  thumbnailUrl: string | null;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  presentation: GraduationCap, study: FileText, video: Video, link: LinkIcon,
  infographic: BarChart2, image: ImageIcon, protocol: ClipboardList,
  invoice: Receipt, medical_finding: Stethoscope,
};
const TYPE_COLORS: Record<string, string> = {
  presentation: 'bg-purple-100 text-purple-700', study: 'bg-blue-100 text-blue-700',
  video: 'bg-red-100 text-red-700', link: 'bg-gray-100 text-gray-700',
  infographic: 'bg-orange-100 text-orange-700', image: 'bg-teal-100 text-teal-700',
  protocol: 'bg-indigo-100 text-indigo-700', invoice: 'bg-yellow-100 text-yellow-700',
  medical_finding: 'bg-rose-100 text-rose-700',
};

const fieldCls = 'flex flex-col gap-1';
const labelCls = 'text-xs font-semibold text-muted-foreground uppercase tracking-wide';
const inputCls = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Returns true if the URL points to our object storage */
function isStorageUrl(url: string) {
  return url.startsWith('/api/storage/objects/') || url.includes('/api/storage/objects/');
}

/** Detect mime type from URL suffix to show appropriate icon */
function storageIcon(url: string): React.ElementType {
  const lower = url.toLowerCase();
  if (lower.endsWith('.pdf')) return FileText;
  if (lower.match(/\.(png|jpe?g|gif|webp|svg)$/)) return ImageIcon;
  return File;
}

/** Upload a file via the presigned-URL flow → returns the served object path */
async function uploadFile(file: File, token: string): Promise<string> {
  const meta = await fetch('/api/storage/uploads/request-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  }).then((r) => { if (!r.ok) throw new Error('presign-failed'); return r.json(); });

  await fetch(meta.uploadURL, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  }).then((r) => { if (!r.ok) throw new Error('gcs-put-failed'); });

  // meta.objectPath is like "/objects/some-uuid"
  // Serve it via the storage proxy: /api/storage/objects/some-uuid
  const suffix = (meta.objectPath as string).replace(/^\/objects\//, '');
  return `/api/storage/objects/${suffix}`;
}

// ── Source toggle: URL ↔ File upload ─────────────────────────────────────────

interface SourceInputProps {
  lang: string;
  token: string;
  /** Called with the final URL (either typed URL or storage path) */
  onResolve: (url: string) => void;
  /** Current value (for edit mode) */
  initialUrl?: string;
  /** Ref to expose the current typed URL for form submission */
  urlRef?: React.RefObject<{ getValue: () => string }>;
}

function SourceInput({ lang, token, onResolve, initialUrl = '' }: SourceInputProps) {
  const [mode, setMode] = useState<'url' | 'file'>(
    initialUrl && isStorageUrl(initialUrl) ? 'file' : 'url',
  );
  const [typedUrl, setTypedUrl] = useState(isStorageUrl(initialUrl) ? '' : initialUrl);
  const [uploadedUrl, setUploadedUrl] = useState(isStorageUrl(initialUrl) ? initialUrl : '');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const url = await uploadFile(file, token);
      setUploadedUrl(url);
      onResolve(url);
      toast({ title: lang === 'de' ? 'Datei hochgeladen' : 'File uploaded' });
    } catch {
      setUploadError(lang === 'de' ? 'Upload fehlgeschlagen' : 'Upload failed');
      toast({ variant: 'destructive', title: lang === 'de' ? 'Upload-Fehler' : 'Upload error' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-2">
      {/* Toggle */}
      <div className="flex rounded-md border border-input overflow-hidden text-xs font-medium">
        <button
          type="button"
          onClick={() => setMode('url')}
          className={`flex-1 py-1.5 transition-colors ${mode === 'url' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}
        >
          {lang === 'de' ? 'Web-Link' : 'Web Link'}
        </button>
        <button
          type="button"
          onClick={() => setMode('file')}
          className={`flex-1 py-1.5 transition-colors ${mode === 'file' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}
        >
          {lang === 'de' ? 'Datei hochladen' : 'Upload File'}
        </button>
      </div>

      {mode === 'url' ? (
        <input
          name="url"
          type="url"
          required
          value={typedUrl}
          onChange={(e) => { setTypedUrl(e.target.value); onResolve(e.target.value); }}
          placeholder="https://…"
          className={inputCls}
        />
      ) : (
        <div className="space-y-1.5">
          {/* Hidden field so the form always has a url value */}
          <input type="hidden" name="url" value={uploadedUrl} />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 w-full rounded-md border border-dashed border-input bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {uploading
              ? <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              : <Upload className="w-4 h-4 shrink-0" />}
            <span className="truncate">
              {uploading
                ? (lang === 'de' ? 'Wird hochgeladen…' : 'Uploading…')
                : uploadedUrl
                  ? (lang === 'de' ? 'Andere Datei wählen' : 'Choose another file')
                  : (lang === 'de' ? 'Bild oder PDF auswählen' : 'Choose image or PDF')}
            </span>
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf,application/pdf"
            className="hidden"
            onChange={handleFile}
          />

          {uploadedUrl && !uploading && (
            <p className="flex items-center gap-1.5 text-xs text-green-600">
              <File className="w-3 h-3" />
              {lang === 'de' ? 'Hochgeladen' : 'Uploaded'}:{' '}
              <span className="font-mono truncate">{uploadedUrl.split('/').pop()}</span>
            </p>
          )}
          {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function IrocWebsiteResources() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { irocUrl } = useSiteUrls();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Resource | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  // Tracks the resolved URL for add form (from either typed URL or upload)
  const [addUrl, setAddUrl] = useState('');
  const [editUrl, setEditUrl] = useState('');

  const { data: resources = [], isLoading } = useQuery({
    queryKey: QK,
    queryFn: () =>
      fetch(`/api/resources`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() : []) as Promise<Resource[]>,
    enabled: !!token,
  });

  const addRes = useMutation({
    mutationFn: (data: Record<string, unknown>) => adminPost('/api/admin/resources', token!, data),
    onSuccess: () => { toast({ title: lang === 'de' ? 'Ressource hinzugefügt' : 'Resource added' }); qc.invalidateQueries({ queryKey: QK }); },
    onError: () => toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' }),
  });

  const delRes = useMutation({
    mutationFn: (id: number) => adminDelete(`/api/admin/resources/${id}`, token!),
    onSuccess: () => { toast({ title: lang === 'de' ? 'Gelöscht' : 'Deleted' }); qc.invalidateQueries({ queryKey: QK }); },
    onError: () => toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' }),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const url = (fd.get('url') as string) || addUrl;
    if (!url) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Bitte URL eingeben oder Datei hochladen' : 'Please enter a URL or upload a file' });
      return;
    }
    addRes.mutate({
      title: fd.get('title') as string,
      titleDe: (fd.get('titleDe') as string) || null,
      description: (fd.get('description') as string) || null,
      type: fd.get('type') as string,
      instrument: fd.get('instrument') as string,
      url,
      thumbnailUrl: (fd.get('thumbnailUrl') as string) || null,
    });
    (e.target as HTMLFormElement).reset();
    setAddUrl('');
  };

  const handleEditSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing || !token) return;
    const fd = new FormData(e.currentTarget);
    const url = (fd.get('url') as string) || editUrl;
    if (!url) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Bitte URL eingeben oder Datei hochladen' : 'Please enter a URL or upload a file' });
      return;
    }
    setEditSaving(true);
    try {
      await adminPatch(`/api/admin/resources/${editing.id}`, token, {
        title: fd.get('title') as string,
        titleDe: (fd.get('titleDe') as string) || null,
        description: (fd.get('description') as string) || null,
        type: fd.get('type') as string,
        instrument: fd.get('instrument') as string,
        url,
      });
      setEditing(null);
      setEditUrl('');
      qc.invalidateQueries({ queryKey: QK });
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' });
    } finally {
      setEditSaving(false);
    }
  };

  const byInstrument = ['spirecut', 'ministem', 'both'].map((inst) => ({
    label: inst === 'spirecut' ? 'Spirecut®' : inst === 'ministem' ? 'MiniStem®' : lang === 'de' ? 'Beide' : 'Both',
    items: resources.filter((r) => r.instrument === inst),
    color: inst === 'spirecut' ? 'bg-blue-100 text-blue-700' : inst === 'ministem' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700',
  }));

  const selectCls = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg"><BookOpen className="w-5 h-5 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'Portal-Ressourcen' : 'Portal Resources'}</h1>
          <p className="text-sm text-muted-foreground">
            {lang === 'de' ? `${resources.length} Ressourcen im Arzt-Portal` : `${resources.length} resources in the doctor portal`}
          </p>
        </div>
        <a href={`${irocUrl}/portal`} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
          <Globe className="w-4 h-4" />{lang === 'de' ? 'Website öffnen →' : 'Open Website →'}
        </a>
      </div>

      {/* Add form */}
      <div className="bg-card border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4 text-primary font-semibold">
          <Plus className="w-4 h-4" /> {lang === 'de' ? 'Neue Ressource hinzufügen' : 'Add New Resource'}
        </div>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Titel (EN)' : 'Title (EN)'}</label><Input name="title" required /></div>
          <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Titel (DE, optional)' : 'Title (DE, optional)'}</label><Input name="titleDe" /></div>
          <div className={fieldCls}>
            <label className={labelCls}>{lang === 'de' ? 'Typ' : 'Type'}</label>
            <select name="type" required className={selectCls}>
              <option value="presentation">{lang === 'de' ? 'Präsentation' : 'Presentation'}</option>
              <option value="study">{lang === 'de' ? 'Studie' : 'Study'}</option>
              <option value="video">Video</option>
              <option value="link">Link</option>
              <option value="infographic">Infographic</option>
              <option value="image">Image</option>
              <option value="protocol">{lang === 'de' ? 'Protokoll' : 'Protocol'}</option>
              <option value="invoice">{lang === 'de' ? 'Rechnung' : 'Invoice'}</option>
              <option value="medical_finding">{lang === 'de' ? 'Medizinischer Befund' : 'Medical Finding'}</option>
            </select>
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Instrument</label>
            <select name="instrument" required className={selectCls}>
              <option value="spirecut">Spirecut®</option>
              <option value="ministem">MiniStem®</option>
              <option value="both">{lang === 'de' ? 'Beide' : 'Both'}</option>
            </select>
          </div>
          <div className={`${fieldCls} md:col-span-2`}>
            <label className={labelCls}>{lang === 'de' ? 'Quelle' : 'Source'}</label>
            <SourceInput lang={lang} token={token ?? ''} onResolve={setAddUrl} />
          </div>
          <div className={`${fieldCls} col-span-2 md:col-span-3`}>
            <label className={labelCls}>{lang === 'de' ? 'Beschreibung (optional)' : 'Description (optional)'}</label>
            <Input name="description" />
          </div>
          <div className="col-span-2 md:col-span-3">
            <Button type="submit" disabled={addRes.isPending} className="gap-2">
              {addRes.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {lang === 'de' ? 'Ressource hinzufügen' : 'Add resource'}
            </Button>
          </div>
        </form>
      </div>

      {/* Resource list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-4">
          {byInstrument.map(({ label, items, color }) => items.length > 0 && (
            <div key={label} className="bg-card border rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b bg-muted/30 flex items-center gap-2">
                <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${color}`}>{label}</span>
                <span className="text-sm text-muted-foreground">{items.length}</span>
              </div>
              <div className="divide-y">
                {items.map((r) => {
                  const TypeIcon = TYPE_ICONS[r.type] ?? LinkIcon;
                  const isFile = isStorageUrl(r.url);
                  const FileIcon = storageIcon(r.url);
                  return (
                    <div key={r.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${TYPE_COLORS[r.type] ?? 'bg-gray-100 text-gray-700'}`}>
                        <TypeIcon className="w-3 h-3 inline mr-1" />{r.type}
                      </span>
                      {isFile && (
                        <span className="text-xs px-2 py-0.5 rounded font-medium shrink-0 bg-amber-100 text-amber-700 flex items-center gap-1">
                          <FileIcon className="w-3 h-3" />
                          {lang === 'de' ? 'Datei' : 'File'}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{r.title}{r.titleDe ? ` / ${r.titleDe}` : ''}</p>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline truncate block"
                        >
                          {isFile
                            ? (lang === 'de' ? '↗ Datei öffnen' : '↗ Open file')
                            : r.url}
                        </a>
                        {r.description && <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>}
                      </div>
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => { setEditing(r); setEditUrl(r.url); }}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        title={lang === 'de' ? 'Bearbeiten' : 'Edit'}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => { if (confirm(lang === 'de' ? 'Löschen?' : 'Delete?')) delRes.mutate(r.id); }}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {resources.length === 0 && (
            <p className="text-center py-12 text-muted-foreground text-sm">
              {lang === 'de' ? 'Noch keine Ressourcen vorhanden.' : 'No resources yet.'}
            </p>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{lang === 'de' ? 'Ressource bearbeiten' : 'Edit Resource'}</h2>
              <button onClick={() => { setEditing(null); setEditUrl(''); }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleEditSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className={fieldCls}><label className={labelCls}>Titel (EN) *</label><input name="title" defaultValue={editing.title} required className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>Titel (DE)</label><input name="titleDe" defaultValue={editing.titleDe ?? ''} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className={fieldCls}>
                  <label className={labelCls}>{lang === 'de' ? 'Typ' : 'Type'} *</label>
                  <select name="type" defaultValue={editing.type} required className={inputCls}>
                    <option value="presentation">{lang === 'de' ? 'Präsentation' : 'Presentation'}</option>
                    <option value="study">{lang === 'de' ? 'Studie' : 'Study'}</option>
                    <option value="video">Video</option>
                    <option value="link">Link</option>
                    <option value="infographic">Infographic</option>
                    <option value="image">Image</option>
                    <option value="protocol">{lang === 'de' ? 'Protokoll' : 'Protocol'}</option>
                    <option value="invoice">{lang === 'de' ? 'Rechnung' : 'Invoice'}</option>
                    <option value="medical_finding">{lang === 'de' ? 'Medizinischer Befund' : 'Medical Finding'}</option>
                  </select>
                </div>
                <div className={fieldCls}>
                  <label className={labelCls}>Instrument *</label>
                  <select name="instrument" defaultValue={editing.instrument} required className={inputCls}>
                    <option value="spirecut">Spirecut®</option>
                    <option value="ministem">MiniStem®</option>
                    <option value="both">{lang === 'de' ? 'Beide' : 'Both'}</option>
                  </select>
                </div>
              </div>
              <div className={fieldCls}>
                <label className={labelCls}>{lang === 'de' ? 'Quelle' : 'Source'} *</label>
                <SourceInput
                  key={editing.id}
                  lang={lang}
                  token={token ?? ''}
                  onResolve={setEditUrl}
                  initialUrl={editing.url}
                />
              </div>
              <div className={fieldCls}>
                <label className={labelCls}>{lang === 'de' ? 'Beschreibung' : 'Description'}</label>
                <input name="description" defaultValue={editing.description ?? ''} className={inputCls} />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={editSaving}>
                  {editSaving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  {lang === 'de' ? 'Speichern' : 'Save'}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setEditing(null); setEditUrl(''); }}>
                  {lang === 'de' ? 'Abbrechen' : 'Cancel'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

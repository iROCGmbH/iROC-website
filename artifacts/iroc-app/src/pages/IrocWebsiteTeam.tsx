import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useSiteUrls } from '@/hooks/use-site-urls';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserCircle2, Plus, Trash2, Loader2, Globe, Pencil, X, Upload } from 'lucide-react';
import { adminPost, adminDelete, adminPatch } from '@/lib/admin-fetch';

const QK = ['iroc-team'];

/** Stored photoPath is either an external URL or an object-storage path like /objects/uploads/<uuid>. */
function photoSrc(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith('/objects/') ? `/api/storage${path}` : path;
}

/** Upload via the presigned-URL flow → returns the raw object path ("/objects/uploads/<uuid>"),
 *  which is the format the website's TeamSection expects. */
async function uploadTeamPhoto(file: File, token: string): Promise<string> {
  const meta = await fetch('/api/storage/uploads/request-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  }).then((r) => { if (!r.ok) throw new Error('presign-failed'); return r.json(); });

  const putRes = await fetch(meta.uploadURL, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!putRes.ok) throw new Error('gcs-put-failed');
  return meta.objectPath as string;
}

/** Photo input: paste a URL or upload an image file. Keeps the value in a hidden
 *  photoPath input so the surrounding FormData-based forms keep working. */
function PhotoField({ defaultValue, token, lang, onUploadingChange }: { defaultValue: string | null; token: string; lang: string; onUploadingChange: (uploading: boolean) => void }) {
  const [value, setValue] = useState(defaultValue ?? '');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(false);

  const setUploadingBoth = (u: boolean) => { setUploading(u); onUploadingChange(u); };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingBoth(true);
    setError(false);
    try {
      setValue(await uploadTeamPhoto(file, token));
    } catch {
      setError(true);
    } finally {
      setUploadingBoth(false);
    }
  };

  const preview = photoSrc(value || null);
  return (
    <div className="flex items-start gap-3">
      {preview && <img src={preview} alt="" className="w-14 h-14 rounded-full object-cover shrink-0 bg-muted border" />}
      <div className="flex-1 space-y-1">
        <input type="hidden" name="photoPath" value={value} />
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={lang === 'de' ? 'https://… oder Bild hochladen' : 'https://… or upload an image'}
          />
          <label className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm font-medium cursor-pointer hover:bg-accent whitespace-nowrap">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {lang === 'de' ? 'Hochladen' : 'Upload'}
            <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={uploading} />
          </label>
        </div>
        {error && <p className="text-xs text-destructive">{lang === 'de' ? 'Upload fehlgeschlagen. Bitte erneut versuchen.' : 'Upload failed. Please try again.'}</p>}
      </div>
    </div>
  );
}

/** Matches the actual teamMembersTable columns returned by GET /api/team */
interface TeamMember {
  id: number;
  name: string;
  role: string;          // English title/role (required by backend)
  roleDe: string | null; // German title/role
  bio: string | null;    // English bio
  bioDe: string | null;  // German bio
  photoPath: string | null;
  sortOrder: number;
  category: string | null;
}

export default function IrocWebsiteTeam() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { irocUrl } = useSiteUrls();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TeamMember | null>(null);

  const { data: members = [], isLoading } = useQuery({
    queryKey: QK,
    queryFn: () => fetch(`/api/team`).then((r) => r.json()) as Promise<TeamMember[]>,
  });

  const addMember = useMutation({
    mutationFn: (data: Record<string, unknown>) => adminPost('/api/admin/team', token!, data),
    onSuccess: () => { toast({ title: lang === 'de' ? 'Mitglied hinzugefügt' : 'Member added' }); qc.invalidateQueries({ queryKey: QK }); },
    onError: () => toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' }),
  });

  const updateMember = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => adminPatch(`/api/admin/team/${id}`, token!, data),
    onSuccess: () => { toast({ title: lang === 'de' ? 'Aktualisiert' : 'Updated' }); qc.invalidateQueries({ queryKey: QK }); setEditing(null); },
    onError: () => toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' }),
  });

  const delMember = useMutation({
    mutationFn: (id: number) => adminDelete(`/api/admin/team/${id}`, token!),
    onSuccess: () => { toast({ title: lang === 'de' ? 'Gelöscht' : 'Deleted' }); qc.invalidateQueries({ queryKey: QK }); },
    onError: () => toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' }),
  });

  const parseForm = (e: React.FormEvent<HTMLFormElement>) => {
    const fd = new FormData(e.currentTarget);
    return {
      name: fd.get('name') as string,
      role: (fd.get('role') as string) || '',           // EN title — required
      roleDe: (fd.get('roleDe') as string) || null,     // DE title
      bio: (fd.get('bio') as string) || null,           // EN bio
      bioDe: (fd.get('bioDe') as string) || null,       // DE bio
      photoPath: (fd.get('photoPath') as string) || null,
      sortOrder: parseInt(fd.get('sortOrder') as string) || 0,
      category: (fd.get('category') as string) || 'consulting_doctors',
    };
  };

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    addMember.mutate(parseForm(e));
    (e.target as HTMLFormElement).reset();
  };

  const handleUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    updateMember.mutate({ id: editing.id, data: parseForm(e) });
  };

  return (
    <PageBody
      lang={lang} irocUrl={irocUrl} members={members} isLoading={isLoading} token={token!}
      editing={editing} setEditing={setEditing}
      addMember={addMember} updateMember={updateMember} delMember={delMember}
      handleAdd={handleAdd} handleUpdate={handleUpdate}
    />
  );
}

const fieldCls = "flex flex-col gap-1";
const labelCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide";

/** Top-level (stable identity) so React never remounts it on parent re-renders,
 *  which would wipe in-progress input — especially the PhotoField state. */
function TeamForm({ defaultValues, onSubmit, submitting, lang, token, onCancel }: {
  defaultValues?: TeamMember;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
  lang: string;
  token: string;
  onCancel?: () => void;
}) {
  const [photoUploading, setPhotoUploading] = useState(false);
  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 md:grid-cols-3 gap-4">
      <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Name' : 'Name'}</label><Input name="name" required defaultValue={defaultValues?.name ?? ''} /></div>
      <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Titel (EN)' : 'Title (EN)'} *</label><Input name="role" required defaultValue={defaultValues?.role ?? ''} placeholder={lang === 'de' ? 'z. B. CEO' : 'e.g. CEO'} /></div>
      <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Titel (DE)' : 'Title (DE)'}</label><Input name="roleDe" defaultValue={defaultValues?.roleDe ?? ''} placeholder="z.B. Geschäftsführer" /></div>
      <div className={`${fieldCls} col-span-2 md:col-span-3`}><label className={labelCls}>Bio (EN, optional)</label><textarea name="bio" defaultValue={defaultValues?.bio ?? ''} rows={2} className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none" /></div>
      <div className={`${fieldCls} col-span-2 md:col-span-3`}><label className={labelCls}>Bio (DE, optional)</label><textarea name="bioDe" defaultValue={defaultValues?.bioDe ?? ''} rows={2} className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none" /></div>
      <div className={`${fieldCls} col-span-2`}><label className={labelCls}>{lang === 'de' ? 'Foto (URL oder Upload, optional)' : 'Photo (URL or upload, optional)'}</label><PhotoField defaultValue={defaultValues?.photoPath ?? null} token={token} lang={lang} onUploadingChange={setPhotoUploading} /></div>
      <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Reihenfolge' : 'Order'}</label><Input name="sortOrder" type="number" defaultValue={defaultValues?.sortOrder ?? 0} /></div>
      <div className={fieldCls}>
        <label className={labelCls}>{lang === 'de' ? 'Kategorie' : 'Category'}</label>
        <select name="category" defaultValue={defaultValues?.category ?? 'consulting_doctors'} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
          <option value="consulting_doctors">{lang === 'de' ? 'Beratungsärzte' : 'Consulting Doctors'}</option>
          <option value="specialists">{lang === 'de' ? 'Spezialisten' : 'Specialists'}</option>
           <option value="ai_agents">Agents/Managers</option>
        </select>
      </div>
      <div className="col-span-2 md:col-span-3 flex gap-2">
        <Button type="submit" disabled={submitting || photoUploading} className="gap-2">
          {submitting || photoUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {photoUploading
            ? (lang === 'de' ? 'Foto wird hochgeladen…' : 'Uploading photo…')
            : defaultValues ? (lang === 'de' ? 'Speichern' : 'Save') : (lang === 'de' ? 'Mitglied hinzufügen' : 'Add member')}
        </Button>
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>{lang === 'de' ? 'Abbrechen' : 'Cancel'}</Button>}
      </div>
    </form>
  );
}

function PageBody({ lang, irocUrl, members, isLoading, token, editing, setEditing, addMember, updateMember, delMember, handleAdd, handleUpdate }: {
  lang: string;
  irocUrl: string;
  members: TeamMember[];
  isLoading: boolean;
  token: string;
  editing: TeamMember | null;
  setEditing: (m: TeamMember | null) => void;
  addMember: { isPending: boolean; isSuccess: boolean };
  updateMember: { isPending: boolean };
  delMember: { mutate: (id: number) => void };
  handleAdd: (e: React.FormEvent<HTMLFormElement>) => void;
  handleUpdate: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  // Remount the add form after each successful add so the (controlled) photo field resets too
  const [addFormKey, setAddFormKey] = useState(0);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg"><UserCircle2 className="w-5 h-5 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-bold">Team</h1>
          <p className="text-sm text-muted-foreground">{lang === 'de' ? `${members.length} Mitglieder` : `${members.length} members`}</p>
        </div>
        <a href={irocUrl} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
          <Globe className="w-4 h-4" />{lang === 'de' ? 'Website öffnen →' : 'Open Website →'}
        </a>
      </div>

      {/* Add form */}
      <div className="bg-card border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4 text-primary font-semibold">
          <Plus className="w-4 h-4" /> {lang === 'de' ? 'Neues Mitglied hinzufügen' : 'Add New Member'}
        </div>
        <TeamForm key={addFormKey} onSubmit={(e) => { handleAdd(e); setAddFormKey(k => k + 1); }} submitting={addMember.isPending} lang={lang} token={token} />
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{lang === 'de' ? 'Mitglied bearbeiten' : 'Edit Member'}</h2>
              <button onClick={() => setEditing(null)}><X className="w-5 h-5" /></button>
            </div>
            <TeamForm key={editing.id} defaultValues={editing} onSubmit={handleUpdate} submitting={updateMember.isPending} lang={lang} token={token} onCancel={() => setEditing(null)} />
          </div>
        </div>
      )}

      {/* Member list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : members.length === 0 ? (
        <p className="text-center py-12 text-muted-foreground text-sm">{lang === 'de' ? 'Noch keine Mitglieder.' : 'No members yet.'}</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {[...members].sort((a, b) => a.sortOrder - b.sortOrder).map((m) => (
            <div key={m.id} className="bg-card border rounded-xl p-4 shadow-sm flex items-start gap-4">
              {m.photoPath ? (
                <img src={photoSrc(m.photoPath)!} alt={m.name} className="w-14 h-14 rounded-full object-cover shrink-0 bg-muted" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <UserCircle2 className="w-8 h-8 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{m.name}</p>
                <p className="text-xs text-muted-foreground">{lang === 'de' ? (m.roleDe || m.role) : (m.role || m.roleDe)}</p>
                {(lang === 'de' ? m.bioDe : m.bio) && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{lang === 'de' ? m.bioDe : m.bio}</p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setEditing(m)} className="text-muted-foreground hover:text-foreground">
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { if (confirm(lang === 'de' ? 'Löschen?' : 'Delete?')) delMember.mutate(m.id); }} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

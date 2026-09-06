import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Bot, Save, CheckCircle, AlertCircle, Loader2, Upload, File as FileIcon, Trash2, X, Plus } from 'lucide-react';
import { adminGet, adminPost, adminDelete } from '@/lib/admin-fetch';
import { CHATBOT_SYSTEM_PROMPT_MAX_LENGTH } from '@workspace/spirecut-shared';
import { format } from 'date-fns';
import { de, enUS } from 'date-fns/locale';

type SpiroKnowledgeDocument = {
  id: number;
  name: string;
  objectPath: string;
  contentType: string;
  sizeBytes: number;
  status: 'processing' | 'ready' | 'failed';
  pageCount: number | null;
  characterCount: number;
  errorMessage: string | null;
  createdAt: string;
  analyzedAt: string | null;
};

const EMPTY_STARTERS: [string, string, string, string] = ['', '', '', ''];
const CHATBOT_SYSTEM_PROMPT_WARNING_LENGTH = Math.floor(CHATBOT_SYSTEM_PROMPT_MAX_LENGTH * 0.9);

function parseStarters(raw: string): [string, string, string, string] {
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      const four = arr.slice(0, 4).map((v) => String(v ?? ''));
      while (four.length < 4) four.push('');
      return four as [string, string, string, string];
    }
  } catch { /* ignore */ }
  return [...EMPTY_STARTERS] as [string, string, string, string];
}

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export default function SpiroSettings() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();

  const [chatPrompt, setChatPrompt] = useState('');
  const [chatPromptSaved, setChatPromptSaved] = useState('');
  const [chatStartersDe, setChatStartersDe] = useState<[string,string,string,string]>([...EMPTY_STARTERS]);
  const [chatStartersEn, setChatStartersEn] = useState<[string,string,string,string]>([...EMPTY_STARTERS]);
  const [chatStartersDeOrig, setChatStartersDeOrig] = useState<[string,string,string,string]>([...EMPTY_STARTERS]);
  const [chatStartersEnOrig, setChatStartersEnOrig] = useState<[string,string,string,string]>([...EMPTY_STARTERS]);
  const [chatSaving, setChatSaving] = useState<Record<string, boolean>>({});
  const [chatResults, setChatResults] = useState<Record<string, 'ok' | 'error'>>({});

  const [documents, setDocuments] = useState<SpiroKnowledgeDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadingName, setUploadingName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const chatPromptLength = chatPrompt.length;
  const chatPromptOverLimit = chatPromptLength > CHATBOT_SYSTEM_PROMPT_MAX_LENGTH;
  const chatPromptNearLimit = chatPromptLength >= CHATBOT_SYSTEM_PROMPT_WARNING_LENGTH;
  const formattedChatPromptLength = chatPromptLength.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US');
  const formattedChatPromptMaxLength = CHATBOT_SYSTEM_PROMPT_MAX_LENGTH.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US');

  const fetchDocuments = async () => {
    if (!token) return;
    try {
      const data = await adminGet<SpiroKnowledgeDocument[]>('/api/admin/spiro/knowledge', token);
      setDocuments(data);
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Dokumente konnten nicht geladen werden' : 'Could not load documents' });
    } finally {
      setDocumentsLoading(false);
    }
  };

  const uploadToSignedUrl = (url: string, file: File): Promise<void> => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', 'application/pdf');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => request.status >= 200 && request.status < 300
      ? resolve()
      : reject(new Error(`Upload failed (${request.status})`));
    request.onerror = () => reject(new Error('Upload failed'));
    request.send(file);
  });

  const uploadFiles = async (files: File[]) => {
    if (!token || isUploading) return;
    const validFiles = files.filter((file) => {
      if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
        toast({ variant: 'destructive', title: lang === 'de' ? `${file.name}: Nur PDFs erlaubt` : `${file.name}: Only PDFs are allowed` });
        return false;
      }
      if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
        toast({ variant: 'destructive', title: lang === 'de' ? `${file.name}: maximal 20 MB` : `${file.name}: maximum 20 MB` });
        return false;
      }
      return true;
    });
    if (validFiles.length === 0) return;

    setIsUploading(true);
    try {
      for (const file of validFiles) {
        setUploadingName(file.name);
        setProgress(0);
        const upload = await adminPost<{ uploadURL: string; objectPath: string }>(
          '/api/admin/spiro/knowledge/upload-url',
          token,
          { name: file.name, size: file.size, contentType: 'application/pdf' },
        );
        await uploadToSignedUrl(upload.uploadURL, file);
        setProgress(100);
        await adminPost('/api/admin/spiro/knowledge', token, {
          name: file.name,
          objectPath: upload.objectPath,
          contentType: 'application/pdf',
          sizeBytes: file.size,
        });
      }
      toast({
        title: lang === 'de' ? 'Wissen hinzugefügt' : 'Knowledge added',
        description: lang === 'de'
          ? `${validFiles.length} PDF-Datei(en) wurden analysiert.`
          : `${validFiles.length} PDF file(s) were analyzed.`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: lang === 'de' ? 'PDF-Verarbeitung fehlgeschlagen' : 'PDF processing failed',
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      await fetchDocuments();
      setIsUploading(false);
      setUploadingName('');
      setProgress(0);
    }
  };

  useEffect(() => {
    if (!token) return;
    
    adminGet<{ settings: Record<string, string> }>('/api/admin/spirecut-settings', token)
      .then(({ settings: data }) => {
        const prompt = data['sp_chatbot_system_prompt'] ?? '';
        setChatPrompt(prompt);
        setChatPromptSaved(prompt);

        const de = parseStarters(data['sp_chatbot_starters_de'] ?? '');
        const en = parseStarters(data['sp_chatbot_starters_en'] ?? '');
        setChatStartersDe(de);
        setChatStartersDeOrig(de);
        setChatStartersEn(en);
        setChatStartersEnOrig(en);
      })
      .catch(() => {});
      
    fetchDocuments();
  }, [token]);

  // Poll for processing documents
  useEffect(() => {
    const hasProcessing = documents.some(d => d.status === 'processing');
    if (!hasProcessing) return;
    
    const interval = setInterval(fetchDocuments, 5000);
    return () => clearInterval(interval);
  }, [documents, token]);

  const handleSaveChatPrompt = async () => {
    if (!token) return;
    setChatSaving((s) => ({ ...s, prompt: true }));
    setChatResults((r) => { const n = { ...r }; delete n['prompt']; return n; });
    try {
      await adminPost('/api/admin/spirecut-settings', token, { key: 'sp_chatbot_system_prompt', value: chatPrompt.trim() });
      setChatPromptSaved(chatPrompt.trim());
      setChatResults((r) => ({ ...r, prompt: 'ok' }));
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
    } catch {
      setChatResults((r) => ({ ...r, prompt: 'error' }));
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Speichern' : 'Error saving' });
    } finally {
      setChatSaving((s) => ({ ...s, prompt: false }));
    }
  };

  const handleSaveChatStarters = async (locale: 'de' | 'en') => {
    if (!token) return;
    const starters = locale === 'de' ? chatStartersDe : chatStartersEn;
    const key = locale === 'de' ? 'sp_chatbot_starters_de' : 'sp_chatbot_starters_en';
    const filtered = starters.filter((s) => s.trim());
    const value = filtered.length ? JSON.stringify(filtered) : '';
    setChatSaving((s) => ({ ...s, [locale]: true }));
    setChatResults((r) => { const n = { ...r }; delete n[locale]; return n; });
    try {
      await adminPost('/api/admin/spirecut-settings', token, { key, value });
      const parsed = parseStarters(value);
      if (locale === 'de') { setChatStartersDeOrig(parsed); setChatStartersDe(parsed); }
      else { setChatStartersEnOrig(parsed); setChatStartersEn(parsed); }
      setChatResults((r) => ({ ...r, [locale]: 'ok' }));
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
    } catch {
      setChatResults((r) => ({ ...r, [locale]: 'error' }));
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Speichern' : 'Error saving' });
    } finally {
      setChatSaving((s) => ({ ...s, [locale]: false }));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    void uploadFiles(Array.from(e.target.files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (isUploading) return;
    
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) void uploadFiles(files);
  };

  const handleDeleteDocument = async (id: number) => {
    if (!token) return;
    if (!confirm(lang === 'de' ? 'Dokument wirklich löschen?' : 'Really delete document?')) return;
    
    try {
      await adminDelete(`/api/admin/spiro/knowledge/${id}`, token);
      setDocuments(docs => docs.filter(d => d.id !== id));
      toast({ title: lang === 'de' ? 'Gelöscht' : 'Deleted' });
    } catch (err) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Löschen' : 'Error deleting' });
    }
  };

  const filteredDocuments = documents.filter(doc => 
    doc.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Bot className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'Spiro Einstellungen' : 'Spiro Settings'}</h1>
          <p className="text-sm text-muted-foreground">
            {lang === 'de' ? 'Patienten-Chatbot Anweisungen und Wissensdatenbank' : 'Patient chatbot instructions and knowledge base'}
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-8 items-start">
        <div className="space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {lang === 'de' ? 'Chatbot-Konfiguration' : 'Chatbot Configuration'}
            </h2>
            <div className="grid gap-4">

              {/* System Prompt */}
              <div className="bg-card border rounded-xl p-5 shadow-sm space-y-3">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-muted-foreground" />
                  <p className="font-medium text-sm">
                    {lang === 'de' ? 'System-Prompt (Anweisungen für den Assistenten)' : 'System Prompt (assistant instructions)'}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {lang === 'de'
                    ? 'Leer lassen, um den eingebauten Standard-Prompt zu verwenden.'
                    : 'Leave empty to use the built-in default prompt.'}
                </p>
                <Textarea
                  value={chatPrompt}
                  onChange={(e) => setChatPrompt(e.target.value)}
                  placeholder={lang === 'de' ? 'System-Prompt eingeben…' : 'Enter system prompt…'}
                  rows={8}
                  aria-describedby={chatPromptNearLimit ? 'chatbot-prompt-length chatbot-prompt-limit' : 'chatbot-prompt-length'}
                  className="font-mono text-xs resize-y"
                />
                <div
                  id="chatbot-prompt-length"
                  className={`text-xs ${chatPromptOverLimit ? 'text-destructive font-medium' : chatPromptNearLimit ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}
                  aria-live="polite"
                >
                  {formattedChatPromptLength} / {formattedChatPromptMaxLength}{' '}
                  {lang === 'de' ? 'Zeichen' : 'characters'}
                </div>
                {chatPromptOverLimit ? (
                  <p id="chatbot-prompt-limit" className="flex items-center gap-1.5 text-sm text-destructive" role="alert">
                    <AlertCircle className="w-4 h-4" />
                    {lang === 'de'
                      ? `Der Prompt ist zu lang. Kürzen Sie ihn auf maximal ${formattedChatPromptMaxLength} Zeichen, bevor Sie speichern.`
                      : `The prompt is too long. Shorten it to ${formattedChatPromptMaxLength} characters or fewer before saving.`}
                  </p>
                ) : chatPromptNearLimit ? (
                  <p id="chatbot-prompt-limit" className="flex items-center gap-1.5 text-sm text-amber-600" role="status">
                    <AlertCircle className="w-4 h-4" />
                    {lang === 'de'
                      ? 'Achtung: Der Prompt nähert sich dem sicheren Zeichenlimit.'
                      : 'Warning: The prompt is approaching the safe character limit.'}
                  </p>
                ) : null}
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    onClick={handleSaveChatPrompt}
                    disabled={chatSaving['prompt'] || chatPromptOverLimit}
                    aria-label={lang === 'de' ? 'System-Prompt speichern' : 'Save system prompt'}
                    className="gap-1.5"
                  >
                    {chatSaving['prompt'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {lang === 'de' ? 'Speichern' : 'Save'}
                  </Button>
                  {chatResults['prompt'] === 'ok' && (
                    <span className="flex items-center gap-1.5 text-sm text-green-600">
                      <CheckCircle className="w-4 h-4" /> {lang === 'de' ? 'Gespeichert' : 'Saved'}
                    </span>
                  )}
                  {chatResults['prompt'] === 'error' && (
                    <span className="flex items-center gap-1.5 text-sm text-destructive">
                      <AlertCircle className="w-4 h-4" /> {lang === 'de' ? 'Fehler' : 'Error'}
                    </span>
                  )}
                  {chatPromptSaved && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground text-xs"
                      onClick={() => { setChatPrompt(''); }}
                    >
                      {lang === 'de' ? 'Standard wiederherstellen' : 'Restore default'}
                    </Button>
                  )}
                </div>
              </div>

              {/* Starter Questions DE */}
              <div className="bg-card border rounded-xl p-5 shadow-sm space-y-3">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-muted-foreground" />
                  <p className="font-medium text-sm">
                    {lang === 'de' ? 'Starterfragen (Deutsch, max. 4)' : 'Starter Questions (German, max. 4)'}
                  </p>
                </div>
                <div className="grid gap-2">
                  {chatStartersDe.map((q, i) => (
                    <Input
                      key={i}
                      value={q}
                      onChange={(e) => {
                        const next = [...chatStartersDe] as [string,string,string,string];
                        next[i] = e.target.value;
                        setChatStartersDe(next);
                      }}
                      placeholder={`${lang === 'de' ? 'Frage' : 'Question'} ${i + 1}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    onClick={() => handleSaveChatStarters('de')}
                    disabled={chatSaving['de']}
                    className="gap-1.5"
                  >
                    {chatSaving['de'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {lang === 'de' ? 'Speichern' : 'Save'}
                  </Button>
                  {chatResults['de'] === 'ok' && (
                    <span className="flex items-center gap-1.5 text-sm text-green-600">
                      <CheckCircle className="w-4 h-4" /> {lang === 'de' ? 'Gespeichert' : 'Saved'}
                    </span>
                  )}
                  {chatResults['de'] === 'error' && (
                    <span className="flex items-center gap-1.5 text-sm text-destructive">
                      <AlertCircle className="w-4 h-4" /> {lang === 'de' ? 'Fehler' : 'Error'}
                    </span>
                  )}
                  {chatStartersDeOrig.some(s => s) && (
                    <Button
                      size="sm" variant="ghost" className="text-muted-foreground text-xs"
                      onClick={() => setChatStartersDe([...EMPTY_STARTERS])}
                    >
                      {lang === 'de' ? 'Alle leeren' : 'Clear all'}
                    </Button>
                  )}
                </div>
              </div>

              {/* Starter Questions EN */}
              <div className="bg-card border rounded-xl p-5 shadow-sm space-y-3">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-muted-foreground" />
                  <p className="font-medium text-sm">
                    {lang === 'de' ? 'Starterfragen (Englisch, max. 4)' : 'Starter Questions (English, max. 4)'}
                  </p>
                </div>
                <div className="grid gap-2">
                  {chatStartersEn.map((q, i) => (
                    <Input
                      key={i}
                      value={q}
                      onChange={(e) => {
                        const next = [...chatStartersEn] as [string,string,string,string];
                        next[i] = e.target.value;
                        setChatStartersEn(next);
                      }}
                      placeholder={`${lang === 'de' ? 'Frage' : 'Question'} ${i + 1}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    onClick={() => handleSaveChatStarters('en')}
                    disabled={chatSaving['en']}
                    className="gap-1.5"
                  >
                    {chatSaving['en'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {lang === 'de' ? 'Speichern' : 'Save'}
                  </Button>
                  {chatResults['en'] === 'ok' && (
                    <span className="flex items-center gap-1.5 text-sm text-green-600">
                      <CheckCircle className="w-4 h-4" /> {lang === 'de' ? 'Gespeichert' : 'Saved'}
                    </span>
                  )}
                  {chatResults['en'] === 'error' && (
                    <span className="flex items-center gap-1.5 text-sm text-destructive">
                      <AlertCircle className="w-4 h-4" /> {lang === 'de' ? 'Fehler' : 'Error'}
                    </span>
                  )}
                  {chatStartersEnOrig.some(s => s) && (
                    <Button
                      size="sm" variant="ghost" className="text-muted-foreground text-xs"
                      onClick={() => setChatStartersEn([...EMPTY_STARTERS])}
                    >
                      {lang === 'de' ? 'Alle leeren' : 'Clear all'}
                    </Button>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {lang === 'de' ? 'Wissensdatenbank (PDFs)' : 'Knowledge Base (PDFs)'}
            </h2>
            
            <div className="bg-card border rounded-xl shadow-sm overflow-hidden flex flex-col h-[700px]">
              {/* Upload area */}
              <div 
                className={`p-6 border-b text-center transition-colors ${isUploading ? 'bg-muted/50' : 'hover:bg-muted/20'}`}
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileSelect} 
                  accept=".pdf,application/pdf"
                  multiple
                  className="hidden" 
                />
                
                {isUploading ? (
                  <div className="space-y-3 py-4">
                    <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
                    <p className="text-sm font-medium">{uploadingName}</p>
                    <p className="text-xs text-muted-foreground">
                      {lang === 'de' ? 'Wird hochgeladen und analysiert' : 'Uploading and analyzing'} · {progress}%
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {lang === 'de' ? 'PDF hierher ziehen oder' : 'Drag PDF here or'}
                      </p>
                      <Button 
                        variant="link" 
                        className="text-primary h-auto p-0 text-sm font-medium"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {lang === 'de' ? 'Datei auswählen' : 'Select file'}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {lang === 'de' ? 'Maximal 20 MB pro Datei' : 'Maximum 20 MB per file'}
                    </p>
                  </div>
                )}
              </div>

              {/* List header & search */}
              <div className="p-4 border-b bg-muted/20">
                <Input
                  placeholder={lang === 'de' ? 'Dokumente durchsuchen...' : 'Search documents...'}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="bg-background"
                />
              </div>

              {/* Document list */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {documentsLoading ? (
                  <div className="py-12 text-center text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    <p className="text-sm">{lang === 'de' ? 'Lade...' : 'Loading...'}</p>
                  </div>
                ) : filteredDocuments.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">
                    <FileIcon className="w-8 h-8 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">
                      {documents.length === 0 
                        ? (lang === 'de' ? 'Keine Dokumente hochgeladen' : 'No documents uploaded')
                        : (lang === 'de' ? 'Keine Treffer' : 'No matches found')}
                    </p>
                  </div>
                ) : (
                  filteredDocuments.map(doc => (
                    <div key={doc.id} className="flex items-start gap-3 p-3 rounded-lg border bg-background hover:bg-muted/5 transition-colors group">
                      <div className={`p-2 rounded-md shrink-0 ${
                        doc.status === 'ready' ? 'bg-green-100 text-green-700 dark:bg-green-900/30' :
                        doc.status === 'failed' ? 'bg-destructive/10 text-destructive' :
                        'bg-blue-100 text-blue-700 dark:bg-blue-900/30'
                      }`}>
                        {doc.status === 'processing' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <FileIcon className="w-4 h-4" />
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm truncate" title={doc.name}>
                            {doc.name}
                          </p>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                            onClick={() => handleDeleteDocument(doc.id)}
                            title={lang === 'de' ? 'Löschen' : 'Delete'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{formatBytes(doc.sizeBytes)}</span>
                          
                          {doc.status === 'ready' && doc.pageCount != null && (
                            <>
                              <span className="w-1 h-1 rounded-full bg-border" />
                              <span>{doc.pageCount} {lang === 'de' ? 'Seiten' : 'pages'}</span>
                            </>
                          )}
                          
                          <span className="w-1 h-1 rounded-full bg-border" />
                          <span>{format(new Date(doc.createdAt), 'dd.MM.yyyy', { locale: lang === 'de' ? de : enUS })}</span>
                        </div>
                        
                        {doc.status === 'failed' && doc.errorMessage && (
                          <p className="text-xs text-destructive mt-1.5 bg-destructive/10 p-1.5 rounded">
                            {doc.errorMessage}
                          </p>
                        )}
                        
                        {doc.status === 'processing' && (
                          <p className="text-xs text-blue-600 mt-1">
                            {lang === 'de' ? 'Wird analysiert...' : 'Analyzing...'}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

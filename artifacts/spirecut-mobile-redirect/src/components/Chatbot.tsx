/**
 * Spiro — Spirecut Patient Chatbot
 *
 * Floating chat widget powered by Gemini 2.5 Flash with Google Search grounding.
 * Uses the /api/gemini/conversations/* endpoints via streaming SSE.
 *
 * Features:
 * - Short initial answers (2–4 sentences) enforced via system prompt
 * - Follow-up suggestion chips rendered after each answer
 * - Per-message quick-edit actions (Shorter / Simpler / More detail / Custom)
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageCircle, X, Send, Loader2, User, ChevronDown,
  Trash2, AlertCircle, Download, RefreshCw, Pencil, Sparkles,
} from 'lucide-react';
import { ChatbotPDFDownload } from './ChatbotPDF';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  followUps?: string[];
}

// ── Suggested starter questions ────────────────────────────────────────────────

const DEFAULT_STARTERS_DE = [
  'Was ist der Spirecut®-Eingriff?',
  'Wie lange dauert die Heilung nach dem Eingriff?',
  'Ist der Eingriff schmerzhaft?',
  'Wie finde ich einen zertifizierten Arzt in meiner Nähe?',
];
const DEFAULT_STARTERS_EN = [
  'What is the Spirecut® procedure?',
  'How long is the recovery after the procedure?',
  'Is the procedure painful?',
  'How do I find a certified doctor near me?',
];

function parseStartersFromRaw(raw: string, fallback: string[]): string[] {
  if (!raw) return fallback;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0) return arr.map(String).filter(Boolean);
  } catch { /* ignore */ }
  return fallback;
}

// ── Quick-edit actions ─────────────────────────────────────────────────────────

const EDIT_ACTIONS_DE = [
  { label: 'Kürzer',       msg: 'Bitte fasse deine letzte Antwort kürzer zusammen.' },
  { label: 'Einfacher',    msg: 'Bitte erkläre das nochmal einfacher, ohne Fachbegriffe.' },
  { label: 'Mehr Details', msg: 'Bitte erkläre das ausführlicher.' },
];
const EDIT_ACTIONS_EN = [
  { label: 'Shorter',     msg: 'Please give a shorter version of your last answer.' },
  { label: 'Simpler',     msg: 'Please explain that more simply, without jargon.' },
  { label: 'More detail', msg: 'Please explain that in more detail.' },
];

// ── Follow-up parsing ──────────────────────────────────────────────────────────

const FOLLOWUP_RE = /<!--\s*SPIRO_FOLLOWUPS:\s*(\[[\s\S]*?\])\s*-->/;

/** Strip any partial or complete SPIRO_FOLLOWUPS marker from display during streaming. */
function stripMarkerForDisplay(text: string): string {
  // Complete marker — strip entirely
  if (FOLLOWUP_RE.test(text)) return text.replace(FOLLOWUP_RE, '').trimEnd();
  // Partial marker starting — hide from the `<!--` onwards
  const idx = text.lastIndexOf('<!--');
  if (idx !== -1 && !text.slice(idx).includes('-->')) return text.slice(0, idx).trimEnd();
  return text;
}

/** After streaming completes: extract follow-up questions and clean content. */
function parseFollowUps(text: string): { clean: string; followUps: string[] } {
  const match = text.match(FOLLOWUP_RE);
  if (!match) return { clean: text, followUps: [] };
  try {
    const arr = JSON.parse(match[1]) as unknown[];
    const followUps = arr.filter((s): s is string => typeof s === 'string');
    return { clean: text.replace(FOLLOWUP_RE, '').trimEnd(), followUps };
  } catch {
    return { clean: text.replace(FOLLOWUP_RE, '').trimEnd(), followUps: [] };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function createConversation(title: string): Promise<number> {
  const r = await fetch('/api/gemini/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!r.ok) throw new Error('Failed to create conversation');
  const data = await r.json();
  return data.id as number;
}

async function* streamMessage(
  conversationId: number,
  content: string,
  language: 'de' | 'en',
): AsyncGenerator<{ content?: string; done?: boolean; error?: string; retryable?: boolean }> {
  const r = await fetch(`/api/gemini/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, language }),
  });
  if (!r.ok || !r.body) {
    yield { error: 'Network error', retryable: r.status >= 500 || r.status === 429 };
    return;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try { yield JSON.parse(line.slice(6)); } catch { /* ignore malformed */ }
      }
    }
  }
}

// ── Spiro avatar ───────────────────────────────────────────────────────────────

function SpiroAvatar({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const cls = size === 'lg'
    ? 'w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-md'
    : 'w-7 h-7 rounded-xl bg-primary flex items-center justify-center shrink-0';
  const text = size === 'lg' ? 'text-lg' : 'text-xs';
  return (
    <div className={cls}>
      <span className={`font-bold text-white ${text} select-none`}>S</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Chatbot() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('de') ? 'de' : 'en';

  const [open, setOpen]             = useState(false);
  const [messages, setMessages]     = useState<Message[]>([]);
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [streamError, setStreamError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [convId, setConvId]         = useState<number | null>(null);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [startersDe, setStartersDe] = useState<string[]>(DEFAULT_STARTERS_DE);
  const [startersEn, setStartersEn] = useState<string[]>(DEFAULT_STARTERS_EN);

  const bottomRef          = useRef<HTMLDivElement>(null);
  const inputRef           = useRef<HTMLTextAreaElement>(null);
  const lastUserMessageRef = useRef<string>('');

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 100); }, [open]);

  useEffect(() => {
    fetch('/api/patient-settings')
      .then((r) => r.ok ? r.json() : {})
      .then((data: Record<string, string>) => {
        setStartersDe(parseStartersFromRaw(data['sp_chatbot_starters_de'] ?? '', DEFAULT_STARTERS_DE));
        setStartersEn(parseStartersFromRaw(data['sp_chatbot_starters_en'] ?? '', DEFAULT_STARTERS_EN));
      })
      .catch(() => {});
  }, []);

  const starters    = lang === 'de' ? startersDe : startersEn;
  const editActions = lang === 'de' ? EDIT_ACTIONS_DE : EDIT_ACTIONS_EN;

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);
    setStreamError(null);
    setEditingId(null);
    setLoading(true);
    setInput('');
    lastUserMessageRef.current = trimmed;

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);

    let cid = convId;
    try {
      if (!cid) {
        cid = await createConversation(trimmed.slice(0, 60));
        setConvId(cid);
      }
    } catch {
      setError(lang === 'de' ? 'Verbindungsfehler. Bitte versuchen Sie es erneut.' : 'Connection error. Please try again.');
      setLoading(false);
      return;
    }

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', streaming: true }]);

    try {
      let full = '';
      let hitError = false;
      for await (const chunk of streamMessage(cid, trimmed, lang)) {
        if (chunk.error) {
          hitError = true;
          setMessages((prev) => {
            const bubble = prev.find((m) => m.id === assistantId);
            if (bubble && !bubble.content) return prev.filter((m) => m.id !== assistantId);
            return prev.map((m) => m.id === assistantId ? { ...m, streaming: false } : m);
          });
          setStreamError({
            message: chunk.retryable
              ? (lang === 'de'
                  ? 'Spiro ist vorübergehend nicht verfügbar. Bitte versuchen Sie es erneut.'
                  : 'Spiro is temporarily unavailable. Please try again.')
              : (lang === 'de'
                  ? 'Fehler beim Abrufen der Antwort. Bitte versuchen Sie es erneut.'
                  : 'Error fetching response. Please try again.'),
            retryable: chunk.retryable ?? false,
          });
          break;
        }
        if (chunk.content) {
          full += chunk.content;
          // Strip partial/complete marker from display while streaming
          const displayText = stripMarkerForDisplay(full);
          setMessages((prev) =>
            prev.map((m) => m.id === assistantId ? { ...m, content: displayText, streaming: true } : m)
          );
        }
        if (chunk.done) break;
      }
      if (!hitError) {
        // Parse follow-up questions from the full response
        const { clean, followUps } = parseFollowUps(full);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: clean || m.content, streaming: false, followUps: followUps.length > 0 ? followUps : undefined }
              : m
          )
        );
      }
    } catch {
      setMessages((prev) => {
        const bubble = prev.find((m) => m.id === assistantId);
        if (bubble && !bubble.content) return prev.filter((m) => m.id !== assistantId);
        return prev.map((m) => m.id === assistantId ? { ...m, streaming: false } : m);
      });
      setStreamError({
        message: lang === 'de' ? 'Verbindungsfehler. Bitte versuchen Sie es erneut.' : 'Connection error. Please try again.',
        retryable: true,
      });
    } finally {
      setLoading(false);
    }
  }, [convId, lang, loading]);

  const retryLastMessage = useCallback(() => {
    const last = lastUserMessageRef.current;
    if (!last) return;
    setMessages((prev) => {
      const idx = [...prev].reverse().findIndex((m) => m.role === 'user' && m.content === last);
      if (idx === -1) return prev;
      return prev.filter((_, i) => i !== prev.length - 1 - idx);
    });
    setStreamError(null);
    sendMessage(last);
  }, [sendMessage]);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); sendMessage(input); };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const clearChat = () => {
    setMessages([]); setConvId(null); setError(null); setStreamError(null); setEditingId(null);
  };

  const isEmpty = messages.length === 0;

  return (
    <>
      {/* ── Floating toggle button ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={lang === 'de' ? 'Spiro öffnen' : 'Open Spiro'}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 bg-primary text-white rounded-full shadow-lg transition-all duration-200 hover:scale-105 hover:shadow-xl px-4 py-3"
      >
        {open ? (
          <>
            <ChevronDown className="w-5 h-5" />
            <span className="text-sm font-semibold hidden sm:inline">
              {lang === 'de' ? 'Schließen' : 'Close'}
            </span>
          </>
        ) : (
          <>
            <MessageCircle className="w-5 h-5" />
            <span className="text-sm font-semibold hidden sm:inline">Spiro</span>
          </>
        )}
      </button>

      {/* ── Chat panel ── */}
      {open && (
        <div className="fixed bottom-20 right-4 z-50 w-[calc(100vw-2rem)] max-w-md">
          <div className="bg-card border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
               style={{ height: 'min(80vh, 620px)' }}>

            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b bg-primary/5">
              <SpiroAvatar size="sm" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm leading-none">Spiro</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {lang === 'de'
                    ? 'Ihr Spirecut® Patientenassistent'
                    : 'Your Spirecut® Patient Assistant'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {messages.some((m) => m.role === 'assistant') && !messages.some((m) => m.streaming) && (
                  <ChatbotPDFDownload
                    messages={messages}
                    lang={lang}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                  </ChatbotPDFDownload>
                )}
                {messages.length > 0 && (
                  <button
                    onClick={clearChat}
                    title={lang === 'de' ? 'Chat löschen' : 'Clear chat'}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {isEmpty && (
                <div className="space-y-4">
                  {/* Welcome */}
                  <div className="text-center pt-2">
                    <div className="inline-flex mb-3">
                      <SpiroAvatar size="lg" />
                    </div>
                    <p className="font-bold text-base">
                      {lang === 'de' ? 'Hallo! Ich bin Spiro 👋' : 'Hi there! I\'m Spiro 👋'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                      {lang === 'de'
                        ? 'Ich beantworte Ihre Fragen rund um den Spirecut®-Eingriff – kurz und verständlich.'
                        : 'I answer your questions about the Spirecut® procedure – short and easy to understand.'}
                    </p>
                  </div>

                  {/* Disclaimer */}
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex gap-2 text-xs text-amber-800">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      {lang === 'de'
                        ? 'Spiro ersetzt keine ärztliche Beratung. Bei persönlichen medizinischen Fragen wenden Sie sich bitte an Ihren Arzt.'
                        : 'Spiro does not replace medical advice. For personal medical concerns, please consult your physician.'}
                    </span>
                  </div>

                  {/* Starter questions */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {lang === 'de' ? 'Womit kann ich helfen?' : 'What can I help with?'}
                    </p>
                    {starters.map((q) => (
                      <button
                        key={q}
                        onClick={() => sendMessage(q)}
                        className="w-full text-left px-3.5 py-2.5 rounded-xl border bg-background hover:bg-primary/5 hover:border-primary/30 text-sm transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>

                  {msg.role === 'assistant' && (
                    <div className="shrink-0 mt-0.5">
                      <SpiroAvatar size="sm" />
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5 max-w-[82%]">
                    {/* Bubble */}
                    <div
                      className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-primary text-white rounded-tr-sm'
                          : 'bg-muted/60 rounded-tl-sm'
                      }`}
                    >
                      {msg.role === 'assistant' ? (
                        <div className="whitespace-pre-wrap">
                          {msg.content}
                          {msg.streaming && (
                            <span className="inline-block w-1.5 h-4 bg-current opacity-70 ml-0.5 animate-pulse rounded-sm" />
                          )}
                        </div>
                      ) : (
                        <span>{msg.content}</span>
                      )}
                    </div>

                    {/* Follow-up suggestion chips */}
                    {msg.role === 'assistant' && !msg.streaming && msg.followUps && msg.followUps.length > 0 && (
                      <div className="space-y-1 mt-0.5">
                        <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5" />
                          {lang === 'de' ? 'Weiterführende Fragen' : 'You might also ask'}
                        </p>
                        {msg.followUps.map((q, i) => (
                          <button
                            key={i}
                            onClick={() => sendMessage(q)}
                            disabled={loading}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40 text-xs text-primary/90 transition-colors disabled:opacity-50"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Edit / modify actions */}
                    {msg.role === 'assistant' && !msg.streaming && msg.content && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <button
                          onClick={() => setEditingId(editingId === msg.id ? null : msg.id)}
                          title={lang === 'de' ? 'Antwort anpassen' : 'Modify answer'}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] transition-colors ${
                            editingId === msg.id
                              ? 'bg-primary/10 text-primary'
                              : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50'
                          }`}
                        >
                          <Pencil className="w-2.5 h-2.5" />
                          {lang === 'de' ? 'Anpassen' : 'Modify'}
                        </button>
                      </div>
                    )}

                    {/* Quick-edit chips (visible when this message is in edit mode) */}
                    {msg.role === 'assistant' && !msg.streaming && editingId === msg.id && (
                      <div className="flex flex-wrap gap-1.5 p-2.5 bg-muted/30 rounded-xl border border-muted">
                        <p className="w-full text-[10px] text-muted-foreground mb-0.5">
                          {lang === 'de' ? 'Wie soll ich die Antwort ändern?' : 'How should I change the answer?'}
                        </p>
                        {editActions.map((action) => (
                          <button
                            key={action.label}
                            onClick={() => { setEditingId(null); sendMessage(action.msg); }}
                            disabled={loading}
                            className="px-2.5 py-1 rounded-lg bg-background border hover:bg-primary/5 hover:border-primary/30 text-xs transition-colors disabled:opacity-50"
                          >
                            {action.label}
                          </button>
                        ))}
                        <button
                          onClick={() => {
                            setEditingId(null);
                            setInput(lang === 'de' ? 'Bitte ' : 'Please ');
                            setTimeout(() => {
                              inputRef.current?.focus();
                              // Place cursor at end
                              const ta = inputRef.current;
                              if (ta) ta.setSelectionRange(ta.value.length, ta.value.length);
                            }, 50);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-background border hover:bg-muted text-xs text-muted-foreground transition-colors"
                        >
                          {lang === 'de' ? 'Eigener Wunsch…' : 'Custom…'}
                        </button>
                      </div>
                    )}
                  </div>

                  {msg.role === 'user' && (
                    <div className="shrink-0 mt-0.5 p-1.5 bg-primary/10 rounded-full h-fit">
                      <User className="w-3.5 h-3.5 text-primary" />
                    </div>
                  )}
                </div>
              ))}

              {error && (
                <div className="flex gap-2 text-xs text-destructive bg-destructive/10 rounded-xl px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {streamError && (
                <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <div className="flex-1 min-w-0">
                    <p>{streamError.message}</p>
                    {streamError.retryable && (
                      <button
                        onClick={retryLastMessage}
                        className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-900 hover:text-amber-700 transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {lang === 'de' ? 'Erneut versuchen' : 'Retry'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input form */}
            <div className="border-t p-3">
              <form onSubmit={handleSubmit} className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder={lang === 'de' ? 'Frage an Spiro …' : 'Ask Spiro …'}
                  disabled={loading}
                  className="flex-1 resize-none bg-muted/40 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 min-h-[38px] max-h-32"
                  style={{ fieldSizing: 'content' } as React.CSSProperties}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
                  className="shrink-0 p-2 bg-primary text-white rounded-xl hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label={lang === 'de' ? 'Senden' : 'Send'}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </form>
              <p className="text-[10px] text-muted-foreground text-center mt-2">
                {lang === 'de'
                  ? 'Spiro kann Fehler machen · Kein Ersatz für ärztlichen Rat'
                  : 'Spiro can make mistakes · Not a substitute for medical advice'}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

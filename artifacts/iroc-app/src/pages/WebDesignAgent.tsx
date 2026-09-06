import { useState, useRef, useEffect, useCallback } from "react";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Bot, User, Send, Trash2, Loader2, FileText, FilePen, FolderOpen,
  ChevronDown, ChevronRight, Wand2, Globe, Stethoscope,
  ImagePlus, FileUp, Link2, X, Check,
} from "lucide-react";
import { adminPost } from "@/lib/admin-fetch";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolActivity {
  name: "read_file" | "write_file" | "list_files" | string;
  path?: string;
  resultSummary: string;
  wrote?: boolean;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed?: ToolActivity[];
  error?: boolean;
}

type Website = "both" | "iroc" | "spirecut";

// ── Attachment types ──────────────────────────────────────────────────────────

type AttachmentStatus = "uploading" | "ready" | "error";

interface ImageAttachment {
  id: string;
  type: "image";
  name: string;
  previewUrl: string;   // blob URL for thumbnail
  servingUrl: string;   // /api/storage/objects/...
  status: AttachmentStatus;
}

interface DocumentAttachment {
  id: string;
  type: "document";
  name: string;
  content: string;
  status: AttachmentStatus;
}

interface LinkAttachment {
  id: string;
  type: "link";
  url: string;
}

type Attachment = ImageAttachment | DocumentAttachment | LinkAttachment;

// ── Simple markdown renderer ──────────────────────────────────────────────────

function renderText(text: string): React.ReactNode[] {
  // Split into code-block segments and normal text
  const segments = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return segments.map((seg, i) => {
    if (seg.startsWith("```")) {
      const inner = seg.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
      return (
        <pre
          key={i}
          className="bg-muted rounded-md p-3 my-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap"
        >
          {inner}
        </pre>
      );
    }
    if (seg.startsWith("`") && seg.endsWith("`")) {
      return (
        <code key={i} className="bg-muted rounded px-1 py-0.5 text-xs font-mono">
          {seg.slice(1, -1)}
        </code>
      );
    }
    // Within normal text, handle **bold** and line breaks
    const parts = seg.split(/(\*\*[^*]+\*\*|\n)/g);
    return (
      <span key={i}>
        {parts.map((p, j) => {
          if (p.startsWith("**") && p.endsWith("**")) {
            return <strong key={j}>{p.slice(2, -2)}</strong>;
          }
          if (p === "\n") return <br key={j} />;
          return p;
        })}
      </span>
    );
  });
}

// ── Tool activity badge ───────────────────────────────────────────────────────

function ToolBadge({ tool }: { tool: ToolActivity }) {
  const [open, setOpen] = useState(false);

  const icon =
    tool.name === "write_file" ? (
      <FilePen className="w-3 h-3 shrink-0" />
    ) : tool.name === "read_file" ? (
      <FileText className="w-3 h-3 shrink-0" />
    ) : (
      <FolderOpen className="w-3 h-3 shrink-0" />
    );

  const color =
    tool.wrote
      ? "bg-green-50 border-green-200 text-green-800"
      : "bg-muted border-border text-muted-foreground";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-medium",
            color,
          )}
        >
          {icon}
          <span className="max-w-[200px] truncate">{tool.path ?? tool.name}</span>
          {open ? (
            <ChevronDown className="w-3 h-3 ml-0.5" />
          ) : (
            <ChevronRight className="w-3 h-3 ml-0.5" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="text-xs text-muted-foreground mt-1 ml-1 font-mono">
          {tool.resultSummary}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";

  return (
    <div className={cn("flex gap-3 w-full", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-violet-100 text-violet-700",
        )}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Content */}
      <div
        className={cn(
          "flex flex-col gap-2 max-w-[85%]",
          isUser ? "items-end" : "items-start",
        )}
      >
        {/* Tool activity row */}
        {msg.toolsUsed && msg.toolsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {msg.toolsUsed.map((t, i) => (
              <ToolBadge key={i} tool={t} />
            ))}
          </div>
        )}

        {/* Text bubble */}
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-relaxed",
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : msg.error
              ? "bg-destructive/10 text-destructive border border-destructive/20 rounded-tl-sm"
              : "bg-muted/60 border border-border rounded-tl-sm",
          )}
        >
          {renderText(msg.content)}
        </div>
      </div>
    </div>
  );
}

// ── Welcome screen ────────────────────────────────────────────────────────────

function WelcomeScreen({ de }: { de: boolean }) {
  const examples = de
    ? [
        "Ändere den Titel auf der Startseite der iROC-Website auf 'Regenerative Orthopädie'",
        "Füge eine neue Seite 'Über uns' zur Spirecut-Website hinzu",
        "Übersetze die iROC-Startseite vollständig ins Französische",
        "Erstelle einen neuen Abschnitt 'Patienten-Bewertungen' auf der Spirecut-Homepage",
        "Passe das Farbschema der Navigation auf der iROC-Website an",
      ]
    : [
        "Change the heading on the iROC website homepage to 'Regenerative Orthopaedics'",
        "Add a new 'About Us' page to the Spirecut website",
        "Add Arabic language support to the iROC website",
        "Create a new 'Patient Testimonials' section on the Spirecut homepage",
        "Adjust the navigation colour scheme on the iROC website",
      ];

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center gap-6">
      <div className="w-16 h-16 rounded-2xl bg-violet-100 flex items-center justify-center">
        <Wand2 className="w-8 h-8 text-violet-600" />
      </div>
      <div>
        <h2 className="text-xl font-semibold mb-1">
          {de ? "Website-Design-Agent" : "Website Design Agent"}
        </h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {de
            ? "Beschreibe auf Deutsch oder Englisch, was du ändern möchtest. Der Agent liest die Quelldateien, nimmt Änderungen vor und veröffentlicht sie sofort."
            : "Describe what you'd like to change in any language. The agent reads the source files, makes your changes, and publishes them instantly."}
        </p>
      </div>
      <div className="w-full max-w-md space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {de ? "Beispiele" : "Examples"}
        </p>
        {examples.map((ex, i) => (
          <div
            key={i}
            className="text-xs text-left px-3 py-2 rounded-lg bg-muted/50 text-muted-foreground border border-border/60"
          >
            "{ex}"
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

let msgIdCounter = 0;
function newId() {
  return `msg-${++msgIdCounter}-${Date.now()}`;
}

const WEBSITE_OPTIONS: { value: Website; labelDE: string; labelEN: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "both",     labelDE: "Beide Websites",          labelEN: "Both Websites",        icon: Globe       },
  { value: "iroc",     labelDE: "iROC GmbH Website",       labelEN: "iROC GmbH Website",    icon: Globe       },
  { value: "spirecut", labelDE: "Spirecut Patienten-Site",  labelEN: "Spirecut Patient Site", icon: Stethoscope },
];

export default function WebDesignAgent() {
  const { lang } = useLanguage();
  const { token } = useAuth();
  const { toast } = useToast();
  const de = lang === "de";

  const [website, setWebsite] = useState<Website>("both");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Attachment state
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [linkDraft, setLinkDraft] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);

  const abortRef    = useRef<AbortController | null>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef   = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function stopGeneration() {
    abortRef.current?.abort();
    setLoading(false);
  }

  // ── Attachment handlers ──────────────────────────────────────────────────

  async function handleImageFiles(files: FileList | null) {
    if (!files || !token) return;
    for (const file of Array.from(files)) {
      const id = `att-img-${Date.now()}-${Math.random()}`;
      const previewUrl = URL.createObjectURL(file);
      setAttachments((prev) => [
        ...prev,
        { id, type: "image", name: file.name, previewUrl, servingUrl: "", status: "uploading" },
      ]);
      try {
        // Step 1: get presigned PUT URL from storage service
        const { uploadURL, objectPath } = await adminPost<{
          uploadURL: string;
          objectPath: string;
        }>("/api/storage/uploads/request-url", token, {
          name: file.name,
          size: file.size,
          contentType: file.type,
        });
        // Step 2: upload directly to GCS
        const putRes = await fetch(uploadURL, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
        // Step 3: store the API serving URL
        const servingUrl = `/api/storage/objects${objectPath}`;
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id ? { ...(a as ImageAttachment), servingUrl, status: "ready" } : a,
          ),
        );
      } catch (err) {
        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: "error" as const } : a)),
        );
        toast({ title: de ? "Upload fehlgeschlagen" : "Upload failed", description: String(err), variant: "destructive" });
      }
    }
    // Reset so the same file can be re-selected
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  async function handleDocFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const id = `att-doc-${Date.now()}-${Math.random()}`;
      setAttachments((prev) => [
        ...prev,
        { id, type: "document", name: file.name, content: "", status: "uploading" },
      ]);
      try {
        const content = await file.text();
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id ? { ...(a as DocumentAttachment), content, status: "ready" } : a,
          ),
        );
      } catch (err) {
        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: "error" as const } : a)),
        );
        toast({ title: de ? "Lesen fehlgeschlagen" : "Read failed", description: String(err), variant: "destructive" });
      }
    }
    if (docInputRef.current) docInputRef.current.value = "";
  }

  function handleAddLink() {
    const url = linkDraft.trim();
    if (!url) return;
    const id = `att-link-${Date.now()}`;
    setAttachments((prev) => [...prev, { id, type: "link", url }]);
    setLinkDraft("");
    setShowLinkInput(false);
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      if (removed?.type === "image") URL.revokeObjectURL((removed as ImageAttachment).previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  // ── Build history ────────────────────────────────────────────────────────

  const buildHistory = useCallback(
    () => messages.map((m) => ({ role: m.role, content: m.content })),
    [messages],
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || !token || loading) return;

    // Website context
    const websiteCtx =
      website === "both"
        ? ""
        : website === "iroc"
        ? "\n\n[Context: Focus on the iROC GmbH website only — artifacts/iroc-website/src/]"
        : "\n\n[Context: Focus on the Spirecut Patient website only — artifacts/spirecut-patient/src/]";

    // Attachment context — only include ready attachments
    const readyAttachments = attachments.filter(
      (a) => !("status" in a) || (a as { status: string }).status === "ready",
    );
    let attachmentCtx = "";
    if (readyAttachments.length > 0) {
      attachmentCtx = "\n\n[Attached resources for this request:";
      for (const a of readyAttachments) {
        if (a.type === "image") {
          attachmentCtx += `\n- Image "${a.name}" is uploaded. Use this exact URL in website code (img src, CSS background-image, etc.): ${a.servingUrl}`;
        } else if (a.type === "document") {
          const preview =
            a.content.length > 8000 ? a.content.slice(0, 8000) + "\n...[truncated]" : a.content;
          attachmentCtx += `\n- Document "${a.name}":\n---\n${preview}\n---`;
        } else if (a.type === "link") {
          attachmentCtx += `\n- Reference URL: ${a.url}`;
        }
      }
      attachmentCtx += "\n]";
    }

    const fullMessage = text + websiteCtx + attachmentCtx;

    const userMsg: ChatMessage = { id: newId(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setAttachments([]);
    setShowLinkInput(false);
    setLoading(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const data = await adminPost<{ reply: string; toolsUsed: ToolActivity[] }>(
        "/api/iroc/agent/chat",
        token,
        { history: buildHistory(), message: fullMessage },
        { signal: controller.signal },
      );

      const assistantMsg: ChatMessage = {
        id: newId(),
        role: "assistant",
        content: data.reply,
        toolsUsed: data.toolsUsed?.filter((t) => t.name !== "list_files") ?? [],
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const errMsg: ChatMessage = {
        id: newId(),
        role: "assistant",
        content: de ? `Fehler: ${String(err)}` : `Error: ${String(err)}`,
        error: true,
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  }, [input, token, loading, website, buildHistory, de, attachments]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage();
    }
  }

  const writtenFiles = messages.flatMap(
    (m) => m.toolsUsed?.filter((t) => t.wrote).map((t) => t.path ?? "") ?? [],
  );

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] p-0">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-background shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
            <Wand2 className="w-4 h-4 text-violet-600" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">
              {de ? "Website-Design-Agent" : "Website Design Agent"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {de ? "KI-gestützte Website-Bearbeitung" : "AI-powered website editing"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Website selector */}
          <div className="flex rounded-lg border overflow-hidden text-xs">
            {WEBSITE_OPTIONS.map(({ value, labelDE, labelEN }) => (
              <button
                key={value}
                onClick={() => setWebsite(value)}
                className={cn(
                  "px-2.5 py-1.5 font-medium transition-colors",
                  website === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {de ? labelDE : labelEN}
              </button>
            ))}
          </div>

          {/* Clear */}
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => setMessages([])}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              {de ? "Löschen" : "Clear"}
            </Button>
          )}
        </div>
      </div>

      {/* ── Changed files banner ── */}
      {writtenFiles.length > 0 && (
        <div className="px-6 py-2 bg-green-50 border-b border-green-200 text-xs text-green-800 flex items-center gap-2 shrink-0">
          <FilePen className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium">
            {de ? "Geänderte Dateien:" : "Modified files:"}
          </span>
          <span className="font-mono">{[...new Set(writtenFiles)].join(", ")}</span>
        </div>
      )}

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <WelcomeScreen de={de} />
        ) : (
          <div className="flex flex-col gap-5 px-6 py-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-violet-700" />
                </div>
                <div className="flex items-center gap-2 bg-muted/60 border border-border rounded-2xl rounded-tl-sm px-4 py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {de ? "Agent arbeitet…" : "Agent is working…"}
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Input area ── */}
      <div className="shrink-0 border-t bg-background px-6 py-4">
        <div className="max-w-4xl mx-auto space-y-2">

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((a) => {
                const status = "status" in a ? (a as { status: AttachmentStatus }).status : "ready";
                return (
                  <div
                    key={a.id}
                    className={cn(
                      "inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg border text-xs font-medium max-w-[220px]",
                      status === "uploading" && "bg-muted/60 border-border text-muted-foreground",
                      status === "ready"     && "bg-violet-50 border-violet-200 text-violet-800",
                      status === "error"     && "bg-destructive/10 border-destructive/30 text-destructive",
                    )}
                  >
                    {/* Icon */}
                    {a.type === "image" && status === "ready" ? (
                      <img
                        src={(a as ImageAttachment).previewUrl}
                        alt=""
                        className="w-4 h-4 rounded object-cover shrink-0"
                      />
                    ) : a.type === "image" ? (
                      <ImagePlus className="w-3 h-3 shrink-0" />
                    ) : a.type === "document" ? (
                      <FileUp className="w-3 h-3 shrink-0" />
                    ) : (
                      <Link2 className="w-3 h-3 shrink-0" />
                    )}

                    {/* Label */}
                    <span className="truncate max-w-[140px]">
                      {a.type === "link" ? a.url : a.name}
                    </span>

                    {/* Status indicator */}
                    {status === "uploading" && (
                      <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                    )}
                    {status === "ready" && (
                      <Check className="w-3 h-3 shrink-0 text-violet-500" />
                    )}

                    {/* Remove */}
                    <button
                      onClick={() => removeAttachment(a.id)}
                      className="ml-0.5 rounded p-0.5 hover:bg-black/10 shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Link input (inline) */}
          {showLinkInput && (
            <div className="flex gap-2 items-center">
              <Input
                autoFocus
                value={linkDraft}
                onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleAddLink(); }
                  if (e.key === "Escape") { setShowLinkInput(false); setLinkDraft(""); }
                }}
                placeholder="https://…"
                className="h-8 text-xs"
              />
              <Button size="sm" className="h-8 px-3 text-xs" onClick={handleAddLink} disabled={!linkDraft.trim()}>
                {de ? "Hinzufügen" : "Add"}
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setShowLinkInput(false); setLinkDraft(""); }}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          {/* Main input row */}
          <div className="flex gap-3 items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                de
                  ? "Beschreibe, was du ändern möchtest… (Ctrl+Enter zum Senden)"
                  : "Describe what you'd like to change… (Ctrl+Enter to send)"
              }
              className="resize-none min-h-[72px] max-h-[200px] text-sm"
              disabled={loading}
              rows={3}
            />
            <div className="flex flex-col gap-2 shrink-0">
              {loading ? (
                <Button variant="outline" onClick={stopGeneration} className="h-9 px-3">
                  <div className="w-3 h-3 bg-foreground rounded-sm mr-1.5" />
                  {de ? "Stopp" : "Stop"}
                </Button>
              ) : (
                <Button
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                  className="h-9 px-3"
                >
                  <Send className="w-4 h-4 mr-1.5" />
                  {de ? "Senden" : "Send"}
                </Button>
              )}
            </div>
          </div>

          {/* Attachment toolbar */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={loading}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            >
              <ImagePlus className="w-3.5 h-3.5" />
              {de ? "Bild" : "Image"}
            </button>
            <button
              onClick={() => docInputRef.current?.click()}
              disabled={loading}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
            >
              <FileUp className="w-3.5 h-3.5" />
              {de ? "Dokument" : "Document"}
            </button>
            <button
              onClick={() => setShowLinkInput((v) => !v)}
              disabled={loading}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors disabled:opacity-40",
                showLinkInput
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <Link2 className="w-3.5 h-3.5" />
              Link
            </button>

            <span className="ml-auto text-xs text-muted-foreground">
              {de ? "Ctrl+Enter zum Senden" : "Ctrl+Enter to send"}
            </span>
          </div>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleImageFiles(e.target.files)}
        />
        <input
          ref={docInputRef}
          type="file"
          accept=".txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.html,.css,.xml,.yaml,.yml,.env"
          multiple
          className="hidden"
          onChange={(e) => handleDocFiles(e.target.files)}
        />
      </div>
    </div>
  );
}

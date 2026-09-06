import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { MessageSquareQuote, Check, X, Trash2, RefreshCw, Star, StarOff, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListIrocNotificationsQueryKey } from "@workspace/api-client-react";

interface Quote {
  id: string;
  procedure: string;
  operationMonth: string;
  rating: number;
  ageRange?: string;
  gender?: string;
  experience: string;
  shareQuote: boolean;
  quoteApproved: true | false | null;
  featured?: boolean;
  wasFeatured?: boolean;
  submittedAt: string;
}

const PROCEDURE_LABELS: Record<string, string> = {
  ct: "Carpaltunnelsyndrom",
  tf: "Trigger-Finger",
  both: "CT + Trigger-Finger",
};

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="text-amber-400 text-sm">
      {"★".repeat(Math.round(rating))}
      {"☆".repeat(5 - Math.round(rating))}
    </span>
  );
}

function ApprovalBadge({ approved, lang }: { approved: true | false | null; lang: string }) {
  const de = lang === "de";
  if (approved === true)
    return <Badge className="bg-green-100 text-green-800 border-green-200">{de ? "Freigegeben" : "Approved"}</Badge>;
  if (approved === false)
    return <Badge className="bg-red-100 text-red-800 border-red-200">{de ? "Abgelehnt" : "Rejected"}</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 border-amber-200">{de ? "Ausstehend" : "Pending"}</Badge>;
}

export default function SpirecutQuotes() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [acting, setActing] = useState<Record<string, boolean>>({});
  const [dismissedNotices, setDismissedNotices] = useState<Record<string, boolean>>({});

  // Dismiss pending-quote notifications when the admin visits this page
  useEffect(() => {
    if (!token) return;
    fetch("/api/iroc/notifications/read-by-type", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: "pending_quote" }),
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: getListIrocNotificationsQueryKey() });
    }).catch(() => {/* non-critical */});
  }, [token, queryClient]);

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/iroc/quotes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load quotes");
      const data = await res.json();
      setQuotes(data);
    } catch {
      toast({ title: t("error_loading", lang), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [token, lang, toast]);

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  const setApproval = async (id: string, approved: boolean) => {
    setActing((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/iroc/quotes/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ approved }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setQuotes((prev) =>
        prev.map((q) =>
          q.id === id
            ? { ...q, quoteApproved: approved, featured: data.featured, wasFeatured: data.wasFeatured }
            : q
        )
      );
      queryClient.invalidateQueries({ queryKey: getListIrocNotificationsQueryKey() });
      toast({
        title: approved ? t("quote_approved", lang) : t("quote_rejected", lang),
      });
    } catch {
      toast({ title: t("error_saving", lang), variant: "destructive" });
    } finally {
      setActing((prev) => ({ ...prev, [id]: false }));
    }
  };

  const setFeatured = async (id: string, featured: boolean) => {
    setActing((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/iroc/quotes/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ featured }),
      });
      if (!res.ok) throw new Error();
      setQuotes((prev) =>
        prev.map((q) => {
          if (q.id === id) return { ...q, featured, wasFeatured: featured ? false : q.wasFeatured };
          // Clear featured flag from all others when featuring this one
          if (featured && q.featured) return { ...q, featured: false };
          return q;
        })
      );
      // Once re-featured, dismiss the notice automatically
      if (featured) {
        setDismissedNotices((prev) => ({ ...prev, [id]: true }));
      }
      toast({
        title: featured ? t("quote_featured", lang) : t("quote_unfeatured", lang),
      });
    } catch {
      toast({ title: t("error_saving", lang), variant: "destructive" });
    } finally {
      setActing((prev) => ({ ...prev, [id]: false }));
    }
  };

  const deleteQuote = async (id: string) => {
    if (!window.confirm(t("confirm_delete", lang))) return;
    setActing((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/iroc/quotes/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      setQuotes((prev) => prev.filter((q) => q.id !== id));
      queryClient.invalidateQueries({ queryKey: getListIrocNotificationsQueryKey() });
      toast({ title: t("deleted", lang) });
    } catch {
      toast({ title: t("error_saving", lang), variant: "destructive" });
    } finally {
      setActing((prev) => ({ ...prev, [id]: false }));
    }
  };

  const filtered = quotes.filter((q) => {
    if (filter === "pending") return q.quoteApproved === null || q.quoteApproved === undefined;
    if (filter === "approved") return q.quoteApproved === true;
    if (filter === "rejected") return q.quoteApproved === false;
    return true;
  });

  const counts = {
    all: quotes.length,
    pending: quotes.filter((q) => q.quoteApproved === null || q.quoteApproved === undefined).length,
    approved: quotes.filter((q) => q.quoteApproved === true).length,
    rejected: quotes.filter((q) => q.quoteApproved === false).length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <MessageSquareQuote className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {t("spirecut_quotes", lang)}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("spirecut_quotes_desc", lang)}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchQuotes} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          {t("refresh", lang)}
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["pending", "approved", "rejected", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              filter === f
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`filter_${f}`, lang)}
            <span className="ml-1.5 text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
              {counts[f]}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {t("loading", lang)}…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {t("no_data", lang)}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((q) => (
            <div
              key={q.id}
              className="border border-border rounded-xl p-5 bg-card space-y-3"
            >
              {/* Meta row */}
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <ApprovalBadge approved={q.quoteApproved} lang={lang} />
                  {q.featured && (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-200">
                      <Star className="h-3 w-3 mr-1 fill-amber-500 text-amber-500" />
                      {t("featured_badge", lang)}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {PROCEDURE_LABELS[q.procedure] ?? q.procedure}
                  </span>
                  <StarRow rating={q.rating} />
                  {q.ageRange && (
                    <span className="text-xs text-muted-foreground">{q.ageRange} J.</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(q.submittedAt).toLocaleDateString("de-DE")}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  {q.quoteApproved !== true && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-green-700 border-green-200 hover:bg-green-50 h-8"
                      disabled={acting[q.id]}
                      onClick={() => setApproval(q.id, true)}
                    >
                      <Check className="h-3.5 w-3.5 mr-1" />
                      {t("approve", lang)}
                    </Button>
                  )}
                  {q.quoteApproved !== false && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-700 border-red-200 hover:bg-red-50 h-8"
                      disabled={acting[q.id]}
                      onClick={() => setApproval(q.id, false)}
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      {t("reject", lang)}
                    </Button>
                  )}
                  {q.quoteApproved === true && (
                    <Button
                      size="sm"
                      variant="outline"
                      className={q.featured
                        ? "text-amber-700 border-amber-300 hover:bg-amber-50 h-8"
                        : "text-muted-foreground border-border hover:bg-muted h-8"}
                      disabled={acting[q.id]}
                      onClick={() => setFeatured(q.id, !q.featured)}
                    >
                      {q.featured
                        ? <><StarOff className="h-3.5 w-3.5 mr-1" />{t("unfeature", lang)}</>
                        : <><Star className="h-3.5 w-3.5 mr-1" />{t("feature", lang)}</>
                      }
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive h-8 w-8 p-0"
                    disabled={acting[q.id]}
                    onClick={() => deleteQuote(q.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Re-feature notice: shown when re-approved but was previously featured */}
              {q.quoteApproved === true && q.wasFeatured && !q.featured && !dismissedNotices[q.id] && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                  <span className="flex-1">{t("quote_was_featured_notice", lang)}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      className="text-xs font-medium underline underline-offset-2 hover:text-amber-900"
                      disabled={acting[q.id]}
                      onClick={() => setFeatured(q.id, true)}
                    >
                      {t("refeature", lang)}
                    </button>
                    <button
                      className="text-xs text-amber-600 hover:text-amber-900"
                      onClick={() => setDismissedNotices((prev) => ({ ...prev, [q.id]: true }))}
                    >
                      {t("dismiss", lang)}
                    </button>
                  </div>
                </div>
              )}

              {/* Quote text */}
              <blockquote className="border-l-2 border-primary/30 pl-4 text-sm text-muted-foreground italic leading-relaxed">
                „{q.experience}"
              </blockquote>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

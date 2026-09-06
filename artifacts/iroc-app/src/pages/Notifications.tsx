import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/utils";
import { useListIrocNotifications, useMarkIrocNotificationRead, useMarkAllIrocNotificationsRead, getListIrocNotificationsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { adminDelete } from "@/lib/admin-fetch";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Bell, Check, Package, Info, Trash2, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useState } from "react";

export default function Notifications() {
  const { lang } = useLanguage();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { data: notifications, isLoading } = useListIrocNotifications();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [clearingRead, setClearingRead] = useState(false);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListIrocNotificationsQueryKey() });

  const markReadMutation = useMarkIrocNotificationRead({
    mutation: {
      onSuccess: () => invalidate(),
    }
  });

  const markAllReadMutation = useMarkAllIrocNotificationsRead({
    mutation: {
      onSuccess: () => invalidate(),
    }
  });

  const handleDelete = async (id: number) => {
    if (!token) return;
    setDeletingId(id);
    await adminDelete(`/api/iroc/notifications/${id}`, token).catch(() => {});
    setDeletingId(null);
    invalidate();
  };

  const handleMarkRead = async (id: number) => {
    await markReadMutation.mutateAsync({ id });
    // Auto-remove after brief pause so the user sees the transition
    setTimeout(() => invalidate(), 400);
  };

  const handleClearRead = async () => {
    if (!token) return;
    setClearingRead(true);
    await adminDelete("/api/iroc/notifications/read", token).catch(() => {});
    setClearingRead(false);
    invalidate();
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">{t("notifications", lang)}</h1>
        <div className="space-y-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </div>
    );
  }

  const hasUnread = notifications?.some(n => !n.isRead);
  const hasRead   = notifications?.some(n =>  n.isRead);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-3xl font-bold tracking-tight">{t("notifications", lang)}</h1>
        <div className="flex items-center gap-2">
          {hasRead && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearRead}
              disabled={clearingRead}
              className="gap-1.5 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              {lang === "de" ? "Gelesene löschen" : "Delete read"}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => markAllReadMutation.mutate(undefined)}
            disabled={!hasUnread || markAllReadMutation.isPending}
          >
            <Check className="h-4 w-4 mr-2" />
            {t("mark_all_read", lang)}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {notifications?.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Bell className="h-8 w-8 mb-4 opacity-20" />
              <p>{t("no_data", lang)}</p>
            </CardContent>
          </Card>
        ) : (
          notifications?.map(notif => {
            const isStockAlert = notif.type === 'low_stock';
            const Icon = isStockAlert ? Package : Info;
            const isDeleting = deletingId === notif.id;
            return (
              <Card key={notif.id} className={`${notif.isRead ? 'bg-muted/30' : 'bg-card border-primary/20 shadow-sm'}`}>
                <CardContent className="p-4 flex items-start gap-4">
                  <div className={`p-2 rounded-full mt-1 shrink-0 ${isStockAlert ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
                    <Icon className={`h-5 w-5 ${isStockAlert ? 'text-amber-600 dark:text-amber-500' : 'text-blue-600 dark:text-blue-500'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium ${!notif.isRead ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {(() => {
                        try {
                          const parsed = JSON.parse(notif.message) as { de?: string; en?: string };
                          if (parsed && typeof parsed === 'object') {
                            return (lang === 'en' ? parsed.en : parsed.de) ?? parsed.de ?? parsed.en ?? notif.message;
                          }
                        } catch { /* legacy plain-text message — fall through */ }
                        return notif.message;
                      })()}
                    </p>
                    <div className="flex items-center gap-4 mt-2">
                      <span className="text-xs text-muted-foreground">{formatDate(notif.createdAt)}</span>
                      {notif.productId && (
                        <Link href={`/products/${notif.productId}`} className="text-xs text-primary hover:underline font-medium">
                          {t("products", lang)} &rarr;
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!notif.isRead && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMarkRead(notif.id)}
                        disabled={markReadMutation.isPending}
                        title={t("mark_read", lang)}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        {t("mark_read", lang)}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(notif.id)}
                      disabled={isDeleting}
                      title={lang === "de" ? "Löschen" : "Delete"}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

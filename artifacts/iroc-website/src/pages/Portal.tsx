import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useListResources, useDoctorLogout } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { useEffect, useRef, useState, useCallback } from 'react';
import { FileText, Video, ExternalLink, PresentationIcon, LogOut, BarChart2, ImageIcon, ClipboardList, Receipt, Stethoscope, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';

const IDLE_TIMEOUT_MS  = 10 * 60 * 1000; // 10 minutes
const WARN_BEFORE_MS   =  1 * 60 * 1000; // warn 1 minute before logout

export default function Portal() {
  const { t } = useLanguage();
  const { isAuthenticated, instrument, isLoading, isFetching, checkAuth } = useAuth();
  const [, setLocation] = useLocation();

  // ── Idle-timeout state ──────────────────────────────────────────────────────
  const idleTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countTick   = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleDeadline = useRef<number | null>(null);
  const remainingIdleTime = useRef(IDLE_TIMEOUT_MS);
  const isIdleTimerPaused = useRef(document.visibilityState === 'hidden');
  const [warnSecondsLeft, setWarnSecondsLeft] = useState<number | null>(null);

  const logoutMut = useDoctorLogout({
    mutation: {
      onSuccess: async () => {
        await checkAuth();
        setLocation('/login');
      }
    }
  });

  const doLogout = useCallback(() => {
    setWarnSecondsLeft(null);
    if (countTick.current) clearInterval(countTick.current);
    logoutMut.mutate();
  }, [logoutMut]);

  const clearIdleTimers = useCallback(() => {
    if (idleTimer.current)  clearTimeout(idleTimer.current);
    if (warnTimer.current)  clearTimeout(warnTimer.current);
    if (countTick.current)  clearInterval(countTick.current);
    idleTimer.current = null;
    warnTimer.current = null;
    countTick.current = null;
  }, []);

  const scheduleIdleTimer = useCallback((remainingMs: number) => {
    clearIdleTimers();
    remainingIdleTime.current = remainingMs;
    idleDeadline.current = Date.now() + remainingMs;

    if (remainingMs <= WARN_BEFORE_MS) {
      let secs = Math.max(1, Math.ceil(remainingMs / 1000));
      setWarnSecondsLeft(secs);
      countTick.current = setInterval(() => {
        secs -= 1;
        setWarnSecondsLeft(secs);
      }, 1000);
    } else {
      setWarnSecondsLeft(null);
      warnTimer.current = setTimeout(() => {
        let secs = Math.round(WARN_BEFORE_MS / 1000);
        setWarnSecondsLeft(secs);
        countTick.current = setInterval(() => {
          secs -= 1;
          setWarnSecondsLeft(secs);
        }, 1000);
      }, remainingMs - WARN_BEFORE_MS);
    }

    idleTimer.current = setTimeout(doLogout, remainingMs);
  }, [clearIdleTimers, doLogout]);

  const resetIdleTimer = useCallback(() => {
    if (isIdleTimerPaused.current) return;
    scheduleIdleTimer(IDLE_TIMEOUT_MS);
  }, [scheduleIdleTimer]);

  // Attach activity listeners while authenticated
  useEffect(() => {
    if (!isAuthenticated) return;

    isIdleTimerPaused.current = document.visibilityState === 'hidden';
    if (!isIdleTimerPaused.current) resetIdleTimer();

    const events: (keyof DocumentEventMap)[] = [
      'mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll',
    ];
    events.forEach(e => document.addEventListener(e, resetIdleTimer, { passive: true }));

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (isIdleTimerPaused.current) return;

        isIdleTimerPaused.current = true;
        remainingIdleTime.current = Math.max(0, (idleDeadline.current ?? Date.now()) - Date.now());
        clearIdleTimers();
        idleDeadline.current = null;
        return;
      }

      if (document.visibilityState === 'visible' && isIdleTimerPaused.current) {
        isIdleTimerPaused.current = false;
        scheduleIdleTimer(remainingIdleTime.current);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      events.forEach(e => document.removeEventListener(e, resetIdleTimer));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearIdleTimers();
    };
  }, [clearIdleTimers, isAuthenticated, resetIdleTimer, scheduleIdleTimer]);

  // ── Auth guard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && !isFetching && !isAuthenticated) {
      setLocation('/login');
    }
  }, [isLoading, isFetching, isAuthenticated, setLocation]);

  const { data: resources = [] } = useListResources(undefined, {
    query: {
      enabled: isAuthenticated,
      queryKey: ['resources', instrument]
    }
  });

  if (isLoading || !isAuthenticated) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">{t('Wird geladen...', 'Loading...')}</div>;
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'presentation': return <PresentationIcon className="w-8 h-8 text-blue-500" />;
      case 'video': return <Video className="w-8 h-8 text-red-500" />;
      case 'study': return <FileText className="w-8 h-8 text-green-500" />;
      case 'link': return <ExternalLink className="w-8 h-8 text-purple-500" />;
      case 'infographic': return <BarChart2 className="w-8 h-8 text-orange-500" />;
      case 'image': return <ImageIcon className="w-8 h-8 text-teal-500" />;
      case 'protocol': return <ClipboardList className="w-8 h-8 text-indigo-500" />;
      case 'invoice': return <Receipt className="w-8 h-8 text-yellow-500" />;
      case 'medical_finding': return <Stethoscope className="w-8 h-8 text-rose-500" />;
      default: return <FileText className="w-8 h-8 text-primary" />;
    }
  };

  const getTypeName = (type: string) => {
    switch (type) {
      case 'presentation': return t('Präsentation', 'Presentation');
      case 'video': return 'Video';
      case 'study': return t('Studie', 'Study');
      case 'link': return 'Link';
      case 'infographic': return 'Infographic';
      case 'image': return 'Image';
      case 'protocol': return t('Protokoll', 'Protocol');
      case 'invoice': return t('Rechnung', 'Invoice');
      case 'medical_finding': return t('Medizinischer Befund', 'Medical Finding');
      default: return type;
    }
  };

  return (
    <div className="py-12 bg-muted/10 min-h-screen">

      {/* ── Idle-logout warning banner ─────────────────────────────────────── */}
      {warnSecondsLeft !== null && (
        <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-4 bg-amber-500 text-white px-6 py-3 shadow-lg">
          <div className="flex items-center gap-3 text-sm font-medium">
            <Clock className="w-4 h-4 shrink-0" />
            <span>
              {t(
                `Sitzung läuft ab in ${warnSecondsLeft} Sekunde${warnSecondsLeft !== 1 ? 'n' : ''} aufgrund von Inaktivität.`,
                `Session expires in ${warnSecondsLeft} second${warnSecondsLeft !== 1 ? 's' : ''} due to inactivity.`
              )}
            </span>
          </div>
          <button
            onClick={resetIdleTimer}
            className="shrink-0 rounded-lg border border-white/40 bg-white/20 px-3 py-1 text-sm font-semibold hover:bg-white/30 transition-colors"
          >
            {t('Aktiv bleiben', 'Stay logged in')}
          </button>
        </div>
      )}

      <div className="container mx-auto px-4 max-w-6xl">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12 gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">{t('Arzt Portal', 'Doctor Portal')}</h1>
            <p className="text-muted-foreground">
              {t('Zertifizierter Bereich für', 'Certified area for')} <strong className="text-foreground capitalize">{instrument}</strong>
            </p>
          </div>
          <Button variant="outline" onClick={() => logoutMut.mutate()} disabled={logoutMut.isPending}>
            <LogOut className="w-4 h-4 mr-2" /> {t('Abmelden', 'Logout')}
          </Button>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {resources.map(resource => (
            <a
              key={resource.id}
              href={resource.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-2xl p-6 border shadow-sm hover:shadow-md hover:border-primary/30 transition-all group flex flex-col"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="p-3 bg-slate-50 rounded-xl group-hover:bg-primary/5 transition-colors">
                  {getIcon(resource.type)}
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                    {getTypeName(resource.type)}
                  </div>
                  <h3 className="font-bold text-lg leading-tight group-hover:text-primary transition-colors">
                    {resource.title}
                  </h3>
                </div>
              </div>
              {resource.description && (
                <p className="text-sm text-muted-foreground mb-4 flex-1">
                  {resource.description}
                </p>
              )}
              <div className="mt-auto text-primary text-sm font-medium flex items-center gap-1 group-hover:underline">
                {t('Öffnen', 'Open')} <ExternalLink className="w-3 h-3 ml-1" />
              </div>
            </a>
          ))}

          {resources.length === 0 && (
            <div className="col-span-full py-20 text-center bg-white rounded-2xl border border-dashed">
              <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground">{t('Noch keine Ressourcen verfügbar.', 'No resources available yet.')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

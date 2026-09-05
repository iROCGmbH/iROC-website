import { type ReactNode, useEffect, useState } from 'react';
import transitionVideo from '@assets/transition_video_iROC_1787578793804.webm';

interface AppLaunchTransitionProps {
  children: ReactNode;
}

export function AppLaunchTransition({ children }: AppLaunchTransitionProps) {
  const [appReady, setAppReady] = useState(false);
  const [videoFinished, setVideoFinished] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    let secondFrame: number | undefined;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setAppReady(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, []);

  useEffect(() => {
    if (!appReady || !videoFinished || leaving) return;
    setLeaving(true);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setMounted(false), reducedMotion ? 0 : 350);
    return () => window.clearTimeout(timer);
  }, [appReady, videoFinished, leaving]);

  return (
    <>
      {children}
      {mounted && (
        <div
          aria-live="polite"
          aria-label="Loading application / Anwendung wird geladen"
          className="app-launch-transition"
          onTransitionEnd={(event) => {
            if (event.propertyName === 'opacity') setMounted(false);
          }}
          style={{ position: 'fixed', inset: 0, zIndex: 2147483647, overflow: 'hidden', background: '#4b0b1a', opacity: leaving ? 0 : 1, pointerEvents: 'all', transition: 'opacity 320ms ease' }}
        >
          {mediaFailed ? (
            <div style={fallbackStyle}>Loading application / Anwendung wird geladen</div>
          ) : (
            <video src={transitionVideo} autoPlay muted playsInline preload="auto" onEnded={() => setVideoFinished(true)} onError={() => { setMediaFailed(true); setVideoFinished(true); }} style={videoStyle} />
          )}
          <span style={visuallyHiddenStyle}>Loading application / Anwendung wird geladen</span>
        </div>
      )}
      <style>{'@media (prefers-reduced-motion: reduce) { .app-launch-transition { transition: none !important; } }'}</style>
    </>
  );
}

const videoStyle = { width: '100%', height: '100%', objectFit: 'cover' as const, display: 'block' };
const fallbackStyle = { width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'white', fontFamily: 'system-ui, sans-serif' };
const visuallyHiddenStyle = { position: 'absolute' as const, width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden' as const, clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap' as const, border: 0 };
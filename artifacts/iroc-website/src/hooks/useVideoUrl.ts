import { useState, useEffect } from 'react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

interface VideoUrls {
  spirecut: string;
  ministem: string;
}

let cache: VideoUrls | null = null;
const listeners: Array<() => void> = [];

async function fetchVideoUrls(): Promise<VideoUrls> {
  if (cache) return cache;
  try {
    const res = await fetch(`${BASE_URL}/api/video-urls`);
    if (!res.ok) throw new Error('Failed');
    cache = await res.json();
    listeners.forEach((fn) => fn());
    return cache!;
  } catch {
    return {
      spirecut: 'https://www.youtube.com/embed/mjPCpa427go',
      ministem: '',
    };
  }
}

export function useVideoUrl(instrument: 'spirecut' | 'ministem'): string | null {
  const [urls, setUrls] = useState<VideoUrls | null>(cache);

  useEffect(() => {
    if (cache) { setUrls(cache); return; }
    let alive = true;
    fetchVideoUrls().then((u) => { if (alive) setUrls(u); });
    return () => { alive = false; };
  }, []);

  if (!urls) return null;
  return urls[instrument] || null;
}

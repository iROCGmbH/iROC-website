import { useEffect, useState } from "react";
import {
  createSpirecutMediaStore,
  DEFAULT_SENTINEL,
  HIDDEN_SENTINEL,
  MEDIA_UPDATE_CHANNEL,
  resolvePatientMediaUrl,
} from "@workspace/spirecut-shared";

const mediaStore = createSpirecutMediaStore();

export { DEFAULT_SENTINEL, HIDDEN_SENTINEL, MEDIA_UPDATE_CHANNEL };

export function useMedia(
  key: string,
  fallback: string,
  legacyKey?: string,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const map = await mediaStore.load();
        if (alive) {
          setUrl(resolvePatientMediaUrl(map[key] ?? (legacyKey ? map[legacyKey] : undefined), fallback));
        }
      } catch {
        // A temporary content API failure must not permanently replace the
        // bundled image. The failed request is not cached, so retry is fresh.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
        if (!alive) return;
        try {
          const map = await mediaStore.load();
          if (alive) {
            setUrl(resolvePatientMediaUrl(map[key] ?? (legacyKey ? map[legacyKey] : undefined), fallback));
          }
        } catch {
          if (alive) setUrl(fallback);
        }
      }
    };

    load();
    const unsubscribe = mediaStore.subscribe(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [key, fallback, legacyKey]);

  return url;
}

export function invalidateMediaCache() {
  mediaStore.invalidate();
}
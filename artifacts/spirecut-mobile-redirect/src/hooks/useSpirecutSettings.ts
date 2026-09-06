import { useEffect, useState } from "react";
import {
  createSpirecutSettingsStore,
  SP_DEFAULTS,
  toEmbedUrl,
  type SpirecutSettings,
} from "@workspace/spirecut-shared";

const settingsStore = createSpirecutSettingsStore();

export type { SpirecutSettings };
export { SP_DEFAULTS, toEmbedUrl };

export function invalidateSpirecutSettingsCache() {
  settingsStore.invalidate();
}

export function useSpirecutSettings(): SpirecutSettings {
  const [settings, setSettings] = useState(settingsStore.getSnapshot);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      settingsStore.load().then((next) => {
        if (alive) setSettings(next);
      });
    };

    refresh();
    const unsubscribe = settingsStore.subscribe(refresh);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return settings;
}
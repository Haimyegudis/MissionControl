// AppSettings store — loaded once from GET /api/settings; updates go through
// PUT /api/settings with a partial (server performs load-then-mutate so fields
// not sent survive).

import { settings as settingsApi } from '../api/client';
import { defaultAppSettings, type AppSettings } from '../types';
import { createStore } from './store';

export const settingsStore = createStore<AppSettings>(defaultAppSettings());

/** Map a stored theme value onto the <html data-theme> attribute. */
export function resolveTheme(theme: string | null | undefined): 'dark' | 'light' | 'railbook' {
  const t = (theme ?? '').toLowerCase();
  if (t === 'light') return 'light';
  if (t === 'railbook') return 'railbook';
  return 'dark';
}

let loaded = false;
let loading: Promise<AppSettings> | null = null;

/** Load settings from the server once; subsequent calls reuse the result. */
export function loadSettings(force = false): Promise<AppSettings> {
  if (loaded && !force) return Promise.resolve(settingsStore.get());
  if (loading && !force) return loading;
  loading = settingsApi
    .get()
    .then((s) => {
      loaded = true;
      settingsStore.set(s);
      return s;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Current settings snapshot (defaults until loadSettings resolves). */
export function getSettings(): AppSettings {
  return settingsStore.get();
}

/**
 * Persist a partial update. Optimistically applies locally, then reconciles
 * with the server's merged copy.
 */
export async function updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const previous = settingsStore.get();
  settingsStore.set({ ...previous, ...partial });
  try {
    const merged = await settingsApi.put(partial);
    if (merged) settingsStore.set(merged);
    return settingsStore.get();
  } catch (err) {
    settingsStore.set(previous);
    throw err;
  }
}

export function subscribeSettings(cb: (s: AppSettings) => void): () => void {
  return settingsStore.subscribe(cb);
}

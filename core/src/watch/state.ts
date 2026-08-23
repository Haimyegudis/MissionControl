// Watch state + config persistence. Both ride the `lists` KV table, which the
// desktop maps to KvLists in SQLite and the Android build maps to the
// encrypted store — so no new table (and no EncryptedStorePlugin whitelist
// change) is needed for either platform.

import type { KvStore } from '../storage/kv.js';
import { sanitizeWatchConfig } from './config.js';
import { EMPTY_WATCH_STATE, type WatchConfig, type WatchState } from './types.js';

const STATE_KEY = 'watch.state';
const CONFIG_KEY = 'watch.config';

export class KvWatchRepo {
  constructor(private readonly kv: KvStore) {}

  /**
   * Stored state, or a usable empty one. A corrupt payload reads as empty and
   * `hasBaseline` then reports false, so the differ's baseline rule applies and
   * the user gets silence rather than one event per issue they already had.
   */
  private read(): { state: WatchState; hasBaseline: boolean } {
    const row = this.kv.get('lists', STATE_KEY);
    if (!row?.json) return { state: { ...EMPTY_WATCH_STATE }, hasBaseline: false };
    try {
      const parsed = JSON.parse(row.json) as Partial<WatchState>;
      const snapshot =
        parsed.snapshot !== null && typeof parsed.snapshot === 'object' ? parsed.snapshot : null;
      if (snapshot === null) return { state: { ...EMPTY_WATCH_STATE }, hasBaseline: false };
      return {
        state: {
          snapshot,
          lastCycle: typeof parsed.lastCycle === 'string' ? parsed.lastCycle : null,
          feed: Array.isArray(parsed.feed) ? parsed.feed : [],
          ackedAt: typeof parsed.ackedAt === 'string' ? parsed.ackedAt : null,
        },
        hasBaseline: true,
      };
    } catch {
      return { state: { ...EMPTY_WATCH_STATE }, hasBaseline: false };
    }
  }

  getState(): WatchState {
    return this.read().state;
  }

  /** False before the first successful cycle — the differ's baseline signal. */
  hasBaseline(): boolean {
    return this.read().hasBaseline;
  }

  setState(state: WatchState): void {
    this.kv.set('lists', STATE_KEY, JSON.stringify(state));
  }

  getConfig(): WatchConfig {
    const row = this.kv.get('lists', CONFIG_KEY);
    if (!row?.json) return sanitizeWatchConfig({});
    try {
      return sanitizeWatchConfig(JSON.parse(row.json));
    } catch {
      return sanitizeWatchConfig({});
    }
  }

  setConfig(raw: unknown): WatchConfig {
    const config = sanitizeWatchConfig(raw);
    this.kv.set('lists', CONFIG_KEY, JSON.stringify(config));
    return config;
  }
}

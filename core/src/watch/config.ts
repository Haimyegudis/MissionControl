// WatchConfig sanitization — unknown kinds dropped, interval clamped to the
// allowed set, in the style of server/src/reminders.ts sanitize().

import {
  DEFAULT_WATCH_CONFIG,
  WATCH_EVENT_KINDS,
  WATCH_INTERVALS,
  type WatchConfig,
  type WatchEventKind,
} from './types.js';

export function sanitizeWatchConfig(raw: unknown): WatchConfig {
  const src = (raw ?? {}) as Partial<WatchConfig>;
  const rawKinds = (src.kinds ?? {}) as Record<string, unknown>;
  const kinds = {} as Record<WatchEventKind, boolean>;
  for (const kind of WATCH_EVENT_KINDS) {
    kinds[kind] = rawKinds[kind] === undefined ? DEFAULT_WATCH_CONFIG.kinds[kind] : rawKinds[kind] === true;
  }
  const interval = Number(src.intervalMinutes);
  return {
    enabled: src.enabled === undefined ? DEFAULT_WATCH_CONFIG.enabled : src.enabled === true,
    intervalMinutes: WATCH_INTERVALS.includes(interval) ? interval : DEFAULT_WATCH_CONFIG.intervalMinutes,
    kinds,
  };
}

// Draft autosave store — unsaved editor work (new/edit TestRail cases,
// Confluence pages) survives refreshes, timeouts and crashes in
// localStorage. Each draft is one key: `mc.draft.<kind>` → { savedAt, data }.
// Editors restore on reopen and clear on successful save. Pure module —
// unit tested; localStorage access is guarded for SSR/test environments.

const PREFIX = 'mc.draft.';
/** Drafts older than this are pruned (ms). */
export const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface StoredDraft<T> {
  savedAt: number;
  data: T;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Compose a namespaced draft key from id parts. */
export function draftKey(...parts: Array<string | number>): string {
  return PREFIX + parts.map((p) => String(p)).join('.');
}

export function saveDraft<T>(key: string, data: T, now: number = Date.now()): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify({ savedAt: now, data } satisfies StoredDraft<T>));
  } catch {
    /* quota — draft is best-effort */
  }
}

export function loadDraft<T>(key: string, now: number = Date.now()): StoredDraft<T> | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (typeof parsed?.savedAt !== 'number' || parsed.data === undefined) return null;
    if (now - parsed.savedAt > DRAFT_TTL_MS) {
      s.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  storage()?.removeItem(key);
}

/** Drop every expired draft; call once at editor-view mount. */
export function pruneDrafts(now: number = Date.now()): void {
  const s = storage();
  if (!s) return;
  const stale: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    try {
      const parsed = JSON.parse(s.getItem(key) ?? '') as StoredDraft<unknown>;
      if (typeof parsed?.savedAt !== 'number' || now - parsed.savedAt > DRAFT_TTL_MS) stale.push(key);
    } catch {
      stale.push(key);
    }
  }
  for (const key of stale) s.removeItem(key);
}

/** "5 minutes ago" / "3 hours ago" / "2 days ago" for the restore banner. */
export function draftAge(savedAt: number, now: number = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - savedAt) / 60000));
  if (mins < 1) return 'a moment ago';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

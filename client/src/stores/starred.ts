// Starred issues (ui-parity §12.13) — case-insensitive set backed by
// AppSettings.starredIssueKeys. Toggle persists the whole list via the
// settings store and fires a change event.

import type { JiraIssue } from '../types';
import { createEmitter } from './store';
import { getSettings, settingsStore, updateSettings } from './settings';

const changeBus = createEmitter<void>();

let keys = new Set<string>();

function rebuild(list: string[]): void {
  const next = new Set(list.map((k) => k.toLowerCase()));
  if (next.size === keys.size && [...next].every((k) => keys.has(k))) return;
  keys = next;
  changeBus.emit();
}

settingsStore.subscribe((s) => rebuild(s.starredIssueKeys ?? []));
rebuild(getSettings().starredIssueKeys ?? []);

export function isStarred(key: string): boolean {
  return keys.has(key.toLowerCase());
}

/** Subscribe to starred-set changes. Returns an unsubscribe fn. */
export function onStarredChange(cb: () => void): () => void {
  return changeBus.on(cb);
}

/** Flip a key and persist the full list through settings. */
export async function toggleStarred(key: string): Promise<void> {
  const lower = key.toLowerCase();
  const current = getSettings().starredIssueKeys ?? [];
  const next = keys.has(lower)
    ? current.filter((k) => k.toLowerCase() !== lower)
    : [...current, key];
  rebuild(next); // fire change immediately (optimistic)
  await updateSettings({ starredIssueKeys: next });
}

/** Stamp isStarred on a list of issues in place; returns the same array. */
export function applyStarred<T extends Pick<JiraIssue, 'key' | 'isStarred'>>(issues: T[]): T[] {
  for (const issue of issues) issue.isStarred = keys.has(issue.key.toLowerCase());
  return issues;
}

// Draft autosave store (lib/drafts) — save/load/TTL/prune/age formatting.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearDraft,
  DRAFT_TTL_MS,
  draftAge,
  draftKey,
  isFlushSuppressed,
  loadDraft,
  pruneDrafts,
  saveDraft,
} from '../src/lib/drafts';

// Vitest jsdom-less env: give the module a real Storage-like localStorage.
class MemStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).localStorage = new MemStorage();
});

describe('draftKey', () => {
  it('namespaces and joins parts', () => {
    expect(draftKey('case', 'edit', 42)).toBe('mc.draft.case.edit.42');
    expect(draftKey('cfpage', 'new', 'HIG')).toBe('mc.draft.cfpage.new.HIG');
  });
});

describe('save/load/clear', () => {
  it('round-trips data with its savedAt stamp', () => {
    const key = draftKey('case', 'new', 1, 'all');
    saveDraft(key, { title: 'hello' }, 1000);
    const got = loadDraft<{ title: string }>(key, 2000);
    expect(got?.data.title).toBe('hello');
    expect(got?.savedAt).toBe(1000);
  });

  it('returns null for missing/cleared/corrupt drafts', () => {
    const key = draftKey('x');
    expect(loadDraft(key)).toBeNull();
    saveDraft(key, { a: 1 });
    clearDraft(key);
    expect(loadDraft(key)).toBeNull();
    localStorage.setItem(key, 'not json');
    expect(loadDraft(key)).toBeNull();
  });

  it('expires drafts past the TTL', () => {
    const key = draftKey('old');
    saveDraft(key, { a: 1 }, 0);
    expect(loadDraft(key, DRAFT_TTL_MS - 1)).not.toBeNull();
    expect(loadDraft(key, DRAFT_TTL_MS + 1)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull(); // removed on expired read
  });
});

describe('pruneDrafts', () => {
  it('sweeps expired and corrupt mc.draft.* keys, leaves the rest', () => {
    saveDraft(draftKey('fresh'), { a: 1 }, 1000);
    saveDraft(draftKey('stale'), { a: 1 }, 0);
    localStorage.setItem(draftKey('corrupt'), '{{{');
    localStorage.setItem('mc.other', 'untouched');
    pruneDrafts(DRAFT_TTL_MS + 500);
    expect(localStorage.getItem(draftKey('fresh'))).not.toBeNull();
    expect(localStorage.getItem(draftKey('stale'))).toBeNull();
    expect(localStorage.getItem(draftKey('corrupt'))).toBeNull();
    expect(localStorage.getItem('mc.other')).toBe('untouched');
  });
});

describe('flush suppression', () => {
  it('clearDraft suppresses the unmount flush; saveDraft lifts it', () => {
    const key = draftKey('sup');
    saveDraft(key, { a: 1 });
    expect(isFlushSuppressed(key)).toBe(false);
    clearDraft(key); // deliberate clear (save/discard)
    expect(isFlushSuppressed(key)).toBe(true);
    saveDraft(key, { a: 2 }); // user typed again → drafting resumes
    expect(isFlushSuppressed(key)).toBe(false);
  });
});

describe('draftAge', () => {
  it('formats minutes/hours/days', () => {
    const now = 100 * 24 * 60 * 60 * 1000;
    expect(draftAge(now - 30_000, now)).toBe('a moment ago');
    expect(draftAge(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(draftAge(now - 60 * 60_000, now)).toBe('1 hour ago');
    expect(draftAge(now - 5 * 3_600_000, now)).toBe('5 hours ago');
    expect(draftAge(now - 2 * 86_400_000, now)).toBe('2 days ago');
  });
});

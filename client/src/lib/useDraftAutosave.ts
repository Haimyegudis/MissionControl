// Debounced draft autosave for editor dialogs. Feed it the current form
// snapshot; it writes the draft 600ms after the last change, and removes the
// draft again while the form matches its pristine baseline (so untouched or
// reverted editors never leave junk behind).

import { useEffect, useRef } from 'react';
import { clearDraft, saveDraft } from './drafts';

const DEBOUNCE_MS = 600;

export function useDraftAutosave<T>(key: string, data: T, pristine: boolean): void {
  const json = JSON.stringify(data);
  const first = useRef(true);

  useEffect(() => {
    // Skip the mount pass — restoring a draft must not immediately re-stamp
    // its savedAt (the "from N hours ago" banner would lie).
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      if (pristine) clearDraft(key);
      else saveDraft(key, JSON.parse(json) as T);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [key, json, pristine]);
}

// Debounced draft autosave for editor dialogs. Feed it the current form
// snapshot; it writes the draft 600ms after the last change, removes the
// draft again while the form matches its pristine baseline (so untouched or
// reverted editors never leave junk), and FLUSHES any pending change when
// the editor unmounts — closing a dialog right after typing loses nothing.

import { useEffect, useRef } from 'react';
import { clearDraft, isFlushSuppressed, saveDraft } from './drafts';

const DEBOUNCE_MS = 600;

export function useDraftAutosave<T>(key: string, data: T, pristine: boolean): void {
  const json = JSON.stringify(data);
  const latest = useRef({ key, json, pristine });
  latest.current = { key, json, pristine };
  const first = useRef(true);
  const dirtySinceMount = useRef(false);

  useEffect(() => {
    // Skip the mount pass — restoring a draft must not immediately re-stamp
    // its savedAt (the "from N hours ago" banner would lie).
    if (first.current) {
      first.current = false;
      return;
    }
    dirtySinceMount.current = true;
    const timer = window.setTimeout(() => {
      if (pristine) clearDraft(key);
      else saveDraft(key, JSON.parse(json) as T);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [key, json, pristine]);

  // Unmount flush: a change typed less than DEBOUNCE_MS before the editor
  // closed (backdrop click, Esc, view switch) still lands in the draft.
  // Suppressed after a deliberate clearDraft (successful save / discard).
  useEffect(
    () => () => {
      if (!dirtySinceMount.current) return;
      const snap = latest.current;
      if (snap.pristine) clearDraft(snap.key);
      else if (!isFlushSuppressed(snap.key)) saveDraft(snap.key, JSON.parse(snap.json) as T);
    },
    [],
  );
}

// Banner shown at the top of an editor when unsaved work from a previous
// session was restored. Offers a one-click discard back to the clean state.

import { draftAge } from '../lib/drafts';

export function DraftBanner({ savedAt, onDiscard }: { savedAt: number; onDiscard: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 12px',
        borderRadius: 6,
        border: '1px solid var(--accent-yellow)',
        background: 'color-mix(in srgb, var(--accent-yellow) 12%, transparent)',
        fontSize: 12.5,
      }}
    >
      <span aria-hidden>📝</span>
      <span style={{ flex: 1 }}>
        Unsaved draft restored — you stopped {draftAge(savedAt)}. Keep editing, or discard it.
      </span>
      <button className="btn" onClick={onDiscard}>
        Discard draft
      </button>
    </div>
  );
}

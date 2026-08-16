// Markdown formatting toolbar for textarea fields (case editor). Operates on
// whichever registered textarea was focused last: wraps the selection in
// markdown marks (TestRail renders these). Fields register themselves via the
// useMdFields() helper's onFocus prop.

import { useRef } from 'react';
import { applyMdFormat, type MdFormat } from '../lib/mdFormat';

export interface ActiveMdField {
  el: HTMLTextAreaElement;
  set: (value: string) => void;
}

export interface MdFieldRegistry {
  /** Spread onto each participating <textarea>: registers it on focus. */
  register: (set: (value: string) => void) => { onFocus: (e: React.FocusEvent<HTMLTextAreaElement>) => void };
  activeRef: React.MutableRefObject<ActiveMdField | null>;
}

export function useMdFields(): MdFieldRegistry {
  const activeRef = useRef<ActiveMdField | null>(null);
  return {
    activeRef,
    register: (set) => ({
      onFocus: (e) => {
        activeRef.current = { el: e.currentTarget, set };
      },
    }),
  };
}

const BUTTONS: Array<{ fmt: MdFormat; label: string; title: string; style?: React.CSSProperties }> = [
  { fmt: 'bold', label: 'B', title: 'Bold (**text**)', style: { fontWeight: 800 } },
  { fmt: 'italic', label: 'I', title: 'Italic (*text*)', style: { fontStyle: 'italic' } },
  { fmt: 'code', label: '</>', title: 'Inline code (`text`)' },
  { fmt: 'ol', label: '1.', title: 'Numbered list' },
  { fmt: 'ul', label: '•', title: 'Bullet list' },
  { fmt: 'table', label: '⊞', title: 'Insert table' },
  { fmt: 'link', label: '🔗', title: 'Link [text](url)' },
];

export function MdToolbar({ fields }: { fields: MdFieldRegistry }) {
  const apply = (fmt: MdFormat) => {
    const active = fields.activeRef.current;
    if (!active || !document.contains(active.el)) return;
    const { el, set } = active;
    const result = applyMdFormat(el.value, el.selectionStart, el.selectionEnd, fmt);
    set(result.text);
    // Restore focus + selection after React re-renders the controlled value.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(result.selStart, result.selEnd);
    });
  };

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      {BUTTONS.map((b) => (
        <button
          key={b.fmt}
          type="button"
          className="btn"
          title={b.title}
          style={{ padding: '2px 9px', fontSize: 12, minWidth: 30, ...b.style }}
          // preventDefault keeps focus in the textarea so the selection survives
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply(b.fmt)}
        >
          {b.label}
        </button>
      ))}
      <span className="muted" style={{ fontSize: 10.5, marginLeft: 4 }}>
        Formats the focused text field — TestRail renders markdown
      </span>
    </div>
  );
}

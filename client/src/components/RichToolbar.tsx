// Formatting toolbar for RichTextArea fields — applies REAL formatting
// (visible bold/lists/tables) to the focused editor via execCommand.
// Serialization to TestRail markdown happens in RichTextArea.

import { useRef } from 'react';

export interface RichTarget {
  current: HTMLElement | null;
}

export function useRichTarget(): RichTarget {
  return useRef<HTMLElement | null>(null);
}

const TABLE_HTML =
  '<table><thead><tr><th>Header 1</th><th>Header 2</th></tr></thead>' +
  '<tbody><tr><td>Cell 1</td><td>Cell 2</td></tr><tr><td>Cell 3</td><td>Cell 4</td></tr></tbody></table><div><br></div>';

export function RichToolbar({ target }: { target: RichTarget }) {
  const exec = (command: string, arg?: string) => {
    const el = target.current;
    if (!el || !document.contains(el)) return;
    el.focus();
    document.execCommand(command, false, arg);
    // execCommand mutates the DOM without firing onInput — nudge the editor
    // so it re-serializes its markdown.
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const insertCode = () => {
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString() : 'code';
    exec('insertHTML', `<code>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>`);
  };

  const insertLink = () => {
    const url = window.prompt('Link URL:', 'https://');
    if (url) exec('createLink', url);
  };

  const buttons: Array<{ label: string; title: string; run: () => void; style?: React.CSSProperties }> = [
    { label: 'B', title: 'Bold', run: () => exec('bold'), style: { fontWeight: 800 } },
    { label: 'I', title: 'Italic', run: () => exec('italic'), style: { fontStyle: 'italic' } },
    { label: '</>', title: 'Inline code', run: insertCode },
    { label: '1.', title: 'Numbered list — Enter adds the next number', run: () => exec('insertOrderedList') },
    { label: '•', title: 'Bullet list', run: () => exec('insertUnorderedList') },
    { label: '⊞', title: 'Insert table', run: () => exec('insertHTML', TABLE_HTML) },
    { label: '🔗', title: 'Link', run: insertLink },
    { label: '⌫fmt', title: 'Clear formatting', run: () => exec('removeFormat') },
  ];

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      {buttons.map((b) => (
        <button
          key={b.label}
          type="button"
          className="btn"
          title={b.title}
          style={{ padding: '2px 9px', fontSize: 12, minWidth: 30, ...b.style }}
          // keep focus + selection in the editor
          onMouseDown={(e) => e.preventDefault()}
          onClick={b.run}
        >
          {b.label}
        </button>
      ))}
      <span className="muted" style={{ fontSize: 10.5, marginLeft: 4 }}>
        Formats the focused field — saved as TestRail markdown
      </span>
    </div>
  );
}

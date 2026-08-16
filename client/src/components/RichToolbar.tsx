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
  // Selection inside the editor, captured before a <select> steals focus.
  const savedRange = useRef<Range | null>(null);

  const saveSelection = () => {
    const sel = window.getSelection();
    const el = target.current;
    if (sel && sel.rangeCount > 0 && el && el.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const exec = (command: string, arg?: string) => {
    const el = target.current;
    if (!el || !document.contains(el)) return;
    el.focus();
    if (savedRange.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRange.current);
      savedRange.current = null;
    }
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
      <select
        title="Text color — visible here while editing; TestRail stores plain text"
        defaultValue=""
        style={{ padding: '2px 4px', fontSize: 12, width: 64 }}
        onMouseDown={saveSelection}
        onChange={(e) => {
          if (e.target.value) exec('foreColor', e.target.value);
          e.target.value = '';
        }}
      >
        <option value="" disabled>
          A color
        </option>
        <option value="#e5484d" style={{ color: '#e5484d' }}>■ Red</option>
        <option value="#e8890c" style={{ color: '#e8890c' }}>■ Orange</option>
        <option value="#0f9d6a" style={{ color: '#0f9d6a' }}>■ Green</option>
        <option value="#2f81f7" style={{ color: '#2f81f7' }}>■ Blue</option>
        <option value="#b558f6" style={{ color: '#b558f6' }}>■ Purple</option>
        <option value="inherit">Default</option>
      </select>
      <select
        title="Highlight — visible here while editing; TestRail stores plain text"
        defaultValue=""
        style={{ padding: '2px 4px', fontSize: 12, width: 78 }}
        onMouseDown={saveSelection}
        onChange={(e) => {
          if (e.target.value) exec('hiliteColor', e.target.value);
          e.target.value = '';
        }}
      >
        <option value="" disabled>
          Highlight
        </option>
        <option value="#fde84766">Yellow</option>
        <option value="#22d38f55">Green</option>
        <option value="#4f9cf955">Blue</option>
        <option value="#ff4ecd44">Pink</option>
        <option value="transparent">None</option>
      </select>
      <span className="muted" style={{ fontSize: 10.5, marginLeft: 4 }}>
        Formats the focused field — colors show here only; TestRail gets plain text
      </span>
    </div>
  );
}

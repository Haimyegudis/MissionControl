// Formatting toolbar for RichTextArea fields — applies REAL formatting
// (visible bold/lists/tables) to the focused editor via execCommand.
// Serialization to TestRail markdown happens in RichTextArea.

import { useRef, useState } from 'react';

export interface RichTarget {
  current: HTMLElement | null;
}

export function useRichTarget(): RichTarget {
  return useRef<HTMLElement | null>(null);
}

function tableHtml(rows: number, cols: number): string {
  const head =
    '<thead><tr>' + Array.from({ length: cols }, (_, c) => `<th>Header ${c + 1}</th>`).join('') + '</tr></thead>';
  const body =
    '<tbody>' +
    Array.from(
      { length: Math.max(1, rows - 1) },
      () => '<tr>' + Array.from({ length: cols }, () => '<td><br></td>').join('') + '</tr>',
    ).join('') +
    '</tbody>';
  return `<table>${head}${body}</table><div><br></div>`;
}

/** Cell containing the caret (inside the given editor), if any. */
function caretCell(editor: HTMLElement | null): HTMLTableCellElement | null {
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  if (!node || !editor || !editor.contains(node)) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  return (el?.closest('td,th') as HTMLTableCellElement | null) ?? null;
}

export function RichToolbar({ target }: { target: RichTarget }) {
  // Selection inside the editor, captured before a <select> steals focus.
  const savedRange = useRef<Range | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [tRows, setTRows] = useState(3);
  const [tCols, setTCols] = useState(3);

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

  const notifyInput = () => target.current?.dispatchEvent(new Event('input', { bubbles: true }));

  /** Run a structural table op on the cell the caret is in. */
  const withCell = (fn: (cell: HTMLTableCellElement, row: HTMLTableRowElement, table: HTMLTableElement) => void) => {
    const cell = caretCell(target.current);
    const row = cell?.parentElement as HTMLTableRowElement | null;
    const table = cell?.closest('table') as HTMLTableElement | null;
    if (!cell || !row || !table) return;
    fn(cell, row, table);
    notifyInput();
  };

  const addRow = () =>
    withCell((_cell, row, table) => {
      const cols = row.cells.length;
      const tr = document.createElement('tr');
      for (let i = 0; i < cols; i++) {
        const td = document.createElement('td');
        td.innerHTML = '<br>';
        tr.appendChild(td);
      }
      if (row.parentElement?.tagName === 'THEAD') {
        const tbody = table.querySelector('tbody') ?? table.appendChild(document.createElement('tbody'));
        tbody.insertBefore(tr, tbody.firstChild);
      } else {
        row.after(tr);
      }
    });

  const addCol = () =>
    withCell((cell, _row, table) => {
      const idx = cell.cellIndex;
      for (const tr of table.querySelectorAll('tr')) {
        const ref = tr.cells[Math.min(idx, tr.cells.length - 1)];
        const isHead = ref?.tagName === 'TH';
        const neu = document.createElement(isHead ? 'th' : 'td');
        neu.innerHTML = isHead ? 'Header' : '<br>';
        ref ? ref.after(neu) : tr.appendChild(neu);
      }
    });

  const delRow = () =>
    withCell((...args) => {
      const [, row, table] = args;
      row.remove();
      if (table.querySelectorAll('tr').length === 0) table.remove();
    });

  const delCol = () =>
    withCell((cell, _row, table) => {
      const idx = cell.cellIndex;
      for (const tr of table.querySelectorAll('tr')) tr.cells[idx]?.remove();
      if ([...table.querySelectorAll('tr')].every((tr) => tr.cells.length === 0)) table.remove();
    });

  const buttons: Array<{ label: string; title: string; run: () => void; style?: React.CSSProperties }> = [
    { label: 'B', title: 'Bold', run: () => exec('bold'), style: { fontWeight: 800 } },
    { label: 'I', title: 'Italic', run: () => exec('italic'), style: { fontStyle: 'italic' } },
    { label: '</>', title: 'Inline code', run: insertCode },
    { label: '1.', title: 'Numbered list — Enter adds the next number', run: () => exec('insertOrderedList') },
    { label: '•', title: 'Bullet list', run: () => exec('insertUnorderedList') },
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
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          type="button"
          className="btn"
          title="Table — insert any size, add/remove rows and columns"
          style={{ padding: '2px 9px', fontSize: 12, minWidth: 30 }}
          onMouseDown={(e) => {
            e.preventDefault();
            saveSelection();
          }}
          onClick={() => setTableOpen((v) => !v)}
        >
          ⊞ ▾
        </button>
        {tableOpen ? (
          <div
            className="card card-high"
            style={{
              position: 'absolute',
              top: '110%',
              left: 0,
              zIndex: 50,
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              width: 230,
            }}
          >
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
              <input
                type="number"
                min={1}
                max={30}
                value={tRows}
                onChange={(e) => setTRows(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                style={{ width: 56, padding: '3px 6px' }}
              />
              ×
              <input
                type="number"
                min={1}
                max={12}
                value={tCols}
                onChange={(e) => setTCols(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
                style={{ width: 56, padding: '3px 6px' }}
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '2px 10px', fontSize: 12 }}
                onClick={() => {
                  setTableOpen(false);
                  exec('insertHTML', tableHtml(tRows, tCols));
                }}
              >
                Insert
              </button>
            </div>
            <div className="muted" style={{ fontSize: 10.5 }}>
              rows × columns (first row is the header)
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {[
                { label: '+ row', title: 'Add row below the caret', run: addRow },
                { label: '+ col', title: 'Add column right of the caret', run: addCol },
                { label: '− row', title: 'Delete the caret row', run: delRow },
                { label: '− col', title: 'Delete the caret column', run: delCol },
              ].map((b) => (
                <button
                  key={b.label}
                  type="button"
                  className="btn"
                  title={b.title}
                  style={{ padding: '2px 8px', fontSize: 11.5 }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={b.run}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 10.5 }}>
              Click inside a table cell first, then use + / −
            </div>
          </div>
        ) : null}
      </span>
      <select
        title="Text color — visible here while editing; TestRail stores plain text"
        defaultValue=""
        style={{ padding: '2px 4px', fontSize: 12, width: 64 }}
        onMouseDown={saveSelection}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__default__') {
            // Reset to the theme's normal text color (execCommand needs a
            // concrete color — 'inherit' silently does nothing).
            const el = target.current;
            exec('foreColor', el ? getComputedStyle(el).color : '#000000');
          } else if (v) {
            exec('foreColor', v);
          }
          e.target.value = '';
        }}
      >
        <option value="" disabled>
          A color
        </option>
        <option value="__default__">Default</option>
        <option value="#e5484d" style={{ color: '#e5484d' }}>■ Red</option>
        <option value="#e8890c" style={{ color: '#e8890c' }}>■ Orange</option>
        <option value="#0f9d6a" style={{ color: '#0f9d6a' }}>■ Green</option>
        <option value="#2f81f7" style={{ color: '#2f81f7' }}>■ Blue</option>
        <option value="#b558f6" style={{ color: '#b558f6' }}>■ Purple</option>
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
        Formats the focused field — colors show in Mission Control; TestRail shows them as {'{color}'} text marks
      </span>
    </div>
  );
}

// Markdown formatting operations for plain <textarea> fields (case editor).
// TestRail renders markdown in steps/preconditions/expected, so the toolbar
// inserts markdown marks around the current selection. Pure — unit tested.

export type MdFormat = 'bold' | 'italic' | 'code' | 'ol' | 'ul' | 'table' | 'link';

export interface MdResult {
  text: string;
  /** New selection range (caret positions) after the edit. */
  selStart: number;
  selEnd: number;
}

const WRAP: Partial<Record<MdFormat, [string, string, string]>> = {
  bold: ['**', '**', 'bold text'],
  italic: ['*', '*', 'italic text'],
  code: ['`', '`', 'code'],
};

const TABLE_TEMPLATE = '| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n| Cell 3 | Cell 4 |';

/** Apply a markdown format to value[selStart..selEnd]. */
export function applyMdFormat(value: string, selStart: number, selEnd: number, fmt: MdFormat): MdResult {
  const before = value.slice(0, selStart);
  const sel = value.slice(selStart, selEnd);
  const after = value.slice(selEnd);

  const wrap = WRAP[fmt];
  if (wrap) {
    const [open, close, placeholder] = wrap;
    const body = sel || placeholder;
    return {
      text: before + open + body + close + after,
      selStart: selStart + open.length,
      selEnd: selStart + open.length + body.length,
    };
  }

  if (fmt === 'ol' || fmt === 'ul') {
    // Expand to whole lines covering the selection and prefix each.
    const lineStart = before.lastIndexOf('\n') + 1;
    const relEnd = value.indexOf('\n', selEnd);
    const blockEnd = relEnd === -1 ? value.length : relEnd;
    const block = value.slice(lineStart, blockEnd);
    const lines = block.split('\n');
    const prefixed = lines
      .map((line, i) => (fmt === 'ol' ? `${i + 1}. ${line}` : `- ${line}`))
      .join('\n');
    return {
      text: value.slice(0, lineStart) + prefixed + value.slice(blockEnd),
      selStart: lineStart,
      selEnd: lineStart + prefixed.length,
    };
  }

  if (fmt === 'table') {
    const needsNl = before.length > 0 && !before.endsWith('\n');
    const insert = (needsNl ? '\n' : '') + TABLE_TEMPLATE + '\n';
    return {
      text: before + insert + sel + after,
      selStart: selStart + insert.length,
      selEnd: selStart + insert.length + sel.length,
    };
  }

  // link
  const label = sel || 'link text';
  const url = 'https://';
  const text = `${before}[${label}](${url})${after}`;
  const urlStart = selStart + 1 + label.length + 2;
  return { text, selStart: urlStart, selEnd: urlStart + url.length };
}

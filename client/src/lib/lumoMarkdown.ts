// Mini-markdown for Lumo summaries (Yaki-style): pipe tables, **bold**,
// `code`, [text](url). Pure segmentation logic — unit tested; rendering
// happens in LumoMarkdown.tsx.

export interface TableSegment {
  kind: 'table';
  headers: string[];
  rows: string[][];
}

export interface TextSegment {
  kind: 'text';
  text: string;
}

export type LumoSegment = TableSegment | TextSegment;

function isTableLine(line: string): boolean {
  const t = line.trim();
  return t.includes('|') && t.replace(/[^|]/g, '').length >= 2;
}

function isSeparatorLine(line: string): boolean {
  const t = line.trim().replace(/^\||\|$/g, '');
  return t.length > 0 && /^[\s:|-]+$/.test(t) && t.includes('-');
}

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

/** Split a summary into text blocks and pipe tables (header count normalized). */
export function segmentSummary(text: string | null | undefined): LumoSegment[] {
  const input = (text ?? '').replace(/\r\n/g, '\n');
  if (!input.trim()) return [];
  const lines = input.split('\n');
  const segments: LumoSegment[] = [];
  let buf: string[] = [];

  const flushText = () => {
    const t = buf.join('\n');
    if (t.trim().length > 0) segments.push({ kind: 'text', text: t });
    buf = [];
  };

  let i = 0;
  while (i < lines.length) {
    // A table = 2+ consecutive pipe lines (separator rows allowed anywhere).
    if (isTableLine(lines[i]) && i + 1 < lines.length && isTableLine(lines[i + 1])) {
      flushText();
      const tableLines: string[] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      const dataLines = tableLines.filter((l) => !isSeparatorLine(l));
      const headers = splitRow(dataLines[0] ?? '');
      const rows = dataLines.slice(1).map((l) => {
        const cells = splitRow(l);
        // Normalize stray cell counts to the header width.
        if (cells.length > headers.length) {
          return [...cells.slice(0, headers.length - 1), cells.slice(headers.length - 1).join(' | ')];
        }
        while (cells.length < headers.length) cells.push('');
        return cells;
      });
      segments.push({ kind: 'table', headers, rows });
      continue;
    }
    buf.push(lines[i]);
    i++;
  }
  flushText();
  return segments;
}

export interface InlineToken {
  kind: 'text' | 'bold' | 'code' | 'link';
  text: string;
  url?: string;
}

/** Tokenize inline **bold** / `code` / [text](url) inside a text run. */
export function tokenizeInline(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'code', text: m[2] });
    else out.push({ kind: 'link', text: m[3], url: m[4] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

// Markdown ↔ HTML for the case editor's WYSIWYG fields. TestRail stores
// markdown; the editor shows rendered bold/lists/tables in a contentEditable
// and serializes back to markdown on every change.
//
// Supported both ways: **bold**, *italic*, `code`, numbered / bullet lists,
// GFM tables, [links](url), line breaks. Anything else passes through as
// plain text. mdToHtml is pure string→string (unit tested); htmlToMd walks a
// DOM element (verified in the browser).

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** CSS color value safe to inject into a style attribute. */
function safeColor(value: string): string | null {
  const v = value.trim();
  return /^[#a-zA-Z0-9(),.%\s-]+$/.test(v) ? v : null;
}

/** Inline markdown → HTML (bold/italic/code/links/colors) on an escaped line. */
function inlineMdToHtml(line: string): string {
  let out = escapeHtml(line);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  out = out.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  // Mission Control color tags — persisted in the markdown; TestRail shows
  // them as plain text markers, we render real colors.
  out = out.replace(/\{color:([^}]+)\}([\s\S]*?)\{\/color\}/g, (m, col: string, body: string) => {
    const c = safeColor(col);
    return c ? `<span style="color:${c}">${body}</span>` : m;
  });
  out = out.replace(/\{bg:([^}]+)\}([\s\S]*?)\{\/bg\}/g, (m, col: string, body: string) => {
    const c = safeColor(col);
    return c ? `<span style="background-color:${c}">${body}</span>` : m;
  });
  return out;
}

const OL_RE = /^\s*\d+[.)]\s+(.*)$/;
const UL_RE = /^\s*[-*]\s+(.*)$/;
const TABLE_ROW_RE = /^\s*\|(.+)\|?\s*$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|?\s*$/;

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/** Markdown (TestRail flavor) → HTML for the contentEditable editor. */
export function mdToHtml(md: string): string {
  const lines = (md ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // table: header row + separator row
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      out.push(
        '<table><thead><tr>' +
          header.map((h) => `<th>${inlineMdToHtml(h)}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => `<td>${inlineMdToHtml(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table>',
      );
      continue;
    }

    // ordered list run
    if (OL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && OL_RE.test(lines[i])) {
        items.push(lines[i].match(OL_RE)![1]);
        i++;
      }
      out.push('<ol>' + items.map((t) => `<li>${inlineMdToHtml(t)}</li>`).join('') + '</ol>');
      continue;
    }

    // bullet list run
    if (UL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UL_RE.test(lines[i])) {
        items.push(lines[i].match(UL_RE)![1]);
        i++;
      }
      out.push('<ul>' + items.map((t) => `<li>${inlineMdToHtml(t)}</li>`).join('') + '</ul>');
      continue;
    }

    out.push(`<div>${line.trim() === '' ? '<br>' : inlineMdToHtml(line)}</div>`);
    i++;
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// HTML → markdown (DOM walk; browser runtime)
// ---------------------------------------------------------------------------

function inlineHtmlToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/ /g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const inner = [...el.childNodes].map(inlineHtmlToMd).join('');
  switch (el.tagName) {
    case 'B':
    case 'STRONG':
      return inner.trim() ? `**${inner}**` : inner;
    case 'I':
    case 'EM':
      return inner.trim() ? `*${inner}*` : inner;
    case 'CODE':
      return inner.trim() ? `\`${inner}\`` : inner;
    case 'A':
      return `[${inner || el.getAttribute('href') || ''}](${el.getAttribute('href') ?? ''})`;
    case 'BR':
      return '\n';
    case 'FONT': {
      const color = el.getAttribute('color');
      return color && inner.trim() ? `{color:${color}}${inner}{/color}` : inner;
    }
    case 'SPAN': {
      // execCommand writes colors as inline styles — persist them as tags.
      const style = el.getAttribute('style') ?? '';
      const color = /(?:^|;)\s*color:\s*([^;]+)/i.exec(style)?.[1]?.trim();
      const bg = /background(?:-color)?:\s*([^;]+)/i.exec(style)?.[1]?.trim();
      let out = inner;
      if (color && out.trim()) out = `{color:${color}}${out}{/color}`;
      if (bg && bg !== 'transparent' && out.trim()) out = `{bg:${bg}}${out}{/bg}`;
      return out;
    }
    case 'U':
    default:
      return inner;
  }
}

function tableToMd(table: HTMLTableElement): string {
  const rows = [...table.querySelectorAll('tr')].map((tr) =>
    [...tr.querySelectorAll('th,td')].map((cell) => inlineHtmlToMd(cell).replace(/\n/g, ' ').trim()),
  );
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const line = (r: string[]) => `| ${pad(r).join(' | ')} |`;
  const sep = `| ${Array(width).fill('---').join(' | ')} |`;
  return [line(rows[0]), sep, ...rows.slice(1).map(line)].join('\n');
}

/** contentEditable HTML → TestRail markdown. */
export function htmlToMd(root: HTMLElement): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? '').replace(/ /g, ' ');
      if (t.trim()) parts.push(t);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    switch (el.tagName) {
      case 'OL': {
        const items = [...el.children].filter((c) => c.tagName === 'LI');
        parts.push(items.map((li, i) => `${i + 1}. ${inlineHtmlToMd(li).replace(/\n+/g, ' ').trim()}`).join('\n'));
        return;
      }
      case 'UL': {
        const items = [...el.children].filter((c) => c.tagName === 'LI');
        parts.push(items.map((li) => `- ${inlineHtmlToMd(li).replace(/\n+/g, ' ').trim()}`).join('\n'));
        return;
      }
      case 'TABLE':
        parts.push(tableToMd(el as HTMLTableElement));
        return;
      case 'DIV':
      case 'P': {
        // Block wrapper: recurse if it holds nested blocks, else inline line.
        if (el.querySelector('ol,ul,table,div,p')) {
          [...el.childNodes].forEach(walk);
        } else {
          parts.push(inlineHtmlToMd(el).trim());
        }
        return;
      }
      case 'BR':
        parts.push('');
        return;
      default:
        parts.push(inlineHtmlToMd(el).trim());
    }
  };
  [...root.childNodes].forEach(walk);
  // Collapse trailing blank lines but keep internal blanks (paragraph gaps).
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}

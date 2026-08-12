// IssueLinkText tokenizer (ui-parity-contract.md §12.9). Pure — unit tested.

export type LinkToken =
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: string }
  | { kind: 'url'; url: string; index: number };

const LINK_RE = /(https?:\/\/[^\s"<>)]+)|(\b[A-Z][A-Z0-9_]+-\d+\b)/g;
const TRAILING = new Set(['.', ',', ';', ')']);

/**
 * Split text into text / issue-key / url tokens. URLs are numbered 1-based in
 * order of appearance (`Link 1`, `Link 2`, ...); trailing `. , ; )` are trimmed
 * off URLs and re-emitted as text. Only http/https URLs match.
 */
export function tokenize(text: string | null | undefined): LinkToken[] {
  const tokens: LinkToken[] = [];
  const input = text ?? '';
  if (!input) return tokens;

  let last = 0;
  let urlCount = 0;
  LINK_RE.lastIndex = 0;
  for (let m = LINK_RE.exec(input); m; m = LINK_RE.exec(input)) {
    if (m.index > last) tokens.push({ kind: 'text', text: input.slice(last, m.index) });
    if (m[1]) {
      let url = m[1];
      let trailing = '';
      while (url.length > 0 && TRAILING.has(url[url.length - 1])) {
        trailing = url[url.length - 1] + trailing;
        url = url.slice(0, -1);
      }
      if (url) {
        urlCount += 1;
        tokens.push({ kind: 'url', url, index: urlCount });
      }
      if (trailing) tokens.push({ kind: 'text', text: trailing });
    } else {
      tokens.push({ kind: 'key', key: m[2] });
    }
    last = m.index + m[0].length;
  }
  if (last < input.length) tokens.push({ kind: 'text', text: input.slice(last) });
  return tokens;
}

// IssueLinkText (ui-parity §12.9): issue keys become cyan underlined links that
// open details; URLs render as numbered "Link 1", "Link 2", ... with the URL as
// tooltip, trailing punctuation trimmed, http/https only, opened in a new tab.

import { tokenize } from '../lib/linkify';

export interface IssueLinkTextProps {
  text: string | null | undefined;
  onOpenIssue?: (key: string) => void;
}

export function IssueLinkText({ text, onOpenIssue }: IssueLinkTextProps) {
  const tokens = tokenize(text);
  return (
    <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {tokens.map((t, i) => {
        if (t.kind === 'text') return <span key={i}>{t.text}</span>;
        if (t.kind === 'key') {
          return (
            <a
              key={i}
              href="#"
              title={`Open ${t.key} in new window`}
              onClick={(e) => {
                e.preventDefault();
                onOpenIssue?.(t.key);
              }}
              style={{ color: 'var(--accent-cyan)', textDecoration: 'underline' }}
            >
              {t.key}
            </a>
          );
        }
        return (
          <a
            key={i}
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            title={t.url}
            style={{ color: 'var(--accent-cyan)', textDecoration: 'underline' }}
          >
            {`Link ${t.index}`}
          </a>
        );
      })}
    </span>
  );
}

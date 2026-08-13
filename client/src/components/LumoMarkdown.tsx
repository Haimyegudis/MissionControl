// Renders a Lumo summary: pipe tables become real sortable-free HTML tables,
// text runs get **bold** / `code` / [link](url) inline formatting.

import type { CSSProperties } from 'react';
import { segmentSummary, tokenizeInline } from '../lib/lumoMarkdown';

const cellBase: CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid var(--border-soft)',
  textAlign: 'left',
  verticalAlign: 'top',
};

function Inline({ text }: { text: string }) {
  return (
    <>
      {tokenizeInline(text).map((t, i) => {
        if (t.kind === 'bold') return <strong key={i}>{t.text}</strong>;
        if (t.kind === 'code')
          return (
            <code key={i} style={{ background: 'var(--bg-panel-high)', padding: '0 4px', borderRadius: 4 }}>
              {t.text}
            </code>
          );
        if (t.kind === 'link')
          return (
            <a key={i} href={t.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-cyan)' }}>
              {t.text}
            </a>
          );
        return <span key={i}>{t.text}</span>;
      })}
    </>
  );
}

export function LumoMarkdown({ text }: { text: string }) {
  const segments = segmentSummary(text);
  if (segments.length === 0) return null;
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          <div key={i} style={{ whiteSpace: 'pre-wrap' }}>
            <Inline text={seg.text} />
          </div>
        ) : (
          <div key={i} style={{ overflowX: 'auto', margin: '6px 0' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead>
                <tr>
                  {seg.headers.map((h, j) => (
                    <th
                      key={j}
                      style={{
                        ...cellBase,
                        borderBottom: '2px solid var(--border-strong)',
                        fontSize: 10.5,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'var(--muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <Inline text={h} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {seg.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} style={cellBase}>
                        <Inline text={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </>
  );
}

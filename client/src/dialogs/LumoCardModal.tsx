// Lumo card modal (ui-parity §10.10) — 560×500, dedicated dark palette
// (deliberately not themed: the contract fixes these colors).

import { useEffect } from 'react';
import type { LumoCard } from '../types';
import { sourceMeta } from './lumoSources';

export function LumoCardModal({ card, onClose }: { card: LumoCard; onClose: () => void }) {
  const meta = sourceMeta(card.source);
  const fields = Object.entries(card.fields ?? {});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(2, 2, 12, 0.65)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: 560,
          maxWidth: 'calc(100vw - 32px)',
          height: 500,
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          background: '#0D0D1A',
          border: '1px solid #373766',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 18px 48px rgba(0, 0, 0, 0.6)',
        }}
      >
        {/* header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            background: '#151528',
            borderBottom: '1px solid #373766',
          }}
        >
          <span
            style={{
              background: meta.color,
              color: '#FFFFFF',
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 999,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {meta.label}
          </span>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              color: '#E2E8F0',
              fontWeight: 600,
              fontSize: 14,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {card.title}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              color: '#94A3B8',
              cursor: 'pointer',
              fontSize: 14,
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          <div style={{ color: '#CBD5F5', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {card.summary}
          </div>
          {fields.length > 0 && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {fields.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 10, fontSize: 12.5 }}>
                  <div style={{ width: 120, flexShrink: 0, color: '#94A3B8' }}>{k}</div>
                  <div style={{ color: '#E2E8F0', minWidth: 0, overflowWrap: 'anywhere' }}>{v}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            background: '#0F0F22',
            borderTop: '1px solid #373766',
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              color: '#64748B',
              fontSize: 11,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {card.url ?? ''}
          </div>
          {card.url && (
            <button
              onClick={() => window.open(card.url!, '_blank', 'noopener,noreferrer')}
              style={{
                background: '#4F46E5',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: 12,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Open in browser ⤴
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

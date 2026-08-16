// Toast host (ui-parity §10.8): 360px cards stacked bottom-right, 16px inset,
// bg #1F2937, border #334155, radius 8, padding 14, shadow. Title 13px
// semibold #E8EEFA; body 12px #94A3B8; ✕ close. Auto-dismiss handled by the
// toasts store (8s).

import type { CSSProperties } from 'react';
import { dismissToast, toastsStore } from '../stores/toasts';
import { useStore } from '../stores/useStore';

const hostStyle: CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  // Above every dialog/drawer (Modal overlay is 2000, Confluence full-screen
  // 1000) — alerts must never hide behind an open card.
  zIndex: 3000,
  pointerEvents: 'none',
};

const cardStyle: CSSProperties = {
  width: 360,
  background: 'var(--toast-bg)',
  border: '1px solid var(--toast-border)',
  borderRadius: 8,
  padding: 14,
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
  pointerEvents: 'auto',
};

const SEVERITY_EDGE: Record<string, string> = {
  success: 'var(--accent-green)',
  error: 'var(--accent-red)',
  info: 'var(--accent-cyan)',
};

export function ToastHost() {
  const toasts = useStore(toastsStore);
  if (toasts.length === 0) return null;
  return (
    <div style={hostStyle}>
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{ ...cardStyle, borderLeft: `3px solid ${SEVERITY_EDGE[t.severity] ?? SEVERITY_EDGE.info}` }}
          // Errors must interrupt screen readers; the rest stay polite.
          role={t.severity === 'error' ? 'alert' : 'status'}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--toast-title)' }}>{t.title}</div>
              <div style={{ fontSize: 12, color: 'var(--toast-body)', marginTop: 4, overflowWrap: 'break-word' }}>
                {t.body}
              </div>
              {t.action ? (
                <button
                  className="btn"
                  style={{ marginTop: 8, padding: '2px 12px', fontSize: 12 }}
                  onClick={() => {
                    t.action?.onClick();
                    dismissToast(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--toast-body)',
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
                padding: 2,
              }}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

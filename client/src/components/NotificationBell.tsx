// Notification bell — retained toast history with an unread badge. Toasts
// auto-dismiss in 8s; anything that happened while the user looked away
// (or while Mute all is on) is recoverable here.

import { useEffect, useRef, useState } from 'react';
import {
  markToastsSeen,
  toastHistoryStore,
  toastSeenStore,
  type ToastHistoryEntry,
} from '../stores/toasts';
import { useStore } from '../stores/useStore';

const DOT: Record<string, string> = {
  success: 'var(--accent-green)',
  error: 'var(--accent-red)',
  info: 'var(--accent-cyan)',
};

function timeAgo(at: number): string {
  const mins = Math.floor((Date.now() - at) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export function NotificationBell() {
  const history = useStore(toastHistoryStore);
  const seenAt = useStore(toastSeenStore);
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  const unread = history.filter((h) => h.at > seenAt).length;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpen((v) => {
      if (!v) markToastsSeen();
      return !v;
    });
  };

  return (
    <div ref={host} style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="btn btn-icon" title="Notifications" onClick={toggle} aria-label={`Notifications (${unread} unread)`}>
        🔔
        {unread > 0 ? (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              borderRadius: 999,
              background: 'var(--accent-red)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="card card-high"
          style={{
            position: 'absolute',
            top: '115%',
            right: 0,
            zIndex: 900,
            width: 360,
            maxHeight: '60vh',
            overflowY: 'auto',
            padding: 8,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, padding: '4px 8px 8px' }}>Notifications</div>
          {history.length === 0 ? (
            <div className="muted" style={{ fontSize: 12, padding: '8px 8px 12px' }}>
              Nothing yet — events from this session show up here.
            </div>
          ) : (
            history.map((h: ToastHistoryEntry) => (
              <div key={h.id} style={{ display: 'flex', gap: 8, padding: '6px 8px', borderTop: '1px solid var(--border-soft)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, marginTop: 5, flexShrink: 0, background: DOT[h.severity] ?? DOT.info }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{h.title}</div>
                  <div className="muted" style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>{h.body}</div>
                </div>
                <span className="muted" style={{ fontSize: 10.5, flexShrink: 0 }}>{timeAgo(h.at)}</span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

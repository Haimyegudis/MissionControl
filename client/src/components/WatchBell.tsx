// Change-feed bell. Shows the unread count from the watcher and drops down a
// list of what changed on the Dashboard. Reading the feed is the ack, so
// opening the dropdown clears the badge.

import { useEffect, useRef, useState } from 'react';
import { ackWatchFeed, watchStore } from '../stores/watch';
import { useStore } from '../stores/useStore';
import type { WatchEvent, WatchEventKind } from '../types';

const KIND_LABEL: Record<WatchEventKind, string> = {
  assigned: 'Assigned',
  unassigned: 'Removed',
  status: 'Status',
  sprint: 'Sprint',
  priority: 'Priority',
  dueDate: 'Due date',
  comment: 'Comments',
};

const KIND_COLOR: Record<WatchEventKind, string> = {
  assigned: '#22D38F',
  unassigned: '#8A93A6',
  status: '#1FE0E0',
  sprint: '#7A5CFF',
  priority: '#EF4444',
  dueDate: '#FFA13A',
  comment: '#FFD23A',
};

/** "4m ago" / "2h ago" / "3d ago" — the feed never needs finer than this. */
function relative(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function describeEvent(event: WatchEvent): string {
  switch (event.kind) {
    case 'assigned':
      return 'now assigned to you';
    case 'unassigned':
      if (event.reason === 'done') return 'closed';
      if (event.reason === 'reassigned') return 'reassigned to someone else';
      if (event.reason === 'left-sprint') return 'moved out of your sprint';
      return 'no longer on your dashboard';
    case 'comment':
      return `${Number(event.to) - Number(event.from)} new comment(s)`;
    case 'dueDate':
      return event.to === null ? 'due date cleared' : `due ${event.to}`;
    default:
      return `${event.from ?? '—'} → ${event.to ?? '—'}`;
  }
}

export function WatchBell({ onOpenIssue }: { onOpenIssue?: (key: string) => void }) {
  const feed = useStore(watchStore);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on an outside click; a dropdown that survives the next click reads
  // as stuck rather than open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next && feed.unreadCount > 0) void ackWatchFeed();
  };

  const now = Date.now();

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn"
        onClick={toggle}
        title={feed.unreadCount > 0 ? `${feed.unreadCount} unread change(s)` : 'Dashboard changes'}
        aria-label="Dashboard changes"
        style={{ position: 'relative', padding: '6px 10px', fontSize: 14 }}
      >
        🔔
        {feed.unreadCount > 0 ? (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 8,
              background: '#EF4444',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              lineHeight: '16px',
              textAlign: 'center',
            }}
          >
            {feed.unreadCount > 99 ? '99+' : feed.unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="card"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            width: 340,
            maxHeight: 420,
            overflowY: 'auto',
            padding: 8,
            zIndex: 40,
          }}
        >
          <div className="muted" style={{ fontSize: 11, padding: '4px 6px 8px' }}>
            {feed.lastCycle ? `Last checked ${relative(feed.lastCycle, now)}` : 'Not checked yet'}
          </div>
          {feed.events.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5, padding: '8px 6px' }}>
              Nothing has changed on your dashboard.
            </div>
          ) : (
            feed.events.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenIssue?.(event.key);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 6px',
                  cursor: onOpenIssue ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12.5 }}>
                  <span style={{ color: KIND_COLOR[event.kind], fontWeight: 700 }}>
                    {KIND_LABEL[event.kind]}
                  </span>
                  <span style={{ fontWeight: 600 }}>{event.key}</span>
                  <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
                    {relative(event.at, now)}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, marginTop: 1 }}>{event.summary}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  {describeEvent(event)}
                </div>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

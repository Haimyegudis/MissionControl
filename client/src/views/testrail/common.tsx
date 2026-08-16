// Shared TestRail view pieces (Phase 3): distribution bars, stat tiles,
// typed-confirm dialog, connection gate. Styles live in theme.css.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Modal } from '../../components/Modal';
import { Stamp, statusVariant } from '../../components/Stamp';
import type { RunCounts } from '../../lib/testrail';
import { totalCount } from '../../lib/testrail';
import { navigate } from '../../router';
import { initTestRail, statusLabel, trStore, type TestRailState } from '../../stores/testrail';
import { useStore } from '../../stores/useStore';

export function DistBar({ r }: { r: RunCounts }) {
  const total = totalCount(r);
  const title = `pass ${r.passedCount} · fail ${r.failedCount} · blocked ${r.blockedCount} · retest ${r.retestCount} · untested ${r.untestedCount}`;
  const seg = (n: number, cls: string) =>
    n > 0 ? <span key={cls} className={cls} style={{ width: `${((n / total) * 100).toFixed(2)}%` }} /> : null;
  return (
    <div className="dist" title={total ? title : undefined}>
      {total > 0 && (
        <>
          {seg(r.passedCount, 'd-pass')}
          {seg(r.failedCount, 'd-fail')}
          {seg(r.blockedCount, 'd-blocked')}
          {seg(r.retestCount, 'd-retest')}
        </>
      )}
    </div>
  );
}

export function Tile({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  color: string;
}) {
  return (
    <div className="tr-tile" style={{ '--tile-color': color } as CSSProperties}>
      <div className="t-label">{label}</div>
      <div className="t-value">{value}</div>
      {hint ? <div className="t-hint">{hint}</div> : null}
    </div>
  );
}

/** Status stamp resolved against meta labels (falls back to canonical names). */
export function StatusStamp({ st, statusId }: { st: TestRailState; statusId: number }) {
  const fallback: Record<number, string> = { 1: 'Passed', 2: 'Blocked', 3: 'Untested', 4: 'Retest', 5: 'Failed' };
  const label = st.meta?.statuses.length ? statusLabel(st, statusId) : (fallback[statusId] ?? `status ${statusId}`);
  return <Stamp variant={statusVariant(statusId)}>{label}</Stamp>;
}

export function RunStateStamp({ isCompleted }: { isCompleted: boolean }) {
  return isCompleted ? <Stamp variant="closed">closed</Stamp> : <Stamp variant="active">active</Stamp>;
}

// ---------------------------------------------------------------------------
// confirm dialog (optionally typed-name gated, per Railbook confirmModal)
// ---------------------------------------------------------------------------

export interface ConfirmSpec {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Require typing this exact string to enable the confirm button. */
  typed?: string | null;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec; onClose: () => void }) {
  const [typedValue, setTypedValue] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = Boolean(spec.typed) && typedValue.trim() !== spec.typed;
  const run = async () => {
    setBusy(true);
    try {
      await spec.onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={spec.title}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            disabled={blocked || busy}
            onClick={() => void run()}
            style={
              spec.danger !== false
                ? { borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }
                : { borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)' }
            }
          >
            {busy ? '…' : (spec.confirmLabel ?? 'Confirm')}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>{spec.message}</div>
        {spec.typed ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>
              Type <b style={{ color: 'var(--text-primary)' }}>{spec.typed}</b> to confirm
            </span>
            <input autoComplete="off" value={typedValue} onChange={(e) => setTypedValue(e.target.value)} />
          </label>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// side drawer (Railbook .drawer)
// ---------------------------------------------------------------------------

export function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus moves into the drawer on open and returns to the trigger on close.
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <>
      <div className="tr-drawer-veil" onMouseDown={onClose} />
      <div className="tr-drawer" role="dialog" aria-modal="true" tabIndex={-1} ref={panelRef} style={{ outline: 'none' }}>
        {children}
      </div>
    </>
  );
}

export function DrawerHead({
  kicker,
  title,
  onClose,
}: {
  kicker: ReactNode;
  title: ReactNode;
  onClose: () => void;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div className="tr-kicker">{kicker}</div>
        <h2>{title}</h2>
      </div>
      <button className="btn btn-icon" title="Close" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// connection gate — every TestRail view mounts through this
// ---------------------------------------------------------------------------

export function useTestRail(): TestRailState {
  const st = useStore(trStore);
  useEffect(() => {
    void initTestRail();
  }, []);
  return st;
}

/** Loading / not-connected gate; renders children only when connected. */
export function TestRailGate({ st, children }: { st: TestRailState; children: ReactNode }) {
  if (st.phase === 'connected') return <>{children}</>;
  if (st.phase === 'disconnected') {
    return (
      <div className="card" style={{ maxWidth: 520, margin: '48px auto', padding: 28, textAlign: 'center' }}>
        <div className="tr-kicker">TestRail</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: '6px 0 8px' }}>Not connected</h2>
        <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          Add your TestRail URL, email and API key in Settings to open the case library.
        </div>
        <button className="btn btn-primary" onClick={() => navigate('settings')}>
          Open Settings
        </button>
      </div>
    );
  }
  return (
    <div className="muted" style={{ padding: 48, textAlign: 'center', fontSize: 13 }}>
      Loading TestRail…
    </div>
  );
}

export const pageHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
  marginBottom: 14,
};

export function PageTitle({ kicker, title, lede }: { kicker: ReactNode; title: ReactNode; lede?: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="tr-kicker">{kicker}</div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, margin: '2px 0 2px' }}>{title}</h1>
      {lede ? (
        <div className="muted" style={{ fontSize: 12.5 }}>
          {lede}
        </div>
      ) : null}
    </div>
  );
}

export { errText } from '../../lib/errors';

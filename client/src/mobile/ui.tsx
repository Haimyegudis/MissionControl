// Mobile design primitives.
//
// These are the whole vocabulary of the phone UI: a screen frame, a list card,
// a stat tile, a segmented control, a bottom sheet, and a few atoms. Every
// mobile screen is composed from them, which is what keeps six screens looking
// like one product rather than six retrofits.
//
// They use the existing theme tokens, so the phone inherits all three themes
// (dark, light, railbook) without a parallel palette.
//
// Rules baked in, so no screen has to remember them:
//   - 44px minimum touch target, with real spacing between adjacent targets
//   - touch-action: manipulation everywhere tappable (kills the 300ms delay)
//   - no hover-dependent affordances
//   - text wraps or truncates, never widens its container

import { useEffect, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { pushBackHandler } from './backHandler';

/* ---------------------------------------------------------------- scale --- */
/**
 * Fluid type. A 360px Android and a 430px Pro Max are both "mobile" but a
 * third apart in width, and the tablet case is wider still — fixed px sizes
 * are either cramped on one or wasteful on the other. clamp() gives a floor,
 * a viewport-relative middle and a ceiling, so one scale covers XS through MD.
 */
export const type = {
  title: 'clamp(1.15rem, 5.2vw, 1.6rem)',
  body: 'clamp(0.875rem, 3.7vw, 1rem)',
  meta: 'clamp(0.72rem, 3vw, 0.8rem)',
  stat: 'clamp(1.25rem, 6vw, 1.75rem)',
} as const;

/** Visible focus for keyboard and switch users; there is no hover to fall back on. */
export const focusRing: CSSProperties = { outline: 'none' };

/* -------------------------------------------------------------- screen --- */

export function Screen({
  title,
  kicker,
  action,
  children,
  scrollRef,
}: {
  title: string;
  kicker?: string;
  action?: ReactNode;
  children: ReactNode;
  scrollRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <header
        style={{
          flexShrink: 0,
          padding: '10px 14px 8px',
          borderBottom: '1px solid var(--border-soft)',
          background: 'var(--bg-panel)',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          {kicker ? (
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--accent-cyan)',
                fontWeight: 600,
              }}
            >
              {kicker}
            </div>
          ) : null}
          <h1
            style={{
              margin: 0,
              fontSize: type.title,
              lineHeight: 1.15,
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </h1>
        </div>
        {action ? <div style={{ flexShrink: 0, display: 'flex', gap: 8 }}>{action}</div> : null}
      </header>
      <div
        ref={scrollRef}
        className="mob-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          // Stops a scroll at the end of this list from dragging the page
          // behind it — the rubber-band effect that makes nested lists feel
          // broken on a phone.
          overscrollBehavior: 'contain',
          padding: '10px 12px calc(16px + env(safe-area-inset-bottom))',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- atoms --- */

export const tapReset: CSSProperties = {
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent',
};

export function Pill({ tone = 'muted', children }: { tone?: string; children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 9px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.5,
        color: tone,
        border: `1px solid ${tone}`,
        opacity: 0.95,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function Muted({ children, size = 11.5 }: { children: ReactNode; size?: number }) {
  return <span style={{ color: 'var(--muted)', fontSize: size }}>{children}</span>;
}

/* ------------------------------------------------------------ list card --- */

/**
 * The workhorse. One tappable record: a leading line of small meta, a title
 * that wraps to at most three lines, and a footer row of chips. Nothing is
 * ever truncated to a single unreadable line.
 */
export function ListCard({
  onClick,
  onLongPress,
  selected,
  lead,
  title,
  footer,
  accent,
}: {
  onClick?: () => void;
  onLongPress?: (at: { clientX: number; clientY: number }) => void;
  selected?: boolean;
  lead?: ReactNode;
  title: ReactNode;
  footer?: ReactNode;
  /** Colour of the 3px status rail down the left edge. */
  accent?: string;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let origin: { x: number; y: number } | null = null;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    origin = null;
  };

  const activate = () => onClick?.();

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className="mob-card"
      onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
      onClick={activate}
      onTouchStart={(e) => {
        if (!onLongPress) return;
        const t = e.touches[0];
        origin = { x: t.clientX, y: t.clientY };
        const at = { clientX: t.clientX, clientY: t.clientY };
        timer = setTimeout(() => onLongPress(at), 500);
      }}
      onTouchMove={(e) => {
        if (!origin) return;
        const t = e.touches[0];
        if (Math.abs(t.clientX - origin.x) > 10 || Math.abs(t.clientY - origin.y) > 10) cancel();
      }}
      onTouchEnd={cancel}
      onTouchCancel={cancel}
      style={{
        ...tapReset,
        position: 'relative',
        display: 'block',
        width: '100%',
        textAlign: 'left',
        border: `1px solid ${selected ? 'var(--accent-cyan)' : 'var(--border-soft)'}`,
        borderLeft: accent ? `3px solid ${accent}` : undefined,
        borderRadius: 12,
        background: 'var(--bg-panel)',
        padding: '11px 13px',
        marginBottom: 8,
        minHeight: 44,
        overflow: 'hidden',
      }}
    >
      {lead ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, minWidth: 0 }}>{lead}</div>
      ) : null}
      <div
        style={{
          fontSize: type.body,
          lineHeight: 1.35,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          overflowWrap: 'anywhere',
        }}
      >
        {title}
      </div>
      {footer ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', marginTop: 8 }}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ stat tile --- */

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(148px, 100%), 1fr))',
        gap: 8,
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        ...tapReset,
        border: '1px solid var(--border-soft)',
        borderRadius: 12,
        background: 'var(--bg-panel)',
        padding: '12px 13px',
        minHeight: 68,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: type.stat, fontWeight: 700, lineHeight: 1, color: tone ?? 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- segmented ------ */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        gap: 4,
        padding: 3,
        borderRadius: 10,
        background: 'var(--input-bg)',
        border: '1px solid var(--border-soft)',
        marginBottom: 10,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            style={{
              ...tapReset,
              flex: 1,
              minHeight: 38,
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: active ? 650 : 450,
              background: active ? 'var(--bg-panel-high)' : 'transparent',
              color: active ? 'var(--accent-cyan)' : 'var(--muted)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- sheet ------ */

/**
 * Bottom sheet. Filters, pickers and menus live here rather than in a cramped
 * inline toolbar — the "simplify, don't shrink" rule: a phone gets one thing at
 * a time, full width, with room to tap.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // The back gesture should dismiss the sheet before it touches navigation.
    const release = pushBackHandler(() => {
      onClose();
      return true;
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      release();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        background: 'rgba(2, 6, 20, 0.55)',
        display: 'flex',
        alignItems: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="mob-scroll"
        style={{
          width: '100%',
          maxHeight: '86dvh',
          overscrollBehavior: 'contain',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-panel-high)',
          borderRadius: '16px 16px 0 0',
          border: '1px solid var(--border-soft)',
          borderBottom: 'none',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 2px' }}>
          <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border-strong)' }} />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 14px 10px',
            borderBottom: '1px solid var(--border-soft)',
          }}
        >
          <div style={{ flex: 1, fontWeight: 650, fontSize: 15 }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ ...tapReset, minWidth: 44, minHeight: 44, border: 'none', background: 'none', color: 'var(--muted)', fontSize: 18 }}>
            ✕
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px' }}>{children}</div>
        {footer ? <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-soft)' }}>{footer}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ feedback --- */

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '56px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <Empty>{what}…</Empty>;
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div
      style={{
        border: '1px solid var(--accent-red)',
        borderRadius: 12,
        padding: '12px 14px',
        margin: '8px 0',
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <div style={{ color: 'var(--accent-red)', fontWeight: 600, marginBottom: 4 }}>Couldn’t load</div>
      <div style={{ overflowWrap: 'anywhere' }}>{children}</div>
      {onRetry ? (
        <button onClick={onRetry} className="btn" style={{ ...tapReset, marginTop: 10, minHeight: 40 }}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** Full-width primary action, e.g. the filter bar trigger. */
export function BarButton({
  onClick,
  children,
  badge,
}: {
  onClick: () => void;
  children: ReactNode;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        ...tapReset,
        width: '100%',
        minHeight: 44,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        border: '1px solid var(--border-soft)',
        borderRadius: 10,
        background: 'var(--bg-panel)',
        color: 'var(--text-primary)',
        fontSize: 13.5,
        marginBottom: 10,
      }}
    >
      {children}
      {badge ? (
        <span
          style={{
            minWidth: 20,
            height: 20,
            borderRadius: 10,
            background: 'var(--accent-cyan)',
            color: 'var(--bg-panel)',
            fontSize: 11,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 6px',
          }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

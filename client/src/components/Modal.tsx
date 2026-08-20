// Modal overlay (ui-parity §10.x dialogs): Esc close, click-outside close,
// light focus trap (Tab cycles within the panel).

import { useEffect, useId, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useIsNarrow } from '../lib/useViewport';

export interface ModalProps {
  title?: ReactNode;
  width?: number | string;
  maxHeight?: number | string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Close when the backdrop is clicked (default true). */
  closeOnBackdrop?: boolean;
}

/** Full-screen sheet geometry used below the mobile breakpoint. */
const sheetStyle: CSSProperties = {
  width: '100vw',
  maxWidth: '100vw',
  height: '100dvh',
  maxHeight: '100dvh',
  borderRadius: 0,
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  width = 640,
  maxHeight = '86vh',
  onClose,
  children,
  footer,
  closeOnBackdrop = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // On a phone a centred card wastes most of the screen and leaves the content
  // scrolling inside a scroll; a full-screen sheet is the native shape.
  const narrow = useIsNarrow();
  // Callers pass inline arrows for onClose; keep the latest in a ref so the
  // effect runs once — re-running it would re-focus the first field and steal
  // focus from whatever the user is typing in.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && panel) {
        const focusables = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (focusables.length === 0) return;
        const firstEl = focusables[0];
        const lastEl = focusables[focusables.length - 1];
        const activeEl = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (activeEl === firstEl || !panel.contains(activeEl))) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && activeEl === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(2, 6, 20, 0.6)',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? titleId : undefined}
        aria-label={title === undefined ? 'Dialog' : undefined}
        className="card card-high"
        style={{
          ...(narrow ? sheetStyle : { width, maxWidth: 'calc(100vw - 32px)', maxHeight }),
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
        }}
      >
        {title !== undefined ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-soft)',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            <div id={titleId} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            <button className="btn btn-icon" onClick={onClose} title="Close" aria-label="Close">
              ✕
            </button>
          </div>
        ) : null}
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer !== undefined ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              padding: '12px 16px',
              borderTop: '1px solid var(--border-soft)',
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

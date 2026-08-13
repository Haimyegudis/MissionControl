// Positioned popup menu with lazy submenus (ui-parity §2 row menu, §12.4, §12.10).

import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Lazy submenu loader — invoked on first hover. */
  submenu?: () => MenuEntry[] | Promise<MenuEntry[]>;
  /** Keep the menu open after onClick (checkbox-style items). */
  keepOpen?: boolean;
}

export type MenuEntry = MenuItem | 'separator';

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 4000,
  minWidth: 180,
  maxWidth: 380,
  maxHeight: 420,
  overflowY: 'auto',
  padding: '4px 0',
  background: 'var(--bg-panel-high)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-card)',
  backdropFilter: 'blur(14px)',
};

function MenuList({
  entries,
  x,
  y,
  onClose,
}: {
  entries: MenuEntry[];
  x: number;
  y: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ index: number; entries: MenuEntry[] | null; x: number; y: number } | null>(null);

  // Clamp to viewport after first paint.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth - 4) nx = Math.max(4, window.innerWidth - r.width - 4);
    if (ny + r.height > window.innerHeight - 4) ny = Math.max(4, window.innerHeight - r.height - 4);
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  const openSubmenu = (index: number, item: MenuItem, e: React.MouseEvent) => {
    if (!item.submenu || item.disabled) return;
    if (sub?.index === index) return;
    const row = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSub({ index, entries: null, x: row.right - 2, y: row.top - 4 });
    Promise.resolve(item.submenu()).then(
      (loaded) => setSub((cur) => (cur && cur.index === index ? { ...cur, entries: loaded } : cur)),
      () => setSub((cur) => (cur && cur.index === index ? { ...cur, entries: [{ label: 'Error', disabled: true }] } : cur)),
    );
  };

  return (
    <div ref={ref} style={{ ...menuStyle, left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {entries.map((entry, i) =>
        entry === 'separator' ? (
          <div key={i} style={{ height: 1, background: 'var(--border-soft)', margin: '4px 8px' }} />
        ) : (
          <div
            key={i}
            role="menuitem"
            aria-disabled={entry.disabled || undefined}
            onMouseEnter={(e) => {
              if (entry.submenu) openSubmenu(i, entry, e);
              else setSub(null);
            }}
            onClick={() => {
              if (entry.disabled) return;
              if (entry.submenu) return; // submenu items act via their children
              entry.onClick?.();
              if (!entry.keepOpen) onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '6px 14px',
              fontSize: 12.5,
              whiteSpace: 'nowrap',
              cursor: entry.disabled ? 'default' : 'pointer',
              color: entry.disabled ? 'var(--muted)' : 'var(--text-primary)',
              opacity: entry.disabled ? 0.6 : 1,
              background: sub?.index === i ? 'var(--bg-panel)' : 'transparent',
            }}
            onMouseOver={(e) => {
              if (!entry.disabled) (e.currentTarget as HTMLElement).style.background = 'var(--bg-panel-high)';
            }}
            onMouseOut={(e) => {
              (e.currentTarget as HTMLElement).style.background = sub?.index === i ? 'var(--bg-panel)' : 'transparent';
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.label}</span>
            {entry.submenu ? <span className="muted">▸</span> : null}
          </div>
        ),
      )}
      {sub ? (
        <MenuList
          entries={sub.entries ?? [{ label: 'Loading...', disabled: true }]}
          x={sub.x}
          y={sub.y}
          onClose={onClose}
        />
      ) : null}
    </div>
  );
}

export interface ContextMenuProps {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
}

/** Fixed-position context menu. Esc / outside-click close. */
export function ContextMenu({ x, y, entries, onClose }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div ref={rootRef}>
      <MenuList entries={entries} x={x} y={y} onClose={onClose} />
    </div>
  );
}

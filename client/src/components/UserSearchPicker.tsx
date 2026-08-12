// UserSearchPicker (ui-parity-contract.md §10.6).
// Placeholder "👤 Search users...", ✕ clear, dropdown of <=50 ci-substring
// matches (sorted). Opens on focus/keystroke when >=1 match. ↓ moves into the
// list; Enter in the box commits raw text, Enter in the list commits the
// selection; Esc closes; click commits. Empty commit = no filter.

import { useMemo, useRef, useState } from 'react';

export interface UserSearchPickerProps {
  /** Full roster of user display names. */
  users: string[];
  /** Committed value ('' = no filter). */
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  width?: number | string;
}

export function UserSearchPicker({
  users,
  value,
  onCommit,
  placeholder = '👤 Search users...',
  width = 220,
}: UserSearchPickerProps) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const lastCommitted = useRef(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Track external value changes (committed elsewhere).
  if (value !== lastCommitted.current) {
    lastCommitted.current = value;
    setText(value);
  }

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    const filtered = q ? users.filter((u) => u.toLowerCase().includes(q)) : [...users];
    filtered.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return filtered.slice(0, 50);
  }, [users, text]);

  const commit = (v: string) => {
    lastCommitted.current = v;
    setText(v);
    setOpen(false);
    setActive(-1);
    onCommit(v);
  };

  const maybeOpen = (nextText: string) => {
    const q = nextText.trim().toLowerCase();
    const any = q ? users.some((u) => u.toLowerCase().includes(q)) : users.length > 0;
    setOpen(any);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) maybeOpen(text);
      setActive((i) => Math.min(matches.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && active < matches.length) commit(matches[active]);
      else commit(text.trim());
    }
  };

  return (
    <div style={{ position: 'relative', width }}>
      <input
        ref={inputRef}
        value={text}
        placeholder={placeholder}
        style={{ width: '100%', paddingRight: 26 }}
        onFocus={() => maybeOpen(text)}
        onChange={(e) => {
          setText(e.target.value);
          setActive(-1);
          maybeOpen(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Delay so option mousedown/click wins over blur-close.
          setTimeout(() => setOpen(false), 120);
        }}
      />
      {text ? (
        <span
          title="Clear"
          onMouseDown={(e) => {
            e.preventDefault();
            commit('');
            inputRef.current?.focus();
          }}
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            cursor: 'pointer',
            color: 'var(--muted)',
            fontSize: 12,
          }}
        >
          ✕
        </span>
      ) : null}
      {open && matches.length > 0 ? (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            maxHeight: 260,
            overflowY: 'auto',
            zIndex: 3000,
            background: 'var(--bg-panel-high)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {matches.map((u, i) => (
            <div
              key={u}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(u);
              }}
              onMouseEnter={() => setActive(i)}
              style={{
                padding: '6px 10px',
                fontSize: 12.5,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                background: i === active ? 'rgba(31, 224, 224, 0.14)' : 'transparent',
              }}
            >
              {u}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Searchable user select keyed by TestRail user id: type to filter, click or
// Enter to pick, ✕ to clear. Replaces scroll-only <select> dropdowns.

import { useEffect, useMemo, useRef, useState } from 'react';

export interface UserIdPickerProps {
  /** [id, displayName] options, pre-sorted. */
  options: Array<[number, string]>;
  /** Selected id ('' = none). */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}

export function UserIdPicker({ options, value, onChange, placeholder = 'Type to search…' }: UserIdPickerProps) {
  const selectedName = useMemo(
    () => options.find(([id]) => String(id) === value)?.[1] ?? '',
    [options, value],
  );
  const [text, setText] = useState(selectedName);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => setText(selectedName), [selectedName]);

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    const list = q && q !== selectedName.toLowerCase()
      ? options.filter(([, name]) => name.toLowerCase().includes(q))
      : options;
    return list.slice(0, 50);
  }, [options, text, selectedName]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) {
        setOpen(false);
        setText(selectedName);
      }
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open, selectedName]);

  const pick = (id: number, name: string) => {
    onChange(String(id));
    setText(name);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div ref={host} style={{ position: 'relative' }}>
      <input
        style={{ width: '100%', paddingRight: 26 }}
        placeholder={placeholder}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const hit = matches[active >= 0 ? active : 0];
            if (hit) pick(hit[0], hit[1]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setText(selectedName);
          }
        }}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => {
            onChange('');
            setText('');
          }}
          style={{
            position: 'absolute',
            right: 4,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            color: 'var(--muted)',
            cursor: 'pointer',
            fontSize: 13,
            padding: 2,
          }}
        >
          ✕
        </button>
      ) : null}
      {open && matches.length > 0 ? (
        <div
          className="card card-high"
          style={{
            position: 'absolute',
            top: '105%',
            left: 0,
            right: 0,
            zIndex: 2500,
            maxHeight: 220,
            overflowY: 'auto',
            padding: 4,
          }}
        >
          {matches.map(([id, name], i) => (
            <div
              key={id}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(id, name);
              }}
              onMouseEnter={() => setActive(i)}
              style={{
                padding: '5px 10px',
                fontSize: 12.5,
                borderRadius: 6,
                cursor: 'pointer',
                background: i === active ? 'var(--bg-panel-high)' : 'transparent',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {name}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

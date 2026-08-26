// datetime-local input + explicit calendar button. The native picker
// indicator is easy to miss in the dark theme; the button opens the same
// native picker via showPicker().

import { useRef } from 'react';

export function DateTimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const el = ref.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        ref={ref}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1 }}
      />
      <button type="button" className="btn" onClick={openPicker} title="Pick date" aria-label="Pick date">
        📅
      </button>
    </div>
  );
}

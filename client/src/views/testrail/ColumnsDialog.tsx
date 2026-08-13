// Column chooser dialog (Railbook columnsModal). Toggles persist through the
// store's setVisibleCols (localStorage 'deck.tr.cols').

import { Modal } from '../../components/Modal';

export interface ColumnsDialogProps {
  cols: Array<{ key: string; label: string; always?: boolean }>;
  visible: string[];
  onChange: (visible: string[]) => void;
  onClose: () => void;
}

export function ColumnsDialog({ cols, visible, onChange, onClose }: ColumnsDialogProps) {
  return (
    <Modal
      title="Table columns"
      width={380}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {cols.map((c) => (
        <label
          key={c.key}
          style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0', fontSize: 13 }}
        >
          <input
            type="checkbox"
            checked={c.always || visible.includes(c.key)}
            disabled={c.always}
            onChange={(e) => {
              onChange(e.target.checked ? [...visible, c.key] : visible.filter((k) => k !== c.key));
            }}
          />
          {c.label}
          {c.always ? (
            <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
              always
            </span>
          ) : null}
        </label>
      ))}
    </Modal>
  );
}

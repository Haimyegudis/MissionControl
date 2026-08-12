// Epic chip (ui-parity §1 card anatomy): deterministic HSL-hash background,
// black/white foreground by luminance, text = EpicName ?? EpicKey, max-width
// 220 ellipsis, tooltip = EpicKey.

import { epicLabelColor } from '../lib/colors';

export interface EpicChipProps {
  epicKey: string;
  epicName?: string | null;
}

export function EpicChip({ epicKey, epicName }: EpicChipProps) {
  const { bg, fg } = epicLabelColor(epicKey);
  return (
    <span
      title={epicKey}
      style={{
        display: 'inline-block',
        maxWidth: 220,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        background: bg,
        color: fg,
        borderRadius: 999,
        padding: '1px 8px',
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '16px',
        verticalAlign: 'middle',
      }}
    >
      {epicName || epicKey}
    </span>
  );
}

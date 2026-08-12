// 8x8 aging dot (ui-parity §12.8 AgingDot, visibility mode): rendered only when
// the issue has not been updated for >=3 days; hidden for epoch/min dates.
// Tooltip: "Stalling — not updated recently".

import { agingColor, agingDotVisible } from '../lib/colors';

export interface AgingDotProps {
  updated: string | null | undefined;
}

export function AgingDot({ updated }: AgingDotProps) {
  if (!agingDotVisible(updated)) return null;
  const color = agingColor(updated);
  if (!color) return null;
  return (
    <span
      title="Stalling — not updated recently"
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        flex: '0 0 auto',
      }}
    />
  );
}

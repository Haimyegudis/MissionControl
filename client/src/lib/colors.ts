// Color converters (ui-parity-contract.md §12.8). Pure functions — unit tested.

const MS_PER_DAY = 86_400_000;

/**
 * Whole days since `updatedIso` (local clock). Returns null for null/empty,
 * unparseable, or epoch/min sentinel dates (getTime() <= 0).
 */
export function daysSinceUpdate(updatedIso: string | null | undefined, now: Date = new Date()): number | null {
  if (!updatedIso) return null;
  const d = new Date(updatedIso);
  const t = d.getTime();
  if (Number.isNaN(t) || t <= 0) return null;
  return Math.floor((now.getTime() - t) / MS_PER_DAY);
}

/**
 * AgingDot color: >=7 days `#EF4444`, >=3 `#F59E0B`, else `#10B981`.
 * Null for missing/epoch dates (dot hidden entirely).
 */
export function agingColor(updatedIso: string | null | undefined, now: Date = new Date()): string | null {
  const days = daysSinceUpdate(updatedIso, now);
  if (days === null) return null;
  if (days >= 7) return '#EF4444';
  if (days >= 3) return '#F59E0B';
  return '#10B981';
}

/** Visibility mode: show the dot only when the issue is stalling (>=3 days). */
export function agingDotVisible(updatedIso: string | null | undefined, now: Date = new Date()): boolean {
  const days = daysSinceUpdate(updatedIso, now);
  return days !== null && days >= 3;
}

/**
 * PriorityToBrush: highest/critical/blocker `#EF4444` · high/s3 `#FFA13A` ·
 * medium/s4 `#FFD23A` · low/s5/s6/default `#8AA0BF`. Case-insensitive substring.
 */
/** Chip color per issue type — epics must be visually distinct from tasks. */
export function issueTypeColor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('epic')) return '#b558f6';
  if (t.includes('story')) return '#22d38f';
  if (t.includes('bug') || t.includes('defect') || t.includes('incident')) return '#e5484d';
  if (t.includes('sub')) return '#8aa0bf';
  return '#4f9cf9'; // task & everything else
}

export function priorityColor(priority: string | null | undefined): string {
  const p = (priority ?? '').toLowerCase();
  if (p.includes('highest') || p.includes('critical') || p.includes('blocker')) return '#EF4444';
  if (p.includes('high') || p.includes('s3')) return '#FFA13A';
  if (p.includes('medium') || p.includes('s4')) return '#FFD23A';
  return '#8AA0BF';
}

/**
 * StatusToBrush: done|closed|delivered `#22D38F` · blocked|rejected `#EF4444` ·
 * progress|review `#1FE0E0` · default `#8AA0BF`. Case-insensitive substring.
 */
export function statusColor(status: string | null | undefined): string {
  const s = (status ?? '').toLowerCase();
  if (s.includes('done') || s.includes('closed') || s.includes('delivered')) return '#22D38F';
  if (s.includes('blocked') || s.includes('rejected')) return '#EF4444';
  if (s.includes('progress') || s.includes('review')) return '#1FE0E0';
  return '#8AA0BF';
}

function hslToRgb(hDeg: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((hDeg % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

function toHex(unit: number): string {
  return Math.round(Math.min(1, Math.max(0, unit)) * 255)
    .toString(16)
    .padStart(2, '0');
}

/**
 * LabelColor (epic chips): deterministic HSL hash of the key.
 * `h = 23; h = h*31 + lower(charCode)` (32-bit wrap), `hue = (h & 0xFFFF)/65535*360`,
 * HSL(hue, .55, .45); fg Black when luminance (.2126R+.7152G+.0722B) > .55 else White.
 */
export function epicLabelColor(key: string | null | undefined): { bg: string; fg: string } {
  const text = (key ?? '').toLowerCase();
  let h = 23;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  }
  const hue = ((h & 0xffff) / 65535) * 360;
  const [r, g, b] = hslToRgb(hue, 0.55, 0.45);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return {
    bg: `#${toHex(r)}${toHex(g)}${toHex(b)}`,
    fg: luminance > 0.55 ? '#000000' : '#FFFFFF',
  };
}

/** StarColor: Gold when starred, LightGray otherwise. */
export function starColor(isStarred: boolean): string {
  return isStarred ? '#FFD700' : '#D3D3D3';
}

/** Chart palette, fixed order (ui-parity §12.3). Never cycled per-rank. */
export const CHART_PALETTE = [
  '#6366F1', // indigo
  '#06B6D4', // cyan
  '#F59E0B', // amber
  '#10B981', // emerald
  '#EC4899', // pink
  '#EF4444', // red
  '#64748B', // slate
] as const;

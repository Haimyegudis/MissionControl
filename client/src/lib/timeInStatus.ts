// Time-in-Status field parser. The Jira "Time in Status" plugin stores its
// data as an opaque string: entries separated by `_*|*_`, fields by `_*:*_`
// in the shape  statusId _*:*_ timesEntered _*:*_ totalMillis.
// We parse it and render "Status — 21d 4h (entered 2×)" rows instead.

export interface TimeInStatusEntry {
  statusId: string;
  count: number;
  millis: number;
}

/** Null when the value is not a Time-in-Status raw string. */
export function parseTimeInStatus(raw: string | null | undefined): TimeInStatusEntry[] | null {
  if (!raw || !raw.includes('_*:*_')) return null;
  const entries: TimeInStatusEntry[] = [];
  for (const part of raw.split('_*|*_')) {
    const bits = part.split('_*:*_');
    if (bits.length < 3) return null;
    const [statusId, countStr, millisStr] = bits;
    const count = Number(countStr);
    const millis = Number(millisStr);
    if (!/^\d+$/.test(statusId.trim()) || !Number.isFinite(count) || !Number.isFinite(millis)) return null;
    entries.push({ statusId: statusId.trim(), count, millis });
  }
  // Longest stay first — that's what people scan for.
  return entries.sort((a, b) => b.millis - a.millis);
}

/** "29d 18h" / "3h 12m" / "12m" / "<1m". */
export function fmtDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '<1m';
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rem = mins % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
  return `${rem}m`;
}

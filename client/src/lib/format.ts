// Minimal formatting helpers (fuller set arrives with Task B2).

/**
 * TimeSpanFormat (ui-parity §12.8): `0m` for null/zero, else
 * `{H}h {M}m` / `{H}h` / `{M}m`.
 */
export function formatTimeSpan(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '0m';
  const totalMinutes = Math.floor(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/** .NET 'g'-style general date/time (short): `M/d/yyyy h:mm AM`. */
export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} ${time}`;
}

/** `HH:mm:ss` wall-clock stamp (top-bar "Last refresh"). */
export function formatClock(d: Date | null | undefined): string {
  if (!d) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** `hh:mm:ss` elapsed formatting (pomodoro widget). */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/**
 * RecentSummary (ui-parity §12.8): strip a leading issue-key prefix and
 * `: - ` punctuation from a summary.
 */
export function trimRecentSummary(key: string, summary: string): string {
  let s = summary ?? '';
  if (key && s.toUpperCase().startsWith(key.toUpperCase())) {
    s = s.slice(key.length);
  }
  return s.replace(/^[\s:\-–]+/, '').trim() || summary;
}

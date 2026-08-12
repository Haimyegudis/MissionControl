// Jira time notation — port of MissionControl JiraTimeFormat.TryParse and
// TimeSpanFormatConverter. docs/reference/ui-parity-contract.md §12.5 / §12.8.

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isSpace(c: string): boolean {
  return /\s/.test(c);
}

/**
 * Parse Jira's "1h 30m" / "2h" / "45m" / "30s" / "1.5h" / "1,5h" notation
 * into total seconds. Units: w = 5x8h, d = 8h, h, m, s. Unknown units
 * contribute 0; a trailing bare number is treated as hours.
 * Returns null when the total is <= 0 or a numeric token is unparseable.
 */
export function parseJiraTime(raw: string | null | undefined): number | null {
  if (!raw || raw.trim().length === 0) return null;
  let total = 0;
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && isSpace(raw[i]!)) i++;
    if (i >= raw.length) break;
    const start = i;
    while (i < raw.length && (isDigit(raw[i]!) || raw[i] === '.' || raw[i] === ',')) i++;
    if (start === i) return null;
    const numText = raw.slice(start, i).replace(/,/g, '.');
    const num = Number(numText);
    if (!Number.isFinite(num)) return null;
    while (i < raw.length && isSpace(raw[i]!)) i++;
    if (i >= raw.length) {
      total += num * 3600; // trailing bare number = hours
      break;
    }
    const unit = raw[i]!.toLowerCase();
    i++;
    switch (unit) {
      case 'w':
        total += num * 5 * 8 * 3600;
        break;
      case 'd':
        total += num * 8 * 3600;
        break;
      case 'h':
        total += num * 3600;
        break;
      case 'm':
        total += num * 60;
        break;
      case 's':
        total += num;
        break;
      default:
        break; // unknown unit contributes 0
    }
  }
  return total <= 0 ? null : total;
}

/**
 * Format seconds as a compact Jira-style span:
 * null/0 -> "0m"; else "{H}h {M}m" / "{H}h" / "{M}m". Hours accumulate
 * beyond 24; leftover seconds are truncated.
 */
export function formatTimeSpan(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds === 0) return '0m';
  const hours = Math.trunc(seconds / 3600);
  const minutes = Math.trunc((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

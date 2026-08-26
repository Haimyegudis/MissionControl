// Shared pure formatting/date helpers for the B4b views (Boards, Filters,
// Recent Updates, Time Spent, Dashboards, Team, Settings). Mirrors the .NET
// format strings used by the WPF view models.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** .NET `0.##` — round to 2 decimals, trim trailing zeros. */
export function fmtHours(value: number): string {
  const r = Math.round(value * 100) / 100;
  // Avoid "-0" for tiny negative values.
  return String(r === 0 ? 0 : r);
}

/** .NET `0.#` — round to 1 decimal, trim trailing zero. */
export function fmtHours1(value: number): string {
  const r = Math.round(value * 10) / 10;
  return String(r === 0 ? 0 : r);
}

/** Timesheet cell display: `0` when <= 0, else `0.##` (WPF TimesheetDayCell). */
export function hoursDisplay(value: number): string {
  return value <= 0 ? '0' : fmtHours(value);
}

/** Local-date key `yyyy-MM-dd`. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parse a `yyyy-MM-dd` key as a local date (midnight). */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** Sunday-start week (timesheet parity, §12.6). */
export function startOfWeekSunday(d: Date): Date {
  return addDays(d, -d.getDay());
}

/** .NET `ddd dd MMM` — e.g. `Tue 12 Aug`. */
export function formatDayShort(d: Date): string {
  return `${DAY_NAMES[d.getDay()]} ${pad2(d.getDate())} ${MONTH_NAMES[d.getMonth()]}`;
}

/** .NET `ddd dd MMM yyyy` — e.g. `Tue 12 Aug 2026`. */
export function formatDayLong(d: Date): string {
  return `${formatDayShort(d)} ${d.getFullYear()}`;
}

/** .NET `d/MMM/yy` — e.g. `9/Aug/26` (weekly-timesheet pill). */
export function formatDMmmYy(d: Date): string {
  return `${d.getDate()}/${MONTH_NAMES[d.getMonth()]}/${pad2(d.getFullYear() % 100)}`;
}

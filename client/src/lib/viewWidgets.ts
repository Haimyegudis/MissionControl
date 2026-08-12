// Settings — dashboard-widget reorderable checkbox list logic (ui-parity §14).
// Pure and unit tested; the view renders the toggles and calls these helpers.

export const ALL_DASHBOARD_WIDGETS = [
  'OpenIssues',
  'Critical',
  'OnHold',
  'UpdatedToday',
  'LoggedToday',
  'LoggedThisWeek',
] as const;

export interface WidgetToggle {
  id: string;
  enabled: boolean;
}

/** Legacy id `"Blocked"` is migrated to `"OnHold"` on read (§1). */
export function migrateWidgetId(id: string): string {
  return id === 'Blocked' ? 'OnHold' : id;
}

/**
 * Build the toggle list: enabled widgets first in their saved order, then the
 * remaining known widgets unchecked. Legacy ids migrated, duplicates dropped.
 */
export function buildWidgetToggles(enabled: readonly string[]): WidgetToggle[] {
  const seen = new Set<string>();
  const toggles: WidgetToggle[] = [];
  for (const raw of enabled) {
    const id = migrateWidgetId(raw);
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    toggles.push({ id, enabled: true });
  }
  for (const id of ALL_DASHBOARD_WIDGETS) {
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    toggles.push({ id, enabled: false });
  }
  return toggles;
}

/** Move the toggle at `index` by `delta` (▲ = −1, ▼ = +1). No-op out of range. */
export function moveWidget(list: readonly WidgetToggle[], index: number, delta: -1 | 1): WidgetToggle[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

/** Flip a toggle's enabled flag. */
export function toggleWidget(list: readonly WidgetToggle[], index: number): WidgetToggle[] {
  return list.map((w, i) => (i === index ? { ...w, enabled: !w.enabled } : w));
}

/** Persisted value: enabled ids in display order. */
export function enabledWidgetIds(list: readonly WidgetToggle[]): string[] {
  return list.filter((w) => w.enabled).map((w) => w.id);
}

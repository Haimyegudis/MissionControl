// Settings — dashboard-widget reorderable list logic (ui-parity §14).

import { describe, expect, it } from 'vitest';
import {
  ALL_DASHBOARD_WIDGETS,
  buildWidgetToggles,
  enabledWidgetIds,
  migrateWidgetId,
  moveWidget,
  toggleWidget,
} from '../src/lib/viewWidgets';

describe('buildWidgetToggles', () => {
  it('enabled first in saved order, then remaining known widgets unchecked', () => {
    const toggles = buildWidgetToggles(['LoggedToday', 'OpenIssues']);
    expect(toggles.map((t) => t.id)).toEqual([
      'LoggedToday',
      'OpenIssues',
      'Critical',
      'OnHold',
      'UpdatedToday',
      'LoggedThisWeek',
    ]);
    expect(toggles.map((t) => t.enabled)).toEqual([true, true, false, false, false, false]);
  });

  it('migrates legacy "Blocked" to "OnHold" on read', () => {
    expect(migrateWidgetId('Blocked')).toBe('OnHold');
    const toggles = buildWidgetToggles(['Blocked', 'Critical']);
    expect(toggles[0]).toEqual({ id: 'OnHold', enabled: true });
    // OnHold must not appear twice.
    expect(toggles.filter((t) => t.id === 'OnHold')).toHaveLength(1);
  });

  it('drops duplicates', () => {
    const toggles = buildWidgetToggles(['OpenIssues', 'OpenIssues']);
    expect(toggles.filter((t) => t.id === 'OpenIssues')).toHaveLength(1);
    expect(toggles).toHaveLength(ALL_DASHBOARD_WIDGETS.length);
  });
});

describe('moveWidget', () => {
  const list = buildWidgetToggles(['OpenIssues', 'Critical']);

  it('moves up and down', () => {
    expect(moveWidget(list, 1, -1)[0].id).toBe('Critical');
    expect(moveWidget(list, 0, 1)[1].id).toBe('OpenIssues');
  });

  it('no-op at the edges', () => {
    expect(moveWidget(list, 0, -1).map((t) => t.id)).toEqual(list.map((t) => t.id));
    expect(moveWidget(list, list.length - 1, 1).map((t) => t.id)).toEqual(list.map((t) => t.id));
  });

  it('does not mutate the input', () => {
    const before = list.map((t) => t.id);
    moveWidget(list, 1, -1);
    expect(list.map((t) => t.id)).toEqual(before);
  });
});

describe('toggleWidget / enabledWidgetIds', () => {
  it('flips one flag and persists enabled ids in display order', () => {
    let list = buildWidgetToggles(['OpenIssues', 'Critical']);
    list = toggleWidget(list, 2); // enable third entry
    list = toggleWidget(list, 0); // disable OpenIssues
    expect(enabledWidgetIds(list)).toEqual(['Critical', 'OnHold']);
  });
});

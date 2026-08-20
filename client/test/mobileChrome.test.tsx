import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { BottomTabs, MOBILE_TABS } from '../src/components/BottomTabs';
import { MOBILE_ROUTE_IDS } from '../src/router';

describe('BottomTabs', () => {
  it('renders exactly the Phase 1 tabs, in order', () => {
    expect(MOBILE_TABS.map((t) => t.id)).toEqual(['mywork', 'testrail-runs', 'settings']);
  });

  it('renders a labelled button per tab', () => {
    const html = renderToString(<BottomTabs active="mywork" />);
    expect(html).toContain('Backlog');
    expect(html).toContain('Runs');
    expect(html).toContain('Settings');
  });

  it('marks the active tab with aria-current', () => {
    const html = renderToString(<BottomTabs active="testrail-runs" />);
    expect(html).toContain('aria-current="page"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('every tab is a reachable mobile route', () => {
    for (const tab of MOBILE_TABS) expect(MOBILE_ROUTE_IDS.has(tab.id)).toBe(true);
  });
});

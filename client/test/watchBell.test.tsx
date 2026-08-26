// WatchBell markup: clear-all visibility and the prominent change line.
import { describe, expect, it } from 'vitest';
import { describeEventTitle } from '../src/components/WatchBell';
import type { WatchEvent } from '../src/types';

function ev(partial: Partial<WatchEvent>): WatchEvent {
  return {
    id: 'A-1:status:t',
    kind: 'status',
    key: 'A-1',
    summary: 'Some issue',
    from: 'In Progress',
    to: 'Done',
    at: new Date().toISOString(),
    ...partial,
  };
}

describe('describeEventTitle', () => {
  it('prefixes field changes with the kind label', () => {
    expect(describeEventTitle(ev({}))).toBe('Status: In Progress → Done');
    expect(describeEventTitle(ev({ kind: 'priority', from: 'P3', to: 'P1' }))).toBe('Priority: P3 → P1');
    expect(describeEventTitle(ev({ kind: 'sprint', from: 'S1', to: 'S2' }))).toBe('Sprint: S1 → S2');
    expect(describeEventTitle(ev({ kind: 'dueDate', from: null, to: '2026-09-01' }))).toBe('Due date: due 2026-09-01');
  });
  it('keeps sentence forms for assignment and comments', () => {
    expect(describeEventTitle(ev({ kind: 'assigned' }))).toBe('now assigned to you');
    expect(describeEventTitle(ev({ kind: 'comment', from: '2', to: '4' }))).toBe('2 new comment(s)');
  });
});

// Alerts & reminders config sanitization (reminders.ts) — pure parts only;
// scheduled-task plumbing is exercised manually on Windows.

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, sanitize, sanitizeRule, sanitizeTaskAlerts } from '../src/reminders.js';

describe('sanitizeRule', () => {
  it('accepts a valid rule', () => {
    const rule = sanitizeRule({ enabled: true, days: ['mon', 'WED'], time: '08:15' }, DEFAULT_CONFIG.logWork);
    expect(rule).toEqual({ enabled: true, days: ['MON', 'WED'], time: '08:15' });
  });

  it('falls back on invalid days/time and non-boolean enabled', () => {
    const rule = sanitizeRule({ enabled: 'yes', days: ['XXX'], time: '25:99' }, DEFAULT_CONFIG.logWork);
    expect(rule.enabled).toBe(false);
    expect(rule.days).toEqual(DEFAULT_CONFIG.logWork.days);
    expect(rule.time).toBe(DEFAULT_CONFIG.logWork.time);
  });

  it('handles null/undefined raw', () => {
    expect(sanitizeRule(undefined, DEFAULT_CONFIG.todo).enabled).toBe(false);
    expect(sanitizeRule(null, DEFAULT_CONFIG.todo).time).toBe(DEFAULT_CONFIG.todo.time);
  });
});

describe('sanitizeTaskAlerts', () => {
  it('keeps valid alerts, uppercases keys, strips risky note chars', () => {
    const alerts = sanitizeTaskAlerts([
      { key: 'isw-123', date: '2026-08-20', time: '14:30', note: 'check "this" `now` $x' },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('ISW-123');
    expect(alerts[0].note).not.toContain('"');
    expect(alerts[0].note).not.toContain('`');
    expect(alerts[0].note).not.toContain('$');
    expect(alerts[0].note).toContain('check');
  });

  it('drops invalid key/date/time entries and non-arrays', () => {
    expect(
      sanitizeTaskAlerts([
        { key: 'not a key', date: '2026-08-20', time: '14:30' },
        { key: 'ISW-1', date: '20-08-2026', time: '14:30' },
        { key: 'ISW-1', date: '2026-08-20', time: '9:30' },
      ]),
    ).toEqual([]);
    expect(sanitizeTaskAlerts('nope')).toEqual([]);
    expect(sanitizeTaskAlerts(undefined)).toEqual([]);
  });

  it('caps at 20 alerts', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      key: `ISW-${i + 1}`,
      date: '2026-08-20',
      time: '10:00',
    }));
    expect(sanitizeTaskAlerts(many)).toHaveLength(20);
  });
});

describe('sanitize (full config)', () => {
  it('maps the legacy flat shape to logWork', () => {
    const config = sanitize({ enabled: true, days: ['FRI'], time: '11:00' });
    expect(config.logWork).toEqual({ enabled: true, days: ['FRI'], time: '11:00' });
    expect(config.inProgress.enabled).toBe(false);
    expect(config.todo.enabled).toBe(false);
    expect(config.taskAlerts).toEqual([]);
  });

  it('reads the new multi-alert shape', () => {
    const config = sanitize({
      logWork: { enabled: false, days: ['MON'], time: '16:00' },
      inProgress: { enabled: true, days: ['TUE'], time: '10:30' },
      todo: { enabled: true, days: ['WED'], time: '09:00' },
      taskAlerts: [{ key: 'ISW-9', date: '2026-09-01', time: '12:00' }],
    });
    expect(config.logWork.enabled).toBe(false);
    expect(config.inProgress).toEqual({ enabled: true, days: ['TUE'], time: '10:30' });
    expect(config.todo).toEqual({ enabled: true, days: ['WED'], time: '09:00' });
    expect(config.taskAlerts).toEqual([{ key: 'ISW-9', date: '2026-09-01', time: '12:00' }]);
  });

  it('empty payload → everything disabled with defaults', () => {
    const config = sanitize({});
    expect(config.logWork.enabled).toBe(false);
    expect(config.inProgress.enabled).toBe(false);
    expect(config.todo.enabled).toBe(false);
    expect(config.taskAlerts).toEqual([]);
  });
});

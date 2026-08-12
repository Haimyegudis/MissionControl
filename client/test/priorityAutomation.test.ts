import { describe, expect, it } from 'vitest';
import {
  computePriority,
  environmentBoost,
  reproducibilityBoost,
  severityTier,
} from '../src/lib/priorityAutomation';

describe('priority automation (ui-parity §10.2)', () => {
  it('maps severity tiers', () => {
    expect(severityTier('S1 - Critical')).toBe(1);
    expect(severityTier('S2')).toBe(2);
    expect(severityTier('S3')).toBe(3);
    expect(severityTier('S4')).toBe(4);
    expect(severityTier('S5')).toBe(5);
    expect(severityTier('S6')).toBe(6);
    expect(severityTier('Critical')).toBe(1);
    expect(severityTier('Highest')).toBe(1);
    expect(severityTier('High')).toBe(2);
    expect(severityTier('Medium')).toBe(3);
    expect(severityTier('Low')).toBe(4);
    expect(severityTier('Lowest')).toBe(5);
    expect(severityTier('whatever')).toBe(3);
  });

  it('maps environment boosts', () => {
    expect(environmentBoost('Production')).toBe(-1);
    expect(environmentBoost('Customer')).toBe(-1);
    expect(environmentBoost('Lab')).toBe(1);
    expect(environmentBoost('Test')).toBe(1);
    expect(environmentBoost('Development')).toBe(0);
  });

  it('maps reproducibility boosts', () => {
    expect(reproducibilityBoost('Always')).toBe(-1);
    expect(reproducibilityBoost('Often')).toBe(0);
    expect(reproducibilityBoost('Sometimes')).toBe(1);
    expect(reproducibilityBoost('Once')).toBe(1);
    expect(reproducibilityBoost('Rare')).toBe(1);
    expect(reproducibilityBoost('Did not try')).toBe(0);
  });

  it('clamps the sum to 1..5 and names the tier', () => {
    // S1 + Production + Always = 1 - 1 - 1 = -1 → clamp 1 → Highest
    expect(computePriority('S1', 'Production', 'Always')).toBe('Highest');
    // S3 + Development + Often = 3 → Medium
    expect(computePriority('S3', 'Development', 'Often')).toBe('Medium');
    // S6 + Lab + Rare = 6 + 1 + 1 = 8 → clamp 5 → Lowest
    expect(computePriority('S6', 'Lab', 'Rare')).toBe('Lowest');
    // S2 + Customer + Always = 2 - 1 - 1 = 0 → clamp 1 → Highest
    expect(computePriority('S2', 'Customer', 'Always')).toBe('Highest');
    // S4 + Test + Sometimes = 4 + 1 + 1 = 6 → clamp 5 → Lowest
    expect(computePriority('S4', 'Test', 'Sometimes')).toBe('Lowest');
    // S3 + Production + Always = 3 - 1 - 1 = 1 → Highest
    expect(computePriority('S3', 'Production', 'Always')).toBe('Highest');
  });

  it('returns null unless all three drivers are set', () => {
    expect(computePriority('S1', 'Production', null)).toBeNull();
    expect(computePriority('S1', '', 'Always')).toBeNull();
    expect(computePriority(null, 'Production', 'Always')).toBeNull();
  });
});

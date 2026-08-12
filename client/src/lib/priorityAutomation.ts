// Create-issue priority automation (ui-parity §10.2) — pure, unit tested.
//
//   sevTier:   S1|CRITICAL|HIGHEST=1, S2|HIGH=2, S3|MEDIUM=3, S4|LOW=4,
//              S5|LOWEST=5, S6=6, else 3
//   envBoost:  Production=-1, Customer=-1, Lab=+1, Test=+1, else 0
//   reproBoost: Always=-1, Often=0, Sometimes=+1, Once=+1, Rare=+1, else 0
//   tier = clamp(sum, 1, 5) → 1 Highest, 2 High, 3 Medium, 4 Low, 5 Lowest

const TIER_NAMES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'] as const;

export function severityTier(severity: string): number {
  const s = severity.toUpperCase();
  if (s.includes('S1')) return 1;
  if (s.includes('S2')) return 2;
  if (s.includes('S3')) return 3;
  if (s.includes('S4')) return 4;
  if (s.includes('S5')) return 5;
  if (s.includes('S6')) return 6;
  // Word forms: check the longer tokens before their substrings.
  if (s.includes('HIGHEST') || s.includes('CRITICAL')) return 1;
  if (s.includes('LOWEST')) return 5;
  if (s.includes('HIGH')) return 2;
  if (s.includes('MEDIUM')) return 3;
  if (s.includes('LOW')) return 4;
  return 3;
}

export function environmentBoost(environment: string): number {
  const e = environment.toUpperCase();
  if (e.includes('PRODUCTION')) return -1;
  if (e.includes('CUSTOMER')) return -1;
  if (e.includes('LAB')) return 1;
  if (e.includes('TEST')) return 1;
  return 0;
}

export function reproducibilityBoost(reproducibility: string): number {
  const r = reproducibility.toUpperCase();
  if (r.includes('ALWAYS')) return -1;
  if (r.includes('OFTEN')) return 0;
  if (r.includes('SOMETIMES')) return 1;
  if (r.includes('ONCE')) return 1;
  if (r.includes('RARE')) return 1;
  return 0;
}

/**
 * Suggested priority name for the given drivers, or null unless all three are
 * non-empty (automation only runs when Severity + Environment + Reproducibility
 * are all set).
 */
export function computePriority(
  severity: string | null | undefined,
  environment: string | null | undefined,
  reproducibility: string | null | undefined,
): string | null {
  if (!severity || !environment || !reproducibility) return null;
  const sum = severityTier(severity) + environmentBoost(environment) + reproducibilityBoost(reproducibility);
  const tier = Math.min(5, Math.max(1, sum));
  return TIER_NAMES[tier - 1];
}

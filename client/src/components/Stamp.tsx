// Status stamp (Phase 3 — unified-deck plan T14/T16). Variants map onto the
// theme's status accents; the Railbook theme gives them the field-manual
// stamp look through var(--font-mono) + uppercase + border in theme.css.

export type StampVariant =
  | 'pass'
  | 'fail'
  | 'blocked'
  | 'retest'
  | 'untested'
  | 'active'
  | 'closed'
  | 'neverran'
  | 'neutral';

/** TestRail status ids: 1 pass, 2 blocked, 3 untested, 4 retest, 5 fail. */
export function statusVariant(statusId: number | null | undefined): StampVariant {
  switch (statusId) {
    case 1:
      return 'pass';
    case 2:
      return 'blocked';
    case 3:
      return 'untested';
    case 4:
      return 'retest';
    case 5:
      return 'fail';
    default:
      return 'neutral';
  }
}

export function Stamp({ variant, children }: { variant: StampVariant; children: React.ReactNode }) {
  return <span className={`stamp s-${variant}`}>{children}</span>;
}

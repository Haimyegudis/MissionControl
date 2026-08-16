// Jira-key linkifier for TestRail References strings — "ISW-123, ISW-456"
// becomes clickable keys opening the in-app issue dialog.

import { dialogs } from '../dialogs/DialogHost';

const KEY_RE = /([A-Z][A-Z0-9_]+-\d+)/g;

export function RefLinks({ refs }: { refs: string | null | undefined }) {
  if (!refs || !refs.trim()) return <>—</>;
  const parts = refs.split(KEY_RE);
  return (
    <>
      {parts.map((part, i) =>
        /^[A-Z][A-Z0-9_]+-\d+$/.test(part) ? (
          <a
            key={i}
            href={`#${part}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dialogs.openIssueDetails(part);
            }}
            style={{ color: 'var(--accent-cyan)', textDecoration: 'underline' }}
            title={`Open ${part} in Jira view`}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

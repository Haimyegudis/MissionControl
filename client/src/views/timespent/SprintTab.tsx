// Current-sprint issues with Estimated/Logged/Remaining bars and a one-click
// Start (To Do → In Progress). Follows the user picker ('' = me).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { issues as issuesApi, metadataExtra } from '../../api/client';
import { dialogs } from '../../dialogs/DialogHost';
import { statusColor } from '../../lib/colors';
import { errText } from '../../lib/errors';
import { formatTimeSpan } from '../../lib/format';
import { activeSprintRange, pickStartTransition, sprintBars, sprintJql } from '../../lib/viewTimeSpentTabs';
import { getSettings } from '../../stores/settings';
import { pushToast } from '../../stores/toasts';
import type { JiraIssue } from '../../types';

const BARS: Array<{ key: 'estimated' | 'logged' | 'remaining'; label: string; color: string }> = [
  { key: 'estimated', label: 'Estimated', color: 'var(--accent-cyan)' },
  { key: 'logged', label: 'Logged', color: 'var(--accent-green)' },
  { key: 'remaining', label: 'Remaining', color: 'var(--accent-red)' },
];

export function SprintTab({ user }: { user: string }) {
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const loadGenRef = useRef(0);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setBusy(true);
    setError(null);
    try {
      let resolvedUser: string | null = null;
      if (user.trim()) {
        const resolved = await metadataExtra.resolveUser(user).catch(() => ({ username: null }));
        resolvedUser = resolved.username ?? user;
      }
      const project = getSettings().defaultProjectKey || 'ISW';
      const jql = sprintJql(project, resolvedUser);
      const page = await issuesApi.search(jql, 0, 100);
      if (gen === loadGenRef.current) setIssues(page.items ?? []);
    } catch (e) {
      if (gen === loadGenRef.current) setError(errText(e));
    } finally {
      if (gen === loadGenRef.current) setBusy(false);
    }
  }, [user]);

  loadRef.current = load;

  useEffect(() => {
    void load();
    return () => { loadGenRef.current++; };
  }, [load]);

  const sprint = useMemo(() => activeSprintRange(issues), [issues]);

  const start = async (issue: JiraIssue) => {
    setStartingKey(issue.key);
    try {
      const transitions = await issuesApi.transitions(issue.key);
      const t = pickStartTransition(transitions);
      if (!t) {
        pushToast({ title: 'No transition', body: `No transition to In Progress available for ${issue.key}.` });
        return;
      }
      const screen = await issuesApi.transitionScreen(issue.key, t.id);
      const hasRequired = screen.some((f) => f.required && f.id !== 'comment');
      if (hasRequired) {
        dialogs.openTransition(issue.key, t, screen, () => void loadRef.current());
      } else {
        await issuesApi.performTransition(issue.key, { id: t.id });
        pushToast({ title: issue.key, body: `Moved to ${t.toStatus ?? 'In Progress'}.` });
        await loadRef.current();
      }
    } catch (e) {
      pushToast({ title: 'Transition failed', body: errText(e) });
    } finally {
      setStartingKey(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>
          Current sprint{sprint ? ` — ${sprint.name} (${sprint.start} → ${sprint.end})` : ''}
        </span>
        {busy ? <span className="accent-cyan">…</span> : null}
        <span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>{issues.length} issue(s)</span>
      </div>
      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}
      {issues.length === 0 && !busy ? (
        <div className="muted" style={{ fontSize: 12.5 }}>No issues in the current sprint.</div>
      ) : (
        issues.map((issue) => {
          const bars = sprintBars(issue);
          const isTodo = issue.statusCategory === 'new';
          return (
            <div key={issue.key} className="card" style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => dialogs.openIssueDetails(issue.key)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12.5 }}
                >
                  {issue.key}
                </button>
                <span style={{ flex: 1, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{issue.summary}</span>
                <span
                  style={{
                    padding: '1px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
                    color: statusColor(issue.status), border: `1px solid ${statusColor(issue.status)}`,
                  }}
                >
                  {issue.status}
                </span>
                {isTodo ? (
                  <button className="btn" disabled={startingKey === issue.key} onClick={() => void start(issue)} style={{ fontSize: 11.5 }}>
                    ▶ Start
                  </button>
                ) : null}
                <button
                  className="btn"
                  style={{ fontSize: 11.5 }}
                  onClick={() =>
                    dialogs.openLogWork(issue.key, {
                      remainingEstimate: issue.remainingEstimate,
                      onLogged: () => void loadRef.current(),
                    })
                  }
                >
                  + Log
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8 }}>
                {BARS.map((b) => (
                  <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="muted" style={{ fontSize: 10.5, width: 62 }}>{b.label}:</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--border-soft)', overflow: 'hidden' }}>
                      <div style={{ width: `${bars[`${b.key}Pct` as const]}%`, height: '100%', background: b.color }} />
                    </div>
                    <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', width: 52, textAlign: 'right' }}>
                      {formatTimeSpan(bars[b.key])}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

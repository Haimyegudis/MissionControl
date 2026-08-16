// Issue details dialog (ui-parity §10.1) — large modal (~90vw/90vh), 3fr/2fr
// body, per-dialog back/forward history, transitions, comments, worklogs,
// timeline, all-fields, sanitized description HTML, MRU recording.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { issues as issuesApi } from '../api/client';
import { trApi } from '../api/testrail';
import { fmtDuration, parseTimeInStatus } from '../lib/timeInStatus';
import { IssueTestRailPanel } from './IssueTestRailPanel';
import type { TrRun } from '../testrailTypes';
import { Modal } from '../components/Modal';
import { IssueLinkText } from '../components/IssueLinkText';
import { priorityColor, statusColor } from '../lib/colors';
import { descriptionCss, prepareDescriptionHtml } from '../lib/descriptionHtml';
import { formatDateTime, formatTimeSpan } from '../lib/format';
import { getSettings, updateSettings } from '../stores/settings';
import type { JiraIssueDetails, JiraTransition } from '../types';
import { useDialogs } from './DialogHost';

export interface IssueDetailsProps {
  /** Requested key; `seq` bumps on every openIssueDetails call. */
  request: { key: string; seq: number };
  onClose: () => void;
}

const DESC_SCOPE = 'jw-issue-desc';

/** MRU (ui-parity §10.1): dedup newest-first, cap 10, mirror recentIssueKeys. */
function recordMru(key: string, summary: string): void {
  const current = getSettings();
  const list = [{ key, summary }, ...(current.recentIssues ?? []).filter((r) => r.key !== key)].slice(0, 10);
  updateSettings({ recentIssues: list, recentIssueKeys: list.map((r) => r.key) }).catch(() => {
    /* MRU persistence is best-effort */
  });
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function KV({ label, children, labelWidth = 110 }: { label: string; children: ReactNode; labelWidth?: number }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 12.5 }}>
      <div className="muted" style={{ width: labelWidth, flexShrink: 0 }}>
        {label}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
    </div>
  );
}

interface LoadState {
  loading: boolean;
  error: string | null;
  details: JiraIssueDetails | null;
}

export function IssueDetails({ request, onClose }: IssueDetailsProps) {
  const dialogs = useDialogs();
  const [currentKey, setCurrentKey] = useState(request.key);
  const backRef = useRef<string[]>([]);
  const forwardRef = useRef<string[]>([]);
  const [, forceHistoryRender] = useState(0);
  const [state, setState] = useState<LoadState>({ loading: true, error: null, details: null });
  const [transitionStatus, setTransitionStatus] = useState('');
  const [commentText, setCommentText] = useState('');
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [trRuns, setTrRuns] = useState<TrRun[]>([]);
  const [trCases, setTrCases] = useState<
    Array<{ id: number; title: string; suiteId: number; suiteName: string; projectId: number }>
  >([]);
  const [statusNames, setStatusNames] = useState<Record<string, string>>({});

  // Status id → name (for the Time-in-Status field) — fetched once.
  useEffect(() => {
    fetch('/api/metadata/status-map')
      .then((r) => (r.ok ? r.json() : {}))
      .then((m) => setStatusNames(m ?? {}))
      .catch(() => {});
  }, []);
  const [commentStatus, setCommentStatus] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const loadSeq = useRef(0);

  /** Push only when the key differs (§10.1 navigation history). */
  const navigateTo = useCallback((key: string) => {
    setCurrentKey((prev) => {
      if (prev === key) return prev;
      backRef.current.push(prev);
      forwardRef.current = [];
      forceHistoryRender((n) => n + 1);
      return key;
    });
  }, []);

  const goBack = () => {
    const prev = backRef.current.pop();
    if (prev === undefined) return;
    setCurrentKey((cur) => {
      forwardRef.current.push(cur);
      forceHistoryRender((n) => n + 1);
      return prev;
    });
  };

  const goForward = () => {
    const next = forwardRef.current.pop();
    if (next === undefined) return;
    setCurrentKey((cur) => {
      backRef.current.push(cur);
      forceHistoryRender((n) => n + 1);
      return next;
    });
  };

  // External openIssueDetails while the dialog is open → in-dialog navigation.
  useEffect(() => {
    navigateTo(request.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.seq]);

  const load = useCallback(async (key: string): Promise<JiraIssueDetails | null> => {
    const seq = ++loadSeq.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const details = await issuesApi.details(key);
      if (loadSeq.current !== seq) return null;
      setState({ loading: false, error: null, details });
      recordMru(details.issue.key, details.issue.summary);
      return details;
    } catch (err) {
      if (loadSeq.current !== seq) return null;
      setState({ loading: false, error: err instanceof Error ? err.message : String(err), details: null });
      return null;
    }
  }, []);

  useEffect(() => {
    setTransitionStatus('');
    setCommentStatus('');
    setCommentText('');
    void load(currentKey);
  }, [currentKey, load]);

  const details = state.details;
  const issue = details?.issue ?? null;

  // TestRail runs referencing this issue (via run refs) — best-effort, cached.
  // For epics the match also covers every child issue key, so runs created
  // against the epic's stories/tasks surface on the epic itself.
  useEffect(() => {
    let cancelled = false;
    setTrRuns([]);
    setTrCases([]);
    const key = details?.issue.key;
    if (!key) return;
    const isEpic = /epic/i.test(details?.issue.issueType ?? '');
    (async () => {
      try {
        const needles = new Set<string>([key.toUpperCase()]);
        if (isEpic) {
          try {
            const children = await issuesApi.search(
              `"Epic Link" = ${key} OR parent = ${key}`,
              0,
              200,
            );
            for (const child of children.items) needles.add(child.key.toUpperCase());
          } catch {
            /* epic children lookup is best-effort */
          }
        }
        const projects = (await trApi.projects()).filter((p) => /indigo/i.test(p.name) || p.id === 603);
        const lists = await Promise.all(projects.map((p) => trApi.runs(p.id).catch(() => [] as TrRun[])));
        // Match by refs OR run name — many runs carry the key in their title.
        const noSpace = (s: string) => s.replace(/\s+/g, '');
        const matches = lists.flat().filter((r) => {
          const hay = noSpace(`${r.refs ?? ''} ${r.name ?? ''}`).toUpperCase();
          if (!hay) return false;
          for (const n of needles) if (hay.includes(noSpace(n))) return true;
          return false;
        });
        matches.sort((a, b) => (b.createdOn ?? 0) - (a.createdOn ?? 0));
        if (!cancelled) setTrRuns(matches.slice(0, 12));

        // Linked cases — the Jira TestRail plugin links via case References.
        // Cases get copied between program suites keeping the same refs, so
        // the issue's Program field scopes the list: an epic on Kedem shows
        // only the Kedem suite's cases, not the David/S4 duplicates.
        try {
          let cases = await trApi.casesByRef(key, projects.map((p) => p.id));
          const programs = (details?.allFields.find((f) => f.key.trim().toLowerCase() === 'program')?.value ?? '')
            .split(',')
            .map((p) => p.trim().toLowerCase())
            .filter(Boolean);
          if (programs.length > 0) {
            const scoped = cases.filter((c) => {
              const suite = c.suiteName.toLowerCase();
              const project = (c.projectName ?? '').toLowerCase();
              return programs.some((p) => suite.includes(p) || p.includes(suite) || project.includes(p));
            });
            if (scoped.length > 0) cases = scoped;
          }
          if (!cancelled) setTrCases(cases);
        } catch {
          /* section stays hidden */
        }
      } catch {
        /* TestRail not connected — section simply stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [details?.issue.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadWithStatus = useCallback(async () => {
    const fresh = await load(currentKey);
    if (fresh) setTransitionStatus(`Status: ${fresh.issue.status}`);
  }, [currentKey, load]);

  const runTransition = async (t: JiraTransition) => {
    try {
      const screen = await issuesApi.transitionScreen(currentKey, t.id);
      if (screen.length > 0) {
        dialogs.openTransition(currentKey, t, screen, () => {
          void reloadWithStatus();
        });
        return;
      }
      await issuesApi.performTransition(currentKey, { id: t.id });
      await reloadWithStatus();
    } catch {
      alert('Transition failed');
    }
  };

  const copyKey = () => {
    void navigator.clipboard?.writeText(currentKey);
  };

  const openInJira = () => {
    if (details?.browseUrl) window.open(details.browseUrl, '_blank', 'noopener,noreferrer');
  };

  const addComment = async () => {
    if (!commentText.trim() || commentBusy) return;
    setCommentBusy(true);
    setCommentStatus('');
    try {
      await issuesApi.addComment(currentKey, commentText);
      setCommentText('');
      setCommentStatus('Comment added.');
      await load(currentKey);
    } catch (err) {
      setCommentStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCommentBusy(false);
    }
  };

  const openIssue = (key: string) => navigateTo(key);

  const title = (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
      <span style={{ color: 'var(--accent-cyan)', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {issue ? `${issue.projectKey} / ${issue.key}` : currentKey}
      </span>
      <span
        style={{
          fontSize: 20,
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {issue?.summary ?? ''}
      </span>
    </div>
  );

  const barBtn: CSSProperties = { whiteSpace: 'nowrap' };

  return (
    <Modal width="90vw" maxHeight="90vh" onClose={onClose} title={title} closeOnBackdrop={false}>
      <style>{descriptionCss(DESC_SCOPE)}</style>

      {/* -------------------------------------------------- action bar ----- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <button className="btn btn-icon" title="Back" onClick={goBack} disabled={backRef.current.length === 0}>
          ◀
        </button>
        <button
          className="btn btn-icon"
          title="Forward"
          onClick={goForward}
          disabled={forwardRef.current.length === 0}
        >
          ▶
        </button>

        {(details?.transitions ?? []).map((t) => (
          <button
            key={t.id}
            className="btn btn-primary"
            style={barBtn}
            title={`Move to: ${t.toStatus ?? ''}`}
            onClick={() => void runTransition(t)}
          >
            {t.name}
          </button>
        ))}

        <button
          className="btn"
          style={barBtn}
          onClick={() =>
            dialogs.openLogWork(currentKey, {
              remainingEstimate: issue?.remainingEstimate ?? null,
              onLogged: () => void load(currentKey),
            })
          }
        >
          Log work
        </button>
        <button className="btn" style={barBtn} onClick={copyKey}>
          Copy key
        </button>
        <button className="btn" style={barBtn} onClick={openInJira} disabled={!details?.browseUrl}>
          Open in Jira
        </button>

        {transitionStatus && (
          <span style={{ color: 'var(--accent-green)', fontSize: 12.5 }}>{transitionStatus}</span>
        )}
      </div>

      {state.loading && (
        <div className="muted" style={{ padding: 24, textAlign: 'center' }}>
          Loading {currentKey}…
        </div>
      )}
      {state.error && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--accent-red)' }}>{state.error}</div>
      )}

      {details && issue && !state.loading && (
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14, alignItems: 'start' }}>
          {/* ------------------------------------------------ left column -- */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            {details.parentKey && (
              <SectionCard title={details.parentFieldLabel ?? 'Parent'}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    openIssue(details.parentKey!);
                  }}
                  style={{ color: 'var(--accent-cyan)', textDecoration: 'underline', fontSize: 13 }}
                >
                  {details.parentKey} — {details.parentSummary ?? ''}
                </a>
              </SectionCard>
            )}

            <SectionCard title="Details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 20 }}>
                <KV label="Type">{issue.issueType}</KV>
                <KV label="Status">
                  <span style={{ color: statusColor(issue.status), fontWeight: 600 }}>{issue.status}</span>
                </KV>
                <KV label="Priority">
                  <span style={{ color: priorityColor(issue.priority), fontWeight: 600 }}>{issue.priority}</span>
                </KV>
                <KV label="Severity">{issue.severity ?? ''}</KV>
                <KV label="Sprint">{issue.sprint ?? ''}</KV>
                <KV label="Reject Reasons">{issue.rejectReasons ?? ''}</KV>
              </div>
            </SectionCard>

            {details.allFields.length > 0 && (
              <SectionCard title="All fields">
                {details.allFields.map((f) => {
                  const tis = parseTimeInStatus(f.value);
                  return (
                    <KV key={f.key} label={f.key} labelWidth={200}>
                      {tis ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {tis.map((e) => (
                            <div key={e.statusId} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                              <span style={{ minWidth: 130 }}>{statusNames[e.statusId] ?? `Status ${e.statusId}`}</span>
                              <b>{fmtDuration(e.millis)}</b>
                              {e.count > 1 ? <span className="muted">entered {e.count}×</span> : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <IssueLinkText text={f.value} onOpenIssue={openIssue} />
                      )}
                    </KV>
                  );
                })}
              </SectionCard>
            )}

            <SectionCard title="Description">
              {details.descriptionHtml ? (
                <div
                  className={DESC_SCOPE}
                  // Sanitized + URL-rewritten by prepareDescriptionHtml.
                  dangerouslySetInnerHTML={{
                    __html: prepareDescriptionHtml(details.descriptionHtml, details.browseUrl),
                  }}
                />
              ) : details.description ? (
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{details.description}</div>
              ) : (
                <div className="muted">(no description)</div>
              )}
            </SectionCard>

            {details.timeline.length > 0 && (
              <SectionCard title="Activity timeline">
                <button
                  className="btn"
                  style={{ marginBottom: 6 }}
                  onClick={() => setTimelineOpen((v) => !v)}
                >
                  {timelineOpen ? '▾ Hide' : `▸ Show ${details.timeline.length} events`}
                </button>
                {timelineOpen && details.timeline.map((ev, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '4px 0', fontSize: 12.5 }}>
                    <div
                      style={{
                        width: 64,
                        flexShrink: 0,
                        color: 'var(--accent-cyan)',
                        fontWeight: 600,
                        textTransform: 'lowercase',
                      }}
                    >
                      {ev.kind}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>{ev.summary}</div>
                    <div className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {ev.author} · {formatDateTime(ev.when)}
                    </div>
                  </div>
                ))}
              </SectionCard>
            )}

            {(trRuns.length > 0 || trCases.length > 0) && (
              <SectionCard title="TestRail">
                <IssueTestRailPanel
                  issueKey={issue.key}
                  issueSummary={issue.summary}
                  runs={trRuns}
                  cases={trCases}
                  onNavigate={onClose}
                />
              </SectionCard>
            )}

            <SectionCard title="Comments">
              {details.comments.length === 0 && <div className="muted">No comments.</div>}
              {details.comments.map((c, i) => (
                <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ display: 'flex', gap: 8, fontSize: 11.5, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600 }}>{c.author}</span>
                    <span className="muted">{formatDateTime(c.created)}</span>
                  </div>
                  <div style={{ fontSize: 12.5 }}>
                    <IssueLinkText text={c.body} onOpenIssue={openIssue} />
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Add a comment…"
                  style={{ height: 64, resize: 'vertical', width: '100%' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button className="btn" onClick={() => void addComment()} disabled={commentBusy || !commentText.trim()}>
                    Add comment
                  </button>
                  {commentStatus && (
                    <span
                      style={{
                        fontSize: 12,
                        color: commentStatus.startsWith('Failed') ? 'var(--accent-red)' : 'var(--accent-green)',
                      }}
                    >
                      {commentStatus}
                    </span>
                  )}
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Worklogs">
              {details.worklogs.length === 0 && <div className="muted">No work logged.</div>}
              {details.worklogs.map((w) => (
                <div key={w.id} style={{ display: 'flex', gap: 10, padding: '3px 0', fontSize: 12.5 }}>
                  <div style={{ width: 160, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {w.author}
                  </div>
                  <div className="muted" style={{ width: 140, flexShrink: 0 }}>
                    {formatDateTime(w.started)}
                  </div>
                  <div style={{ width: 70, flexShrink: 0, color: 'var(--accent-green)', fontWeight: 600 }}>
                    {formatTimeSpan(w.timeSpent)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }} className="muted">
                    {w.comment ?? ''}
                  </div>
                </div>
              ))}
            </SectionCard>
          </div>

          {/* ----------------------------------------------- right column -- */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <SectionCard title="People">
              <KV label="Assignee">{issue.assignee ?? 'Unassigned'}</KV>
              <KV label="Reporter">{issue.reporter ?? ''}</KV>
            </SectionCard>

            <SectionCard title="Dates">
              <KV label="Created">{formatDateTime(issue.created)}</KV>
              <KV label="Updated">{formatDateTime(issue.updated)}</KV>
            </SectionCard>

            <SectionCard title="Time Tracking">
              <KV label="Logged">
                <span style={{ color: 'var(--accent-green)' }}>{formatTimeSpan(issue.timeSpent)}</span>
              </KV>
              <KV label="Remaining">{formatTimeSpan(issue.remainingEstimate)}</KV>
            </SectionCard>
          </div>
        </div>
      )}
    </Modal>
  );
}

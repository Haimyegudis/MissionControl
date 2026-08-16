// Command palette (ui-parity §11) — 660px modal, 180ms debounce with
// cancellation. Groups: NAV (navigation entries), JIRA (live issue search),
// RECENT (settings MRU). Pomodoro pick mode retitles and routes activation.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { issues as issuesApi } from '../api/client';
import { Modal } from '../components/Modal';
import { navigate, ROUTES, TESTRAIL_ROUTES, type RouteId } from '../router';
import { settingsStore } from '../stores/settings';
import { allLoadedCases, openCase, trStore } from '../stores/testrail';
import { useStore } from '../stores/useStore';
import { useDialogs } from './DialogHost';

export type PaletteMode = 'default' | 'pomodoro';

export interface PaletteRow {
  group: string;
  key: string;
  label: string;
  /** Issue type chip (Epic / Task / Bug / …) shown after the key. */
  badge?: string;
  action?: () => void;
}

/** Chip color per issue type — epics must be visually distinct from tasks. */
export function issueTypeColor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('epic')) return '#b558f6';
  if (t.includes('story')) return '#22d38f';
  if (t.includes('bug') || t.includes('defect') || t.includes('incident')) return '#e5484d';
  if (t.includes('sub')) return '#8aa0bf';
  return '#4f9cf9'; // task & everything else
}

const ISSUE_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** JQL for the JIRA group (§11): exact key match prepended for key-like queries. */
export function paletteJql(query: string): string {
  const q = query.replace(/"/g, '\\"');
  return ISSUE_KEY_RE.test(query.trim())
    ? `key = "${query.trim().toUpperCase()}" OR summary ~ "${q}*"`
    : `summary ~ "${q}*"`;
}

export interface CommandPaletteProps {
  mode?: PaletteMode;
  onClose: () => void;
  /** Issue rows (JIRA + RECENT) activate through here (host decides: open vs pomodoro). */
  onPickIssue: (key: string) => void;
}

export function CommandPalette({ mode = 'default', onClose, onPickIssue }: CommandPaletteProps) {
  const dialogs = useDialogs();
  const appSettings = useStore(settingsStore);
  const [query, setQuery] = useState('');
  const [jiraRows, setJiraRows] = useState<PaletteRow[]>([]);
  const [selected, setSelected] = useState(-1);
  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickIssue = (key: string) => onPickIssue(key);

  // NAV group — hidden in pomodoro pick mode.
  const navRows = useMemo<PaletteRow[]>(() => {
    if (mode === 'pomodoro') return [];
    const q = query.trim().toLowerCase();
    const entries: Array<{ id: RouteId | 'help'; label: string }> = [
      ...ROUTES,
      ...TESTRAIL_ROUTES.map((r) => ({ id: r.id, label: `TestRail ${r.label}` })),
      { id: 'help', label: 'Help' },
    ];
    return entries
      .filter((r) => !q || r.label.toLowerCase().includes(q))
      .map((r) => ({
        group: 'NAV',
        key: '',
        label: r.label,
        action: () => {
          onClose();
          if (r.id === 'help') dialogs.openHelp();
          else navigate(r.id);
        },
      }));
  }, [mode, query, onClose, dialogs]);

  // TESTRAIL group — cached cases of the loaded suites, by title or C-id.
  const trState = useStore(trStore);
  const testrailRows = useMemo<PaletteRow[]>(() => {
    if (mode === 'pomodoro') return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const idQ = q.replace(/^c/i, '');
    const rows: PaletteRow[] = [];
    for (const { suiteId, c } of allLoadedCases(trState)) {
      if (c.title.toLowerCase().includes(q) || String(c.id) === idQ) {
        rows.push({
          group: 'TESTRAIL',
          key: `C${c.id}`,
          label: c.title,
          action: () => {
            openCase(c.id, c.suiteId ?? suiteId);
            navigate('testrail-cases');
          },
        });
        if (rows.length >= 8) break;
      }
    }
    return rows;
  }, [mode, query, trState]);

  // RECENT group.
  const recentRows = useMemo<PaletteRow[]>(() => {
    const q = query.trim().toLowerCase();
    return (appSettings.recentIssues ?? [])
      .filter((r) => !q || r.key.toLowerCase().includes(q) || r.summary.toLowerCase().includes(q))
      .map((r) => ({
        group: 'RECENT',
        key: r.key,
        label: r.summary,
        action: () => pickIssue(r.key),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, appSettings.recentIssues]);

  // JIRA group — debounce 180ms; stale responses discarded via seq token.
  useEffect(() => {
    const q = query.trim();
    const seq = ++seqRef.current;
    if (!q) {
      setJiraRows([]);
      return;
    }
    const timer = setTimeout(() => {
      issuesApi.search(paletteJql(q), 0, 10).then(
        (page) => {
          if (seqRef.current !== seq) return;
          setJiraRows(
            page.items.map((i) => ({
              group: 'JIRA',
              key: i.key,
              label: i.summary,
              badge: i.issueType || undefined,
              action: () => pickIssue(i.key),
            })),
          );
        },
        (err) => {
          if (seqRef.current !== seq) return;
          setJiraRows([
            { group: 'ERROR', key: '', label: err instanceof Error ? err.message : String(err) },
          ]);
        },
      );
    }, 180);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const rows = useMemo(
    () => [...navRows, ...jiraRows, ...testrailRows, ...recentRows],
    [navRows, jiraRows, testrailRows, recentRows],
  );

  useEffect(() => {
    setSelected((s) => (rows.length === 0 ? -1 : Math.min(Math.max(s, -1), rows.length - 1)));
  }, [rows]);

  const activate = (row: PaletteRow | undefined) => {
    row?.action?.();
    if (row && row.group !== 'ERROR' && row.group !== 'NAV') onClose();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(rows[selected >= 0 ? selected : 0]);
    }
  };

  return (
    <Modal width={660} maxHeight={440} onClose={onClose} title={mode === 'pomodoro' ? 'Pick issue for Pomodoro' : undefined}>
      <div onKeyDown={onKeyDown} style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(-1);
          }}
          placeholder={mode === 'pomodoro' ? 'Search issue to track…' : 'Search…'}
          style={{ width: '100%' }}
        />

        <div style={{ flex: 1, minHeight: 200, overflowY: 'auto' }}>
          {rows.map((row, i) => (
            <div
              key={`${row.group}:${row.key}:${i}`}
              onClick={() => setSelected(i)}
              onDoubleClick={() => activate(row)}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                cursor: 'pointer',
                background: i === selected ? 'var(--bg-panel-high)' : 'transparent',
              }}
            >
              <div
                style={{
                  width: 130,
                  flexShrink: 0,
                  fontWeight: 700,
                  fontSize: 11,
                  color: row.group === 'ERROR' ? 'var(--accent-red)' : 'var(--accent-cyan)',
                }}
              >
                {row.group}
              </div>
              <div className="muted" style={{ width: 80, flexShrink: 0, fontWeight: 700, fontSize: 12 }}>
                {row.key}
              </div>
              {row.badge ? (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    padding: '1px 7px',
                    borderRadius: 999,
                    border: `1px solid ${issueTypeColor(row.badge)}`,
                    color: issueTypeColor(row.badge),
                  }}
                >
                  {row.badge}
                </span>
              ) : null}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 12.5,
                }}
              >
                {row.label}
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="muted" style={{ padding: 16, textAlign: 'center', fontSize: 12.5 }}>
              No results.
            </div>
          )}
        </div>

        <div className="muted" style={{ fontSize: 11.5, textAlign: 'center' }}>
          Type to search Jira · Enter to open · Esc to close
        </div>
      </div>
    </Modal>
  );
}

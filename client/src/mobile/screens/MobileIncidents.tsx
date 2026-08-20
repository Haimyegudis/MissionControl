// Incidents. Three buckets behind a segmented control, filters in a sheet.
//
// The desktop screen stacks all three buckets as separate paged grids with a
// row of dropdown filters above them. On a phone that is three tables and a
// filter wall, so the buckets become segments — one list at a time — and the
// filters move into a bottom sheet with a count badge, which is the
// "simplify, don't shrink" rule applied literally.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, incidents as incidentsApi } from '../../api/client';
import { dialogs } from '../../dialogs/DialogHost';
import { priorityColor, statusColor } from '../../lib/colors';
import type { JiraFilterDefinition, JiraIssue } from '../../types';
import {
  BarButton,
  Empty,
  ErrorNote,
  ListCard,
  Loading,
  Muted,
  Pill,
  Screen,
  Segmented,
  Sheet,
  tapReset,
} from '../ui';

type Bucket = 'all' | 'verification' | 'rejected';

interface Buckets {
  all: JiraIssue[];
  verification: JiraIssue[];
  rejected: JiraIssue[];
}

const EMPTY: Buckets = { all: [], verification: [], rejected: [] };

export function MobileIncidents() {
  const [bucket, setBucket] = useState<Bucket>('all');
  const [data, setData] = useState<Buckets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [defs, setDefs] = useState<JiraFilterDefinition[]>([]);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [optionsFor, setOptionsFor] = useState<{ id: string; label: string; values: string[] } | null>(null);

  const activeCount = useMemo(
    () => Object.values(selections).filter((v) => v.length > 0).length,
    [selections],
  );

  const load = useCallback(async (sel: Record<string, string[]>) => {
    setBusy(true);
    setError(null);
    try {
      const payload = Object.entries(sel)
        .filter(([, values]) => values.length > 0)
        .map(([filterId, values]) => ({ filterId, values }));
      setData(await incidentsApi.search(payload, null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(selections);
    // Filter definitions are static; fetch once and tolerate failure.
    api
      .get<JiraFilterDefinition[]>('/api/incidents/definitions')
      .then(setDefs)
      .catch(() => setDefs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = (data ?? EMPTY)[bucket];

  return (
    <Screen
      kicker="Jira"
      title="Incidents"
      action={
        <button
          className="btn"
          onClick={() => void load(selections)}
          disabled={busy}
          style={{ ...tapReset, minHeight: 40 }}
        >
          {busy ? '…' : '↻'}
        </button>
      }
    >
      <Segmented
        value={bucket}
        options={[
          { value: 'all', label: `Open ${data ? `(${data.all.length})` : ''}`.trim() },
          { value: 'verification', label: `Verify ${data ? `(${data.verification.length})` : ''}`.trim() },
          { value: 'rejected', label: `Rejected ${data ? `(${data.rejected.length})` : ''}`.trim() },
        ]}
        onChange={setBucket}
      />

      <BarButton onClick={() => setFiltersOpen(true)} badge={activeCount || undefined}>
        Filters
      </BarButton>

      {error ? <ErrorNote onRetry={() => void load(selections)}>{error}</ErrorNote> : null}
      {!data && !error ? <Loading what="Loading incidents" /> : null}

      {data && rows.length === 0 ? <Empty>No incidents in this bucket.</Empty> : null}

      {rows.map((issue) => (
        <ListCard
          key={issue.key}
          accent={priorityColor(issue.priority)}
          onClick={() => dialogs.openIssueDetails(issue.key)}
          lead={
            <>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 700 }}>
                {issue.key}
              </span>
              <Muted>{issue.issueType}</Muted>
            </>
          }
          title={issue.summary}
          footer={
            <>
              <Pill tone={statusColor(issue.status)}>{issue.status}</Pill>
              {issue.priority ? <Pill tone={priorityColor(issue.priority)}>{issue.priority}</Pill> : null}
              {issue.assignee ? <Muted>{issue.assignee}</Muted> : null}
            </>
          }
        />
      ))}

      {/* ------------------------------------------------------- filters --- */}
      <Sheet
        open={filtersOpen}
        title="Filters"
        onClose={() => setFiltersOpen(false)}
        footer={
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              style={{ ...tapReset, flex: 1, minHeight: 44 }}
              onClick={() => {
                setSelections({});
                void load({});
                setFiltersOpen(false);
              }}
            >
              Clear all
            </button>
            <button
              className="btn btn-primary"
              style={{ ...tapReset, flex: 2, minHeight: 44, justifyContent: 'center' }}
              onClick={() => {
                void load(selections);
                setFiltersOpen(false);
              }}
            >
              Apply
            </button>
          </div>
        }
      >
        {defs.length === 0 ? (
          <Muted>No filters available.</Muted>
        ) : (
          defs.map((def) => {
            const chosen = selections[def.id] ?? [];
            return (
              <button
                key={def.id}
                onClick={() => void openOptions(def)}
                style={{
                  ...tapReset,
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  gap: 10,
                  minHeight: 52,
                  padding: '10px 2px',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid var(--border-soft)',
                  color: 'var(--text-primary)',
                  textAlign: 'left',
                }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{def.displayName}</span>
                <span style={{ fontSize: 12, color: chosen.length ? 'var(--accent-cyan)' : 'var(--muted)' }}>
                  {chosen.length ? `${chosen.length} selected` : 'Any'}
                </span>
                <span aria-hidden style={{ color: 'var(--muted)' }}>
                  ›
                </span>
              </button>
            );
          })
        )}
      </Sheet>

      {/* ------------------------------------------------ option picker --- */}
      <Sheet
        open={optionsFor !== null}
        title={optionsFor?.label ?? ''}
        onClose={() => setOptionsFor(null)}
      >
        {optionsFor === null ? null : optionsFor.values.length === 0 ? (
          <Muted>No options.</Muted>
        ) : (
          optionsFor.values.map((value) => {
            const chosen = (selections[optionsFor.id] ?? []).includes(value);
            return (
              <label
                key={value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  minHeight: 48,
                  padding: '6px 2px',
                  borderBottom: '1px solid var(--border-soft)',
                }}
              >
                <input
                  type="checkbox"
                  checked={chosen}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setSelections((prev) => {
                      const cur = new Set(prev[optionsFor.id] ?? []);
                      if (on) cur.add(value);
                      else cur.delete(value);
                      return { ...prev, [optionsFor.id]: [...cur] };
                    });
                  }}
                />
                <span style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{value}</span>
              </label>
            );
          })
        )}
      </Sheet>
    </Screen>
  );

  async function openOptions(def: JiraFilterDefinition) {
    setOptionsFor({ id: def.id, label: def.displayName, values: [] });
    try {
      const values = await incidentsApi.filterOptions(def.id);
      setOptionsFor({ id: def.id, label: def.displayName, values });
    } catch {
      setOptionsFor({ id: def.id, label: def.displayName, values: [] });
    }
  }
}

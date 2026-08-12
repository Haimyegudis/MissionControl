// Team Dashboard (ui-parity-contract.md §9): team select + project textbox,
// New/Edit/Delete/Refresh, empty state, stats band, workload + logged-hours
// charts, grid 'TeamDashboard.Rows' sorted OpenCount DESC, loading overlay.
// JQL verbatim (maxResults 1000); fuzzy member matching in lib/viewTeam.
// Loads on session change; no scheduler tick.

import { useEffect, useMemo, useRef, useState } from 'react';
import { issues as issuesApi, teams as teamsApi } from '../api/client';
import { StackedBarsH } from '../charts/StackedBarsH';
import { DataGrid } from '../components/DataGrid';
import type { GridColumn } from '../components/DataGrid';
import { fmtHours, fmtHours1 } from '../lib/viewFormat';
import { computeTeamRows, otherCount, type TeamMemberRow } from '../lib/viewTeam';
import { sessionStore } from '../stores/session';
import { getSettings, loadSettings, updateSettings } from '../stores/settings';
import { useStore } from '../stores/useStore';
import type { Team } from '../types';
import { MemberDetail } from './team/MemberDetail';
import { TeamEditor } from './team/TeamEditor';

export function TeamView() {
  const session = useStore(sessionStore);
  const connected = session.phase === 'connected';

  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [projectKey, setProjectKey] = useState('ISW');
  const [rows, setRows] = useState<TeamMemberRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ existing: Team | null } | null>(null);
  const [detail, setDetail] = useState<TeamMemberRow | null>(null);
  const loadSeq = useRef(0);
  const projectDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedTeam = useMemo(() => teams.find((t) => t.id === selectedTeamId) ?? null, [teams, selectedTeamId]);

  const loadRows = async (team: Team | null, project: string) => {
    if (!team || team.members.length === 0) {
      setRows([]);
      return;
    }
    const seq = ++loadSeq.current;
    setBusy(true);
    setError(null);
    try {
      // §9 JQL verbatim — no status filter; done/closed matched by substring.
      const jql = `project = ${project.trim()} AND sprint in openSprints() AND issuetype != Incident ORDER BY assignee ASC`;
      const page = await issuesApi.search(jql, 0, 1000);
      if (seq !== loadSeq.current) return;
      setRows(computeTeamRows(team.members, page.items));
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  };

  const reloadTeams = async (preferId?: string | null) => {
    try {
      const all = await teamsApi.list();
      setTeams(all);
      const s = await loadSettings();
      const wanted = preferId ?? s.activeTeamId;
      const pick = all.find((t) => t.id === wanted) ?? all[0] ?? null;
      const project = s.defaultProjectKey || 'ISW';
      setProjectKey(project);
      setSelectedTeamId(pick?.id ?? null);
      await loadRows(pick, project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const reloadTeamsRef = useRef(reloadTeams);
  reloadTeamsRef.current = reloadTeams;

  // §9: loads on session change; no scheduler.
  useEffect(() => {
    if (connected) void reloadTeamsRef.current();
  }, [connected]);

  const selectTeam = async (id: string) => {
    setSelectedTeamId(id);
    const team = teams.find((t) => t.id === id) ?? null;
    if (getSettings().activeTeamId !== id) {
      void updateSettings({ activeTeamId: id }).catch(() => undefined);
    }
    await loadRows(team, projectKey);
  };

  const onProjectChange = (value: string) => {
    setProjectKey(value);
    if (projectDebounce.current) clearTimeout(projectDebounce.current);
    projectDebounce.current = setTimeout(() => {
      const trimmed = value.trim();
      if (!trimmed || !selectedTeam) return;
      if (getSettings().defaultProjectKey !== trimmed) {
        void updateSettings({ defaultProjectKey: trimmed }).catch(() => undefined);
      }
      void loadRows(selectedTeam, trimmed);
    }, 600);
  };

  const deleteTeam = async () => {
    if (!selectedTeam) return;
    if (!window.confirm(`Delete team '${selectedTeam.name}'?`)) return;
    try {
      await teamsApi.remove(selectedTeam.id);
      await reloadTeams(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onEditorClose = (saved: Team | null) => {
    setEditor(null);
    if (saved) void reloadTeams(saved.id);
  };

  const teamLoggedHours = rows.reduce((s, r) => s + r.loggedHours, 0);
  const teamRemainingHours = rows.reduce((s, r) => s + r.remainingHours, 0);

  const columns: GridColumn<TeamMemberRow>[] = useMemo(
    () => [
      { key: 'member', header: 'Member', width: 220 },
      { key: 'openCount', header: 'Open', width: 70 },
      { key: 'doneCount', header: 'Done', width: 70 },
      { key: 'inProgress', header: 'In Progress', width: 100 },
      { key: 'inReview', header: 'In Review', width: 100 },
      { key: 'onHold', header: 'On Hold', width: 80 },
      { key: 'estimatedHours', header: 'Estimated (h)', width: 110, format: (r) => fmtHours(r.estimatedHours) },
      { key: 'remainingHours', header: 'Remaining (h)', width: 110, format: (r) => fmtHours(r.remainingHours) },
      { key: 'loggedHours', header: 'Logged (h)', width: 100, format: (r) => fmtHours(r.loggedHours) },
    ],
    [],
  );

  const emptyState = (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
      <div className="card" style={{ padding: '32px 48px', textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No teams yet</div>
        <div className="muted" style={{ marginBottom: 16 }}>
          Create a team to track only your squad's workload and logged time.
        </div>
        <button className="btn btn-primary" onClick={() => setEditor({ existing: null })}>
          + New team
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18 }}>Team Dashboard</h2>
        <span className="muted">Team:</span>
        <select
          value={selectedTeamId ?? ''}
          onChange={(e) => void selectTeam(e.target.value)}
          style={{ minWidth: 160 }}
          disabled={teams.length === 0}
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="muted">Project:</span>
        <input value={projectKey} onChange={(e) => onProjectChange(e.target.value)} style={{ width: 100 }} />
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => setEditor({ existing: null })}>
          New team
        </button>
        <button className="btn" onClick={() => setEditor({ existing: selectedTeam })} disabled={!selectedTeam}>
          Edit
        </button>
        <button className="btn" onClick={() => void deleteTeam()} disabled={!selectedTeam}>
          Delete
        </button>
        <button className="btn" onClick={() => void loadRows(selectedTeam, projectKey)} disabled={!selectedTeam}>
          Refresh
        </button>
      </div>

      {error ? <div style={{ color: 'var(--accent-red)', fontSize: 12.5 }}>{error}</div> : null}

      {teams.length === 0 ? (
        emptyState
      ) : (
        <>
          <div style={{ display: 'flex', gap: 32 }}>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>
                Logged this week (team)
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtHours1(teamLoggedHours)} h</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>
                Remaining (open issues)
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtHours1(teamRemainingHours)} h</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>
                Members
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{selectedTeam?.members.length ?? 0}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="card" style={{ padding: 12, minHeight: 260 }}>
              <StackedBarsH
                title="Workload (open issues per member)"
                rows={rows.map((r) => ({
                  label: r.member,
                  values: [r.inProgress, r.inReview, r.onHold, otherCount(r)],
                }))}
                series={[
                  { name: 'In Progress', color: '#06B6D4' },
                  { name: 'In Review', color: '#F59E0B' },
                  { name: 'On Hold', color: '#EF4444' },
                  { name: 'Other', color: '#64748B' },
                ]}
              />
            </div>
            <div className="card" style={{ padding: 12, minHeight: 260 }}>
              <StackedBarsH
                title="Logged hours (sprint)"
                rows={rows.map((r) => ({ label: r.member, values: [r.loggedHours] }))}
                series={[{ name: 'Logged (h)', color: '#6366F1' }]}
                valueSuffix="h"
              />
            </div>
          </div>

          <div title="Double-click a member to open details">
            <DataGrid<TeamMemberRow>
              stateKey="TeamDashboard.Rows"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.member}
              onRowDoubleClick={(r) => setDetail(r)}
              emptyText="No sprint issues match this team."
            />
          </div>
        </>
      )}

      {busy ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(2, 6, 20, 0.35)',
            zIndex: 10,
            borderRadius: 10,
          }}
        >
          <span className="accent-cyan" style={{ fontSize: 14 }}>
            Loading…
          </span>
        </div>
      ) : null}

      {editor ? <TeamEditor existing={editor.existing} onClose={onEditorClose} /> : null}
      {detail ? <MemberDetail member={detail.member} issues={detail.issues} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

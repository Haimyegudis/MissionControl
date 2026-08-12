// Team editor modal (ui-parity-contract.md §9.1, 520×640): team name,
// project + Load + member search, checkbox list, error line, Cancel/Save.
// Member source order: sprint assignees (1000) → + logged-in user →
// fallback all-time distinct (2000) when ≤1 → always re-add selected.

import { useEffect, useRef, useState } from 'react';
import { issues as issuesApi, metadata as metadataApi, teams as teamsApi } from '../../api/client';
import { Modal } from '../../components/Modal';
import { getSettings } from '../../stores/settings';
import { sessionStore } from '../../stores/session';
import type { Team } from '../../types';

function newTeamId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

interface MemberPick {
  name: string;
  selected: boolean;
}

export interface TeamEditorProps {
  existing: Team | null;
  /** `saved` is null when cancelled. */
  onClose: (saved: Team | null) => void;
}

export function TeamEditor({ existing, onClose }: TeamEditorProps) {
  const [teamName, setTeamName] = useState(existing?.name ?? '');
  const [projectKey, setProjectKey] = useState(() => getSettings().defaultProjectKey || 'ISW');
  const [filterText, setFilterText] = useState('');
  const [members, setMembers] = useState<MemberPick[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const membersRef = useRef(members);
  membersRef.current = members;

  const loadMembers = async (preselect: string[] | null) => {
    setBusy(true);
    setError(null);
    try {
      const current = preselect ?? membersRef.current.filter((m) => m.selected).map((m) => m.name);
      const project = (projectKey || 'ISW').trim();
      const combined = new Set<string>();
      // (1) Active-sprint assignees only — avoids ex-employees / one-off
      // assignees from years ago.
      try {
        const page = await issuesApi.search(`project = ${project} AND sprint in openSprints()`, 0, 1000);
        for (const i of page.items) {
          if (i.assignee?.trim()) combined.add(i.assignee);
        }
      } catch {
        /* fall back below */
      }
      // (2) Always include the logged-in user.
      const me = sessionStore.get().user?.displayName;
      if (me?.trim()) combined.add(me);
      // (3) Sprint search yielded (almost) nothing → all-time distinct.
      if (combined.size <= 1) {
        try {
          for (const u of await metadataApi.distinct(project, 'assignee', 2000)) combined.add(u);
        } catch {
          /* ignore */
        }
      }
      // (4) Keep already-selected names visible even if absent from the project.
      const picked = new Set(current.map((n) => n.toLowerCase()));
      for (const n of current) combined.add(n);
      const sorted = [...combined].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      setMembers(sorted.map((name) => ({ name, selected: picked.has(name.toLowerCase()) })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadMembers(existing?.members ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!teamName.trim()) {
      setError('Team name is required.');
      return;
    }
    const picks = members.filter((m) => m.selected).map((m) => m.name);
    if (picks.length === 0) {
      setError('Pick at least one member.');
      return;
    }
    const team: Team = {
      id: existing?.id ?? newTeamId(),
      name: teamName.trim(),
      members: picks,
    };
    try {
      await teamsApi.save(team);
      onClose(team);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const visible = members.filter(
    (m) => !filterText.trim() || m.name.toLowerCase().includes(filterText.trim().toLowerCase()),
  );

  const toggle = (name: string) => {
    setMembers((prev) => prev.map((m) => (m.name === name ? { ...m, selected: !m.selected } : m)));
  };

  return (
    <Modal
      title={existing ? 'Edit team' : 'New team'}
      width={520}
      maxHeight={640}
      onClose={() => onClose(null)}
      footer={
        <>
          {error ? (
            <span style={{ color: 'var(--accent-red)', fontSize: 12.5, marginRight: 'auto' }}>{error}</span>
          ) : null}
          <button className="btn" onClick={() => onClose(null)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label>
          Team name
          <input value={teamName} onChange={(e) => setTeamName(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <label style={{ width: 120 }}>
            Project
            <input
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <button className="btn" onClick={() => void loadMembers(null)} disabled={busy}>
            Load
          </button>
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="🔍 Search members..."
            style={{ flex: 1 }}
          />
        </div>
        <div
          style={{
            border: '1px solid var(--border-soft)',
            borderRadius: 8,
            maxHeight: 320,
            overflowY: 'auto',
            padding: 6,
          }}
        >
          {busy ? (
            <div className="muted" style={{ padding: 8 }}>
              Loading...
            </div>
          ) : visible.length === 0 ? (
            <div className="muted" style={{ padding: 8 }}>
              No members found.
            </div>
          ) : (
            visible.map((m) => (
              <label
                key={m.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 6px',
                  fontSize: 12.5,
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                <input type="checkbox" checked={m.selected} onChange={() => toggle(m.name)} />
                {m.name}
              </label>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

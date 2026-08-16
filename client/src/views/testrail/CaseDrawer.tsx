// Case drawer (Railbook openCaseDrawer): right slide-over with kv grid,
// execution status scanned from recent suite runs + plan runs, rich-text
// preconditions/steps/expected, and Edit / Copy / Move / Delete actions.

import { useEffect, useRef, useState } from 'react';
import { trApi } from '../../api/testrail';
import { MdView } from '../../components/MdView';
import { RefLinks } from '../../components/RefLinks';
import { fmtUnixDate } from '../../lib/testrail';
import { navigateTestRailRun } from '../../router';
import { pushToast } from '../../stores/toasts';
import {
  currentSections,
  priorityName,
  suiteRunPool,
  typeName,
  userName,
  type TestRailState,
} from '../../stores/testrail';
import type { TrCase, TrPlanRun, TrRun } from '../../testrailTypes';
import { sectionPath } from '../../lib/testrail';
import { ConfirmDialog, Drawer, DrawerHead, StatusStamp, errText, type ConfirmSpec } from './common';

interface Execution {
  run: TrRun | TrPlanRun;
  statusId: number;
}

export interface CaseDrawerProps {
  st: TestRailState;
  caseId: number;
  onClose: () => void;
  onEdit: (c: TrCase) => void;
  onTransfer: (mode: 'copy' | 'move', ids: number[]) => void;
  /** Called after a successful delete so the view refreshes its cases. */
  onDeleted: () => void;
}

export function CaseDrawer({ st, caseId, onClose, onEdit, onTransfer, onDeleted }: CaseDrawerProps) {
  const c =
    Object.values(st.cases)
      .flatMap((list) => list ?? [])
      .find((x) => x.id === caseId) ?? null;

  const [executions, setExecutions] = useState<Execution[] | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const aliveRef = useRef(true);

  // Scan the suite's recent runs (newest-first, cap 80) for executions of this
  // case — concurrency 6, stop once 6 hits are found (Railbook loadCaseExecutions).
  useEffect(() => {
    aliveRef.current = true;
    setExecutions(null);
    setExecError(null);
    if (!c || c.suiteId == null) {
      setExecutions([]);
      setScanned(0);
      return;
    }
    const suiteId = c.suiteId;
    void (async () => {
      try {
        const pool = (await suiteRunPool(suiteId)).slice(0, 80);
        setScanned(pool.length);
        const found: Execution[] = [];
        const queue = [...pool];
        await Promise.all(
          Array.from({ length: 6 }, async () => {
            while (queue.length && found.length < 6) {
              const r = queue.shift();
              if (!r) break;
              try {
                const t = (await trApi.tests(r.id)).find((x) => x.caseId === c.id);
                if (t) found.push({ run: r, statusId: t.statusId });
              } catch {
                /* unreadable run */
              }
            }
          }),
        );
        if (!aliveRef.current) return;
        found.sort((a, b) => (b.run.createdOn ?? 0) - (a.run.createdOn ?? 0));
        setExecutions(found.slice(0, 6));
      } catch (err) {
        if (aliveRef.current) setExecError(errText(err));
      }
    })();
    return () => {
      aliveRef.current = false;
    };
  }, [caseId, c?.suiteId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) return null;

  const sections = currentSections(st);
  const path = c.sectionId != null ? sectionPath(c.sectionId, sections, st.suites, st.selSuiteId === 'all') : '—';

  const doDelete = () =>
    setConfirm({
      title: 'Delete case',
      message: (
        <span>
          Delete case <b>C{c.id} — {c.title}</b>? This cannot be undone.
        </span>
      ),
      confirmLabel: 'Delete case',
      onConfirm: async () => {
        try {
          await trApi.deleteCase(c.id);
          pushToast({ title: 'TestRail', body: 'Case deleted.' });
          onClose();
          onDeleted();
        } catch (err) {
          pushToast({ title: 'Delete failed', body: errText(err) });
        }
      },
    });

  const sectionTitle = (label: string) => (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: 'var(--muted)',
        padding: '0 0 8px',
      }}
    >
      {label}
    </div>
  );

  return (
    <Drawer onClose={onClose}>
      <DrawerHead kicker={`CASE C${c.id}`} title={c.title} onClose={onClose} />

      <dl className="kv">
        <dt>Section</dt>
        <dd>{path}</dd>
        <dt>Priority</dt>
        <dd>{priorityName(st, c.priorityId)}</dd>
        <dt>Type</dt>
        <dd>{typeName(st, c.typeId)}</dd>
        <dt>Owner</dt>
        <dd>{userName(st, c.ownerId)}</dd>
        <dt>Assigned to</dt>
        <dd>{userName(st, c.assignedToId)}</dd>
        <dt>Refs</dt>
        <dd>
          <RefLinks refs={c.refs} />
        </dd>
        <dt>Estimate</dt>
        <dd>{c.estimate ?? '—'}</dd>
        <dt>Created</dt>
        <dd>
          {fmtUnixDate(c.createdOn)} · {userName(st, c.createdBy)}
        </dd>
        <dt>Updated</dt>
        <dd>
          {fmtUnixDate(c.updatedOn)} · {userName(st, c.updatedBy)}
        </dd>
      </dl>

      <hr className="tr-rule" />
      {sectionTitle('Execution status')}
      {execError ? (
        <div className="muted">✕ {execError}</div>
      ) : executions === null ? (
        <div className="muted">checking recent runs…</div>
      ) : executions.length === 0 ? (
        <div className="muted">Never included in the last {scanned} runs of this suite.</div>
      ) : (
        executions.map(({ run, statusId }) => (
          <div
            key={run.id}
            className="step-card"
            style={{
              borderLeftColor:
                statusId === 1 ? 'var(--accent-green)' : statusId === 5 ? 'var(--accent-red)' : 'var(--border-soft)',
              padding: '7px 10px',
              marginBottom: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusStamp st={st} statusId={statusId} />
              <a
                href={`#/testrail/run/${run.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  onClose();
                  navigateTestRailRun(run.id);
                }}
                style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {run.name}
              </a>
              <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                {fmtUnixDate(run.createdOn)}
              </span>
            </div>
          </div>
        ))
      )}

      {c.preconds ? (
        <>
          <hr className="tr-rule" />
          {sectionTitle('Preconditions')}
          <MdView text={c.preconds} />
        </>
      ) : null}

      <hr className="tr-rule" />
      {sectionTitle('Steps')}
      {c.stepsSeparated.length > 0 ? (
        c.stepsSeparated.map((s) => (
          <div key={s.index} className="step-card">
            <div className="step-n">Step {s.index}</div>
            <MdView text={s.action} />
            {s.expected ? (
              <div className="step-exp">
                <MdView text={s.expected} />
              </div>
            ) : null}
          </div>
        ))
      ) : c.steps ? (
        <MdView text={c.steps} />
      ) : (
        <div className="muted">No steps recorded.</div>
      )}

      {c.expected ? (
        <>
          <div style={{ padding: '12px 0 0' }}>{sectionTitle('Expected')}</div>
          <MdView text={c.expected} />
        </>
      ) : null}

      <hr className="tr-rule" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          onClick={() => {
            onClose();
            onEdit(c);
          }}
        >
          Edit case
        </button>
        <button
          className="btn"
          onClick={() => {
            onClose();
            onTransfer('copy', [c.id]);
          }}
        >
          Copy to…
        </button>
        <button
          className="btn"
          onClick={() => {
            onClose();
            onTransfer('move', [c.id]);
          }}
        >
          Move to…
        </button>
        <button className="btn" style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }} onClick={doDelete}>
          Delete
        </button>
      </div>

      {confirm ? <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} /> : null}
    </Drawer>
  );
}

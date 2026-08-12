// DialogHost — single mount point (in App) that owns every app-level dialog:
// IssueDetails, CreateIssue, LogWork, TransitionDialog, Help, CommandPalette,
// Lumo panel + FAB. Exposes an imperative API via React context (useDialogs)
// plus a module-level `dialogs` proxy for non-component callers.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { startPomodoro } from '../stores/pomodoro';
import type { JiraTransition, JiraTransitionField } from '../types';
import { CommandPalette, type PaletteMode } from './CommandPalette';
import { CreateIssue } from './CreateIssue';
import { HelpDialog } from './HelpDialog';
import { IssueDetails } from './IssueDetails';
import { LogWork } from './LogWork';
import { LumoPanel } from './LumoPanel';
import { TransitionDialog } from './TransitionDialog';

export interface LogWorkOptions {
  /** Seconds; enables the "Use existing estimate of {N}" radio. */
  remainingEstimate?: number | null;
  onLogged?: () => void;
}

export interface DialogsApi {
  openIssueDetails(key: string): void;
  openCreateIssue(): void;
  openLogWork(issueKey: string, opts?: LogWorkOptions): void;
  openTransition(
    issueKey: string,
    transition: JiraTransition,
    screen: JiraTransitionField[],
    onDone?: () => void,
  ): void;
  openHelp(): void;
  openPalette(mode?: PaletteMode): void;
  toggleLumo(): void;
}

const noop = () => {};

const NOOP_API: DialogsApi = {
  openIssueDetails: noop,
  openCreateIssue: noop,
  openLogWork: noop,
  openTransition: noop,
  openHelp: noop,
  openPalette: noop,
  toggleLumo: noop,
};

const DialogsContext = createContext<DialogsApi>(NOOP_API);

/** Dialog openers from any component under <DialogHost>. */
export function useDialogs(): DialogsApi {
  return useContext(DialogsContext);
}

let registered: DialogsApi | null = null;

/** Module-level proxy for non-component code (stores, menus). No-op until a DialogHost mounts. */
export const dialogs: DialogsApi = {
  openIssueDetails: (key) => registered?.openIssueDetails(key),
  openCreateIssue: () => registered?.openCreateIssue(),
  openLogWork: (issueKey, opts) => registered?.openLogWork(issueKey, opts),
  openTransition: (issueKey, transition, screen, onDone) =>
    registered?.openTransition(issueKey, transition, screen, onDone),
  openHelp: () => registered?.openHelp(),
  openPalette: (mode) => registered?.openPalette(mode),
  toggleLumo: () => registered?.toggleLumo(),
};

interface IssueRequest {
  key: string;
  seq: number;
}

interface LogWorkRequest extends LogWorkOptions {
  issueKey: string;
}

interface TransitionRequest {
  issueKey: string;
  transition: JiraTransition;
  screen: JiraTransitionField[];
  onDone?: () => void;
}

function LumoFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Lumo — AI assistant"
      aria-label="Lumo — AI assistant"
      style={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        width: 56,
        height: 56,
        borderRadius: '50%',
        border: 'none',
        cursor: 'pointer',
        background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
        color: '#FFFFFF',
        fontSize: 22,
        boxShadow: '0 8px 24px rgba(79, 70, 229, 0.45)',
        zIndex: 1400,
      }}
    >
      ✦
    </button>
  );
}

export function DialogHost({ children }: { children: ReactNode }) {
  const seqRef = useRef(0);
  const [issueRequest, setIssueRequest] = useState<IssueRequest | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [logWork, setLogWork] = useState<LogWorkRequest | null>(null);
  const [transition, setTransition] = useState<TransitionRequest | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [palette, setPalette] = useState<{ mode: PaletteMode } | null>(null);
  const [lumoOpen, setLumoOpen] = useState(false);

  const api = useMemo<DialogsApi>(
    () => ({
      openIssueDetails(key) {
        seqRef.current += 1;
        setIssueRequest({ key, seq: seqRef.current });
      },
      openCreateIssue() {
        setCreateOpen(true);
      },
      openLogWork(issueKey, opts) {
        setLogWork({ issueKey, ...opts });
      },
      openTransition(issueKey, t, screen, onDone) {
        setTransition({ issueKey, transition: t, screen, onDone });
      },
      openHelp() {
        setHelpOpen(true);
      },
      openPalette(mode = 'default') {
        setPalette({ mode });
      },
      toggleLumo() {
        setLumoOpen((v) => !v);
      },
    }),
    [],
  );

  useEffect(() => {
    registered = api;
    return () => {
      if (registered === api) registered = null;
    };
  }, [api]);

  // F1 → Help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closePalette = useCallback(() => setPalette(null), []);

  const paletteMode: PaletteMode = palette?.mode ?? 'default';
  const onPaletteIssue = useCallback(
    (key: string) => {
      setPalette(null);
      if (paletteMode === 'pomodoro') startPomodoro(key);
      else api.openIssueDetails(key);
    },
    [paletteMode, api],
  );

  return (
    <DialogsContext.Provider value={api}>
      {children}

      {issueRequest !== null && (
        <IssueDetails request={issueRequest} onClose={() => setIssueRequest(null)} />
      )}

      {createOpen && <CreateIssue onClose={() => setCreateOpen(false)} />}

      {logWork !== null && (
        <LogWork
          issueKey={logWork.issueKey}
          remainingEstimate={logWork.remainingEstimate ?? null}
          onClose={() => setLogWork(null)}
          onLogged={() => {
            const cb = logWork.onLogged;
            setLogWork(null);
            cb?.();
          }}
        />
      )}

      {transition !== null && (
        <TransitionDialog
          issueKey={transition.issueKey}
          transition={transition.transition}
          fields={transition.screen}
          onClose={() => setTransition(null)}
          onDone={() => {
            const cb = transition.onDone;
            setTransition(null);
            cb?.();
          }}
        />
      )}

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}

      {palette !== null && (
        <CommandPalette mode={palette.mode} onClose={closePalette} onPickIssue={onPaletteIssue} />
      )}

      <LumoPanel open={lumoOpen} onClose={() => setLumoOpen(false)} />
      <LumoFab onClick={() => setLumoOpen((v) => !v)} />
    </DialogsContext.Provider>
  );
}

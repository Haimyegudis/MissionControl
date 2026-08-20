// AI Assistant — model for the AI helper. The Copilot device-flow login
// lives in Connections. Saved by the shell's bottom action bar.
// Note: `aiEndpoint` is intentionally NOT surfaced here — it is a managed
// URL; the persisted value stays untouched server-side (the shell's partial
// PUT simply never sends it).

import { useState } from 'react';
import { api } from '../../api/client';
import { Field, Section } from './common';

interface KnowledgeHealth {
  ok: boolean;
  selfContained: boolean;
  databases: Array<{ name: string; ok: boolean; collections: Array<{ name: string; coveragePct: number }> }>;
  brain: Array<{ name: string; present: boolean }>;
  connections: { jira: boolean; testrail: boolean; confluence: boolean };
}

export interface AiProps {
  aiModel: string;
  onAiModel: (value: string) => void;
  dataSharingEnabled: boolean;
  onDataSharingEnabled: (value: boolean) => void;
}

export function AiSection(p: AiProps) {
  const [health, setHealth] = useState<KnowledgeHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [healthError, setHealthError] = useState('');

  const verifyKnowledge = async () => {
    setChecking(true);
    setHealthError('');
    try {
      setHealth(await api.get<KnowledgeHealth>('/api/lumo/knowledge-health'));
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Section id="set-ai" label="AI Assistant">
      <Field label="Model">
        <input value={p.aiModel} onChange={(e) => p.onAiModel(e.target.value)} style={{ width: '100%' }} />
      </Field>
      <Field
        label="External data sharing"
        hint="Off uses the local Ollama model. On allows Lumo to send your question, conversation history, and retrieved Jira, Confluence, or TestRail content to the selected Copilot/Claude provider."
      >
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <input type="checkbox" checked={p.dataSharingEnabled} onChange={(e) => p.onDataSharingEnabled(e.target.checked)} />
          <span>I understand and allow Lumo to send relevant work data to the external AI provider.</span>
        </label>
      </Field>
      <Field
        label="Lumo knowledge"
        hint="Checks the bundled databases, brain files, embedding coverage, and live work-system connections."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <button className="btn" disabled={checking} onClick={() => void verifyKnowledge()} style={{ alignSelf: 'flex-start' }}>
            {checking ? 'Verifying…' : 'Verify Lumo knowledge'}
          </button>
          {healthError ? <span style={{ color: 'var(--accent-red)', fontSize: 12 }}>{healthError}</span> : null}
          {health ? (
            <div style={{ fontSize: 11.5, display: 'grid', gap: 4 }}>
              <b style={{ color: health.ok && health.selfContained ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {health.ok && health.selfContained ? '✓ Knowledge bundle complete and self-contained' : '✕ Knowledge bundle has gaps'}
              </b>
              <span className="muted">
                {health.databases.filter((database) => database.ok).length}/{health.databases.length} databases · {health.brain.filter((file) => file.present).length}/{health.brain.length} brain files
              </span>
              <span className="muted">
                Jira {health.connections.jira ? '✓' : '✕'} · TestRail {health.connections.testrail ? '✓' : '✕'} · Confluence {health.connections.confluence ? '✓' : '✕'}
              </span>
              {health.databases.flatMap((database) => database.collections).some((collection) => collection.coveragePct < 100) ? (
                <span style={{ color: 'var(--accent-yellow)' }}>
                  Incomplete embeddings: {health.databases.flatMap((database) => database.collections).filter((collection) => collection.coveragePct < 100).map((collection) => `${collection.name} ${collection.coveragePct}%`).join(', ')}
                </span>
              ) : <span className="muted">All indexed collections: 100% embedded</span>}
            </div>
          ) : null}
        </div>
      </Field>
    </Section>
  );
}

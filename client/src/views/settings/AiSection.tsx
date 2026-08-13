// AI Assistant — model for the AI helper. The Copilot device-flow login
// lives in Connections. Saved by the shell's bottom action bar.
// Note: `aiEndpoint` is intentionally NOT surfaced here — it is a managed
// URL; the persisted value stays untouched server-side (the shell's partial
// PUT simply never sends it).

import { Field, Section } from './common';

export interface AiProps {
  aiModel: string;
  onAiModel: (value: string) => void;
}

export function AiSection(p: AiProps) {
  return (
    <Section id="set-ai" label="AI Assistant">
      <Field label="Model">
        <input value={p.aiModel} onChange={(e) => p.onAiModel(e.target.value)} style={{ width: '100%' }} />
      </Field>
    </Section>
  );
}

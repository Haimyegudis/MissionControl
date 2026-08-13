// Data — cache housekeeping. Clearing the Jira issue cache lives here; the
// TestRail disk cache has its own button inside its Connections block.

import { useState } from 'react';
import { settings as settingsApi } from '../../api/client';
import { ConnNote, Field, Section } from './common';

export function DataSection() {
  const [status, setStatus] = useState('');

  const clearCache = async () => {
    if (!window.confirm('Remove all cached issue data?')) return;
    setStatus('');
    try {
      await settingsApi.clearIssueCache();
      setStatus('✓ Cache cleared.');
    } catch (err) {
      setStatus(`✕ ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Section id="set-data" label="Data">
      <Field label="Issue cache" hint="Drops cached Jira issue data; views refetch on next load.">
        <div className="conn-actions">
          <button className="btn" onClick={() => void clearCache()}>
            Clear cache
          </button>
        </div>
        <ConnNote text={status} />
      </Field>
    </Section>
  );
}

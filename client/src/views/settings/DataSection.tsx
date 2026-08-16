// Data — cache housekeeping. Clearing the Jira issue cache lives here; the
// TestRail disk cache has its own button inside its Connections block.

import { useState } from 'react';
import { settings as settingsApi } from '../../api/client';
import { errText } from '../../lib/errors';
import { ConfirmDialog, type ConfirmSpec } from '../testrail/common';
import { ConnNote, Field, Section } from './common';

export function DataSection() {
  const [status, setStatus] = useState('');
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  const clearCache = () =>
    setConfirm({
      title: 'Clear issue cache',
      message: 'Remove all cached issue data? Views refetch on next load.',
      confirmLabel: 'Clear cache',
      danger: false,
      onConfirm: async () => {
        setStatus('');
        try {
          await settingsApi.clearIssueCache();
          setStatus('✓ Cache cleared.');
        } catch (err) {
          setStatus(`✕ ${errText(err)}`);
        }
      },
    });

  return (
    <Section id="set-data" label="Data">
      <Field label="Issue cache" hint="Drops cached Jira issue data; views refetch on next load.">
        <div className="conn-actions">
          <button className="btn" onClick={clearCache}>
            Clear cache
          </button>
        </div>
        <ConnNote text={status} />
      </Field>
      {confirm ? <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} /> : null}
    </Section>
  );
}

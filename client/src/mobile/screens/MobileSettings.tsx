// Settings. Connection status and the two credentials the phone needs.
//
// The desktop Settings page is a long multi-section form (AI, data, reminders,
// theme, connections). On a phone the only thing that matters is whether the
// three services are connected and how to fix it when they are not, so that is
// all this screen carries.

import { useEffect, useState } from 'react';
import { connectTestRail, disconnectTestRail, initTestRail, trStore } from '../../stores/testrail';
import { sessionStore } from '../../stores/session';
import { useStore } from '../../stores/useStore';
import { auth } from '../../api/client';
import { pushToast } from '../../stores/toasts';
import { JIRA_URL, TESTRAIL_URL } from '../../lib/serviceUrls';
import { Screen, tapReset } from '../ui';

export function MobileSettings() {
  const session = useStore(sessionStore);
  const tr = useStore(trStore);
  const [trKey, setTrKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void initTestRail();
  }, []);

  const email = session.user?.emailAddress ?? session.profile?.email ?? '';

  return (
    <Screen kicker="Account" title="Settings">
      <Block
        name="Jira"
        url={JIRA_URL}
        connected={session.phase === 'connected'}
        detail={session.phase === 'connected' ? (session.user?.displayName ?? email) : 'Not signed in'}
        action={
          session.phase === 'connected' ? (
            <Action
              label="Sign out"
              busy={busy === 'jira'}
              onClick={async () => {
                setBusy('jira');
                try {
                  await auth.logout();
                  window.location.reload();
                } finally {
                  setBusy(null);
                }
              }}
            />
          ) : null
        }
      />

      <Block
        name="TestRail"
        url={TESTRAIL_URL}
        connected={tr.phase === 'connected'}
        detail={tr.phase === 'connected' ? (tr.session?.user?.name ?? email) : 'Not connected'}
      >
        {tr.phase === 'connected' ? (
          <Action
            label="Disconnect"
            busy={busy === 'tr'}
            onClick={async () => {
              setBusy('tr');
              try {
                await disconnectTestRail();
              } finally {
                setBusy(null);
              }
            }}
          />
        ) : (
          <>
            <Field value={trKey} onChange={setTrKey} placeholder="TestRail API key" secret />
            <Action
              primary
              label="Connect"
              busy={busy === 'tr'}
              onClick={async () => {
                if (!trKey.trim() || !email) {
                  pushToast({ title: 'TestRail', body: 'Enter your API key.', severity: 'error' });
                  return;
                }
                setBusy('tr');
                try {
                  await connectTestRail(TESTRAIL_URL, email, trKey.trim());
                  setTrKey('');
                  pushToast({ title: 'TestRail', body: 'Connected.' });
                } catch (e) {
                  pushToast({
                    title: 'TestRail',
                    body: e instanceof Error ? e.message : String(e),
                    severity: 'error',
                  });
                } finally {
                  setBusy(null);
                }
              }}
            />
          </>
        )}
      </Block>

    </Screen>
  );
}

function Block({
  name,
  url,
  connected,
  detail,
  action,
  children,
}: {
  name: string;
  url: string;
  connected: boolean;
  detail: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="card"
      style={{ padding: 14, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          aria-hidden
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            flexShrink: 0,
            background: connected ? 'var(--accent-green)' : 'var(--muted)',
            boxShadow: connected ? '0 0 6px var(--accent-green)' : 'none',
          }}
        />
        <span style={{ fontWeight: 650, fontSize: 15, flex: 1 }}>{name}</span>
        {action}
      </div>
      <div style={{ fontSize: 13 }}>{detail}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{url}</div>
      {children}
    </div>
  );
}

function Field({
  value,
  onChange,
  placeholder,
  secret,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secret?: boolean;
}) {
  return (
    <input
      type={secret ? 'password' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      style={{
        width: '100%',
        minHeight: 44,
        padding: '0 12px',
        borderRadius: 10,
        border: '1px solid var(--border-soft)',
        background: 'var(--input-bg)',
        color: 'var(--text-primary)',
        fontSize: 15,
      }}
    />
  );
}

function Action({
  label,
  onClick,
  busy,
  primary,
}: {
  label: string;
  onClick: () => void | Promise<void>;
  busy?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      className={primary ? 'btn btn-primary' : 'btn'}
      disabled={busy}
      onClick={() => void onClick()}
      style={{ ...tapReset, minHeight: 44, justifyContent: 'center' }}
    >
      {busy ? '…' : label}
    </button>
  );
}

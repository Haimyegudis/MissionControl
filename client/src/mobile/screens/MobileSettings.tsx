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
import { auth, settings, watch as watchApi } from '../../api/client';
import { pushToast } from '../../stores/toasts';
import { JIRA_URL, TESTRAIL_URL } from '../../lib/serviceUrls';
import { Screen, tapReset } from '../ui';
import type { WatchConfig, WatchEventKind } from '../../types';
import { signInWithSso } from '../../native/sso';
import { clearAllServiceSessions, clearServiceSession } from '../../native/ssoSession';
import { nativeRuntime } from '../../native/bootstrap';
import { clearEncryptedPersistence } from '../../native/persistence';
import { secureClearAll, secureRemove } from '../../native/secureStorage';

export function MobileSettings() {
  const session = useStore(sessionStore);
  const tr = useStore(trStore);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void initTestRail();
  }, []);

  const email = session.user?.emailAddress ?? session.profile?.email ?? '';
  const jiraSso = session.profile?.authMode === 'sso';

  /** Swap a live token session for a cookie one without signing out first. */
  const switchJiraToSso = async () => {
    setBusy('jira-sso');
    try {
      const result = await signInWithSso('jira', JIRA_URL);
      if (!result.ok) {
        pushToast({ title: 'Sign in', body: result.reason ?? 'Cancelled.', severity: 'error' });
        return;
      }
      await auth.login({
        baseUrl: JIRA_URL,
        email,
        pat: '', // SSO stores no token; any previously stored one is dropped
        instanceType: 'datacenter',
        authMode: 'sso',
      });
      window.location.reload();
    } catch (e) {
      pushToast({ title: 'Sign in', body: e instanceof Error ? e.message : String(e), severity: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen kicker="Account" title="Settings">
      <Block
        name="Jira"
        url={JIRA_URL}
        connected={session.phase === 'connected'}
        detail={
          session.phase === 'connected'
            ? `${session.user?.displayName ?? email} · ${jiraSso ? 'HP OneUID' : 'API token'}`
            : 'Not signed in'
        }
        action={
          session.phase === 'connected' ? (
            <Action
              label="Sign out & erase data"
              busy={busy === 'jira'}
              onClick={async () => {
                setBusy('jira');
                try {
                  await settings.eraseLocalData();
                  await nativeRuntime()?.flushStorage();
                  await clearEncryptedPersistence();
                  await secureClearAll();
                  await clearAllServiceSessions([JIRA_URL, TESTRAIL_URL]);
                  window.location.reload();
                } finally {
                  setBusy(null);
                }
              }}
            />
          ) : null
        }
      >
        {session.phase === 'connected' && !jiraSso ? (
          <Action
            primary
            label="Switch to HP OneUID"
            busy={busy === 'jira-sso'}
            onClick={switchJiraToSso}
          />
        ) : null}
      </Block>

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
                  await nativeRuntime()?.flushStorage();
                  await secureRemove('mc.testrail.people');
                  await clearServiceSession(TESTRAIL_URL);
                } finally {
                setBusy(null);
              }
            }}
          />
        ) : (
          <>
            <Action
              primary
              label="Sign in with HP OneUID"
              busy={busy === 'tr-sso'}
              onClick={async () => {
                if (!email) {
                  pushToast({ title: 'TestRail', body: 'Sign in to Jira first.', severity: 'error' });
                  return;
                }
                setBusy('tr-sso');
                try {
                  const result = await signInWithSso('testrail', TESTRAIL_URL);
                  if (!result.ok) {
                    pushToast({
                      title: 'TestRail',
                      body: result.reason ?? 'Sign-in cancelled.',
                      severity: 'error',
                    });
                    return;
                  }
                  // The SAML cookie now lives in the shared jar and is the
                  // only credential; no key is stored.
                  await connectTestRail(TESTRAIL_URL, email, '', true);
                  pushToast({ title: 'TestRail', body: 'Signed in.' });
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

      <WatchBlock />

    </Screen>
  );
}

const WATCH_KINDS: Array<[WatchEventKind, string]> = [
  ['assigned', 'Assigned to me'],
  ['unassigned', 'No longer mine'],
  ['status', 'Status changed'],
  ['sprint', 'Sprint changed'],
  ['priority', 'Priority changed'],
  ['dueDate', 'Due date changed'],
  ['comment', 'New comments'],
];

/**
 * Dashboard change alerts. Background checks are driven by WorkManager, whose
 * floor is 15 minutes — the interval below governs the in-app cadence and the
 * delta window, which is why the copy says "about".
 */
function WatchBlock() {
  const [config, setConfig] = useState<WatchConfig | null>(null);

  useEffect(() => {
    watchApi
      .getConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  if (config === null) return null;

  const save = (next: WatchConfig): void => {
    setConfig(next);
    watchApi.setConfig(next).then(setConfig).catch((e: unknown) => {
      pushToast({
        title: 'Alerts',
        body: e instanceof Error ? e.message : String(e),
        severity: 'error',
      });
    });
  };

  return (
    <div className="card" style={{ padding: 14, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 650, fontSize: 15, flex: 1 }}>Dashboard alerts</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => save({ ...config, enabled: e.target.checked })}
          />
          On
        </label>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
        Checked about every 15 minutes in the background, and every {config.intervalMinutes} minutes while the
        app is open.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {WATCH_KINDS.map(([kind, label]) => (
          <label key={kind} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, minHeight: 32 }}>
            <input
              type="checkbox"
              checked={config.kinds[kind]}
              disabled={!config.enabled}
              onChange={(e) => save({ ...config, kinds: { ...config.kinds, [kind]: e.target.checked } })}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
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

// Desktop side of the dashboard watcher: a timer while the server runs, and
// one WinRT toast per batch of changes.
//
// Unlike reminders.ts this is not a Windows Scheduled Task — the poll needs the
// live Jira session this process holds, so it only runs while Mission Control
// is up. The first cycle fires immediately on start so changes made while the
// app was closed are reported at launch rather than one interval later.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WatchEvent } from '@mc/core';
import { dataDir } from './config/appPaths.js';

export interface WatchTimerDeps {
  watch: {
    runCycle(): Promise<WatchEvent[]>;
    getConfig(): { enabled: boolean; intervalMinutes: number };
  };
  /** Injected in tests so no PowerShell is spawned. */
  notify?: (events: WatchEvent[]) => void;
}

/** One line per event, in the toast body. */
export function eventLine(event: WatchEvent): string {
  const summary = event.summary.length > 48 ? `${event.summary.slice(0, 45)}...` : event.summary;
  switch (event.kind) {
    case 'assigned':
      return `${event.key} assigned to you — ${summary}`;
    case 'unassigned':
      if (event.reason === 'done') return `${event.key} closed`;
      if (event.reason === 'reassigned') return `${event.key} reassigned`;
      return `${event.key} left your sprint`;
    case 'comment':
      return `${event.key} — ${Number(event.to) - Number(event.from)} new comment(s)`;
    case 'dueDate':
      return event.to === null ? `${event.key} due date cleared` : `${event.key} due ${event.to}`;
    default:
      return `${event.key} ${event.from ?? '—'} → ${event.to ?? '—'}`;
  }
}

function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function toastScript(events: WatchEvent[]): string {
  const title = `${events.length} change${events.length === 1 ? '' : 's'} on your dashboard`;
  const body = events.slice(0, 3).map(eventLine).join('&#10;');
  return `# Mission Control — dashboard watch toast (generated; do not edit)
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]
$xml = @'
<toast activationType="protocol" launch="http://127.0.0.1:5643/#/dashboard">
  <visual><binding template="ToastGeneric">
    <text>Mission Control</text>
    <text>${xmlEscape(title)}</text>
    <text>${xmlEscape(body)}</text>
  </binding></visual>
  <audio src="ms-winsoundevent:Notification.Default" />
</toast>
'@
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Mission Control').Show($toast)
`;
}

function showToast(events: WatchEvent[]): void {
  try {
    mkdirSync(dataDir(), { recursive: true });
    const script = path.join(dataDir(), 'watch-toast.ps1');
    writeFileSync(script, toastScript(events), 'utf8');
    spawn(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script],
      { windowsHide: true },
    ).on('error', () => {
      // A failed toast still leaves the events in the in-app feed.
    });
  } catch {
    // Same reasoning: never let a notification failure break the cycle.
  }
}

/** Start the poll loop. Returns a stop function. */
export function startWatchTimer(deps: WatchTimerDeps): () => void {
  const notify = deps.notify ?? showToast;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const tick = async (): Promise<void> => {
    const config = deps.watch.getConfig();
    if (config.enabled) {
      try {
        const events = await deps.watch.runCycle();
        if (events.length > 0) notify(events);
      } catch {
        // A failed cycle is silent: 401s are already surfaced by the session
        // machinery, and a VPN blip must not produce a toast.
      }
    }
    if (stopped) return;
    timer = setTimeout(() => void tick(), Math.max(1, config.intervalMinutes) * 60_000);
    timer.unref?.(); // never hold the process open on this alone
  };

  void tick(); // catch-up cycle at start

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}

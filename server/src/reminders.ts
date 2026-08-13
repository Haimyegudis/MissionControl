// Log-work reminder: a Windows Scheduled Task fires a native toast on the
// user's chosen days/time — works even when Mission Control (and this server)
// are not running. Config lives in %APPDATA%\JiraWeb\reminders.json.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './config/appPaths.js';

const appDataDir = dataDir;

export interface ReminderConfig {
  enabled: boolean;
  /** Subset of SUN,MON,TUE,WED,THU,FRI,SAT */
  days: string[];
  /** 24h "HH:MM" */
  time: string;
}

const TASK_NAME = 'MissionControlLogWorkReminder';
const VALID_DAYS = new Set(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);

const DEFAULT_CONFIG: ReminderConfig = { enabled: false, days: ['SUN', 'MON', 'TUE', 'WED', 'THU'], time: '16:30' };

function configPath(): string {
  return path.join(appDataDir(), 'reminders.json');
}

function toastScriptPath(): string {
  return path.join(appDataDir(), 'logwork-toast.ps1');
}

const TOAST_SCRIPT = `# Mission Control — log-work reminder toast (generated; do not edit)
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]
$xml = @'
<toast activationType="protocol" launch="http://127.0.0.1:5643/#/timelogged" scenario="reminder">
  <visual><binding template="ToastGeneric">
    <text>Mission Control</text>
    <text>Time to log your work in Jira</text>
    <text>Click to open Time Spent</text>
  </binding></visual>
  <audio src="ms-winsoundevent:Notification.Reminder" />
</toast>
'@
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Mission Control').Show($toast)
`;

export function loadReminderConfig(): ReminderConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<ReminderConfig>;
    return sanitize(raw);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function sanitize(raw: Partial<ReminderConfig>): ReminderConfig {
  const days = Array.isArray(raw.days)
    ? raw.days.map((d) => String(d).toUpperCase()).filter((d) => VALID_DAYS.has(d))
    : DEFAULT_CONFIG.days;
  const time = typeof raw.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time) ? raw.time : DEFAULT_CONFIG.time;
  return { enabled: raw.enabled === true, days: days.length ? days : DEFAULT_CONFIG.days, time };
}

/** Persist config and (re)create / delete the Windows scheduled task. */
export function applyReminderConfig(raw: Partial<ReminderConfig>): { config: ReminderConfig; error?: string } {
  const config = sanitize(raw);
  mkdirSync(appDataDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');

  if (!config.enabled) {
    spawnSync('schtasks', ['/Delete', '/F', '/TN', TASK_NAME], { windowsHide: true });
    return { config };
  }

  if (!existsSync(toastScriptPath())) writeFileSync(toastScriptPath(), TOAST_SCRIPT, 'utf8');

  const tr = `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${toastScriptPath()}"`;
  const res = spawnSync(
    'schtasks',
    ['/Create', '/F', '/SC', 'WEEKLY', '/D', config.days.join(','), '/ST', config.time, '/TN', TASK_NAME, '/TR', tr],
    { windowsHide: true, encoding: 'utf8' },
  );
  if (res.status !== 0) {
    return { config, error: (res.stderr || res.stdout || 'schtasks failed').trim() };
  }
  return { config };
}

// Alerts & reminders: Windows Scheduled Tasks fire native toasts on the
// user's chosen days/times — works even when Mission Control (and this server)
// are not running. Config lives in %APPDATA%\JiraWeb\reminders.json.
//
// Four alert kinds:
//   logWork    — weekly nudge to log work in Jira (opens Time Spent)
//   inProgress — weekly summary of tasks currently In Progress (live counts
//                fetched from the local API when the server is up; generic
//                text otherwise)
//   todo       — weekly nudge to move tasks from To Do to In Progress
//   taskAlerts — one-time alerts about a specific issue at a date+time

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './config/appPaths.js';

const appDataDir = dataDir;

export interface AlertRule {
  enabled: boolean;
  /** Subset of SUN,MON,TUE,WED,THU,FRI,SAT */
  days: string[];
  /** 24h "HH:MM" */
  time: string;
}

export interface TaskAlert {
  /** Issue key, e.g. ISW-1234 */
  key: string;
  /** Local date "YYYY-MM-DD" */
  date: string;
  /** 24h "HH:MM" */
  time: string;
  note?: string;
}

export interface ReminderConfig {
  logWork: AlertRule;
  inProgress: AlertRule;
  todo: AlertRule;
  taskAlerts: TaskAlert[];
}

/** Persisted shape = config + bookkeeping of created one-time task names. */
interface StoredConfig extends ReminderConfig {
  taskAlertTaskNames?: string[];
}

const LOGWORK_TASK = 'MissionControlLogWorkReminder';
const INPROGRESS_TASK = 'MissionControlInProgressAlert';
const TODO_TASK = 'MissionControlTodoAlert';
const TASK_ALERT_PREFIX = 'MissionControlTaskAlert';

const VALID_DAYS = new Set(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/i;

const DEFAULT_RULE: AlertRule = { enabled: false, days: ['SUN', 'MON', 'TUE', 'WED', 'THU'], time: '16:30' };

export const DEFAULT_CONFIG: ReminderConfig = {
  logWork: { ...DEFAULT_RULE },
  inProgress: { ...DEFAULT_RULE, time: '10:00' },
  todo: { ...DEFAULT_RULE, time: '09:30' },
  taskAlerts: [],
};

function configPath(): string {
  return path.join(appDataDir(), 'reminders.json');
}

function scriptPath(name: string): string {
  return path.join(appDataDir(), name);
}

// ---------------------------------------------------------------------------
// Toast scripts (generated; PowerShell + WinRT toast API)
// ---------------------------------------------------------------------------

/** Static toast — log-work reminder (opens the Time Spent page). */
const LOGWORK_SCRIPT = `# Mission Control — log-work reminder toast (generated; do not edit)
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

/**
 * Dynamic toast — asks the local API for a live summary (top issue lines);
 * falls back to generic text when the server is not running.
 */
function dynamicSummaryScript(type: 'inProgress' | 'todo'): string {
  const fallbackTitle =
    type === 'inProgress' ? 'Check your In Progress tasks' : 'Check your To Do tasks';
  const titleExpr =
    type === 'inProgress'
      ? '"You have $($s.count) task(s) In Progress"'
      : '"$($s.count) task(s) still in To Do - move to In Progress?"';
  return `# Mission Control — ${type} alert toast (generated; do not edit)
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]
$s = $null
$tok = ''
try { $tok = (Get-Content (Join-Path $env:APPDATA 'JiraWeb\api-token') -Raw).Trim() } catch { }
try { $s = Invoke-RestMethod 'http://127.0.0.1:5643/api/reminders/alert-summary?type=${type}' -TimeoutSec 5 -Headers @{ 'x-mc-token' = $tok } } catch { }
if ($s -ne $null -and $s.count -eq 0) { exit 0 }  # nothing to nag about
$title = if ($s -ne $null) { ${titleExpr} } else { '${fallbackTitle}' }
$body = if ($s -ne $null -and $s.lines) { ($s.lines | Select-Object -First 3) -join [char]10 } else { 'Open Mission Control for details' }
function XmlEscape([string]$t) { $t -replace '&','&amp;' -replace '<','&lt;' -replace '>','&gt;' }
$xml = @"
<toast activationType="protocol" launch="http://127.0.0.1:5643/#/dashboard" scenario="reminder">
  <visual><binding template="ToastGeneric">
    <text>Mission Control</text>
    <text>$(XmlEscape $title)</text>
    <text>$(XmlEscape $body)</text>
  </binding></visual>
  <audio src="ms-winsoundevent:Notification.Reminder" />
</toast>
"@
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Mission Control').Show($toast)
`;
}

/** One-time toast about a specific issue; key + note passed as parameters. */
const TASK_ALERT_SCRIPT = `# Mission Control — specific-task alert toast (generated; do not edit)
param([string]$IssueKey = '', [string]$Note = '')
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]
if ([string]::IsNullOrWhiteSpace($Note)) { $Note = 'Click to open Mission Control' }
function XmlEscape([string]$t) { $t -replace '&','&amp;' -replace '<','&lt;' -replace '>','&gt;' }
$xml = @"
<toast activationType="protocol" launch="http://127.0.0.1:5643/#/dashboard" scenario="reminder">
  <visual><binding template="ToastGeneric">
    <text>Mission Control</text>
    <text>Reminder: $(XmlEscape $IssueKey)</text>
    <text>$(XmlEscape $Note)</text>
  </binding></visual>
  <audio src="ms-winsoundevent:Notification.Reminder" />
</toast>
"@
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Mission Control').Show($toast)
`;

// ---------------------------------------------------------------------------
// Config load / sanitize
// ---------------------------------------------------------------------------

export function sanitizeRule(raw: unknown, fallback: AlertRule): AlertRule {
  const r = (raw ?? {}) as Partial<AlertRule>;
  const days = Array.isArray(r.days)
    ? r.days.map((d) => String(d).toUpperCase()).filter((d) => VALID_DAYS.has(d))
    : fallback.days;
  const time = typeof r.time === 'string' && TIME_RE.test(r.time) ? r.time : fallback.time;
  return { enabled: r.enabled === true, days: days.length ? days : fallback.days, time };
}

export function sanitizeTaskAlerts(raw: unknown): TaskAlert[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskAlert[] = [];
  for (const item of raw) {
    const a = (item ?? {}) as Partial<TaskAlert>;
    const key = typeof a.key === 'string' ? a.key.trim().toUpperCase() : '';
    if (!KEY_RE.test(key)) continue;
    if (typeof a.date !== 'string' || !DATE_RE.test(a.date)) continue;
    if (typeof a.time !== 'string' || !TIME_RE.test(a.time)) continue;
    // Note is embedded in a PowerShell argument — keep it strictly plain text.
    const note =
      typeof a.note === 'string' ? a.note.replace(/[^\p{L}\p{N} .,:;!?()\-]/gu, '').slice(0, 120) : undefined;
    out.push({ key, date: a.date, time: a.time, ...(note ? { note } : {}) });
    if (out.length >= 20) break; // sanity cap
  }
  return out;
}

/**
 * Sanitize a raw payload. Back-compat: the legacy single-reminder shape
 * `{enabled, days, time}` maps to `logWork`.
 */
export function sanitize(raw: Record<string, unknown>): ReminderConfig {
  const legacy =
    typeof raw.enabled === 'boolean' && !raw.logWork
      ? sanitizeRule(raw, DEFAULT_CONFIG.logWork)
      : null;
  return {
    logWork: legacy ?? sanitizeRule(raw.logWork, DEFAULT_CONFIG.logWork),
    inProgress: sanitizeRule(raw.inProgress, DEFAULT_CONFIG.inProgress),
    todo: sanitizeRule(raw.todo, DEFAULT_CONFIG.todo),
    taskAlerts: sanitizeTaskAlerts(raw.taskAlerts),
  };
}

export function loadReminderConfig(): ReminderConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as Record<string, unknown>;
    return sanitize(raw);
  } catch {
    return sanitize({});
  }
}

function loadStoredTaskNames(): string[] {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as StoredConfig;
    return Array.isArray(raw.taskAlertTaskNames)
      ? raw.taskAlertTaskNames.filter((n) => typeof n === 'string' && n.startsWith(TASK_ALERT_PREFIX))
      : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Scheduled-task plumbing — fully async: spawnSync here used to block the
// Node event loop (up to ~40 child processes per apply), freezing the whole
// server for every other request.
// ---------------------------------------------------------------------------

function run(exe: string, args: string[]): Promise<{ status: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true });
    let out = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => (out += d));
    child.stderr?.on('data', (d: string) => (out += d));
    child.on('error', (e) => resolve({ status: -1, out: String(e) }));
    child.on('close', (code) => resolve({ status: code ?? -1, out }));
  });
}

function deleteTask(name: string): Promise<unknown> {
  return run('schtasks', ['/Delete', '/F', '/TN', name]);
}

function psFileCommand(script: string): string {
  return `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}"`;
}

/** Weekly task via schtasks (locale-safe: no dates involved). */
async function createWeeklyTask(name: string, rule: AlertRule, script: string): Promise<string | null> {
  const res = await run('schtasks', [
    '/Create', '/F', '/SC', 'WEEKLY', '/D', rule.days.join(','), '/ST', rule.time, '/TN', name, '/TR', psFileCommand(script),
  ]);
  if (res.status !== 0) return res.out.trim() || 'schtasks failed';

  // schtasks.exe defaults to refusing battery-powered starts and stopping a
  // running task when AC power is removed. Press laptops are frequently on
  // battery, so explicitly make reminders power-source independent and let
  // Windows deliver a reminder after sleep or another missed start time.
  const settings =
    `$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries ` +
    `-DontStopIfGoingOnBatteries -StartWhenAvailable; ` +
    `Set-ScheduledTask -TaskName '${name}' -Settings $s | Out-Null`;
  const encoded = Buffer.from(settings, 'utf16le').toString('base64');
  const configured = await run('powershell', ['-NoProfile', '-EncodedCommand', encoded]);
  return configured.status !== 0
    ? configured.out.trim() || 'Unable to configure scheduled-task settings'
    : null;
}

/**
 * All one-time alerts in ONE PowerShell invocation: unregister the previous
 * task names, then Register-ScheduledTask per alert. schtasks /SD is
 * locale-dependent; [datetime]'YYYY-MM-DDTHH:MM' is not. All interpolated
 * values are sanitize()-validated (key/date/time regex, note charset).
 */
async function syncOnceTasks(
  oldNames: string[],
  alerts: TaskAlert[],
  script: string,
): Promise<{ created: string[]; error: string | null }> {
  const created = alerts.map(
    (alert, i) => `${TASK_ALERT_PREFIX}_${alert.key.replace(/[^A-Z0-9]/g, '')}_${i + 1}`,
  );
  const statements = [
    ...oldNames.map(
      (n) => `Unregister-ScheduledTask -TaskName '${n}' -Confirm:$false -ErrorAction SilentlyContinue`,
    ),
    ...alerts.map((alert, i) => {
      const args =
        `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}"` +
        ` -IssueKey "${alert.key}"` +
        (alert.note ? ` -Note "${alert.note}"` : '');
      return (
        `$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '${args}'; ` +
        `$t = New-ScheduledTaskTrigger -Once -At ([datetime]'${alert.date}T${alert.time}'); ` +
        `$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries ` +
        `-DontStopIfGoingOnBatteries -StartWhenAvailable; ` +
        `Register-ScheduledTask -TaskName '${created[i]}' -Action $a -Trigger $t -Settings $s -Force | Out-Null`
      );
    }),
  ];
  if (statements.length === 0) return { created: [], error: null };
  const encoded = Buffer.from(statements.join('; '), 'utf16le').toString('base64');
  const res = await run('powershell', ['-NoProfile', '-EncodedCommand', encoded]);
  if (res.status !== 0) return { created: [], error: res.out.trim() || 'Register-ScheduledTask failed' };
  return { created, error: null };
}

/** Persist config and (re)create / delete every scheduled task. */
export async function applyReminderConfig(
  raw: Record<string, unknown>,
): Promise<{ config: ReminderConfig; error?: string }> {
  const config = sanitize(raw);
  mkdirSync(appDataDir(), { recursive: true });

  const errors: string[] = [];

  // Weekly rules — regenerate scripts on every apply so edits here roll out.
  const weekly: Array<{ task: string; rule: AlertRule; file: string; content: string }> = [
    { task: LOGWORK_TASK, rule: config.logWork, file: 'logwork-toast.ps1', content: LOGWORK_SCRIPT },
    { task: INPROGRESS_TASK, rule: config.inProgress, file: 'inprogress-toast.ps1', content: dynamicSummaryScript('inProgress') },
    { task: TODO_TASK, rule: config.todo, file: 'todo-toast.ps1', content: dynamicSummaryScript('todo') },
  ];
  await Promise.all(
    weekly.map(async ({ task, rule, file, content }) => {
      if (!rule.enabled) {
        await deleteTask(task);
        return;
      }
      const script = scriptPath(file);
      writeFileSync(script, content, 'utf8');
      const err = await createWeeklyTask(task, rule, script);
      if (err) errors.push(`${task}: ${err}`);
    }),
  );

  // One-time task alerts — old names dropped and new ones registered in a
  // single PowerShell process.
  if (config.taskAlerts.length > 0) {
    writeFileSync(scriptPath('task-alert-toast.ps1'), TASK_ALERT_SCRIPT, 'utf8');
  }
  const { created: createdNames, error: onceError } = await syncOnceTasks(
    loadStoredTaskNames(),
    config.taskAlerts,
    scriptPath('task-alert-toast.ps1'),
  );
  if (onceError) errors.push(onceError);

  const stored: StoredConfig = { ...config, taskAlertTaskNames: createdNames };
  writeFileSync(configPath(), JSON.stringify(stored, null, 2), 'utf8');

  if (errors.length > 0) return { config, error: errors.join('; ') };
  return { config };
}

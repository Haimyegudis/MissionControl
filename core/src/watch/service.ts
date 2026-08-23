// Dashboard watcher. One cycle = two searches, a diff against the stored
// snapshot, and a state write.
//
// The searches use their own field list rather than BASE_FIELDS: no view in
// the app needs `duedate` or `comment`, and adding them to BASE_FIELDS would
// make every search in the product pay for comment bodies.

import { apiPrefix, jiraFetch } from '../jira/httpClient.js';
import type { JiraSession } from '../jira/session.js';
import { getSprintFieldId } from '../jira/mapper.js';
import { diffSnapshots } from './differ.js';
import type { KvWatchRepo } from './state.js';
import { FEED_CAP, type IssueSnapshot, type WatchConfig, type WatchEvent } from './types.js';

export { KvWatchRepo } from './state.js';

type FetchFn = typeof jiraFetch;

/** Fields the watcher compares; deliberately separate from BASE_FIELDS. */
const WATCH_FIELDS = ['summary', 'status', 'priority', 'assignee', 'updated', 'duedate', 'comment'];

/** One page is enough: a sprint's worth of one person's issues. */
const MAX_RESULTS = 200;

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `[... name=ISW Sprint 128,state=ACTIVE ...]` or `{ name, state }` shapes. */
function activeSprintName(raw: unknown): string | null {
  const list = Array.isArray(raw) ? raw : [];
  for (const entry of list) {
    if (entry !== null && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      if (readString(obj.state).toLowerCase() === 'active') return readString(obj.name) || null;
      continue;
    }
    const text = readString(entry);
    if (!/state=ACTIVE/i.test(text)) continue;
    const match = text.match(/name=([^,\]]+)/);
    if (match) return match[1];
  }
  return null;
}

export function mapSnapshot(raw: unknown): IssueSnapshot | null {
  const issue = (raw ?? {}) as Record<string, unknown>;
  const key = readString(issue.key);
  if (!key) return null;
  const fields = (issue.fields ?? {}) as Record<string, unknown>;
  const status = (fields.status ?? {}) as Record<string, unknown>;
  const category = (status.statusCategory ?? {}) as Record<string, unknown>;
  const comment = (fields.comment ?? {}) as Record<string, unknown>;
  const sprintField = getSprintFieldId();
  return {
    key,
    summary: readString(fields.summary),
    status: readString(status.name),
    statusCategory: readString(category.key),
    sprintName: activeSprintName(sprintField ? fields[sprintField] : null),
    priority: readString((fields.priority as Record<string, unknown> | null)?.name),
    assignee: readString((fields.assignee as Record<string, unknown> | null)?.displayName) || null,
    dueDate: readString(fields.duedate) || null,
    commentCount: typeof comment.total === 'number' ? comment.total : 0,
    updated: readString(fields.updated),
  };
}

function toMap(issues: unknown): Record<string, IssueSnapshot> {
  const list = Array.isArray(issues) ? issues : [];
  const out: Record<string, IssueSnapshot> = {};
  for (const raw of list) {
    const snapshot = mapSnapshot(raw);
    if (snapshot) out[snapshot.key] = snapshot;
  }
  return out;
}

export class WatchService {
  constructor(
    private readonly session: JiraSession,
    private readonly repo: KvWatchRepo,
    private readonly projectKey: () => string,
    private readonly fetchFn: FetchFn = jiraFetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getConfig(): WatchConfig {
    return this.repo.getConfig();
  }

  setConfig(raw: unknown): WatchConfig {
    return this.repo.setConfig(raw);
  }

  feed(): { events: WatchEvent[]; unreadCount: number; lastCycle: string | null } {
    const state = this.repo.getState();
    const acked = state.ackedAt ? Date.parse(state.ackedAt) : 0;
    return {
      events: state.feed,
      unreadCount: state.feed.filter((e) => Date.parse(e.at) > acked).length,
      lastCycle: state.lastCycle,
    };
  }

  ack(): void {
    this.repo.setState({ ...this.repo.getState(), ackedAt: this.now().toISOString() });
  }

  private search(jql: string): Promise<unknown> {
    const prefix = apiPrefix(this.session.profile?.instanceType ?? 'datacenter');
    const fields = [...WATCH_FIELDS];
    const sprintField = getSprintFieldId();
    if (sprintField && !fields.includes(sprintField)) fields.push(sprintField);
    return this.fetchFn(this.session, `${prefix}/search`, {
      method: 'POST',
      body: { jql, startAt: 0, maxResults: MAX_RESULTS, fields },
    });
  }

  /**
   * Run one cycle. Throws if Jira does — the caller decides whether that is
   * worth surfacing, and the stored snapshot is left alone so the next
   * successful cycle still reports everything that changed meanwhile.
   */
  async runCycle(): Promise<WatchEvent[]> {
    if (!this.session.isConnected) return [];

    const config = this.repo.getConfig();
    const project = this.projectKey();
    const windowMinutes = config.intervalMinutes * 2;

    const membershipResp = await this.search(
      `project = ${project} AND sprint in openSprints() AND assignee = currentUser()`,
    );
    const deltaResp = await this.search(
      `project = ${project} AND assignee = currentUser() AND updated >= -${windowMinutes}m`,
    );

    const next = toMap((membershipResp as Record<string, unknown>)?.issues);
    const delta = toMap((deltaResp as Record<string, unknown>)?.issues);
    const at = this.now().toISOString();

    const hadBaseline = this.repo.hasBaseline();
    const state = this.repo.getState();
    const events = diffSnapshots({
      prev: hadBaseline ? state.snapshot : null,
      next,
      delta,
      config,
      at,
    });

    this.repo.setState({
      snapshot: next,
      lastCycle: at,
      feed: [...events, ...state.feed].slice(0, FEED_CAP),
      ackedAt: state.ackedAt,
    });

    return events;
  }
}

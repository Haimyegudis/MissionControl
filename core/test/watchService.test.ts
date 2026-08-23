// WatchService cycle tests against a stubbed fetch: both queries issued with
// the watcher's own field list, comment totals read, state persisted, and a
// failed query leaving the stored snapshot untouched.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JiraSession } from '../src/jira/session.js';
import { setSprintFieldId } from '../src/jira/mapper.js';
import { MemoryKvStore } from '../src/storage/kv.js';
import { KvWatchRepo, WatchService } from '../src/watch/service.js';

const SPRINT_FIELD = 'customfield_10100';

function session(): JiraSession {
  const s = new JiraSession();
  s.activate(
    {
      jiraBaseUrl: 'https://jira.example.com/',
      jiraPat: 'token',
      authMode: 'token',
      defaultProjectKey: 'ISW',
    } as never,
    null,
  );
  return s;
}

function issue(over: Record<string, unknown> = {}) {
  return {
    key: 'ISW-1',
    fields: {
      summary: 'Fix the thing',
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      priority: { name: 'Major' },
      assignee: { displayName: 'Haim' },
      updated: '2026-08-23T09:00:00.000+0300',
      duedate: null,
      comment: { total: 1 },
      [SPRINT_FIELD]: ['com.x.Sprint@1[name=ISW Sprint 128,state=ACTIVE]'],
      ...over,
    },
  };
}

describe('WatchService', () => {
  let kv: MemoryKvStore;

  beforeEach(() => {
    kv = new MemoryKvStore();
    setSprintFieldId(SPRINT_FIELD);
  });

  function make(fetchFn: ReturnType<typeof vi.fn>) {
    const repo = new KvWatchRepo(kv);
    const service = new WatchService(
      session(),
      repo,
      () => 'ISW',
      fetchFn as never,
      () => new Date('2026-08-23T10:00:00Z'),
    );
    return { repo, service };
  }

  it('issues a membership and a delta query and stores the baseline silently', async () => {
    const fetchFn = vi.fn(async () => ({ issues: [issue()], total: 1 }));
    const { repo, service } = make(fetchFn);

    expect(await service.runCycle()).toEqual([]);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const membership = fetchFn.mock.calls[0][2] as { body: { jql: string; fields: string[] } };
    expect(membership.body.jql).toBe(
      'project = ISW AND sprint in openSprints() AND assignee = currentUser()',
    );
    expect(membership.body.fields).toContain('duedate');
    expect(membership.body.fields).toContain('comment');
    expect(membership.body.fields).toContain(SPRINT_FIELD);
    const delta = fetchFn.mock.calls[1][2] as { body: { jql: string } };
    expect(delta.body.jql).toBe('project = ISW AND assignee = currentUser() AND updated >= -10m');

    expect(repo.getState().snapshot['ISW-1']).toMatchObject({
      status: 'To Do',
      sprintName: 'ISW Sprint 128',
      commentCount: 1,
      priority: 'Major',
      assignee: 'Haim',
    });
    expect(repo.getState().lastCycle).toBe('2026-08-23T10:00:00.000Z');
  });

  it('reports changes on the second cycle and appends them to the feed', async () => {
    const fetchFn = vi.fn(async () => ({ issues: [issue()], total: 1 }));
    const { repo, service } = make(fetchFn);
    await service.runCycle();

    fetchFn.mockImplementation(async () => ({
      issues: [issue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } })],
      total: 1,
    }));
    const events = await service.runCycle();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'status', from: 'To Do', to: 'In Progress' });
    expect(repo.getState().feed).toHaveLength(1);
    expect(service.feed().unreadCount).toBe(1);
    service.ack();
    expect(service.feed().unreadCount).toBe(0);
  });

  it('leaves the stored snapshot untouched when a query fails', async () => {
    const fetchFn = vi.fn(async () => ({ issues: [issue()], total: 1 }));
    const { repo, service } = make(fetchFn);
    await service.runCycle();

    fetchFn.mockRejectedValue(new Error('network is down'));
    await expect(service.runCycle()).rejects.toThrow('network is down');
    expect(repo.getState().snapshot['ISW-1'].status).toBe('To Do');
  });

  it('returns no events and touches nothing when disconnected', async () => {
    const fetchFn = vi.fn(async () => ({ issues: [], total: 0 }));
    const repo = new KvWatchRepo(kv);
    const service = new WatchService(new JiraSession(), repo, () => 'ISW', fetchFn as never);
    expect(await service.runCycle()).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reads the sprint name from an object-shaped sprint field too', async () => {
    const fetchFn = vi.fn(async () => ({
      issues: [issue({ [SPRINT_FIELD]: [{ name: 'ISW Sprint 129', state: 'active' }] })],
      total: 1,
    }));
    const { repo, service } = make(fetchFn);
    await service.runCycle();
    expect(repo.getState().snapshot['ISW-1'].sprintName).toBe('ISW Sprint 129');
  });

  it('sanitizes config through the repo', () => {
    const { service } = make(vi.fn());
    expect(service.setConfig({ intervalMinutes: 99 }).intervalMinutes).toBe(5);
    expect(service.setConfig({ intervalMinutes: 15 }).intervalMinutes).toBe(15);
    expect(service.getConfig().intervalMinutes).toBe(15);
  });

  it('treats a corrupt stored state as no state', () => {
    kv.set('lists', 'watch.state', '{not json');
    const repo = new KvWatchRepo(kv);
    expect(repo.getState().snapshot).toEqual({});
    expect(repo.getState().feed).toEqual([]);
  });
});

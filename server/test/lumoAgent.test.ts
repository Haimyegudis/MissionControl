import { describe, it, expect } from 'vitest';
import { JiraSession } from '../src/jira/session.js';
import {
  askLumo,
  extractFirstJsonObject,
  type LumoTools,
} from '../src/ai/lumoAgent.js';
import type { JiraIssue, JiraIssueDetails, PagedResult } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(): JiraSession {
  const session = new JiraSession();
  session.activate(
    {
      email: 'me@example.com',
      jiraBaseUrl: 'https://jira.example.com/',
      jiraPat: 'secret-pat',
      instanceType: 'datacenter',
      defaultProjectKey: 'ISW',
    },
    { accountId: 'me', displayName: 'Haim Y', emailAddress: null, avatarUrl: null, active: true },
  );
  return session;
}

function makeIssue(key: string, overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    originalOrder: 0,
    isStarred: false,
    key,
    summary: `Summary of ${key}`,
    issueType: 'Bug',
    status: 'Open',
    statusCategory: 'new',
    priority: 'High',
    assignee: 'Haim Y',
    reporter: 'Someone',
    projectKey: 'ISW',
    sprint: null,
    created: '2026-08-01T10:00:00.000+02:00',
    updated: '2026-08-11T10:00:00.000+02:00',
    timeSpent: null,
    remainingEstimate: null,
    originalEstimate: null,
    epicKey: null,
    epicName: null,
    allSprints: [],
    workLoggedForPeriod: null,
    labels: [],
    components: [],
    fixVersions: [],
    boardNames: [],
    boardIds: [],
    isBlocked: false,
    isCritical: false,
    recentlyChanged: false,
    rejectReasons: null,
    ...overrides,
  } as JiraIssue;
}

function makeDetails(key: string, description: string): JiraIssueDetails {
  return {
    issue: makeIssue(key),
    description,
    descriptionHtml: null,
    comments: [],
    worklogs: [],
    transitions: [],
    allFields: [],
    browseUrl: `https://jira.example.com/browse/${key}`,
    parentKey: null,
    parentSummary: null,
    parentFieldLabel: null,
    timeline: [],
  };
}

interface ToolCallRecord {
  name: string;
  args: unknown[];
}

function makeTools(overrides: Partial<LumoTools> = {}): { tools: LumoTools; calls: ToolCallRecord[] } {
  const calls: ToolCallRecord[] = [];
  const tools: LumoTools = {
    async searchIssues(jql: string, startAt?: number, maxResults?: number): Promise<PagedResult<JiraIssue>> {
      calls.push({ name: 'searchIssues', args: [jql, startAt, maxResults] });
      const items = [makeIssue('ISW-1'), makeIssue('ISW-2', { status: 'Done', priority: 'Low' })];
      return { items, startAt: 0, maxResults: 20, total: 2, hasMore: false };
    },
    async getIssueDetails(key: string): Promise<JiraIssueDetails> {
      calls.push({ name: 'getIssueDetails', args: [key] });
      return makeDetails(key, 'A description.');
    },
    async addComment(key: string, body: string): Promise<void> {
      calls.push({ name: 'addComment', args: [key, body] });
    },
    ...overrides,
  };
  return { tools, calls };
}

/** runCli mock returning canned responses in sequence, recording prompts. */
function makeRunCli(responses: string[]): {
  runCli: (prompt: string, model: string) => Promise<string>;
  prompts: string[];
  models: string[];
} {
  const prompts: string[] = [];
  const models: string[] = [];
  let i = 0;
  return {
    runCli: async (prompt: string, model: string) => {
      prompts.push(prompt);
      models.push(model);
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return r;
    },
    prompts,
    models,
  };
}

function baseOptions(runCli: (p: string, m: string) => Promise<string>, tools: LumoTools) {
  return {
    turns: [{ role: 'user' as const, content: 'What is open in ISW?' }],
    projectKey: 'ISW',
    model: 'gpt-5',
    session: makeSession(),
    tools,
    runCli,
  };
}

// ---------------------------------------------------------------------------
// extractFirstJsonObject
// ---------------------------------------------------------------------------

describe('extractFirstJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(extractFirstJsonObject('{"summary":"hi","cards":[]}')).toEqual({
      summary: 'hi',
      cards: [],
    });
  });

  it('strips ```json fences', () => {
    const text = '```json\n{"summary":"fenced","cards":[]}\n```';
    expect(extractFirstJsonObject(text)).toEqual({ summary: 'fenced', cards: [] });
  });

  it('strips bare ``` fences', () => {
    const text = '```\n{"summary":"fenced2"}\n```';
    expect(extractFirstJsonObject(text)).toEqual({ summary: 'fenced2' });
  });

  it('handles nested braces', () => {
    const text = '{"a":{"b":{"c":1}},"summary":"deep"}';
    expect(extractFirstJsonObject(text)).toEqual({ a: { b: { c: 1 } }, summary: 'deep' });
  });

  it('ignores braces inside string literals', () => {
    const text = '{"summary":"use {curly} and } and { freely","cards":[]}';
    expect(extractFirstJsonObject(text)).toEqual({
      summary: 'use {curly} and } and { freely',
      cards: [],
    });
  });

  it('handles escaped quotes and backslashes inside strings', () => {
    const text = '{"summary":"she said \\"hi {\\" and C:\\\\path\\\\","cards":[]}';
    expect(extractFirstJsonObject(text)).toEqual({
      summary: 'she said "hi {" and C:\\path\\',
      cards: [],
    });
  });

  it('skips leading prose before the object', () => {
    const text = 'Sure! Here is the answer you wanted:\n{"summary":"ok","cards":[]}\nHope that helps.';
    expect(extractFirstJsonObject(text)).toEqual({ summary: 'ok', cards: [] });
  });

  it('returns null when there is no JSON object', () => {
    expect(extractFirstJsonObject('just some plain text, no json here')).toBeNull();
    expect(extractFirstJsonObject('')).toBeNull();
    expect(extractFirstJsonObject('{"unterminated": "yes"')).toBeNull();
  });

  it('skips invalid candidates and finds a later valid object', () => {
    const text = '{not json} but then {"summary":"later","cards":[]}';
    expect(extractFirstJsonObject(text)).toEqual({ summary: 'later', cards: [] });
  });
});

// ---------------------------------------------------------------------------
// askLumo — immediate summary
// ---------------------------------------------------------------------------

describe('askLumo — immediate summary', () => {
  it('returns summary and cards on a round-1 final answer', async () => {
    const { runCli, prompts, models } = makeRunCli([
      '{"summary":"All good.","cards":[{"source":"jira","title":"ISW-1","summary":"s","url":"https://x/browse/ISW-1","fields":{"status":"Open"}}]}',
    ]);
    const { tools } = makeTools();
    const statuses: string[] = [];
    const result = await askLumo({ ...baseOptions(runCli, tools), onStatus: (s) => statuses.push(s) });

    expect(result.summary).toBe('All good.');
    expect(result.cards).toEqual([
      {
        source: 'jira',
        title: 'ISW-1',
        summary: 's',
        url: 'https://x/browse/ISW-1',
        fields: { status: 'Open' },
      },
    ]);
    expect(statuses).toEqual(['Lumo is thinking...']);
    expect(models).toEqual(['gpt-5']);
    expect(prompts).toHaveLength(1);
  });

  it('composes the flat prompt with system template substitution and trailing instruction', async () => {
    const { runCli, prompts } = makeRunCli(['{"summary":"ok","cards":[]}']);
    const { tools } = makeTools();
    await askLumo({
      ...baseOptions(runCli, tools),
      turns: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'second question' },
      ],
    });

    const prompt = prompts[0];
    expect(prompt.startsWith('[SYSTEM]\n')).toBe(true);
    expect(prompt).toContain('You are Lumo, the friendly AI assistant inside Jira Mission Control.');
    // substitutions (trailing slash stripped from base URL)
    expect(prompt).toContain('Active Jira: https://jira.example.com');
    expect(prompt).toContain('Default project key: ISW');
    expect(prompt).toContain('Logged-in user: Haim Y');
    expect(prompt).not.toContain('__URL__');
    expect(prompt).not.toContain('__PROJ__');
    expect(prompt).not.toContain('__USER__');
    // turn blocks
    expect(prompt).toContain('[USER]\nfirst question');
    expect(prompt).toContain('[ASSISTANT]\nfirst answer');
    expect(prompt).toContain('[USER]\nsecond question');
    // trailing instruction
    expect(prompt.endsWith('Reply with ONE JSON object only. No prose, no markdown fences.')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// askLumo — tool loop
// ---------------------------------------------------------------------------

describe('askLumo — tool loop', () => {
  it('round 1 tool_calls then round 2 summary, with status sequence and [TOOL RESULTS] prompt', async () => {
    const round1 =
      '{"thinking":"look","tool_calls":[{"name":"search_issues","arguments":{"jql":"project=ISW AND statusCategory != Done"}}]}';
    const round2 = '{"summary":"Found 2 issues.","cards":[]}';
    const { runCli, prompts } = makeRunCli([round1, round2]);
    const { tools, calls } = makeTools();
    const statuses: string[] = [];

    const result = await askLumo({ ...baseOptions(runCli, tools), onStatus: (s) => statuses.push(s) });

    expect(result.summary).toBe('Found 2 issues.');
    expect(statuses).toEqual([
      'Lumo is thinking...',
      'Running search_issues...',
      'Refining (round 2)...',
    ]);

    // tool dispatched with the jql, capped at 20
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('searchIssues');
    expect(calls[0].args[0]).toBe('project=ISW AND statusCategory != Done');
    expect(calls[0].args[2]).toBe(20);

    // second prompt carries assistant raw JSON + [TOOL RESULTS] block
    expect(prompts).toHaveLength(2);
    const p2 = prompts[1];
    expect(p2).toContain('[ASSISTANT]\n');
    expect(p2).toContain('"tool_calls"');
    expect(p2).toContain('[TOOL RESULTS]\n--- search_issues ---\n');
    expect(p2).toContain(
      'Now respond with the final JSON: {"summary":"...","cards":[...]}. Do not call more tools unless absolutely needed.',
    );
    // projected result fields present
    expect(p2).toContain('"key":"ISW-1"');
    expect(p2).toContain('"summary":"Summary of ISW-1"');
    expect(p2).toContain('"status":"Open"');
    expect(p2).toContain('"priority":"High"');
    expect(p2).toContain('"assignee":"Haim Y"');
    expect(p2).toContain('"updated":"2026-08-11T10:00:00.000+02:00"');
    // projection excludes unlisted fields
    expect(p2).not.toContain('"statusCategory"');
    expect(p2).not.toContain('"epicKey"');
  });

  it('truncates tool results to 2000 chars', async () => {
    const round1 = '{"tool_calls":[{"name":"search_issues","arguments":{"jql":"project=ISW"}}]}';
    const round2 = '{"summary":"done","cards":[]}';
    const { runCli, prompts } = makeRunCli([round1, round2]);
    const { tools } = makeTools({
      async searchIssues(): Promise<PagedResult<JiraIssue>> {
        const items = Array.from({ length: 20 }, (_, i) =>
          makeIssue(`ISW-${i + 1}`, { summary: 'Z'.repeat(500) }),
        );
        return { items, startAt: 0, maxResults: 20, total: 20, hasMore: false };
      },
    });

    await askLumo(baseOptions(runCli, tools));

    const p2 = prompts[1];
    const marker = '--- search_issues ---\n';
    const start = p2.indexOf(marker) + marker.length;
    const end = p2.indexOf('\n', start);
    const resultText = p2.slice(start, end === -1 ? undefined : end);
    expect(resultText.length).toBe(2000);
  });

  it('truncates get_issue description to 1000 chars before stringify', async () => {
    const round1 = '{"tool_calls":[{"name":"get_issue","arguments":{"key":"ISW-9"}}]}';
    const round2 = '{"summary":"done","cards":[]}';
    const { runCli, prompts } = makeRunCli([round1, round2]);
    const { tools } = makeTools({
      async getIssueDetails(key: string) {
        return makeDetails(key, 'D'.repeat(1500));
      },
    });

    await askLumo(baseOptions(runCli, tools));

    const p2 = prompts[1];
    expect(p2).toContain('D'.repeat(1000));
    expect(p2).not.toContain('D'.repeat(1001));
  });

  it('dispatches add_comment and reports per-tool status', async () => {
    const round1 =
      '{"tool_calls":[{"name":"add_comment","arguments":{"key":"ISW-3","body":"hello"}},{"name":"get_issue","arguments":{"key":"ISW-3"}}]}';
    const round2 = '{"summary":"commented","cards":[]}';
    const { runCli, prompts } = makeRunCli([round1, round2]);
    const { tools, calls } = makeTools();
    const statuses: string[] = [];

    const result = await askLumo({ ...baseOptions(runCli, tools), onStatus: (s) => statuses.push(s) });

    expect(result.summary).toBe('commented');
    expect(statuses).toEqual([
      'Lumo is thinking...',
      'Running add_comment...',
      'Running get_issue...',
      'Refining (round 2)...',
    ]);
    expect(calls).toEqual([
      { name: 'addComment', args: ['ISW-3', 'hello'] },
      { name: 'getIssueDetails', args: ['ISW-3'] },
    ]);
    const p2 = prompts[1];
    expect(p2).toContain('--- add_comment ---');
    expect(p2).toContain('--- get_issue ---');
  });

  it('reports errors from unknown tools and throwing tools as tool results', async () => {
    const round1 =
      '{"tool_calls":[{"name":"bogus_tool","arguments":{}},{"name":"search_issues","arguments":{"jql":"x"}}]}';
    const round2 = '{"summary":"recovered","cards":[]}';
    const { runCli, prompts } = makeRunCli([round1, round2]);
    const { tools } = makeTools({
      async searchIssues(): Promise<PagedResult<JiraIssue>> {
        throw new Error('jql boom');
      },
    });

    const result = await askLumo(baseOptions(runCli, tools));
    expect(result.summary).toBe('recovered');
    const p2 = prompts[1];
    expect(p2).toContain('--- bogus_tool ---');
    expect(p2).toContain('Unknown tool');
    expect(p2).toContain('jql boom');
  });
});

// ---------------------------------------------------------------------------
// askLumo — fallbacks
// ---------------------------------------------------------------------------

describe('askLumo — fallbacks', () => {
  it('no JSON object → raw text as summary, zero cards', async () => {
    const { runCli } = makeRunCli(['Just a friendly plain-text hello with no json.']);
    const { tools } = makeTools();
    const result = await askLumo(baseOptions(runCli, tools));
    expect(result).toEqual({
      summary: 'Just a friendly plain-text hello with no json.',
      cards: [],
    });
  });

  it('max rounds exhausted → stopped message', async () => {
    const alwaysTools = '{"tool_calls":[{"name":"search_issues","arguments":{"jql":"project=ISW"}}]}';
    const { runCli, prompts } = makeRunCli([alwaysTools, alwaysTools, alwaysTools]);
    const { tools } = makeTools();
    const statuses: string[] = [];

    const result = await askLumo({ ...baseOptions(runCli, tools), onStatus: (s) => statuses.push(s) });

    expect(result).toEqual({
      summary: '(Stopped after max rounds without a final answer.)',
      cards: [],
    });
    expect(prompts).toHaveLength(3);
    expect(statuses).toEqual([
      'Lumo is thinking...',
      'Running search_issues...',
      'Refining (round 2)...',
      'Running search_issues...',
      'Refining (round 3)...',
      'Running search_issues...',
    ]);
  });
});

// ---------------------------------------------------------------------------
// askLumo — card normalization
// ---------------------------------------------------------------------------

describe('askLumo — card normalization', () => {
  it('defaults source to jira, coerces fields, drops bad urls', async () => {
    const response = JSON.stringify({
      summary: 'cards',
      cards: [
        { title: 'ISW-1', summary: 's1', fields: { status: 'Open', count: 3 } },
        { source: 'jira', title: 'ISW-2', summary: 's2', url: '', fields: null },
        { source: '', title: 42, summary: null, url: 123 },
        'not an object',
        null,
      ],
    });
    const { runCli } = makeRunCli([response]);
    const { tools } = makeTools();
    const result = await askLumo(baseOptions(runCli, tools));

    expect(result.cards).toEqual([
      { source: 'jira', title: 'ISW-1', summary: 's1', fields: { status: 'Open', count: '3' } },
      { source: 'jira', title: 'ISW-2', summary: 's2', fields: {} },
      { source: 'jira', title: '42', summary: '', fields: {} },
    ]);
    for (const card of result.cards) {
      expect('url' in card ? card.url : undefined).toBeUndefined();
    }
  });

  it('caps cards at 10', async () => {
    const cards = Array.from({ length: 15 }, (_, i) => ({
      title: `ISW-${i + 1}`,
      summary: `s${i + 1}`,
    }));
    const { runCli } = makeRunCli([JSON.stringify({ summary: 'many', cards })]);
    const { tools } = makeTools();
    const result = await askLumo(baseOptions(runCli, tools));
    expect(result.cards).toHaveLength(10);
    expect(result.cards[9].title).toBe('ISW-10');
  });

  it('non-array cards → empty', async () => {
    const { runCli } = makeRunCli(['{"summary":"no cards","cards":"nope"}']);
    const { tools } = makeTools();
    const result = await askLumo(baseOptions(runCli, tools));
    expect(result).toEqual({ summary: 'no cards', cards: [] });
  });
});

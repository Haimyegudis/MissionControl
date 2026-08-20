import { describe, it, expect, beforeEach } from 'vitest';
import { JiraSession } from '@mc/core';
import {
  askLumo,
  extractFirstJsonObject,
  isOperatorHowToQuery,
  hasAutomationTells,
  scrubOperatorAnswer,
  toolResultCap,
  confluenceFallbackQueries,
  extractPhysicalSheetSize,
  isInsufficientKnowledgeAnswer,
  resetLumoConversationContexts,
  type LumoTools,
} from '../src/ai/lumoAgent.js';
import {
  buildCopilotArgs,
  buildClaudeArgs,
  isClaudeModel,
  isOllamaModel,
  runClaudeCli,
  runCopilotCli,
  runOllama,
  selectCliRunner,
  CLAUDE_STDIN_TRIGGER,
} from '../src/ai/cliRunner.js';
import type { LumoToolset } from '../src/ai/lumoTools.js';
import { selectRelevantExcerpt } from '../src/ai/lumoTools.js';
import { parseEnvFile } from '../src/ai/lumo/env.js';
import { parseCsv } from '../src/ai/lumo/configControl.js';
import { parseConfluenceUrl } from '../src/ai/lumo/confluence.js';
import type { JiraIssue, JiraIssueDetails, PagedResult } from '@mc/core';

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

  it('filters cards to the allowed source set (jira/confluence/testrail/github/case)', async () => {
    const response = JSON.stringify({
      summary: 'filtered',
      cards: [
        { source: 'jira', title: 'ISW-1', summary: 'a' },
        { source: 'confluence', title: 'SWR page', summary: 'b', url: 'https://c/x' },
        { source: 'testrail', title: 'C123', summary: 'c' },
        { source: 'case', title: 'CS555', summary: 'd' },
        { source: 'github', title: 'PR #1', summary: 'e' },
        { source: 'systems-kb', title: 'K200', summary: 'dropped' },
        { source: 'reasoning', title: 'inference', summary: 'dropped' },
      ],
    });
    const { runCli } = makeRunCli([response]);
    const { tools } = makeTools();
    const result = await askLumo(baseOptions(runCli, tools));
    expect(result.cards.map((c) => c.source)).toEqual([
      'jira',
      'confluence',
      'testrail',
      'case',
      'github',
    ]);
  });
});

// ---------------------------------------------------------------------------
// askLumo — Lumo tool catalog dispatch
// ---------------------------------------------------------------------------

describe('askLumo — Lumo tool dispatch', () => {
  it('dispatches unknown-to-legacy names through tools.lumo with args and ctx', async () => {
    const seen: Array<{ name: string; args: unknown; ctx: unknown }> = [];
    const lumo: LumoToolset = {
      lookup_component: async (args, ctx) => {
        seen.push({ name: 'lookup_component', args, ctx });
        return { found: true, count: 1, results: [{ component: { id: 'EF501' } }] };
      },
    };
    const round1 =
      '{"tool_calls":[{"name":"lookup_component","arguments":{"query":"EF501"}}]}';
    const round2 = '{"summary":"EF501 is an e-fuse.","cards":[]}';
    const { runCli, prompts } = makeRunCli([round1, round2]);
    const { tools } = makeTools();
    tools.lumo = lumo;

    const statuses: string[] = [];
    const result = await askLumo({
      ...baseOptions(runCli, tools),
      model: 'claude-sonnet-4-5',
      onStatus: (s) => statuses.push(s),
    });

    expect(result.summary).toBe('EF501 is an e-fuse.');
    expect(seen).toHaveLength(1);
    expect(seen[0].args).toEqual({ query: 'EF501' });
    // ctx carries the runCli + model so reasoning tools can recurse
    expect(seen[0].ctx).toMatchObject({ model: 'claude-sonnet-4-5' });
    expect(statuses).toContain('Running lookup_component...');
    expect(prompts[1]).toContain('--- lookup_component ---');
    expect(prompts[1]).toContain('"EF501"');
  });

  it('lumo tool throwing surfaces as an {error} tool result, not a crash', async () => {
    const lumo: LumoToolset = {
      search_confluence_vectors: async () => {
        throw new Error('ollama down');
      },
    };
    const round1 =
      '{"tool_calls":[{"name":"search_confluence_vectors","arguments":{"query":"x"}}]}';
    const round2 = '{"summary":"handled","cards":[]}';
    const { runCli, prompts } = makeRunCli([round1, round2]);
    const { tools } = makeTools();
    tools.lumo = lumo;

    const result = await askLumo(baseOptions(runCli, tools));
    expect(result.summary).toBe('handled');
    expect(prompts[1]).toContain('ollama down');
  });

  it('still reports Unknown tool when the name is not in the lumo set either', async () => {
    const round1 = '{"tool_calls":[{"name":"nope_tool","arguments":{}}]}';
    const round2 = '{"summary":"ok","cards":[]}';
    const { runCli, prompts } = makeRunCli([round1, round2]);
    const { tools } = makeTools();
    tools.lumo = {};
    await askLumo(baseOptions(runCli, tools));
    expect(prompts[1]).toContain('Unknown tool: nope_tool');
  });

  it('caps tool calls at 5 per user message across rounds', async () => {
    const calls: string[] = [];
    const lumo: LumoToolset = {
      lookup_event: async (args) => {
        calls.push(String((args as Record<string, unknown>).n));
        return { found: false };
      },
    };
    const fourCalls = JSON.stringify({
      tool_calls: [1, 2, 3, 4].map((n) => ({ name: 'lookup_event', arguments: { n } })),
    });
    const threeMore = JSON.stringify({
      tool_calls: [5, 6, 7].map((n) => ({ name: 'lookup_event', arguments: { n } })),
    });
    const done = '{"summary":"done","cards":[]}';
    const { runCli, prompts } = makeRunCli([fourCalls, threeMore, done]);
    const { tools } = makeTools();
    tools.lumo = lumo;

    const result = await askLumo(baseOptions(runCli, tools));
    expect(result.summary).toBe('done');
    // 4 in round 1 + only 1 of 3 in round 2 = TOOL_CALL_LIMIT (5)
    expect(calls).toEqual(['1', '2', '3', '4', '5']);
    expect(prompts[2]).toContain('Tool call limit reached');
  });
});

// ---------------------------------------------------------------------------
// Per-tool truncation caps (Lumo parity)
// ---------------------------------------------------------------------------

describe('toolResultCap', () => {
  it('gives Lumo budgets per tool name', () => {
    expect(toolResultCap('get_cluster_release_notes')).toBe(30_000);
    expect(toolResultCap('search_config_control')).toBe(20_000);
    expect(toolResultCap('search_jira')).toBe(20_000);
    expect(toolResultCap('list_components')).toBe(60_000);
    expect(toolResultCap('lookup_component')).toBe(60_000);
    expect(toolResultCap('lookup_event')).toBe(60_000);
    expect(toolResultCap('lookup_parameter')).toBe(60_000);
    expect(toolResultCap('search_issues')).toBe(2000);
    expect(toolResultCap('anything_else')).toBe(2000);
  });

  it('lookup_component results above 2000 chars are NOT truncated (60k budget)', async () => {
    const big = 'X'.repeat(5000);
    const lumo: LumoToolset = {
      lookup_component: async () => ({ found: true, blob: big }),
    };
    const round1 = '{"tool_calls":[{"name":"lookup_component","arguments":{"query":"k"}}]}';
    const round2 = '{"summary":"ok","cards":[]}';
    const { runCli, prompts } = makeRunCli([round1, round2]);
    const { tools } = makeTools();
    tools.lumo = lumo;
    await askLumo(baseOptions(runCli, tools));
    const p2 = prompts[1];
    expect(p2).toContain(big);
    // Only inspect the tool-results region — the system prompt itself
    // legitimately mentions the "[...truncated]" marker.
    const toolBlock = p2.slice(p2.indexOf('--- lookup_component ---'));
    expect(toolBlock).not.toContain('[...truncated]');
  });

  it('get_cluster_release_notes truncates at 30k with an explicit marker', async () => {
    const big = 'R'.repeat(40_000);
    const lumo: LumoToolset = {
      get_cluster_release_notes: async () => ({ markdown: big }),
    };
    const round1 =
      '{"tool_calls":[{"name":"get_cluster_release_notes","arguments":{"cluster":"C12"}}]}';
    const round2 = '{"summary":"ok","cards":[]}';
    const { runCli, prompts } = makeRunCli([round1, round2]);
    const { tools } = makeTools();
    tools.lumo = lumo;
    await askLumo(baseOptions(runCli, tools));
    const p2 = prompts[1];
    expect(p2).toContain('[...truncated]');
    const marker = '--- get_cluster_release_notes ---\n';
    const start = p2.indexOf(marker) + marker.length;
    const end = p2.indexOf('\n[...truncated]', start);
    expect(end - start).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// Mandatory Confluence fallback for insufficient local-knowledge answers
// ---------------------------------------------------------------------------

describe('Confluence knowledge fallback', () => {
  it('recognizes insufficient answers and rewrites S4 sheet-fed size terminology', () => {
    expect(isInsufficientKnowledgeAnswer('Not documented — I could not find it.')).toBe(true);
    expect(isInsufficientKnowledgeAnswer('The maximum is 750 × 530 mm.')).toBe(false);
    expect(
      confluenceFallbackQueries('What is the substrate maximum size in S4 sheetfed?', 'S4')[0],
    ).toContain('automatic paper size measurement');
  });

  it('selects a relevant passage beyond a long page preamble', () => {
    const content =
      'Revision history and unrelated material. '.repeat(400) +
      'Allowed Size: Width=745mm-750mm, Length=525mm-530mm. Enhancement details follow.';
    const excerpt = selectRelevantExcerpt(
      content,
      'What is the substrate maximum size in S4 sheetfed?',
      2500,
    );
    expect(excerpt).toContain('Width=745mm-750mm');
    expect(excerpt).toContain('Length=525mm-530mm');
  });

  it('extracts the maximum dimensions from a Confluence allowed-size range', () => {
    expect(
      extractPhysicalSheetSize({
        documents: [
          {
            title: 'Automatic paper size measurement',
            url: 'https://confluence.example/pages/416124688',
            content: 'Full Format=750X530, Allowed Size: Width=745mm-750mm, Length=525mm-530mm',
          },
        ],
      }),
    ).toEqual({
      widthMm: 750,
      lengthMm: 530,
      title: 'Automatic paper size measurement',
      url: 'https://confluence.example/pages/416124688',
    });
  });

  it('automatically searches and reads Confluence before accepting Not documented', async () => {
    const calls: string[] = [];
    const lumo: LumoToolset = {
      lookup_parameter: async () => ({ found: false }),
      search_confluence_vectors: async () => {
        calls.push('vectors');
        return [
          {
            documentId: '416124688',
            title: 'Automatic paper size measurement - Printing - S4/5 - SW Requirements',
            url: 'https://confluence.example/pages/viewpage.action?pageId=416124688',
          },
        ];
      },
      search_confluence_docs: async () => {
        calls.push('docs');
        return {
          documents: [
            {
              title: 'Automatic paper size measurement - Printing - S4/5 - SW Requirements',
              content: 'Allowed Size: Width=745mm-750mm, Length=525mm-530mm.',
            },
          ],
        };
      },
    };
    const { tools } = makeTools();
    tools.lumo = lumo;
    const { runCli, prompts } = makeRunCli([
      '{"tool_calls":[{"name":"lookup_parameter","arguments":{"query":"substrate maximum size","series":"S4"}}]}',
      '{"summary":"Not documented — I could not find it.","cards":[]}',
      '{"summary":"The maximum S4 sheet-fed substrate size is 750 × 530 mm.","cards":[]}',
    ]);

    const result = await askLumo({
      ...baseOptions(runCli, tools),
      turns: [{ role: 'user', content: 'What is the substrate maximum size in S4 sheetfed?' }],
    });

    expect(result.summary).toContain('750 × 530 mm');
    expect(calls).toEqual(expect.arrayContaining(['vectors', 'docs']));
    expect(prompts).toHaveLength(2);
    expect(result.cards[0]).toEqual(
      expect.objectContaining({ source: 'confluence', title: expect.stringContaining('Automatic paper size') }),
    );
  });
});

// ---------------------------------------------------------------------------
// Operator-answer scrubber (Lumo parity)
// ---------------------------------------------------------------------------

describe('operator-answer scrubber', () => {
  it('classifies operator how-to queries', () => {
    expect(isOperatorHowToQuery('how to replace BID')).toBe(true);
    expect(isOperatorHowToQuery('how do I run the calibration wizard')).toBe(true);
    expect(isOperatorHowToQuery('how to simulate BID replacement in automation')).toBe(false);
    expect(isOperatorHowToQuery('what is the blanket')).toBe(false);
  });

  it('detects automation tells', () => {
    expect(hasAutomationTells('call S6PRESS.PLC.WaitForNodeValue("x")')).toBe(true);
    expect(hasAutomationTells('verify gInterface.BKT.Stir updates')).toBe(true);
    expect(hasAutomationTells('per SWOFEK-746 the wizard validates')).toBe(true);
    expect(hasAutomationTells('Open HMI, press Service, select Replace BID.')).toBe(false);
  });

  it('replaces a contaminated operator answer with the honest template', () => {
    const scrubbed = scrubOperatorAnswer(
      'how to replace BID',
      'Call S6PRESS.PLC.WaitForNodeValue("OPCUAInterface.PressState","Standby") then swap the BID.',
    );
    expect(scrubbed).toContain('Operator procedure not in indexed Confluence docs');
    expect(scrubbed).not.toContain('WaitForNodeValue');
  });

  it('leaves clean operator answers and non-operator questions untouched', () => {
    const clean = 'To replace BID: 1. Open Menu. 2. Select BID Replacement. 3. Click Finished.';
    expect(scrubOperatorAnswer('how to replace BID', clean)).toBe(clean);
    const techy = 'Use S6PRESS.PLC.WaitForNodeValue in the test.';
    expect(scrubOperatorAnswer('what helper waits for a node value?', techy)).toBe(techy);
  });

  it('applies the scrubber to the final summary in the agent loop', async () => {
    const response = JSON.stringify({
      summary: 'Call S6PRESS.PLC.WaitForNodeValue("x","Standby") then replace the unit.',
      cards: [],
    });
    const { runCli } = makeRunCli([response]);
    const { tools } = makeTools();
    const result = await askLumo({
      ...baseOptions(runCli, tools),
      turns: [{ role: 'user', content: 'how to replace BID' }],
    });
    expect(result.summary).toContain('Operator procedure not in indexed Confluence docs');
    expect(result.summary).not.toContain('WaitForNodeValue');
  });
});

// ---------------------------------------------------------------------------
// set_context — per-conversation Active Context
// ---------------------------------------------------------------------------

describe('askLumo — set_context', () => {
  beforeEach(() => resetLumoConversationContexts());

  it('injects the assumed-default series into the prompt', async () => {
    const { runCli, prompts } = makeRunCli(['{"summary":"ok","cards":[]}']);
    const { tools } = makeTools();
    await askLumo(baseOptions(runCli, tools));
    expect(prompts[0]).toContain('## Active Context\nSeries: S6 (assumed default');
  });

  it('persists set_context across requests of the same conversation', async () => {
    const first = [{ role: 'user' as const, content: 'unique-context-conversation' }];
    {
      const { runCli } = makeRunCli([
        '{"set_context":{"project":"KEDEM","series":"S4"},"summary":"noted","cards":[]}',
      ]);
      const { tools } = makeTools();
      const result = await askLumo({ ...baseOptions(runCli, tools), turns: first });
      expect(result.summary).toBe('noted');
    }
    {
      const { runCli, prompts } = makeRunCli(['{"summary":"again","cards":[]}']);
      const { tools } = makeTools();
      await askLumo({
        ...baseOptions(runCli, tools),
        turns: [
          ...first,
          { role: 'assistant', content: 'noted' },
          { role: 'user', content: 'and now?' },
        ],
      });
      expect(prompts[0]).toContain('## Active Context\nProject: KEDEM | Series: S4\n');
      expect(prompts[0]).not.toContain('Series: S4 (assumed default');
    }
  });

  it('applies set_context arriving alongside tool_calls before the next round', async () => {
    const round1 = JSON.stringify({
      set_context: { series: 'S3' },
      tool_calls: [{ name: 'search_issues', arguments: { jql: 'project=ISW' } }],
    });
    const round2 = '{"summary":"done","cards":[]}';
    const { runCli, prompts } = makeRunCli([round1, round2]);
    const { tools } = makeTools();
    await askLumo({
      ...baseOptions(runCli, tools),
      turns: [{ role: 'user', content: 'another-unique-conversation' }],
    });
    expect(prompts[1]).toContain('## Active Context\nSeries: S3\n');
    expect(prompts[1]).not.toContain('Series: S3 (assumed default');
  });
});

// ---------------------------------------------------------------------------
// CLI backend selection (claude vs copilot)
// ---------------------------------------------------------------------------

describe('cliRunner backend selection', () => {
  it('uses Yaki parity: Sonnet 5 with 1M context and medium reasoning', () => {
    const args = buildCopilotArgs('claude-sonnet-5');
    expect(args).toContain('claude-sonnet-5');
    expect(args.join(' ')).toContain('instructions and response contract');
    expect(args).not.toContain('--no-custom-instructions');
    expect(args.slice(args.indexOf('--context'), args.indexOf('--context') + 2)).toEqual([
      '--context',
      'long_context',
    ]);
    expect(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2)).toEqual([
      '--effort',
      'medium',
    ]);
  });

  it('everything runs on Copilot; Claude CLI only behind LUMO_USE_CLAUDE_CLI=1', () => {
    expect(isClaudeModel('claude-sonnet-4-5')).toBe(true);
    expect(isClaudeModel('gpt-4o-mini')).toBe(false);
    expect(isOllamaModel('ollama:gemma3:4b')).toBe(true);
    expect(selectCliRunner('ollama:gemma3:4b')).toBe(runOllama);
    // Default: Copilot for every model id (Copilot hosts the claude-* roster).
    delete process.env.LUMO_USE_CLAUDE_CLI;
    expect(selectCliRunner('claude-sonnet-4.6')).toBe(runCopilotCli);
    expect(selectCliRunner('gpt-5.2')).toBe(runCopilotCli);
    // Dev escape hatch.
    process.env.LUMO_USE_CLAUDE_CLI = '1';
    expect(selectCliRunner('claude-sonnet-4.6')).toBe(runClaudeCli);
    expect(selectCliRunner('gpt-5.2')).toBe(runCopilotCli);
    delete process.env.LUMO_USE_CLAUDE_CLI;
  });

  it('parses simple KEY=VALUE .env files without logging values', () => {
    const parsed = parseEnvFile(
      '# comment\nCONFLUENCE_PAT=abc123\nQUOTED="with spaces"\nSINGLE=\'sq\'\n\nBROKEN LINE\n=novalue\n',
    );
    expect(parsed).toEqual({ CONFLUENCE_PAT: 'abc123', QUOTED: 'with spaces', SINGLE: 'sq' });
  });

  it('parses CSV with quoted cells, embedded commas and CRLF', () => {
    const rows = parseCsv('A,B,C\r\n1,"x, y","he said ""hi"""\r\n2,,z\r\n');
    expect(rows).toEqual([
      ['A', 'B', 'C'],
      ['1', 'x, y', 'he said "hi"'],
      ['2', '', 'z'],
    ]);
  });

  it('extracts Confluence page ids from all URL forms', () => {
    expect(parseConfluenceUrl('https://c/pages/viewpage.action?pageId=12345').pageId).toBe('12345');
    expect(parseConfluenceUrl('https://c/pages/9876/Some+Title').pageId).toBe('9876');
    expect(parseConfluenceUrl('https://c/display/SENG/My+Page')).toEqual({
      pageId: null,
      spaceKey: 'SENG',
      pageTitle: 'My Page',
    });
  });

  it('builds the Claude CLI argument list (system-prompt-file, text output, no tools)', () => {
    const args = buildClaudeArgs('C:\\tmp\\p.txt', 'claude-sonnet-4-5');
    expect(args).toEqual([
      '-p',
      '--system-prompt-file',
      'C:\\tmp\\p.txt',
      '--strict-mcp-config',
      '--model',
      'claude-sonnet-4-5',
      '--output-format',
      'text',
      '--tools',
      'none',
    ]);
    expect(CLAUDE_STDIN_TRIGGER).toContain('instructions and response contract');
  });
});

/**
 * Lumo agent loop (ui-parity-contract.md §13.1).
 *
 * Always uses the CLI path: compose a flat prompt, run the CLI, extract the
 * first balanced JSON object, dispatch tool calls, loop max 3 rounds.
 */
import type { JiraSession } from '../jira/session.js';
import type { JiraIssue, JiraIssueDetails, PagedResult } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LumoCard {
  /** "jira" default. */
  source: string;
  title: string;
  summary: string;
  url?: string;
  fields: Record<string, string>;
}

export interface LumoResult {
  summary: string;
  cards: LumoCard[];
}

export interface LumoTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Tool surface Lumo dispatches against. Structurally compatible with
 * JiraIssueService (searchIssues/getIssueDetails/addComment) so the route can
 * pass the service instance directly.
 */
export interface LumoTools {
  searchIssues(jql: string, startAt?: number, maxResults?: number): Promise<PagedResult<JiraIssue>>;
  getIssueDetails(issueKey: string): Promise<JiraIssueDetails>;
  addComment(issueKey: string, body: string): Promise<void>;
}

export type RunCliFn = (prompt: string, model: string, signal?: AbortSignal) => Promise<string>;

export interface AskLumoOptions {
  turns: LumoTurn[];
  projectKey: string;
  model: string;
  session: JiraSession;
  tools: LumoTools;
  runCli: RunCliFn;
  onStatus?: (status: string) => void;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Constants (§13.1 verbatim)
// ---------------------------------------------------------------------------

const MAX_ROUNDS = 3;
const TOOL_RESULT_MAX_CHARS = 2000;
const DESCRIPTION_MAX_CHARS = 1000;
const SEARCH_MAX_RESULTS = 20;
const MAX_CARDS = 10;

const FINAL_JSON_INSTRUCTION =
  'Now respond with the final JSON: {"summary":"...","cards":[...]}. Do not call more tools unless absolutely needed.';

const REPLY_INSTRUCTION = 'Reply with ONE JSON object only. No prose, no markdown fences.';

export const SYSTEM_PROMPT_TEMPLATE = `You are Lumo, the friendly AI assistant inside Jira Mission Control.
Active Jira: __URL__
Default project key: __PROJ__
Logged-in user: __USER__

## Tools
Call ONE OR MORE of these by emitting JSON. Do NOT invent issue data.
- search_issues(jql: string)             -> up to 20 issues matching JQL
- get_issue(key: string)                 -> details of one issue
- add_comment(key: string, body: string) -> append a comment

## Response format (STRICT - emit ONE JSON object, no prose around it)
Round 1 (gather): {"thinking":"...", "tool_calls":[{"name":"search_issues","arguments":{"jql":"project=__PROJ__ AND statusCategory != Done"}}]}
Final answer:    {"summary":"Plain-English answer in 1-4 sentences.", "cards":[{"source":"jira","title":"ISW-123","url":"__URL__/browse/ISW-123","summary":"...","fields":{"status":"Open","priority":"High"}}]}

## Rules
- If the user asks about issues, ALWAYS call search_issues or get_issue first - never fabricate keys/statuses.
- JQL: project=__PROJ__ unless user names another. Use ORDER BY updated DESC by default.
- Greetings / non-Jira chitchat: skip tools, return {"summary":"...","cards":[]} immediately.
- Cap cards at 10. Keep summaries to 1-2 sentences.
- After receiving [TOOL RESULTS], return the final {summary, cards} JSON. Don't loop forever.`;

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/**
 * Extract the first balanced JSON object from CLI output. Strips ```json /
 * ``` fences, then brace-counts respecting string literals and backslash
 * escapes. Returns the parsed object or null when none parses.
 */
export function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '');
  let searchFrom = 0;
  while (searchFrom < cleaned.length) {
    const start = cleaned.indexOf('{', searchFrom);
    if (start === -1) return null;
    const end = findBalancedEnd(cleaned, start);
    if (end !== -1) {
      try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // fall through — try the next '{'
      }
    }
    searchFrom = start + 1;
  }
  return null;
}

/** Index of the brace closing the object opened at `start`, or -1. */
function findBalancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

export async function askLumo(options: AskLumoOptions): Promise<LumoResult> {
  const { projectKey, model, session, tools, runCli, onStatus, signal } = options;
  const status = (s: string): void => {
    onStatus?.(s);
  };

  const system = buildSystemPrompt(session, projectKey);
  const turns: LumoTurn[] = [...options.turns];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    status(round === 0 ? 'Lumo is thinking...' : `Refining (round ${round + 1})...`);

    const prompt = composePrompt(system, turns);
    const raw = await runCli(prompt, model, signal);
    const obj = extractFirstJsonObject(raw);

    if (obj === null) {
      return { summary: raw, cards: [] };
    }

    if (obj.summary !== undefined) {
      return { summary: toStr(obj.summary), cards: normalizeCards(obj.cards) };
    }

    if (Array.isArray(obj.tool_calls)) {
      let block = '[TOOL RESULTS]\n';
      for (const call of obj.tool_calls) {
        const name = toStr(isRecord(call) ? call.name : '');
        status(`Running ${name}...`);
        const args = isRecord(call) && isRecord(call.arguments) ? call.arguments : {};
        const result = await dispatchTool(tools, name, args);
        let resultText = JSON.stringify(result) ?? 'null';
        if (resultText.length > TOOL_RESULT_MAX_CHARS) {
          resultText = resultText.slice(0, TOOL_RESULT_MAX_CHARS);
        }
        block += `--- ${name} ---\n${resultText}\n`;
      }
      block += FINAL_JSON_INSTRUCTION;
      turns.push({ role: 'assistant', content: JSON.stringify(obj) });
      turns.push({ role: 'user', content: block });
      continue;
    }

    // Object without summary or tool_calls — treat like no usable answer.
    return { summary: raw, cards: [] };
  }

  return { summary: '(Stopped after max rounds without a final answer.)', cards: [] };
}

function buildSystemPrompt(session: JiraSession, projectKey: string): string {
  const url = (session.profile?.jiraBaseUrl ?? '').replace(/\/+$/, '');
  const user = session.currentUser?.displayName ?? session.profile?.email ?? 'Unknown';
  return SYSTEM_PROMPT_TEMPLATE.replace(/__URL__/g, url)
    .replace(/__PROJ__/g, projectKey)
    .replace(/__USER__/g, user);
}

/** `[SYSTEM]\n{system}\n\n` + per-turn `[USER]`/`[ASSISTANT]` blocks + reply instruction. */
function composePrompt(system: string, turns: LumoTurn[]): string {
  const parts = [`[SYSTEM]\n${system}`];
  for (const turn of turns) {
    parts.push(`[${turn.role === 'user' ? 'USER' : 'ASSISTANT'}]\n${turn.content}`);
  }
  parts.push(REPLY_INSTRUCTION);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

async function dispatchTool(
  tools: LumoTools,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    switch (name) {
      case 'search_issues': {
        const page = await tools.searchIssues(toStr(args.jql), 0, SEARCH_MAX_RESULTS);
        return page.items.map((issue) => ({
          key: issue.key,
          summary: issue.summary,
          status: issue.status,
          priority: issue.priority,
          assignee: issue.assignee,
          updated: issue.updated,
        }));
      }
      case 'get_issue': {
        const details = await tools.getIssueDetails(toStr(args.key));
        const issue = details.issue;
        return {
          key: issue.key,
          summary: issue.summary,
          status: issue.status,
          priority: issue.priority,
          assignee: issue.assignee,
          reporter: issue.reporter,
          created: issue.created,
          updated: issue.updated,
          url: details.browseUrl,
          description: (details.description ?? '').slice(0, DESCRIPTION_MAX_CHARS),
        };
      }
      case 'add_comment': {
        const key = toStr(args.key);
        await tools.addComment(key, toStr(args.body));
        return { ok: true, message: `Comment added to ${key}.` };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Card normalization
// ---------------------------------------------------------------------------

function normalizeCards(raw: unknown): LumoCard[] {
  if (!Array.isArray(raw)) return [];
  const cards: LumoCard[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const card: LumoCard = {
      source:
        typeof item.source === 'string' && item.source.trim().length > 0 ? item.source : 'jira',
      title: toStr(item.title),
      summary: toStr(item.summary),
      fields: normalizeFields(item.fields),
    };
    if (typeof item.url === 'string' && item.url.trim().length > 0) {
      card.url = item.url;
    }
    cards.push(card);
    if (cards.length >= MAX_CARDS) break;
  }
  return cards;
}

function normalizeFields(raw: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!isRecord(raw)) return fields;
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    fields[key] =
      typeof value === 'string'
        ? value
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : String(v);
}

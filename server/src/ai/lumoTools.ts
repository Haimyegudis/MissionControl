/**
 * Lumo tool catalog for Lumo — a LumoTools superset giving the Lumo agent
 * every capability of the Lumo assistant (C:\APPS\Lumo), reading Lumo's
 * knowledge assets in place (LUMO_ROOT) and using JiraWeb's own Jira/TestRail
 * sessions for live systems.
 *
 * Every tool returns a plain data object; failures come back as
 * {error: '...'} — never a throw — so the agent loop can feed the model.
 */
import type { JiraSession } from '@mc/core';
import sanitizeHtml from 'sanitize-html';
import type { ConfluenceService } from '@mc/core';
import { parseConfluenceUrl } from './lumo/confluence.js';
import {
  findHelpersForComponent,
  findSignalInCode,
  findSignalUsage,
  findTestScenarios,
  listComponents,
  lookupCalibrationPattern,
  lookupComponent,
  lookupEvent,
  lookupFailureMethodology,
  lookupInvestigation,
  lookupParameter,
} from './lumo/brain.js';
import {
  getClusterReleaseNotes,
  getConfluencePage,
  searchConfluence,
  searchConfluenceDocs,
} from './lumo/confluence.js';
import { listConfigClusters, searchConfigControl } from './lumo/configControl.js';
import { searchJiraIssue, searchJiraTool } from './lumo/jiraSearch.js';
import {
  searchCodeVectors,
  searchConfluenceVectors,
  searchPressIssues,
  searchTestrailVectors,
  searchTmcVectors,
} from './lumo/vectors.js';
import { getLumoSecret } from './lumo/env.js';

type Rec = Record<string, any>;

/** Per-call context handed down by the agent loop (for the reasoning tools). */
export interface LumoToolContext {
  runCli?: (prompt: string, model: string, signal?: AbortSignal) => Promise<string>;
  model?: string;
  signal?: AbortSignal;
}

export type LumoToolFn = (args: Rec, ctx?: LumoToolContext) => Promise<unknown>;
export type LumoToolset = Record<string, LumoToolFn>;

// ---------------------------------------------------------------------------
// TestRail (over JiraWeb's own TestRailService)
// ---------------------------------------------------------------------------

/** Narrow structural view of TestRailService used by the tools. */
export interface TestRailToolsDep {
  requireClient(): {
    getSuites(projectId: number): Promise<unknown[]>;
    getRaw(cmd: string): Promise<unknown>;
  };
}

function defaultTestRailProjectId(args: Rec): number {
  const fromArgs = Number(args.projectId);
  if (Number.isFinite(fromArgs) && fromArgs > 0) return fromArgs;
  const fromEnv = Number(getLumoSecret('TESTRAIL_PROJECT_ID'));
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 806;
}

function trError(err: unknown): Rec {
  const message = err instanceof Error ? err.message : String(err);
  return { error: /not connected/i.test(message) ? 'TestRail is not connected.' : message };
}

async function getTestrailCase(testrail: TestRailToolsDep | undefined, args: Rec): Promise<unknown> {
  if (!testrail) return { error: 'TestRail is not configured.' };
  const id = String(args.id ?? '').replace(/^C/i, '').trim();
  if (!id) return { error: 'id required' };
  try {
    return await testrail.requireClient().getRaw(`get_case/${id}`);
  } catch (err) {
    return trError(err);
  }
}

async function getTestrailCasesByJira(
  testrail: TestRailToolsDep | undefined,
  args: Rec,
): Promise<unknown> {
  if (!testrail) return { error: 'TestRail is not configured.' };
  const jiraId = String(args.jiraId ?? '').trim();
  if (!jiraId) return { error: 'jiraId required' };
  try {
    const client = testrail.requireClient();
    const projectId = defaultTestRailProjectId(args);
    const suites = (await client.getSuites(projectId)) as Rec[];
    const matches: Rec[] = [];
    for (const suite of suites.slice(0, 25)) {
      if (matches.length >= 50) break;
      const raw = (await client.getRaw(
        `get_cases/${projectId}&suite_id=${suite.id}&refs=${encodeURIComponent(jiraId)}`,
      )) as Rec;
      const cases: Rec[] = Array.isArray(raw) ? raw : (raw?.cases as Rec[]) || [];
      for (const c of cases) {
        matches.push({
          id: c.id,
          title: c.title,
          suiteId: suite.id,
          suiteName: suite.name,
          refs: c.refs,
          url: `https://hp-testrail.external.hp.com/index.php?/cases/view/${c.id}`,
        });
        if (matches.length >= 50) break;
      }
    }
    return { jiraId, count: matches.length, cases: matches };
  } catch (err) {
    return trError(err);
  }
}

async function getTestrailSuites(testrail: TestRailToolsDep | undefined, args: Rec): Promise<unknown> {
  if (!testrail) return { error: 'TestRail is not configured.' };
  try {
    const suites = (await testrail.requireClient().getSuites(defaultTestRailProjectId(args))) as Rec[];
    return suites.map((s) => ({ id: s.id, name: s.name, description: s.description ?? null }));
  } catch (err) {
    return trError(err);
  }
}

// ---------------------------------------------------------------------------
// GitHub (best-effort REST; Lumo uses an MCP exe — degrade when unconfigured)
// ---------------------------------------------------------------------------

async function getGithubPr(args: Rec): Promise<unknown> {
  const patToken = getLumoSecret('GITHUB_PAT');
  if (!patToken) return { error: 'github not configured' };
  const repo = String(args.repo ?? '').trim();
  const prNumber = parseInt(String(args.pullRequestNumber ?? ''), 10);
  if (!repo || !Number.isFinite(prNumber)) return { error: 'repo and pullRequestNumber required' };
  const apiBase = (getLumoSecret('HP_GITHUB_API_BASE') || 'https://api.github.com').replace(/\/+$/, '');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const resp = await fetch(`${apiBase}/repos/${repo}/pulls/${prNumber}`, {
        headers: {
          Authorization: `Bearer ${patToken}`,
          Accept: 'application/vnd.github+json',
        },
        signal: controller.signal,
      });
      if (!resp.ok) return { error: `GitHub HTTP ${resp.status}` };
      const pr = (await resp.json()) as Rec;
      return {
        repo,
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.user?.login,
        url: pr.html_url,
        body: String(pr.body || '').slice(0, 2000),
        merged: pr.merged ?? null,
        baseBranch: pr.base?.ref,
        headBranch: pr.head?.ref,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Reasoning tools (recursive CLI calls with Lumo's sub-prompts)
// ---------------------------------------------------------------------------

async function reasonAboutTopic(args: Rec, ctx?: LumoToolContext): Promise<unknown> {
  const topic = String(args.topic ?? '').trim();
  if (!topic) return { error: 'topic required' };
  if (!ctx?.runCli) return { error: 'reasoning backend unavailable' };
  const knownContext = String(args.knownContext ?? '').trim();
  const reasoningPrompt = `You are a senior QA engineer answering an S6 printing press question. The user asked: "${topic}".

Use general engineering knowledge of industrial control systems, PLCs, EtherCAT, power distribution, and the S6 product family to give a direct, confident answer in the assistant's own voice.

Rules:
- Lead with a one-sentence answer.
- Then explain in 3-6 short bullets.
- DO NOT add disclaimers, source flags, or hedging like "I couldn't find", "based on general knowledge", "this is inference", etc.
- DO NOT invent specific signal paths, parameter names, or event names. If a specific name is genuinely needed, write [TBD - check SWR].

Known context already gathered:
${knownContext || '(none)'}

Return plain text (no JSON, no markdown fences).`;
  try {
    const raw = await ctx.runCli(reasoningPrompt, ctx.model || 'claude-sonnet-5', ctx.signal);
    return { answer: String(raw || '').slice(0, 3000) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function synthesizeFindings(args: Rec, ctx?: LumoToolContext): Promise<unknown> {
  const question = String(args.question ?? '').trim();
  const findings = String(args.findings ?? '').trim();
  if (!question || !findings) return { error: 'question and findings required' };
  if (!ctx?.runCli) return { error: 'reasoning backend unavailable' };
  const synthPrompt = `Answer this question directly by combining the findings below.

QUESTION: ${question}

FINDINGS:
${findings.slice(0, 12000)}

Rules:
- Speak in the assistant's voice. Be direct.
- DO NOT name internal tools, do NOT say "based on vector search", do NOT add source disclaimers.
- DO NOT add hedging language about not finding things.
- 1-3 short paragraphs of plain text.`;
  try {
    const raw = await ctx.runCli(synthPrompt, ctx.model || 'claude-sonnet-5', ctx.signal);
    return { answer: String(raw || '').slice(0, 3000) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Toolset factory
// ---------------------------------------------------------------------------

export interface BuildLumoToolsOptions {
  session: JiraSession;
  testrail?: TestRailToolsDep;
  confluence?: ConfluenceService;
}

function pageText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Select high-signal passages instead of blindly taking the page beginning. */
export function selectRelevantExcerpt(content: string, prompt: string, maxChars = 8000): string {
  if (content.length <= maxChars) return content;
  const stop = new Set(['what', 'where', 'when', 'which', 'with', 'from', 'that', 'this', 'does', 'have', 'into']);
  const terms = new Set(
    (prompt.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((term) => term.length >= 3 && !stop.has(term)),
  );
  const lowerPrompt = prompt.toLowerCase();
  if (/\b(?:maximum|maximal|max|minimum|min)\b/.test(lowerPrompt)) {
    ['maximum', 'maximal', 'minimum', 'allowed', 'limit'].forEach((term) => terms.add(term));
  }
  if (/\b(?:substrate|paper|sheet|media)\b/.test(lowerPrompt)) {
    ['substrate', 'paper', 'sheet', 'media'].forEach((term) => terms.add(term));
  }
  if (/\b(?:size|dimension|width|length)\b/.test(lowerPrompt)) {
    ['size', 'dimension', 'width', 'length'].forEach((term) => terms.add(term));
  }
  if (/\b(?:sheet[ -]?fed|cut[ -]?sheet)\b/.test(lowerPrompt)) {
    ['sheetfed', 'eilat', 'shani'].forEach((term) => terms.add(term));
  }

  const lower = content.toLowerCase();
  const candidates: Array<{ start: number; end: number; score: number }> = [];
  for (const term of terms) {
    let index = lower.indexOf(term);
    let occurrences = 0;
    while (index >= 0 && occurrences < 30) {
      const start = Math.max(0, index - 700);
      const end = Math.min(content.length, index + term.length + 900);
      const window = lower.slice(start, end);
      let score = 0;
      for (const candidate of terms) {
        if (window.includes(candidate)) score += candidate === term ? 2 : 1;
      }
      candidates.push({ start, end, score });
      occurrences += 1;
      index = lower.indexOf(term, index + term.length);
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.start - b.start);

  const selected: Array<{ start: number; end: number }> = [];
  let used = 0;
  for (const candidate of candidates) {
    if (selected.some((range) => candidate.start < range.end && candidate.end > range.start)) continue;
    const length = candidate.end - candidate.start;
    if (used + length > maxChars && selected.length > 0) continue;
    selected.push({ start: candidate.start, end: candidate.end });
    used += length;
    if (used >= maxChars - 500) break;
  }
  if (!selected.length) return content.slice(0, maxChars);
  selected.sort((a, b) => a.start - b.start);
  return selected.map((range) => content.slice(range.start, range.end).trim()).join('\n…\n').slice(0, maxChars);
}

async function resolveUnifiedConfluencePage(service: ConfluenceService, documentUri: string) {
  const raw = documentUri.trim();
  if (/^\d+$/.test(raw)) return service.requirePage(raw);
  const parsed = parseConfluenceUrl(raw);
  if (parsed.pageId) return service.requirePage(parsed.pageId);
  if (parsed.pageTitle) {
    const hits = await service.search({ title: parsed.pageTitle, spaceKey: parsed.spaceKey ?? undefined, limit: 5 });
    if (hits[0]) return service.requirePage(hits[0].id);
  }
  throw new Error(`Could not resolve a Confluence page id from "${documentUri}".`);
}

async function unifiedConfluenceSearch(service: ConfluenceService, args: Rec): Promise<unknown> {
  const query = String(args.query ?? '').trim();
  if (!query) return { error: 'query required' };
  const base = service.status().baseUrl ?? '';
  const results = await service.search({ query, limit: 10 });
  return results.map((page) => ({
    pageId: page.id,
    title: page.title,
    space: page.spaceKey,
    url: page.url ? new URL(page.url, `${base}/`).toString() : `${base}/pages/viewpage.action?pageId=${page.id}`,
  }));
}

async function unifiedConfluencePage(service: ConfluenceService, args: Rec): Promise<unknown> {
  const documentUri = String(args.documentUri ?? '').trim();
  if (!documentUri) return { error: 'documentUri required' };
  const page = await resolveUnifiedConfluencePage(service, documentUri);
  const base = service.status().baseUrl ?? '';
  return {
    pageId: page.id,
    title: page.title,
    url: page.url ? new URL(page.url, `${base}/`).toString() : `${base}/pages/viewpage.action?pageId=${page.id}`,
    content: pageText(page.viewBody || page.storageBody).slice(0, 30_000),
    links: [],
  };
}

async function unifiedConfluenceDocs(service: ConfluenceService, args: Rec): Promise<unknown> {
  const prompt = String(args.prompt ?? '').trim();
  const uris = (Array.isArray(args.documentUris) ? args.documentUris : [])
    .map((value: unknown) => String(value ?? '').trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!uris.length) return { error: 'documentUris required' };
  const documents = await Promise.all(uris.map(async (documentUri) => {
    try {
      const page = await resolveUnifiedConfluencePage(service, documentUri);
      const base = service.status().baseUrl ?? '';
      const url = page.url
        ? new URL(page.url, `${base}/`).toString()
        : `${base}/pages/viewpage.action?pageId=${page.id}`;
      const content = pageText(page.viewBody || page.storageBody);
      return {
        documentUri,
        title: page.title,
        url,
        content: selectRelevantExcerpt(content, prompt, 8000),
      };
    } catch (error) {
      return { documentUri, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  return { prompt, documents, note: 'Answer the prompt from the document content above; cite the source page as a card.' };
}

/**
 * Build the full Lumo tool catalog keyed by tool name. Every function is
 * async and never throws — errors surface as {error} results.
 */
export function buildLumoTools(opts: BuildLumoToolsOptions): LumoToolset {
  const { session, testrail, confluence } = opts;

  const sync = (fn: (args: Rec) => unknown): LumoToolFn => {
    return async (args: Rec) => {
      try {
        return fn(args ?? {});
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    };
  };
  const guard = (fn: LumoToolFn): LumoToolFn => {
    return async (args: Rec, ctx?: LumoToolContext) => {
      try {
        return await fn(args ?? {}, ctx);
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    };
  };

  return {
    // Brain Bundle lookups
    lookup_component: sync(lookupComponent),
    lookup_event: sync(lookupEvent),
    lookup_parameter: sync(lookupParameter),
    list_components: sync(listComponents),
    find_signal_in_code: sync(findSignalInCode),
    find_helpers_for_component: sync(findHelpersForComponent),
    find_signal_usage: sync(findSignalUsage),
    find_test_scenarios: sync(findTestScenarios),
    lookup_investigation: sync(lookupInvestigation),
    lookup_calibration_pattern: sync(lookupCalibrationPattern),
    lookup_failure_methodology: sync(lookupFailureMethodology),

    // Vector search + press issues
    search_confluence_vectors: guard(async (args) => searchConfluenceVectors(args)),
    search_testrail_vectors: guard(async (args) => searchTestrailVectors(args)),
    search_code_vectors: guard(async (args) => searchCodeVectors(args)),
    search_tmc_vectors: guard(async (args) => searchTmcVectors(args)),
    lookup_press_issue: guard(async (args) => searchPressIssues(args)),

    // Jira (over JiraWeb's own session)
    search_jira: guard(async (args) => searchJiraTool(session, args)),
    search_jira_issue: guard(async (args) => searchJiraIssue(session, args)),

    // TestRail (over JiraWeb's TestRailService)
    get_testrail_case: guard(async (args) => getTestrailCase(testrail, args)),
    get_testrail_cases_by_jira: guard(async (args) => getTestrailCasesByJira(testrail, args)),
    get_testrail_suites: guard(async (args) => getTestrailSuites(testrail, args)),

    // Confluence (direct REST)
    search_confluence: guard(async (args) => confluence?.connection()
      ? unifiedConfluenceSearch(confluence, args)
      : searchConfluence(args)),
    get_confluence_page: guard(async (args) => confluence?.connection()
      ? unifiedConfluencePage(confluence, args)
      : getConfluencePage(args)),
    search_confluence_docs: guard(async (args) => confluence?.connection()
      ? unifiedConfluenceDocs(confluence, args)
      : searchConfluenceDocs(args)),
    get_cluster_release_notes: guard(async (args) => getClusterReleaseNotes(args)),

    // Config Control
    search_config_control: sync(searchConfigControl),
    list_config_clusters: sync(listConfigClusters),

    // GitHub
    get_github_pr: guard(async (args) => getGithubPr(args)),

    // Reasoning
    reason_about_topic: guard(reasonAboutTopic),
    synthesize_findings: guard(synthesizeFindings),
  };
}

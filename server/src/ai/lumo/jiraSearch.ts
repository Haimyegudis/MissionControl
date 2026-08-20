/**
 * Lumo-parity Jira tools implemented over JiraWeb's OWN Jira session +
 * httpClient (NOT Lumo's MCP exe). Ports of assistantAgent.js 'search_jira'
 * (JQL builder incl. status !Closed expansion, programCluster variants,
 * reporter/assignee display-name resolution) and mcpManager.textSearchJira
 * (3-stage progressive text search) + fetchJiraTicket.
 */
import { apiPrefix, jiraFetch } from '@mc/core';
import type { JiraSession } from '@mc/core';

type Rec = Record<string, any>;

// customfield_48002 = "Program Cluster" (e.g. "Kedem C15"), customfield_44502 = "Cluster",
// customfield_18302 = "Severity" — same field ids Lumo queries on hp-jira.
const SEARCH_FIELDS =
  'summary,status,priority,issuetype,assignee,reporter,customfield_18302,customfield_48002,customfield_44502,fixVersions,affectsVersions,description';

function baseUrl(session: JiraSession): string {
  return (session.profile?.jiraBaseUrl ?? '').replace(/\/+$/, '');
}

/**
 * Resolve a Jira display name to a username/key (JQL reporter/assignee need
 * the username). Returns null when not found / lookup fails.
 */
export async function resolveJiraUsername(
  session: JiraSession,
  displayName: string,
): Promise<string | null> {
  try {
    const prefix = apiPrefix(session.profile?.instanceType ?? 'datacenter');
    const isCloud = session.profile?.instanceType === 'cloud';
    const users = (await jiraFetch(session, `${prefix}/user/search`, {
      query: isCloud
        ? { query: displayName, maxResults: 5 }
        : { username: displayName, maxResults: 5 },
      timeoutMs: 10_000,
    })) as Rec[] | null;
    if (!Array.isArray(users) || users.length === 0) return null;
    const exact = users.find(
      (u) => String(u.displayName || '').toLowerCase() === displayName.toLowerCase(),
    );
    const user = exact || users[0];
    return (user.name as string) || (user.key as string) || (user.accountId as string) || null;
  } catch {
    return null;
  }
}

/** Run a JQL search and map issues to Lumo's compact result shape. */
export async function searchJiraJql(
  session: JiraSession,
  jql: string,
  maxResults = 10,
): Promise<Rec[]> {
  const prefix = apiPrefix(session.profile?.instanceType ?? 'datacenter');
  const resp = (await jiraFetch(session, `${prefix}/search`, {
    query: { jql, maxResults, fields: SEARCH_FIELDS },
    timeoutMs: 15_000,
  })) as Rec | null;
  const url = baseUrl(session);
  return ((resp?.issues as Rec[]) || []).map((issue) => {
    const f: Rec = issue.fields || {};
    return {
      key: issue.key,
      summary: f.summary || '',
      status: f.status?.name || '',
      priority: f.priority?.name || '',
      type: f.issuetype?.name || '',
      assignee: f.assignee?.displayName || '',
      reporter: f.reporter?.displayName || '',
      severity: f.customfield_18302?.value || '',
      programCluster:
        (typeof f.customfield_48002 === 'object' ? f.customfield_48002?.value : f.customfield_48002) ||
        (typeof f.customfield_44502 === 'object' ? f.customfield_44502?.value : f.customfield_44502) ||
        '',
      fixVersion: ((f.fixVersions as Rec[]) || []).map((v) => v.name).join(', '),
      description: String(f.description || '').substring(0, 500),
      url: `${url}/browse/${issue.key}`,
    };
  });
}

/**
 * Progressive text search: exact phrase → all words ANDed → any word ORed.
 * No ORDER BY on the text stages — Jira ranks by Lucene relevance.
 */
export async function textSearchJira(
  session: JiraSession,
  query: string,
  extraJql = '',
  maxResults = 10,
): Promise<Rec[]> {
  const clean = String(query || '').replace(/"/g, ' ').trim();
  if (!clean) return [];
  const words = clean.split(/\s+/).filter((w) => w.length >= 3 && !/^(the|and|for|with)$/i.test(w));
  const and = extraJql ? ` AND ${extraJql}` : '';

  const stages = [
    `text ~ "\\"${clean}\\""${and}`,
    words.length > 1 ? words.map((w) => `text ~ "${w}"`).join(' AND ') + and : null,
    words.length > 1 ? '(' + words.map((w) => `text ~ "${w}"`).join(' OR ') + ')' + and : null,
  ].filter((s): s is string => Boolean(s));

  for (const jql of stages) {
    const results = await searchJiraJql(session, jql, maxResults).catch(() => [] as Rec[]);
    if (results.length) return results;
  }
  return [];
}

/** search_jira — the filterable Lumo tool (port of executeTool's case). */
export async function searchJiraTool(session: JiraSession, args: Rec): Promise<unknown> {
  if (!session.isConnected) return { error: 'No active Jira session.' };
  try {
    const jqlParts: string[] = [];
    if (args.type) jqlParts.push(`type = "${args.type}"`);
    if (args.status === '!Closed') jqlParts.push('status NOT IN (Closed, Done, Rejected)');
    else if (args.status) jqlParts.push(`status = "${args.status}"`);

    const [reporterKey, assigneeKey] = await Promise.all([
      args.reporter ? resolveJiraUsername(session, String(args.reporter)) : null,
      args.assignee ? resolveJiraUsername(session, String(args.assignee)) : null,
    ]);
    if (args.reporter) jqlParts.push(`reporter = "${reporterKey || args.reporter}"`);
    if (args.assignee) jqlParts.push(`assignee = "${assigneeKey || args.assignee}"`);

    if (args.program) {
      const progs = String(args.program)
        .split(/[,/]| or /i)
        .map((p) => p.trim())
        .filter(Boolean);
      jqlParts.push(
        progs.length > 1
          ? `Program in (${progs.map((p) => `"${p}"`).join(', ')})`
          : `Program = "${progs[0]}"`,
      );
    }
    if (args.classification) jqlParts.push(`Classification = "${args.classification}"`);
    if (args.resolution) jqlParts.push(`resolution = "${args.resolution}"`);

    // "Program Cluster" only supports ~ (text contains). Tag values vary:
    // "Kedem C15", "David C06" (zero-padded), sometimes a space after C —
    // match every form.
    if (args.programCluster) {
      const c = String(args.programCluster).match(/(\d+)/);
      if (c) {
        const n = Number(c[1]);
        const forms = n < 10 ? [`C${n}`, `C0${n}`, `C ${n}`, `C 0${n}`] : [`C${n}`, `C ${n}`];
        jqlParts.push('(' + forms.map((f) => `"Program Cluster" ~ "${f}"`).join(' OR ') + ')');
      } else {
        jqlParts.push(`"Program Cluster" ~ "${args.programCluster}"`);
      }
    }
    if (args.severity) jqlParts.push(`Severity = "${args.severity}"`);
    if (args.priority) jqlParts.push(`priority = "${args.priority}"`);
    if (args.epicLink) jqlParts.push(`"Epic Link" = "${args.epicLink}"`);
    if (args.swEeTeam) jqlParts.push(`"SW EE Team" ~ "${args.swEeTeam}"`);
    if (args.fixVersion) jqlParts.push(`fixVersion = "${args.fixVersion}"`);
    if (args.affectsVersion) jqlParts.push(`affectsVersion = "${args.affectsVersion}"`);

    const maxResults = typeof args.maxResults === 'number' && args.maxResults > 0 ? args.maxResults : 50;
    if (args.query) {
      return await textSearchJira(session, String(args.query), jqlParts.join(' AND '), maxResults);
    }
    const jql = ['project = ISW', ...jqlParts].join(' AND ') + ' ORDER BY updated DESC';
    return await searchJiraJql(session, jql, maxResults);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** search_jira_issue — fetch one issue by key. */
export async function searchJiraIssue(session: JiraSession, args: Rec): Promise<unknown> {
  if (!session.isConnected) return { error: 'No active Jira session.' };
  const issueKey = String(args.issueKey ?? args.key ?? '').trim();
  if (!issueKey) return { error: 'issueKey required' };
  try {
    const prefix = apiPrefix(session.profile?.instanceType ?? 'datacenter');
    const issue = (await jiraFetch(session, `${prefix}/issue/${encodeURIComponent(issueKey)}`, {
      query: { fields: `${SEARCH_FIELDS},created,updated,labels,components,resolution` },
      timeoutMs: 15_000,
    })) as Rec | null;
    if (!issue) return { error: `Issue ${issueKey} not found.` };
    const f: Rec = issue.fields || {};
    return {
      key: issue.key,
      summary: f.summary || '',
      status: f.status?.name || '',
      priority: f.priority?.name || '',
      type: f.issuetype?.name || '',
      assignee: f.assignee?.displayName || '',
      reporter: f.reporter?.displayName || '',
      severity: f.customfield_18302?.value || '',
      programCluster:
        (typeof f.customfield_48002 === 'object' ? f.customfield_48002?.value : f.customfield_48002) ||
        (typeof f.customfield_44502 === 'object' ? f.customfield_44502?.value : f.customfield_44502) ||
        '',
      resolution: f.resolution?.name || '',
      created: f.created || '',
      updated: f.updated || '',
      labels: f.labels || [],
      components: ((f.components as Rec[]) || []).map((c) => c.name),
      fixVersion: ((f.fixVersions as Rec[]) || []).map((v) => v.name).join(', '),
      description: String(f.description || '').substring(0, 4000),
      url: `${baseUrl(session)}/browse/${issue.key}`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

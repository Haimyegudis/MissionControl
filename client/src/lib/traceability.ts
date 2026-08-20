import type { JiraIssueDetails, JiraIssueLink } from '../types';
import { confluenceReferenceFromUrl, tokenize, type ConfluenceUrlReference } from './linkify';

export interface EpicHierarchy {
  source: JiraIssueDetails;
  /** The first Jira parent above the entered QA task, when present. */
  parent: JiraIssueDetails | null;
  epic: JiraIssueDetails;
  chain: JiraIssueDetails[];
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
    promise.then(
      (value) => { globalThis.clearTimeout(timer); resolve(value); },
      (error) => { globalThis.clearTimeout(timer); reject(error); },
    );
  });
}

const DOCUMENT_LINK = /(?:\bSWR\b|software\s+requirements?|\bDR\b|design\s+requirements?|\bintegration\b|\bUX\b|user\s+experience)/i;

/** Jira links that can own requirements/design/integration documentation. */
export function documentIssueLinks(links: readonly JiraIssueLink[]): JiraIssueLink[] {
  const relevant = links.filter((link) =>
    DOCUMENT_LINK.test(`${link.key} ${link.summary} ${link.issueType} ${link.relationship}`),
  );
  // Some Jira instances use generic relationship/type names. In that case,
  // search the linked records rather than silently falling back to epic-only.
  return (relevant.length > 0 ? relevant : links).slice(0, 12);
}

/** Page ids stored in Jira's Link to SWR/DR/Integration custom fields. */
export function confluenceReferences(details: JiraIssueDetails): ConfluenceUrlReference[] {
  const references = new Map<string, ConfluenceUrlReference>();
  const fields = details.allFields.filter((field) =>
    /link\s+to\s+.*(?:swr|\bdr\b|integration|\bux\b)/i.test(field.key),
  );
  for (const field of fields) {
    for (const token of tokenize(field.value)) {
      if (token.kind !== 'url') continue;
      const reference = confluenceReferenceFromUrl(token.url);
      if (!reference) continue;
      const key = reference.pageId ?? `${reference.spaceKey ?? ''}:${reference.title ?? ''}`;
      references.set(key.toLowerCase(), reference);
    }
  }
  return [...references.values()];
}

export function confluencePageIds(details: JiraIssueDetails): string[] {
  return confluenceReferences(details).flatMap((reference) => reference.pageId ? [reference.pageId] : []);
}

function isEpic(details: JiraIssueDetails): boolean {
  return details.issue.issueType.trim().toLowerCase() === 'epic';
}

/**
 * Follow Jira's Parent relationship first, then Epic Link as a fallback.
 * Parent-first traversal matters for QA subtasks: their own Epic Link can be
 * absent or inherited while the parent story carries the authoritative epic.
 */
export async function resolveEpicHierarchy(
  issueKey: string,
  load: (key: string) => Promise<JiraIssueDetails>,
): Promise<EpicHierarchy> {
  const source = await load(issueKey);
  const visited = new Set<string>();

  const walk = async (current: JiraIssueDetails, path: JiraIssueDetails[]): Promise<JiraIssueDetails[] | null> => {
    const normalized = current.issue.key.toUpperCase();
    if (visited.has(normalized) || path.length > 8) return null;
    visited.add(normalized);
    const nextPath = [...path, current];
    if (isEpic(current)) return nextPath;

    const candidates = [current.parentKey, current.issue.epicKey]
      .filter((key): key is string => Boolean(key))
      .filter((key, index, values) => values.findIndex((item) => item.toUpperCase() === key.toUpperCase()) === index);
    for (const candidate of candidates) {
      if (visited.has(candidate.toUpperCase())) continue;
      try {
        const found = await walk(await load(candidate), nextPath);
        if (found) return found;
      } catch {
        // Try the next Jira hierarchy signal before reporting no epic.
      }
    }
    return null;
  };

  const chain = await walk(source, []);
  if (!chain) {
    throw new Error(`No epic could be resolved from ${source.issue.key}. Check the task's Parent and Epic Link fields in Jira.`);
  }
  return {
    source,
    parent: chain.length > 2 ? chain[1] : null,
    epic: chain[chain.length - 1],
    chain,
  };
}

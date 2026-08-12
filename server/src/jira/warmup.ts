// Metadata warmup (jira-rest-layer.md §8 — MetadataWarmup).
// Fire-and-forget after sign-in; global concurrency gate 2; every failure swallowed.

import { INCIDENT_FILTERS } from './incidentCatalog.js';
import type { JiraSession } from './session.js';

const WARMUP_CONCURRENCY = 2;

export interface WarmupMetadata {
  getPriorities(): Promise<string[]>;
  getStatuses(): Promise<string[]>;
  getIssueTypes(): Promise<string[]>;
  getProjects(): Promise<string[]>;
  getVersions(projectKey: string): Promise<string[]>;
  getComponents(projectKey: string): Promise<string[]>;
}

export interface WarmupDeps {
  session: JiraSession;
  /** Cached metadata service. */
  metadata: WarmupMetadata;
  /** Cached board service. */
  boards: { getBoards(): Promise<unknown> };
  /** Cached distinct-field loader (CachedMetadataService.getDistinct wired to issueService). */
  getDistinct(projectKey: string, fieldName: string, maxIssues: number): Promise<string[]>;
}

/** C# `.Trim('"')` — strip all leading/trailing double quotes. */
function stripQuotes(s: string): string {
  return s.replace(/^"+/, '').replace(/"+$/, '');
}

/**
 * Warm caches after sign-in (§8). No-op when disconnected. Warms
 * priorities/statuses/issuetypes/projects, versions+components(project),
 * boards, then a distinct-field pull (max 5000) for every catalog def with
 * `!isQuickFilter && controlType !== 'textSearch'`. Intended to be called
 * fire-and-forget: `void metadataWarmup(deps)` — it never rejects.
 */
export async function metadataWarmup(deps: WarmupDeps): Promise<void> {
  if (!deps.session.isConnected) return;
  const project = deps.session.profile?.defaultProjectKey?.trim() || 'ISW';

  const tasks: Array<() => Promise<unknown>> = [
    () => deps.metadata.getPriorities(),
    () => deps.metadata.getStatuses(),
    () => deps.metadata.getIssueTypes(),
    () => deps.metadata.getProjects(),
    () => deps.metadata.getVersions(project),
    () => deps.metadata.getComponents(project),
    () => deps.boards.getBoards(),
  ];

  for (const def of INCIDENT_FILTERS) {
    if (def.isQuickFilter || def.controlType === 'textSearch') continue;
    const field = stripQuotes(def.jiraFieldName ?? def.displayName);
    tasks.push(() => deps.getDistinct(project, field, 5000));
  }

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      try {
        await tasks[i]();
      } catch {
        // warmup failures are swallowed (§8)
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(WARMUP_CONCURRENCY, tasks.length) }, () => worker()),
  );
}

import { apiPrefix, jiraFetch, JiraError } from './httpClient.js';
import type { JiraSession } from './session.js';
import type { JiraFetchFn } from './issueService.js';
import type { JiraCreateFieldMeta, JiraCreateIssueMeta } from '../types.js';

function mapCreateField(fieldId: string, def: any): JiraCreateFieldMeta {
  const allowedValues: string[] = [];
  for (const el of Array.isArray(def?.allowedValues) ? def.allowedValues : []) {
    if (typeof el === 'string') {
      if (el.length > 0) allowedValues.push(el);
      continue;
    }
    const v = [el?.value, el?.name, el?.displayName].find(
      (x) => typeof x === 'string' && x.length > 0,
    );
    if (v) allowedValues.push(v as string);
  }
  return {
    fieldId,
    displayName:
      typeof def?.name === 'string' && def.name.length > 0 ? def.name : fieldId,
    required: def?.required === true,
    schemaType: typeof def?.schema?.type === 'string' ? def.schema.type : '',
    allowedValues,
  };
}

/** Create-issue service (jira-rest-layer.md §2.12). */
export class JiraCreateIssueService {
  constructor(
    private readonly session: JiraSession,
    private readonly fetchFn: JiraFetchFn = jiraFetch,
  ) {}

  private get prefix(): string {
    return apiPrefix(this.session.profile?.instanceType ?? 'datacenter');
  }

  /**
   * Path A: legacy `createmeta?projectKeys&issuetypeNames&expand`; when it
   * yields 0 fields, Path B: resolve the issue type id via `GET /issuetype`
   * and page `createmeta/{project}/issuetypes/{id}`.
   */
  async getCreateMeta(projectKey: string, issueType: string): Promise<JiraCreateIssueMeta> {
    let fields = await this.getCreateMetaLegacy(projectKey, issueType);
    if (fields.length === 0) {
      fields = await this.getCreateMetaPaged(projectKey, issueType);
    }
    return { projectKey, issueType, fields };
  }

  private async getCreateMetaLegacy(
    projectKey: string,
    issueType: string,
  ): Promise<JiraCreateFieldMeta[]> {
    let resp: any;
    try {
      resp = await this.fetchFn(this.session, `${this.prefix}/issue/createmeta`, {
        query: {
          projectKeys: projectKey,
          issuetypeNames: issueType,
          expand: 'projects.issuetypes.fields',
        },
      });
    } catch {
      return []; // fall through to Path B
    }
    const out: JiraCreateFieldMeta[] = [];
    for (const project of Array.isArray(resp?.projects) ? resp.projects : []) {
      for (const type of Array.isArray(project?.issuetypes) ? project.issuetypes : []) {
        const fieldsObj = type?.fields;
        if (!fieldsObj || typeof fieldsObj !== 'object' || Array.isArray(fieldsObj)) continue;
        for (const [fieldId, def] of Object.entries(fieldsObj as Record<string, any>)) {
          out.push(mapCreateField(fieldId, def));
        }
      }
    }
    return out;
  }

  private async getCreateMetaPaged(
    projectKey: string,
    issueType: string,
  ): Promise<JiraCreateFieldMeta[]> {
    let issueTypeId: string | null = null;
    try {
      const types = await this.fetchFn(this.session, `${this.prefix}/issuetype`);
      const match = (Array.isArray(types) ? (types as any[]) : []).find(
        (t) => typeof t?.name === 'string' && t.name.toLowerCase() === issueType.toLowerCase(),
      );
      if (match?.id !== null && match?.id !== undefined) issueTypeId = String(match.id);
    } catch {
      return [];
    }
    if (!issueTypeId) return [];

    const out: JiraCreateFieldMeta[] = [];
    let startAt = 0;
    for (;;) {
      let resp: any;
      try {
        resp = await this.fetchFn(
          this.session,
          `${this.prefix}/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}`,
          { query: { startAt, maxResults: 50 } },
        );
      } catch {
        break;
      }
      const values: any[] = Array.isArray(resp?.values) ? resp.values : [];
      if (values.length === 0) break;
      for (const el of values) {
        const fieldId = typeof el?.fieldId === 'string' ? el.fieldId : '';
        out.push(mapCreateField(fieldId, el));
      }
      startAt += values.length;
      const total = typeof resp?.total === 'number' ? resp.total : startAt;
      if (resp?.isLast === true || values.length < 50 || startAt >= total) break;
    }
    return out;
  }

  /**
   * POST `{P}/issue` with the caller's fields merged with project/issuetype.
   * Returns the new issue key ("" when absent). Non-2xx →
   * "Jira rejected the issue: {status} — {message truncated to 400}".
   */
  async createIssue(
    projectKey: string,
    issueType: string,
    fields: Record<string, unknown>,
  ): Promise<string> {
    const body = {
      fields: {
        ...fields,
        project: { key: projectKey },
        issuetype: { name: issueType },
      },
    };
    let resp: any;
    try {
      resp = await this.fetchFn(this.session, `${this.prefix}/issue`, {
        method: 'POST',
        body,
      });
    } catch (err) {
      if (err instanceof JiraError) {
        throw new Error(
          `Jira rejected the issue: ${err.status} — ${(err.message ?? '').slice(0, 400)}`,
        );
      }
      throw err;
    }
    return typeof resp?.key === 'string' ? resp.key : '';
  }
}

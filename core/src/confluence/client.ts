import type {
  ConfluenceConnection,
  ConfluencePage,
  ConfluencePageContent,
  ConfluenceSpace,
  ConfluenceUser,
} from './types.js';

type JsonObject = Record<string, unknown>;

export class ConfluenceApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: string | null = null,
  ) {
    super(message);
    this.name = 'ConfluenceApiError';
  }
}

function obj(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function person(value: unknown): string | null {
  const p = obj(value);
  return str(p.displayName) ?? str(p.fullName) ?? str(p.username) ?? str(p.name);
}

function historyFields(value: unknown): Pick<ConfluencePage, 'createdBy' | 'createdAt' | 'lastModifiedBy' | 'lastModifiedAt'> {
  const history = obj(value);
  const version = obj(history.lastUpdated);
  return {
    createdBy: person(history.createdBy),
    createdAt: str(history.createdDate),
    lastModifiedBy: person(version.by),
    lastModifiedAt: str(version.when),
  };
}

function pageFromJson(value: unknown, fallbackSpaceKey = ''): ConfluencePage {
  const p = obj(value);
  const links = obj(p._links);
  const space = obj(p.space);
  const ancestors = array(p.ancestors);
  const parent = ancestors.length > 0 ? obj(ancestors[ancestors.length - 1]) : {};
  return {
    id: str(p.id) ?? String(p.id ?? ''),
    spaceKey: str(space.key) ?? fallbackSpaceKey,
    title: str(p.title) ?? 'Untitled',
    parentId: str(parent.id),
    status: str(p.status) ?? 'current',
    url: str(links.webui),
    ...historyFields(p.history),
    excerpt: str(p.excerpt),
  };
}

export class ConfluenceClient {
  readonly baseUrl: string;
  private readonly pat: string;

  constructor(connection: ConfluenceConnection, private readonly fetchFn: typeof fetch = fetch) {
    const normalized = connection.baseUrl.trim().replace(/\/+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      throw new ConfluenceApiError(400, 'Enter a valid Confluence Base URL.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ConfluenceApiError(400, 'Confluence Base URL must use HTTPS.');
    }
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase());
    if (parsed.protocol !== 'https:' && !loopback) {
      throw new ConfluenceApiError(400, 'Confluence Base URL must use HTTPS (HTTP is allowed only for local development).');
    }
    this.baseUrl = normalized;
    this.pat = connection.pat.trim();
  }

  private async request<T = JsonObject>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/${path.replace(/^\/+/, '')}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.pat}`,
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...init?.headers,
        },
        signal: init?.signal ?? AbortSignal.timeout(30_000),
        redirect: 'manual',
      });
    } catch (error) {
      throw new ConfluenceApiError(502, `Could not reach Confluence: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try {
        const body = obj(JSON.parse(text));
        detail = str(body.message) ?? str(body.reason) ?? text;
      } catch {
        // retain upstream text
      }
      throw new ConfluenceApiError(response.status, `Confluence returned ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`, text || null);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async currentUser(): Promise<ConfluenceUser> {
    const u = obj(await this.request('rest/api/user/current'));
    return {
      userKey: str(u.userKey),
      username: str(u.username) ?? str(u.name),
      displayName: str(u.displayName) ?? str(u.fullName) ?? str(u.username) ?? 'Confluence user',
      email: str(u.email),
    };
  }

  async spaces(): Promise<ConfluenceSpace[]> {
    const spaces: ConfluenceSpace[] = [];
    for (const status of ['current', 'archived']) {
      let start = 0;
      for (;;) {
        const q = new URLSearchParams({ limit: '100', start: String(start), status, expand: 'description.plain,metadata.labels' });
        const root = obj(await this.request(`rest/api/space?${q}`));
        const results = array(root.results);
        for (const raw of results) {
          const s = obj(raw);
          const description = obj(obj(s.description).plain);
          const labelsRoot = obj(obj(s.metadata).labels);
          spaces.push({
            id: typeof s.id === 'number' ? s.id : Number.isFinite(Number(s.id)) ? Number(s.id) : null,
            key: str(s.key) ?? '',
            name: str(s.name) ?? str(s.key) ?? 'Unnamed space',
            type: str(s.type) ?? 'global',
            status: str(s.status) ?? status,
            description: str(description.value) ?? '',
            labels: array(labelsRoot.results).map((x) => str(obj(x).name)).filter((x): x is string => Boolean(x)),
          });
        }
        if (results.length < 100 || start >= 4900) break;
        start += results.length;
      }
    }
    return spaces;
  }

  async pagesInSpace(spaceKey: string, startAt = 0, limit = 200): Promise<{ items: ConfluencePage[]; startAt: number; nextStart: number; hasMore: boolean }> {
    const q = new URLSearchParams({ limit: String(limit), start: String(startAt), depth: 'all', expand: 'history,version,space,ancestors' });
    const root = obj(await this.request(`rest/api/space/${encodeURIComponent(spaceKey)}/content/page?${q}`));
    const results = array(root.results);
    // Enforce the selected space again even if an unusual Confluence version
    // returns broader results from the space-content resource.
    const items = results
      .map((p) => pageFromJson(p, spaceKey))
      .filter((page) => page.spaceKey.toLowerCase() === spaceKey.toLowerCase());
    const nextStart = startAt + results.length;
    const links = obj(root._links);
    return {
      items,
      startAt,
      nextStart,
      hasMore: nextStart < 5000 && (Boolean(str(links.next)) || results.length === limit),
    };
  }

  async rootPagesInSpace(spaceKey: string): Promise<ConfluencePage[]> {
    const q = new URLSearchParams({ limit: '200', depth: 'root', expand: 'history,version,space,ancestors' });
    const root = obj(await this.request(`rest/api/space/${encodeURIComponent(spaceKey)}/content/page?${q}`));
    return array(root.results)
      .map((page) => pageFromJson(page, spaceKey))
      .filter((page) => page.spaceKey.toLowerCase() === spaceKey.toLowerCase());
  }

  async childPages(parentId: string): Promise<ConfluencePage[]> {
    const q = new URLSearchParams({ limit: '200', expand: 'history,version,space,ancestors' });
    const root = obj(await this.request(`rest/api/content/${encodeURIComponent(parentId)}/child/page?${q}`));
    return array(root.results).map((p) => pageFromJson(p));
  }

  async page(pageId: string): Promise<ConfluencePageContent> {
    const q = new URLSearchParams({ expand: 'body.storage,body.view,space,version,history,ancestors' });
    const p = obj(await this.request(`rest/api/content/${encodeURIComponent(pageId)}?${q}`));
    const base = pageFromJson(p);
    return {
      ...base,
      storageBody: str(obj(obj(p.body).storage).value) ?? '',
      viewBody: str(obj(obj(p.body).view).value) ?? '',
      version: Number(obj(p.version).number) || 1,
    };
  }

  /** Resolve Confluence's `/display/SPACE/Page+Title` URL form exactly. */
  async pageBySpaceTitle(spaceKey: string, title: string): Promise<ConfluencePage> {
    const q = new URLSearchParams({
      spaceKey,
      title,
      limit: '10',
      expand: 'history,version,space,ancestors',
    });
    const root = obj(await this.request(`rest/api/content?${q}`));
    const pages = array(root.results).map((page) => pageFromJson(page, spaceKey));
    const exact = pages.find((page) => page.title.localeCompare(title, undefined, { sensitivity: 'accent' }) === 0);
    const match = exact ?? pages[0];
    if (!match) throw new ConfluenceApiError(404, `Confluence page "${title}" was not found in ${spaceKey}.`);
    return match;
  }

  async search(cql: string, limit: number): Promise<ConfluencePage[]> {
    const q = new URLSearchParams({ cql, limit: String(limit), expand: 'history,version,space,ancestors' });
    const root = obj(await this.request(`rest/api/content/search?${q}`));
    return array(root.results).map((p) => pageFromJson(p));
  }

  async createPage(spaceKey: string, title: string, storageBody: string, parentId?: string | null): Promise<ConfluencePageContent> {
    const payload: JsonObject = {
      type: 'page',
      title,
      space: { key: spaceKey },
      body: { storage: { value: storageBody, representation: 'storage' } },
    };
    if (parentId) payload.ancestors = [{ id: parentId }];
    const created = obj(await this.request('rest/api/content', { method: 'POST', body: JSON.stringify(payload) }));
    return this.page(str(created.id) ?? String(created.id));
  }

  async updatePage(page: ConfluencePageContent, title: string, storageBody: string, parentId?: string | null): Promise<ConfluencePageContent> {
    const payload: JsonObject = {
      id: page.id,
      type: 'page',
      title,
      version: { number: page.version + 1 },
      body: { storage: { value: storageBody, representation: 'storage' } },
    };
    if (parentId !== undefined) payload.ancestors = parentId ? [{ id: parentId }] : [];
    await this.request(`rest/api/content/${encodeURIComponent(page.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
    return this.page(page.id);
  }

  /** Move the page to Confluence's trash (soft delete — restorable there). */
  async deletePage(pageId: string): Promise<void> {
    await this.request(`rest/api/content/${encodeURIComponent(pageId)}`, { method: 'DELETE' });
  }

  async proxy(url: string): Promise<Response> {
    const target = new URL(url, `${this.baseUrl}/`);
    const allowed = new URL(this.baseUrl);
    if (target.origin !== allowed.origin) {
      throw new ConfluenceApiError(400, 'Only files from the configured Confluence server can be loaded.');
    }
    return this.fetchFn(target, {
      headers: { Authorization: `Bearer ${this.pat}` },
      signal: AbortSignal.timeout(30_000),
      redirect: 'manual',
    });
  }
}

import type { Credentials } from '../types.js';
import { ConfluenceApiError, ConfluenceClient } from './client.js';
import type { ConfluenceConnection, ConfluencePage, ConfluencePageContent, ConfluenceSearchOptions, ConfluenceSpace, ConfluenceStatus, ConfluenceUser } from './types.js';

export interface CredentialReader {
  load(): Credentials | null;
}

// Indigo's Confluence spaces do not consistently contain "Indigo" in their
// names. These are the spaces exposed by the Indigo Confluence navigation.
// CONFLUENCE_INDIGO_SPACES can replace this list with comma-separated space
// keys or exact names without requiring a code change.
const DEFAULT_INDIGO_SPACE_IDENTIFIERS = [
  'SQA',
  'Autonomous program',
  'Software Requirements',
  'System Engineering',
  'Confluence Home Page',
  'Masterclass',
  'Electronics',
  'Kedem Program',
  'Press SW Design',
  'Press SW Apps',
  // UX/DR pages referenced directly from Indigo epics (e.g. Link to UX/DR).
  'UEK',
  // Integration report pages linked from Jira's Integration Form field.
  'SWSE',
];

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function quoteCql(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function day(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

/**
 * Space-list override. The server sets this from CONFLUENCE_INDIGO_SPACES;
 * core cannot read process.env because it also runs inside a WebView, where
 * that global does not exist.
 */
let spaceOverride: string[] = [];

export function setIndigoSpaceOverride(csv: string | undefined): void {
  spaceOverride = (csv ?? '').split(',').map(normalized).filter(Boolean);
}

export function isIndigoSpace(space: ConfluenceSpace): boolean {
  const identifiers = spaceOverride.length > 0
    ? spaceOverride
    : DEFAULT_INDIGO_SPACE_IDENTIFIERS.map(normalized);
  if (identifiers.includes(normalized(space.key)) || identifiers.includes(normalized(space.name))) return true;
  const text = [space.key, space.name, space.description, ...space.labels].join(' ').toLowerCase();
  return /(^|[^a-z])(?:hp\s*)?indigo([^a-z]|$)/i.test(text);
}

export class ConfluenceService {
  private cachedSpaces: { at: number; spaces: ConfluenceSpace[] } | null = null;
  private user: ConfluenceUser | null = null;

  constructor(private readonly credentials: CredentialReader, private readonly fetchFn: typeof fetch = fetch) {}

  connection(): ConfluenceConnection | null {
    const saved = this.credentials.load();
    if (!saved?.confluenceBaseUrl.trim() || !saved.confluencePat.trim()) return null;
    return { baseUrl: saved.confluenceBaseUrl, pat: saved.confluencePat };
  }

  client(connection = this.connection()): ConfluenceClient {
    if (!connection) throw new ConfluenceApiError(428, 'Connect Confluence in Settings first.');
    return new ConfluenceClient(connection, this.fetchFn);
  }

  async test(connection: ConfluenceConnection): Promise<ConfluenceUser> {
    return new ConfluenceClient(connection, this.fetchFn).currentUser();
  }

  status(): ConfluenceStatus {
    const connection = this.connection();
    return { configured: Boolean(connection), connected: Boolean(connection && this.user), baseUrl: connection?.baseUrl ?? null, user: this.user };
  }

  async connect(): Promise<ConfluenceUser> {
    this.user = await this.client().currentUser();
    return this.user;
  }

  disconnect(): void {
    this.user = null;
    this.cachedSpaces = null;
  }

  async spaces(force = false): Promise<ConfluenceSpace[]> {
    if (!force && this.cachedSpaces && Date.now() - this.cachedSpaces.at < 120_000) return this.cachedSpaces.spaces;
    const spaces = (await this.client().spaces()).filter(isIndigoSpace);
    this.cachedSpaces = { at: Date.now(), spaces };
    return spaces;
  }

  async requireSpace(spaceKey: string): Promise<ConfluenceSpace> {
    const match = (await this.spaces()).find((s) => s.key.toLowerCase() === spaceKey.toLowerCase());
    if (!match) throw new ConfluenceApiError(403, 'This feature is limited to Indigo Confluence spaces.');
    return match;
  }

  async requirePage(pageId: string): Promise<ConfluencePageContent> {
    const page = await this.client().page(pageId);
    await this.requireSpace(page.spaceKey);
    return page;
  }

  async resolvePage(spaceKey: string, title: string): Promise<ConfluencePage> {
    await this.requireSpace(spaceKey);
    return this.client().pageBySpaceTitle(spaceKey, title);
  }

  async pages(spaceKey: string, startAt = 0, limit = 200): Promise<{ items: ConfluencePage[]; startAt: number; nextStart: number; hasMore: boolean }> {
    await this.requireSpace(spaceKey);
    return this.client().pagesInSpace(spaceKey, startAt, limit);
  }

  async treeRoots(spaceKey: string): Promise<ConfluencePage[]> {
    await this.requireSpace(spaceKey);
    const client = this.client();
    const roots = await client.rootPagesInSpace(spaceKey);
    // Confluence spaces normally have one home page. Its children are what
    // the native sidebar/page-tree macro presents as the top-level tree.
    if (roots.length === 1) {
      const children = await client.childPages(roots[0].id);
      const allowedChildren = children.filter((page) => page.spaceKey.toLowerCase() === spaceKey.toLowerCase());
      if (allowedChildren.length > 0) return allowedChildren;
    }
    return roots;
  }

  async children(parentId: string): Promise<ConfluencePage[]> {
    await this.requirePage(parentId);
    const pages = await this.client().childPages(parentId);
    const allowed = new Set((await this.spaces()).map((s) => s.key.toLowerCase()));
    return pages.filter((p) => allowed.has(p.spaceKey.toLowerCase()));
  }

  async search(options: ConfluenceSearchOptions): Promise<ConfluencePage[]> {
    const spaces = await this.spaces();
    if (spaces.length === 0) return [];
    const selected = options.spaceKey ? spaces.filter((s) => s.key.toLowerCase() === options.spaceKey!.toLowerCase()) : spaces;
    if (selected.length === 0) throw new ConfluenceApiError(403, 'This feature is limited to Indigo Confluence spaces.');
    const clauses = ['type=page', `space in (${selected.map((s) => quoteCql(s.key)).join(',')})`];
    if (options.query?.trim()) clauses.push(`text~${quoteCql(options.query.trim())}`);
    if (options.title?.trim()) clauses.push(`title~${quoteCql(options.title.trim())}`);
    if (options.body?.trim()) clauses.push(`text~${quoteCql(options.body.trim())}`);
    if (options.creator?.trim()) clauses.push(`creator=${quoteCql(options.creator.trim())}`);
    if (options.contributor?.trim()) clauses.push(`contributor=${quoteCql(options.contributor.trim())}`);
    if (options.label?.trim()) clauses.push(`label=${quoteCql(options.label.trim())}`);
    const createdAfter = day(options.createdAfter);
    const createdBefore = day(options.createdBefore);
    const modifiedAfter = day(options.modifiedAfter);
    const modifiedBefore = day(options.modifiedBefore);
    if (createdAfter) clauses.push(`created>=${quoteCql(createdAfter)}`);
    if (createdBefore) clauses.push(`created<=${quoteCql(createdBefore)}`);
    if (modifiedAfter) clauses.push(`lastmodified>=${quoteCql(modifiedAfter)}`);
    if (modifiedBefore) clauses.push(`lastmodified<=${quoteCql(modifiedBefore)}`);
    const sort = options.sort === 'created' ? 'created' : options.sort === 'title' ? 'title' : 'lastmodified';
    const direction = sort === 'title' ? 'ASC' : 'DESC';
    return this.client().search(`${clauses.join(' AND ')} ORDER BY ${sort} ${direction}`, Math.min(Math.max(options.limit ?? 100, 1), 200));
  }
}

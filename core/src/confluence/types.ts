export interface ConfluenceConnection {
  baseUrl: string;
  pat: string;
}

export interface ConfluenceUser {
  userKey: string | null;
  username: string | null;
  displayName: string;
  email: string | null;
}

export interface ConfluenceSpace {
  id: number | null;
  key: string;
  name: string;
  type: string;
  status: string;
  description: string;
  labels: string[];
}

export interface ConfluencePage {
  id: string;
  spaceKey: string;
  title: string;
  parentId: string | null;
  status: string;
  url: string | null;
  createdBy: string | null;
  createdAt: string | null;
  lastModifiedBy: string | null;
  lastModifiedAt: string | null;
  excerpt: string | null;
}

export interface ConfluencePageContent extends ConfluencePage {
  storageBody: string;
  viewBody: string;
  version: number;
}

export interface ConfluenceSearchOptions {
  query?: string;
  title?: string;
  body?: string;
  creator?: string;
  contributor?: string;
  label?: string;
  spaceKey?: string;
  createdAfter?: string;
  createdBefore?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  sort?: 'modified' | 'created' | 'title';
  limit?: number;
}

export interface ConfluenceStatus {
  configured: boolean;
  connected: boolean;
  baseUrl: string | null;
  user: ConfluenceUser | null;
}

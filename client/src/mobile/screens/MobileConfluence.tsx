// Confluence. Spaces, then pages, then the page body.
//
// This screen only works on corporate VPN. Confluence is hosted on an
// internal-only name with no external counterpart — verified from the device:
// four candidate *.external.hp.com hostnames all fail to connect while
// hp-jira.external.hp.com answers. Rather than hide that, the screen says so
// when the connection fails, so the failure reads as "you are off VPN" instead
// of "the app is broken".

import { useCallback, useEffect, useState } from 'react';
import { confluence } from '../../api/client';
import type { ConfluencePage, ConfluenceSpace } from '../../types';
import { Empty, ErrorNote, ListCard, Loading, Muted, Screen, tapReset } from '../ui';

type View =
  | { kind: 'spaces' }
  | { kind: 'pages'; space: ConfluenceSpace }
  | { kind: 'page'; space: ConfluenceSpace; page: ConfluencePage; html: string | null };

export function MobileConfluence() {
  const [view, setView] = useState<View>({ kind: 'spaces' });
  const [spaces, setSpaces] = useState<ConfluenceSpace[] | null>(null);
  const [pages, setPages] = useState<ConfluencePage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSpaces = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setSpaces(await confluence.spaces());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadSpaces();
  }, [loadSpaces]);

  const openSpace = async (space: ConfluenceSpace) => {
    setView({ kind: 'pages', space });
    setPages(null);
    setBusy(true);
    setError(null);
    try {
      const batch = await confluence.pageBatch(space.key, 0, 100);
      setPages(batch.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openPage = async (space: ConfluenceSpace, page: ConfluencePage) => {
    setView({ kind: 'page', space, page, html: null });
    setBusy(true);
    setError(null);
    try {
      const content = await confluence.page(page.id);
      setView({ kind: 'page', space, page, html: content.viewBody ?? '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setError(null);
    if (view.kind === 'page') setView({ kind: 'pages', space: view.space });
    else setView({ kind: 'spaces' });
  };

  const title = view.kind === 'spaces' ? 'Confluence' : view.kind === 'pages' ? view.space.name : view.page.title;

  return (
    <Screen
      kicker="Confluence"
      title={title}
      action={
        view.kind === 'spaces' ? (
          <button className="btn" onClick={() => void loadSpaces()} disabled={busy} style={{ ...tapReset, minHeight: 40 }}>
            {busy ? '…' : '↻'}
          </button>
        ) : (
          <button className="btn" onClick={back} style={{ ...tapReset, minHeight: 40 }}>
            ‹ Back
          </button>
        )
      }
    >
      {error ? (
        <ErrorNote onRetry={() => (view.kind === 'spaces' ? void loadSpaces() : back())}>
          {error}
          <div style={{ marginTop: 8, color: 'var(--muted)' }}>
            Confluence is only reachable on the corporate network. If you are on cellular, connect to VPN and retry.
          </div>
        </ErrorNote>
      ) : null}

      {view.kind === 'spaces' ? (
        !spaces && !error ? (
          <Loading what="Loading spaces" />
        ) : spaces && spaces.length === 0 ? (
          <Empty>No spaces.</Empty>
        ) : (
          (spaces ?? []).map((space) => (
            <ListCard
              key={space.key}
              onClick={() => void openSpace(space)}
              lead={<Muted>{space.key}</Muted>}
              title={space.name}
            />
          ))
        )
      ) : null}

      {view.kind === 'pages' ? (
        !pages && !error ? (
          <Loading what="Loading pages" />
        ) : pages && pages.length === 0 ? (
          <Empty>No pages in this space.</Empty>
        ) : (
          (pages ?? []).map((page) => (
            <ListCard key={page.id} onClick={() => void openPage(view.space, page)} title={page.title} />
          ))
        )
      ) : null}

      {view.kind === 'page' ? (
        view.html === null && !error ? (
          <Loading what="Loading page" />
        ) : (
          <div
            className="card"
            style={{ padding: 14, fontSize: 14, lineHeight: 1.55, overflowWrap: 'anywhere' }}
            // The server sanitises Confluence storage format before it is sent.
            dangerouslySetInnerHTML={{ __html: view.html ?? '' }}
          />
        )
      ) : null}
    </Screen>
  );
}

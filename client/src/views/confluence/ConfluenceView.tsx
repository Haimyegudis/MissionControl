import { useEffect, useRef, useState } from 'react';
import { confluence } from '../../api/client';
import { updateSettings } from '../../stores/settings';
import type { ConfluencePage, ConfluencePageContent, ConfluenceSearchOptions, ConfluenceSpace, ConfluenceStatus } from '../../types';

type Mode = 'pages' | 'search' | 'create' | 'edit';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function absoluteConfluenceUrl(baseUrl: string | null, value: string | null): string | null {
  if (!value) return null;
  try { return new URL(value, `${baseUrl?.replace(/\/+$/, '') ?? ''}/`).toString(); } catch { return null; }
}

function PageTree({ pages, selectedId, onOpen }: { pages: ConfluencePage[]; selectedId: string | null; onOpen: (page: ConfluencePage) => void }) {
  const [children, setChildren] = useState<Record<string, ConfluencePage[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [knownLeaf, setKnownLeaf] = useState<Record<string, boolean>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  useEffect(() => { setChildren({}); setExpanded({}); setKnownLeaf({}); }, [pages]);

  const toggle = async (page: ConfluencePage) => {
    if (expanded[page.id]) {
      setExpanded((state) => ({ ...state, [page.id]: false }));
      return;
    }
    if (children[page.id]) {
      setExpanded((state) => ({ ...state, [page.id]: true }));
      return;
    }
    setLoadingId(page.id);
    try {
      const loaded = await confluence.children(page.id);
      if (loaded.length === 0) setKnownLeaf((state) => ({ ...state, [page.id]: true }));
      else {
        setChildren((state) => ({ ...state, [page.id]: loaded }));
        setExpanded((state) => ({ ...state, [page.id]: true }));
      }
    } finally {
      setLoadingId(null);
    }
  };

  const render = (items: ConfluencePage[], depth = 0, path = new Set<string>()): React.ReactNode => items.map((page) => {
    if (path.has(page.id)) return null;
    const nextPath = new Set(path).add(page.id);
    const isExpanded = expanded[page.id] === true;
    return (
    <div key={page.id}>
      <div className={`cf-tree-row${selectedId === page.id ? ' selected' : ''}`} style={{ paddingLeft: 8 + depth * 16 }}>
        <button className="cf-tree-toggle" disabled={knownLeaf[page.id]} onClick={() => void toggle(page)} title={isExpanded ? 'Hide child pages' : 'Show child pages'}>{loadingId === page.id ? '…' : knownLeaf[page.id] ? '·' : isExpanded ? '⌄' : '›'}</button>
        <button className="cf-tree-title" onClick={() => onOpen(page)} title={page.title}>{page.title}</button>
      </div>
      {isExpanded ? render(children[page.id] ?? [], depth + 1, nextPath) : null}
    </div>
  );
  });
  return <div className="cf-tree">{render(pages)}</div>;
}

function PageViewer({ page, baseUrl, onEdit }: { page: ConfluencePageContent; baseUrl: string | null; onEdit: () => void }) {
  const openUrl = absoluteConfluenceUrl(baseUrl, page.url);

  // Ctrl+wheel over the page zooms ONLY the rendered Confluence page (the
  // iframe is scaled; the rest of the app is untouched). Persisted.
  const [zoom, setZoom] = useState(() => {
    try {
      const z = Number(localStorage.getItem('mc.cf.zoom'));
      return z >= 0.4 && z <= 2.5 ? z : 1;
    } catch {
      return 1;
    }
  });
  const zoomWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = zoomWrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => {
        const next = Math.min(2.5, Math.max(0.4, Math.round((z + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10));
        try {
          localStorage.setItem('mc.cf.zoom', String(next));
        } catch {
          /* best-effort */
        }
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <section className="cf-page-panel">
      <div className="cf-page-heading cf-page-actions">
        <div className="cf-breadcrumb">{page.spaceKey} <span>/</span> {page.title}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {zoom !== 1 ? (
            <button className="btn" title="Reset zoom (Ctrl+wheel to zoom)" onClick={() => { setZoom(1); try { localStorage.setItem('mc.cf.zoom', '1'); } catch { /* ignore */ } }}>
              {Math.round(zoom * 100)}% ↺
            </button>
          ) : null}
          <button className="btn btn-primary" onClick={onEdit}>Edit</button>
          {openUrl ? <a className="btn" href={openUrl} target="_blank" rel="noreferrer">Open in Confluence ↗</a> : null}
        </div>
      </div>
      <div ref={zoomWrapRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <iframe
          className="cf-page-frame cf-original-page"
          title={page.title}
          src={confluence.renderUrl(page.id)}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          style={{
            width: `${100 / zoom}%`,
            height: `${100 / zoom}%`,
            transform: `scale(${zoom})`,
            transformOrigin: '0 0',
            border: 0,
          }}
        />
      </div>
    </section>
  );
}

function tool(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function storageToEditor(storage: string): string {
  return storage || '<p><br></p>';
}

function editorToStorage(editor: HTMLDivElement): string {
  const clone = editor.cloneNode(true) as HTMLDivElement;
  clone.querySelectorAll('[data-confluence-layout]').forEach((layout) => {
    const cells = [...layout.querySelectorAll(':scope > .cf-editor-layout-cell')];
    const section = document.createElement('ac:layout-section');
    const type = layout.getAttribute('data-confluence-layout') ?? 'single';
    section.setAttribute('ac:type', type);
    for (const cell of cells) {
      const target = document.createElement('ac:layout-cell');
      target.innerHTML = cell.innerHTML;
      section.appendChild(target);
    }
    const wrapper = document.createElement('ac:layout');
    wrapper.appendChild(section);
    layout.replaceWith(wrapper);
  });
  clone.querySelectorAll('[contenteditable]').forEach((x) => x.removeAttribute('contenteditable'));
  return clone.innerHTML.trim() || '<p><br /></p>';
}

function EditorToolbar({ editor }: { editor: React.RefObject<HTMLDivElement> }) {
  const focus = () => editor.current?.focus();
  const exec = (command: string, value?: string) => { focus(); tool(command, value); };
  const link = () => { const value = window.prompt('Link URL'); if (value) exec('createLink', value); };
  const image = () => { const value = window.prompt('Image URL'); if (value) exec('insertImage', value); };
  const table = () => exec('insertHTML', '<table><tbody><tr><th>Heading</th><th>Heading</th></tr><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>');
  const layout = (type: 'single' | 'two_equal' | 'three_equal') => {
    const count = type === 'single' ? 1 : type === 'two_equal' ? 2 : 3;
    exec('insertHTML', `<div class="cf-editor-layout" data-confluence-layout="${type}">${Array.from({ length: count }, () => '<div class="cf-editor-layout-cell"><p>Type here…</p></div>').join('')}</div><p><br></p>`);
  };
  return (
    <div className="cf-editor-toolbar" onMouseDown={(e) => { if ((e.target as HTMLElement).tagName === 'BUTTON') e.preventDefault(); }}>
      <select aria-label="Text style" defaultValue="p" onChange={(e) => exec('formatBlock', e.target.value)}><option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="h4">Heading 4</option><option value="pre">Code block</option></select>
      <button title="Bold" onClick={() => exec('bold')}><b>B</b></button><button title="Italic" onClick={() => exec('italic')}><i>I</i></button><button title="Underline" onClick={() => exec('underline')}><u>U</u></button><button title="Strikethrough" onClick={() => exec('strikeThrough')}><s>S</s></button>
      <span className="cf-tool-sep" />
      <button title="Bulleted list" onClick={() => exec('insertUnorderedList')}>• List</button><button title="Numbered list" onClick={() => exec('insertOrderedList')}>1. List</button><button title="Quote" onClick={() => exec('formatBlock', 'blockquote')}>❝</button>
      <button title="Align left" onClick={() => exec('justifyLeft')}>≡</button><button title="Align center" onClick={() => exec('justifyCenter')}>≡·</button><button title="Align right" onClick={() => exec('justifyRight')}>·≡</button>
      <span className="cf-tool-sep" />
      <button title="Link" onClick={link}>🔗</button><button title="Remove link" onClick={() => exec('unlink')}>Unlink</button><button title="Image" onClick={image}>Image</button><button title="Table" onClick={table}>Table</button><button title="Horizontal line" onClick={() => exec('insertHorizontalRule')}>―</button>
      <span className="cf-tool-sep" />
      <button title="One-column layout" onClick={() => layout('single')}>▣</button><button title="Two-column layout" onClick={() => layout('two_equal')}>▣▣</button><button title="Three-column layout" onClick={() => layout('three_equal')}>▣▣▣</button>
      <span className="cf-tool-sep" />
      <select aria-label="Text color" defaultValue="" onChange={(e) => { if (e.target.value) { exec('foreColor', e.target.value); e.target.value = ''; } }}>
        <option value="">A color</option><option value="#e8eefa">Default</option><option value="#ef4444">Red</option><option value="#22d38f">Green</option><option value="#4f9cf9">Blue</option><option value="#ffd23a">Yellow</option><option value="#ff4ecd">Magenta</option><option value="#8aa0bf">Gray</option>
      </select>
      <select aria-label="Highlight" defaultValue="" onChange={(e) => { if (e.target.value) { exec('hiliteColor', e.target.value); e.target.value = ''; } }}>
        <option value="">Highlight</option><option value="#fff3bf">Yellow</option><option value="#d3f9d8">Green</option><option value="#ffe3e3">Red</option><option value="#d0ebff">Blue</option><option value="transparent">None</option>
      </select>
      <button title="Inline code" onClick={() => exec('insertHTML', `<code style="background:rgba(120,140,180,.18);padding:1px 5px;border-radius:4px">${window.getSelection()?.toString() || 'code'}</code>&nbsp;`)}>{'</>'}</button>
      <span className="cf-tool-sep" />
      <select aria-label="Status lozenge" defaultValue="" onChange={(e) => { const v = e.target.value; if (v) { const [bg, fg, label] = v.split(','); exec('insertHTML', `<span style="background:${bg};color:${fg};padding:1px 7px;border-radius:3px;font-size:11px;font-weight:700;text-transform:uppercase">${label}</span>&nbsp;`); e.target.value = ''; } }}>
        <option value="">Status</option><option value="#dff3e4,#1d7a46,DONE">DONE</option><option value="#ffe9e6,#b3271e,BLOCKED">BLOCKED</option><option value="#fff3cd,#8a6d00,IN PROGRESS">IN PROGRESS</option><option value="#e7eefc,#2b5bd7,TODO">TODO</option>
      </select>
      <select aria-label="Panel" defaultValue="" onChange={(e) => { const v = e.target.value; if (v) { const [color, bg, label] = v.split(','); exec('insertHTML', `<div style="border-left:4px solid ${color};background:${bg};padding:8px 12px;margin:6px 0;border-radius:4px"><p><b>${label}:</b> type here…</p></div><p><br></p>`); e.target.value = ''; } }}>
        <option value="">Panel</option><option value="#2b5bd7,#eef3fd,Info">Info</option><option value="#8a6d00,#fff8e1,Note">Note</option><option value="#b3271e,#fdecea,Warning">Warning</option><option value="#1d7a46,#eaf7ee,Success">Success</option>
      </select>
      <button title="Expand section" onClick={() => exec('insertHTML', '<details style="border:1px solid rgba(120,140,180,.3);border-radius:6px;padding:6px 10px;margin:6px 0"><summary style="cursor:pointer;font-weight:600">Click to expand</summary><p>Details…</p></details><p><br></p>')}>⌄ Expand</button>
      <button title="Task list" onClick={() => exec('insertHTML', '<ul style="list-style:none;padding-left:4px"><li><input type="checkbox"> Task 1</li><li><input type="checkbox"> Task 2</li></ul><p><br></p>')}>☑ Tasks</button>
      <span className="cf-tool-sep" />
      <button title="Undo" onClick={() => exec('undo')}>↶</button><button title="Redo" onClick={() => exec('redo')}>↷</button><button title="Clear formatting" onClick={() => exec('removeFormat')}>Clear</button>
    </div>
  );
}

/**
 * Parent location picker: space dropdown + expandable page tree. Click a page
 * to make it the parent; "Space root" clears the parent. Any depth reachable.
 */
function ParentPicker({ spaces, spaceKey, onSpaceChange, value, onChange, excludeId }: {
  spaces: ConfluenceSpace[];
  spaceKey: string;
  onSpaceChange: (key: string) => void;
  value: string;
  onChange: (parentId: string, title: string) => void;
  excludeId?: string | null;
}) {
  const [roots, setRoots] = useState<ConfluencePage[]>([]);
  const [kids, setKids] = useState<Record<string, ConfluencePage[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let dead = false;
    setRoots([]); setKids({}); setOpen({}); setLoading(true);
    confluence.treeRoots(spaceKey)
      .then((p) => { if (!dead) setRoots(p.filter((x) => x.spaceKey.toLowerCase() === spaceKey.toLowerCase())); })
      .catch(() => { /* tree unavailable */ })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [spaceKey]);

  const toggle = async (page: ConfluencePage) => {
    if (open[page.id]) { setOpen((o) => ({ ...o, [page.id]: false })); return; }
    if (!kids[page.id]) {
      setBusyId(page.id);
      try {
        const c = await confluence.children(page.id);
        setKids((k) => ({ ...k, [page.id]: c }));
      } catch { setKids((k) => ({ ...k, [page.id]: [] })); }
      finally { setBusyId(null); }
    }
    setOpen((o) => ({ ...o, [page.id]: true }));
  };

  const row = (page: ConfluencePage, depth: number): React.ReactNode => {
    if (excludeId && page.id === excludeId) return null;
    const selected = value === page.id;
    return (
      <div key={page.id}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: depth * 14 }}>
          <button
            onClick={() => void toggle(page)}
            title="Expand children"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', width: 18 }}
          >
            {busyId === page.id ? '…' : open[page.id] ? '⌄' : '›'}
          </button>
          <button
            onClick={() => onChange(page.id, page.title)}
            title={`Insert under "${page.title}"`}
            style={{
              background: selected ? 'var(--bg-panel-high)' : 'none',
              border: selected ? '1px solid var(--accent-cyan)' : '1px solid transparent',
              borderRadius: 6,
              cursor: 'pointer',
              color: selected ? 'var(--accent-cyan)' : 'var(--text-primary)',
              padding: '2px 8px',
              textAlign: 'left',
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {page.title}
          </button>
        </div>
        {open[page.id] ? (kids[page.id] ?? []).map((c) => row(c, depth + 1)) : null}
      </div>
    );
  };

  return (
    <div style={{ border: '1px solid var(--border-soft)', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={{ whiteSpace: 'nowrap' }}>Space</label>
        <select value={spaceKey} onChange={(e) => onSpaceChange(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
          {spaces.map((s) => <option key={s.key} value={s.key}>{s.name} ({s.key})</option>)}
        </select>
      </div>
      <button
        onClick={() => onChange('', '')}
        style={{
          background: value === '' ? 'var(--bg-panel-high)' : 'none',
          border: value === '' ? '1px solid var(--accent-cyan)' : '1px solid transparent',
          borderRadius: 6, cursor: 'pointer', color: value === '' ? 'var(--accent-cyan)' : 'var(--muted)',
          padding: '2px 8px', textAlign: 'left',
        }}
      >
        — Space root (no parent) —
      </button>
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {loading ? <div className="muted" style={{ padding: 6 }}>Loading page tree…</div> : roots.map((p) => row(p, 0))}
      </div>
    </div>
  );
}

function PageEditor({ mode, space, spaces, initial, onCancel, onSaved }: { mode: 'create' | 'edit'; space: ConfluenceSpace; spaces: ConfluenceSpace[]; initial: ConfluencePageContent | null; onCancel: () => void; onSaved: (page: ConfluencePageContent) => void }) {
  const editor = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [parentId, setParentId] = useState<string>(initial?.parentId ?? '');
  const [parentTitle, setParentTitle] = useState<string>('');
  const [targetSpaceKey, setTargetSpaceKey] = useState(space.key);
  const [pickerOpen, setPickerOpen] = useState(mode === 'create');
  const [sourceMode, setSourceMode] = useState(false);
  const [source, setSource] = useState(initial?.storageBody ?? '<p><br /></p>');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (editor.current) editor.current.innerHTML = storageToEditor(initial?.storageBody ?? '<p><br></p>'); }, [initial]);
  const toggleSource = () => {
    if (!sourceMode && editor.current) setSource(editorToStorage(editor.current));
    if (sourceMode && editor.current) editor.current.innerHTML = storageToEditor(source);
    setSourceMode((x) => !x);
  };
  const save = async () => {
    setError('');
    if (!title.trim()) { setError('Page title is required.'); return; }
    const storageBody = sourceMode ? source : editor.current ? editorToStorage(editor.current) : source;
    setBusy(true);
    try {
      const saved = mode === 'create'
        ? await confluence.createPage({ spaceKey: targetSpaceKey, title: title.trim(), storageBody, parentId: parentId || null })
        : await confluence.updatePage(initial!.id, { title: title.trim(), storageBody, version: initial!.version, parentId: parentId || null });
      onSaved(saved);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  };
  return (
    <section className="cf-editor-panel">
      <div className="cf-editor-top">
        <div><div className="cf-breadcrumb">{space.name} <span>/</span> {mode === 'create' ? 'New page' : 'Edit page'}</div><h2>{mode === 'create' ? 'Create a page' : 'Edit page'}</h2></div>
        <div style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={onCancel}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Publishing…' : mode === 'create' ? 'Publish' : 'Update'}</button></div>
      </div>
      <input className="cf-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Page title" autoFocus />
      <div className="cf-editor-meta">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Location
          <button className="btn" onClick={() => setPickerOpen((v) => !v)} title="Choose exactly where to insert the page">
            {targetSpaceKey} / {parentTitle || (parentId ? `#${parentId}` : 'space root')} {pickerOpen ? '▾' : '▸'}
          </button>
        </label>
        <button className="btn" onClick={toggleSource}>{sourceMode ? 'Visual editor' : 'Storage source'}</button>
      </div>
      {pickerOpen ? (
        <ParentPicker
          spaces={spaces}
          spaceKey={targetSpaceKey}
          onSpaceChange={(key) => { setTargetSpaceKey(key); setParentId(''); setParentTitle(''); }}
          value={parentId}
          onChange={(id, t) => { setParentId(id); setParentTitle(t); }}
          excludeId={initial?.id ?? null}
        />
      ) : null}
      {!sourceMode ? <><EditorToolbar editor={editor} /><div ref={editor} className="cf-editor-surface wiki-content" contentEditable suppressContentEditableWarning /></> : <textarea className="cf-source-editor" value={source} onChange={(e) => setSource(e.target.value)} spellCheck={false} />}
      {error ? <div className="cf-error">{error}</div> : null}
    </section>
  );
}

function SpaceDropdown({
  spaces,
  value,
  onChange,
  includeAll = false,
}: {
  spaces: ConfluenceSpace[];
  value: string;
  onChange: (spaceKey: string) => void;
  includeAll?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = spaces.find((item) => item.key === value) ?? null;
  const filtered = spaces.filter((item) =>
    `${item.name} ${item.key} ${item.description} ${item.labels.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  const toggle = () => {
    setOpen((wasOpen) => {
      if (!wasOpen) {
        setQuery('');
        window.setTimeout(() => searchInput.current?.focus(), 0);
      }
      return !wasOpen;
    });
  };
  const choose = (spaceKey: string) => {
    onChange(spaceKey);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="cf-space-dropdown" ref={host}>
      <button type="button" className={`cf-space-trigger${open ? ' open' : ''}`} onClick={toggle} aria-haspopup="listbox" aria-expanded={open}>
        {selected ? <span className="cf-space-avatar">{selected.name.slice(0, 1).toUpperCase()}</span> : <span className="cf-space-avatar all">◎</span>}
        <span className="cf-space-trigger-text"><b>{selected?.name ?? 'All Indigo spaces'}</b><small>{selected ? selected.key : `${spaces.length} spaces available`}</small></span>
        <span className="cf-space-chevron">⌄</span>
      </button>
      {open ? <div className="cf-space-menu" role="listbox">
        <div className="cf-space-search"><span>⌕</span><input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} placeholder="Search spaces by name or key…" /></div>
        <div className="cf-space-options">
          {includeAll && !query ? <button type="button" className={!value ? 'selected' : ''} onClick={() => choose('')}><span className="cf-space-avatar all">◎</span><span><b>All Indigo spaces</b><small>Search every available space</small></span>{!value ? <i>✓</i> : null}</button> : null}
          {filtered.map((item) => <button type="button" key={item.key} className={item.key === value ? 'selected' : ''} onClick={() => choose(item.key)}><span className="cf-space-avatar">{item.name.slice(0, 1).toUpperCase()}</span><span><b>{item.name}</b><small>{item.key}{item.status === 'archived' ? ' · Archived' : ''}</small></span>{item.key === value ? <i>✓</i> : null}</button>)}
          {filtered.length === 0 ? <div className="cf-space-no-results">No matching Indigo spaces</div> : null}
        </div>
        <div className="cf-space-menu-foot">Showing {filtered.length} of {spaces.length} spaces</div>
      </div> : null}
    </div>
  );
}

const emptySearch: ConfluenceSearchOptions = { query: '', title: '', body: '', creator: '', contributor: '', label: '', createdAfter: '', createdBefore: '', modifiedAfter: '', modifiedBefore: '', sort: 'modified', limit: 100 };

function SearchPanel({ spaces, currentSpaceKey, onOpen }: { spaces: ConfluenceSpace[]; currentSpaceKey: string; onOpen: (page: ConfluencePage) => void }) {
  const [form, setForm] = useState<ConfluenceSearchOptions>(() => ({ ...emptySearch, spaceKey: currentSpaceKey }));
  const [advanced, setAdvanced] = useState(false);
  const [results, setResults] = useState<ConfluencePage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const set = (key: keyof ConfluenceSearchOptions, value: string | number) => setForm((x) => ({ ...x, [key]: value }));
  const search = async () => {
    setBusy(true); setError(''); setSearched(true);
    try {
      const found = await confluence.search(form);
      setResults(found.filter((page) => Boolean(page?.id && page?.title)));
    } catch (e) {
      setResults([]);
      setError(message(e));
    } finally { setBusy(false); }
  };
  return (
    <section className="cf-search-panel">
      <div className="cf-search-head"><div><h1>Search Indigo Confluence</h1><div className="muted">Find pages by text, title, author, label, space, or date. Search starts in your selected space.</div></div></div>
      <form onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <div className="cf-search-main"><input value={form.query} onChange={(e) => set('query', e.target.value)} placeholder="Search pages…" /><SpaceDropdown spaces={spaces} value={form.spaceKey ?? ''} includeAll onChange={(key) => set('spaceKey', key)} /><button className="btn btn-primary" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button></div>
        <button type="button" className="cf-advanced-toggle" onClick={() => setAdvanced((x) => !x)}>{advanced ? 'Hide' : 'Show'} advanced search {advanced ? '⌃' : '⌄'}</button>
        {advanced ? <div className="cf-search-grid">
          <label>Title contains<input value={form.title} onChange={(e) => set('title', e.target.value)} /></label><label>Body contains<input value={form.body} onChange={(e) => set('body', e.target.value)} /></label>
          <label>Created by<input value={form.creator} onChange={(e) => set('creator', e.target.value)} placeholder="Username" /></label><label>Contributed by<input value={form.contributor} onChange={(e) => set('contributor', e.target.value)} placeholder="Username" /></label>
          <label>Label<input value={form.label} onChange={(e) => set('label', e.target.value)} /></label><label>Sort by<select value={form.sort} onChange={(e) => set('sort', e.target.value)}><option value="modified">Last modified</option><option value="created">Created</option><option value="title">Title</option></select></label>
          <label>Created after<input type="date" value={form.createdAfter} onChange={(e) => set('createdAfter', e.target.value)} /></label><label>Created before<input type="date" value={form.createdBefore} onChange={(e) => set('createdBefore', e.target.value)} /></label>
          <label>Modified after<input type="date" value={form.modifiedAfter} onChange={(e) => set('modifiedAfter', e.target.value)} /></label><label>Modified before<input type="date" value={form.modifiedBefore} onChange={(e) => set('modifiedBefore', e.target.value)} /></label>
        </div> : null}
      </form>
      {error ? <div className="cf-error">{error}</div> : null}
      {searched && !busy && !error ? <div className="cf-search-count">{results.length} {results.length === 1 ? 'page' : 'pages'} found</div> : null}
      <div className="cf-results">{results.map((page) => <button key={page.id} className="cf-result" onClick={() => onOpen(page)}><span className="cf-page-icon">▤</span><span><b>{page.title}</b><small>{page.spaceKey} · Updated {formatDate(page.lastModifiedAt)}{page.lastModifiedBy ? ` by ${page.lastModifiedBy}` : ''}</small>{page.excerpt ? <span className="cf-excerpt">{page.excerpt}</span> : null}</span></button>)}{!busy && searched && results.length === 0 && !error ? <div className="cf-empty">No matching pages. Try fewer words or choose All Indigo spaces.</div> : null}{!busy && !searched ? <div className="cf-empty">Search across all available Indigo pages.</div> : null}</div>
    </section>
  );
}

export function ConfluenceView() {
  const [status, setStatus] = useState<ConfluenceStatus | null>(null);
  const [spaces, setSpaces] = useState<ConfluenceSpace[]>([]);
  const [space, setSpace] = useState<ConfluenceSpace | null>(null);
  const [roots, setRoots] = useState<ConfluencePage[]>([]);
  const [page, setPage] = useState<ConfluencePageContent | null>(null);
  const [mode, setMode] = useState<Mode>('pages');
  const [pageQuery, setPageQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [treeLoading, setTreeLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState('');
  const preservePageForSpaceChange = useRef(false);
  const [sideOpen, setSideOpen] = useState(() => {
    try { return localStorage.getItem('mc.cf.side') !== '0'; } catch { return true; }
  });
  const toggleSide = () =>
    setSideOpen((prev) => {
      try { localStorage.setItem('mc.cf.side', prev ? '0' : '1'); } catch { /* best-effort */ }
      return !prev;
    });

  const loadSpaces = async (fresh = false) => {
    setLoading(true); setError('');
    try {
      const [nextStatus, nextSpaces] = await Promise.all([confluence.status(), confluence.spaces(fresh)]);
      setStatus(nextStatus); setSpaces(nextSpaces);
      const savedKey = localStorage.getItem('jiraweb.confluence.space');
      setSpace((old) => nextSpaces.find((s) => s.key === old?.key) ?? nextSpaces.find((s) => s.key === savedKey) ?? nextSpaces[0] ?? null);
    } catch (e) { setError(message(e)); try { setStatus(await confluence.status()); } catch { /* status unavailable */ } }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadSpaces(); }, []);
  useEffect(() => {
    if (!space) { setRoots([]); return; }
    let cancelled = false;
    const selectedKey = space.key;
    localStorage.setItem('jiraweb.confluence.space', space.key);
    void updateSettings({ lastConfluenceSpaceKey: space.key }).catch(() => undefined);
    if (preservePageForSpaceChange.current) preservePageForSpaceChange.current = false;
    else setPage(null);
    setPageQuery('');
    setRoots([]);
    setTreeLoading(true);
    setError('');
    void (async () => {
      try {
        const loaded = await confluence.treeRoots(selectedKey);
        if (!cancelled) setRoots(loaded.filter((page) => page.spaceKey.toLowerCase() === selectedKey.toLowerCase()));
      } catch (e) {
        if (!cancelled) setError(message(e));
      } finally {
        if (!cancelled) setTreeLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [space]);

  // Deep link support: #/confluence/<pageId> (used by Lumo confluence cards).
  useEffect(() => {
    const applyHash = () => {
      const m = window.location.hash.match(/^#\/?confluence\/(\d+)/);
      if (m) void openPage({ id: m[1] } as ConfluencePage);
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces]);

  const openPage = async (selected: ConfluencePage) => {
    setMode('pages'); setPageLoading(true); setError('');
    try {
      const loaded = await confluence.page(selected.id);
      const owning = spaces.find((s) => s.key.toLowerCase() === loaded.spaceKey.toLowerCase());
      if (owning && owning.key !== space?.key) {
        preservePageForSpaceChange.current = true;
        setSpace(owning);
      }
      setPage(loaded);
    } catch (e) { setError(message(e)); }
    finally { setPageLoading(false); }
  };
  const filteredRoots = roots.filter((p) => p.title.toLowerCase().includes(pageQuery.toLowerCase()));

  if (!loading && (!status?.configured || error.includes('Connect Confluence'))) return <div className="cf-connect-empty card"><div className="cf-logo">C</div><h2>Connect Confluence</h2><p>Open Settings and add your Confluence Base URL and PAT. This workspace will show only Indigo spaces.</p><a className="btn btn-primary" href="#/settings">Open Settings</a>{error ? <div className="cf-error">{error}</div> : null}</div>;

  return (
    <div className="cf-workspace">
      {sideOpen && (
      <aside className="cf-sidebar">
        <div className="cf-brand"><span className="cf-brand-mark">C</span><span><b>Confluence</b><small>Indigo knowledge</small></span><button className="cf-refresh" title="Refresh spaces" onClick={() => void loadSpaces(true)}>↻</button></div>
        <div className="cf-side-section"><label>Spaces · {spaces.length}</label><SpaceDropdown spaces={spaces} value={space?.key ?? ''} onChange={(key) => { setSpace(spaces.find((item) => item.key === key) ?? null); setMode('pages'); }} /></div>
        {space ? <><div className="cf-side-section page-filter"><label>Pages · {roots.length}{treeLoading ? ' loading…' : ''}</label><input value={pageQuery} onChange={(e) => setPageQuery(e.target.value)} placeholder="Filter page tree" /></div>{treeLoading && roots.length === 0 ? <div className="cf-tree-loading">Loading {space.name} page tree…</div> : <PageTree key={space.key} pages={filteredRoots} selectedId={page?.id ?? null} onOpen={(p) => void openPage(p)} />}</> : null}
      </aside>
      )}
      <div className="cf-main">
        <header className="cf-topnav"><button className="btn btn-icon" title={sideOpen ? 'Hide sidebar — full page mode' : 'Show sidebar'} onClick={toggleSide}>{sideOpen ? '⟨⟨' : '⟩⟩'}</button><div className="cf-tabs"><button className={mode === 'pages' || mode === 'edit' ? 'active' : ''} onClick={() => setMode('pages')}>Pages</button><button className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>Search</button></div><button className="btn btn-primary" disabled={!space} onClick={() => setMode('create')}>＋ Create page</button></header>
        <div className={`cf-content${mode === 'pages' && page ? ' cf-content-page' : ''}`}>
          {error ? <div className="cf-error cf-global-error">{error}<button onClick={() => setError('')}>×</button></div> : null}
          {mode === 'search' ? <SearchPanel spaces={spaces} currentSpaceKey={space?.key ?? ''} onOpen={(p) => void openPage(p)} /> : null}
          {mode === 'create' && space ? <PageEditor mode="create" space={space} spaces={spaces} initial={null} onCancel={() => setMode('pages')} onSaved={(saved) => { setRoots((items) => [saved, ...items.filter((item) => item.id !== saved.id)]); setPage(saved); setMode('pages'); }} /> : null}
          {mode === 'edit' && space && page ? <PageEditor mode="edit" space={space} spaces={spaces} initial={page} onCancel={() => setMode('pages')} onSaved={(saved) => { setPage(saved); setRoots((x) => x.map((p) => p.id === saved.id ? saved : p)); setMode('pages'); }} /> : null}
          {mode === 'pages' ? pageLoading ? <div className="cf-empty">Loading page…</div> : page ? <PageViewer page={page} baseUrl={status?.baseUrl ?? null} onEdit={() => setMode('edit')} /> : <div className="cf-welcome"><div className="cf-welcome-icon">▤</div><h2>{space ? space.name : 'Indigo Confluence'}</h2><p>{space?.description || 'Choose a page from the tree, search all Indigo content, or create a new page.'}</p><div><button className="btn btn-primary" disabled={!space} onClick={() => setMode('create')}>Create a page</button><button className="btn" onClick={() => setMode('search')}>Search pages</button></div></div> : null}
        </div>
      </div>
    </div>
  );
}

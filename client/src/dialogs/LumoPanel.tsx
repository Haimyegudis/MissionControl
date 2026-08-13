// Lumo panel (ui-parity §10.10) — 430×560 fixed panel bottom-right above the
// FAB. Always mounted (display toggles) so the conversation survives closing.
// SSE consumption via api lumoAsk; card click → issue details or card modal.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { lumoAsk } from '../api/client';
import { getSettings, settingsStore, updateSettings } from '../stores/settings';
import { useStore } from '../stores/useStore';
import type { LumoCard, LumoTurn } from '../types';
import { useDialogs } from './DialogHost';
import { LumoCardModal } from './LumoCardModal';
import { sourceMeta } from './lumoSources';

export const LUMO_MODELS = [
  'claude-sonnet-5[1m]',
  'claude-sonnet-5',
  'claude-opus-4.6',
  'claude-haiku-4.5',
  'gpt-5.2',
  'gemini-2.5-pro',
] as const;

interface LumoMessage {
  role: 'user' | 'assistant';
  text: string;
  cards: LumoCard[];
}

const ISSUE_KEY_IN_TITLE = /\b[A-Z][A-Z0-9_]+-\d+\b/;

function Avatar({ size }: { size: number }) {
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        background: 'linear-gradient(135deg, #818CF8, #C4B5FD)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#312E81',
        fontWeight: 800,
        fontSize: size * 0.45,
      }}
    >
      L
    </div>
  );
}

function CardGroup({
  cards,
  onCardClick,
}: {
  cards: LumoCard[];
  onCardClick: (card: LumoCard) => void;
}) {
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const meta = sourceMeta(cards[0]?.source);

  const toggleBtn = (value: 'cards' | 'table'): CSSProperties => ({
    background: view === value ? '#4F46E5' : 'transparent',
    color: view === value ? '#FFFFFF' : '#818CF8',
    border: '1px solid #4F46E5',
    borderRadius: 6,
    fontSize: 10,
    padding: '2px 8px',
    cursor: 'pointer',
  });

  return (
    <div style={{ marginLeft: 42, marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, display: 'inline-block' }}
        />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{meta.label}</span>
        <div style={{ flex: 1 }} />
        <button style={toggleBtn('table')} onClick={() => setView('table')}>
          Table
        </button>
        <button style={toggleBtn('cards')} onClick={() => setView('cards')}>
          Cards
        </button>
      </div>

      {view === 'cards' ? (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {cards.map((card, i) => (
            <div
              key={i}
              onClick={() => onCardClick(card)}
              style={{
                width: 190,
                height: 160,
                flexShrink: 0,
                border: '1px solid var(--border-soft)',
                borderRadius: 10,
                padding: 10,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                background: 'var(--bg-panel-high)',
              }}
            >
              <span
                style={{
                  alignSelf: 'flex-start',
                  background: sourceMeta(card.source).color,
                  color: '#FFFFFF',
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 999,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {sourceMeta(card.source).label}
              </span>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {card.title}
              </div>
              <div
                className="muted"
                style={{ fontSize: 11, lineHeight: 1.35, overflow: 'hidden', flex: 1 }}
              >
                {card.summary}
              </div>
              <div style={{ color: '#818CF8', fontSize: 11, fontWeight: 600 }}>Read →</div>
            </div>
          ))}
        </div>
      ) : (
        <div>
          {/* WPF #22818CF8 is ARGB — CSS equivalent is RRGGBBAA. */}
          <style>{'.jw-lumo-row:hover{background:#818CF822;}'}</style>
          {cards.map((card, i) => (
            <div
              key={i}
              className="jw-lumo-row"
              onClick={() => onCardClick(card)}
              style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer' }}
            >
              <div style={{ color: '#818CF8', fontWeight: 700, fontSize: 12 }}>{card.title}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {card.summary}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LumoPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogs = useDialogs();
  const appSettings = useStore(settingsStore);

  const [messages, setMessages] = useState<LumoMessage[]>([]);
  const [input, setInput] = useState('');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [modalCard, setModalCard] = useState<LumoCard | null>(null);
  const [projectKey, setProjectKey] = useState(() => getSettings().defaultProjectKey || 'ISW');
  const [model, setModel] = useState(() => {
    const m = getSettings().aiModel;
    return m && (LUMO_MODELS as readonly string[]).includes(m) ? m : LUMO_MODELS[0];
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const thinking = statusText !== null;

  // Keep unsynced local defaults in step once settings load.
  const settingsProject = appSettings.defaultProjectKey;
  useEffect(() => {
    setProjectKey((prev) => (prev ? prev : settingsProject || 'ISW'));
  }, [settingsProject]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, statusText]);

  const persistProject = (value: string) => {
    setProjectKey(value);
    if (value.trim()) {
      updateSettings({ defaultProjectKey: value.trim() }).catch(() => {});
    }
  };

  const persistModel = (value: string) => {
    setModel(value);
    updateSettings({ aiModel: value }).catch(() => {});
  };

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || thinking) return;
    const userMsg: LumoMessage = { role: 'user', text, cards: [] };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setStatusText('Lumo is thinking...');

    const turns: LumoTurn[] = history.map((m) => ({ role: m.role, content: m.text }));
    try {
      const result = await lumoAsk(
        { messages: turns, projectKey: projectKey.trim() || 'ISW', model },
        (status) => setStatusText(status),
      );
      setMessages((prev) => [...prev, { role: 'assistant', text: result.summary, cards: result.cards ?? [] }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `Hmm, I ran into a problem: ${msg}`, cards: [] },
      ]);
    } finally {
      setStatusText(null);
    }
  };

  // Yaki-style context bar: program → cluster → HW/SW drill-down (hidden by default).
  // localStorage is absent in SSR test renders — guard access.
  const lsGet = (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const [ctxOpen, setCtxOpen] = useState(() => lsGet('mc.lumo.ctx') === '1');
  const toggleCtx = () =>
    setCtxOpen((prev) => {
      try {
        localStorage.setItem('mc.lumo.ctx', prev ? '' : '1');
      } catch {
        /* persistence best-effort */
      }
      return !prev;
    });
  const [program, setProgram] = useState('kedem');
  const [clusters, setClusters] = useState<string[]>([]);
  const [cluster, setCluster] = useState('');
  const [scope, setScope] = useState<'ALL' | 'HW' | 'SW'>('ALL');

  useEffect(() => {
    if (!ctxOpen) return;
    let dead = false;
    fetch(`/api/lumo/clusters?program=${encodeURIComponent(program)}`)
      .then((r) => r.json())
      .then((d) => {
        if (dead) return;
        const list: string[] = Array.isArray(d?.clusters)
          ? d.clusters.map((c: unknown) => String(c))
          : [];
        setClusters(list);
        setCluster((prev) => (list.includes(prev) ? prev : list[0] ?? ''));
      })
      .catch(() => setClusters([]));
    return () => {
      dead = true;
    };
  }, [program, ctxOpen]);

  const askContext = () => {
    if (!cluster || thinking) return;
    const q =
      scope === 'HW'
        ? `Show all HW configuration-control changes for ${program} cluster ${cluster}. Full table, every row.`
        : scope === 'SW'
          ? `Show the SW release-notes feature list for ${program} cluster ${cluster}.`
          : `Show all changes for ${program} cluster ${cluster} — HW config control and SW release notes, as two separate tables.`;
    void send(q);
  };

  const onCardClick = (card: LumoCard) => {
    if ((card.source ?? '').toLowerCase() === 'jira') {
      const match = ISSUE_KEY_IN_TITLE.exec(card.title ?? '');
      if (match) {
        dialogs.openIssueDetails(match[0]);
        return;
      }
    }
    setModalCard(card);
  };

  return (
    <>
      <div
        style={{
          position: 'fixed',
          right: 24,
          bottom: 92,
          width: 430,
          height: 560,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 120px)',
          zIndex: 1500,
          display: open ? 'flex' : 'none',
          flexDirection: 'column',
          borderRadius: 20,
          overflow: 'hidden',
          background: 'var(--bg-panel-high)',
          border: '1px solid var(--border-soft)',
          boxShadow: '0 18px 48px rgba(2, 6, 20, 0.6)',
          backdropFilter: 'blur(14px)',
        }}
      >
        {/* --------------------------------------------------- header ------ */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
            flexShrink: 0,
          }}
        >
          <Avatar size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 700 }}>Lumo</div>
            <div style={{ color: '#DDD6FE', fontSize: 10 }}>powered by {model}</div>
          </div>
          <button
            title="Clear conversation"
            onClick={() => setMessages([])}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#DDD6FE' }}
          >
            🗑
          </button>
          <button
            title="Close"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#FFFFFF' }}
          >
            ✕
          </button>
        </div>

        {/* ----------------------------------------------- context bar ----- */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-soft)',
            flexShrink: 0,
          }}
        >
          <label style={{ fontSize: 10.5 }}>Project</label>
          <input
            value={projectKey}
            onChange={(e) => persistProject(e.target.value)}
            style={{ width: 80, padding: '4px 8px', fontSize: 12 }}
          />
          <label style={{ fontSize: 10.5 }}>Model</label>
          <select
            value={model}
            onChange={(e) => persistModel(e.target.value)}
            style={{ flex: 1, minWidth: 0, padding: '4px 8px', fontSize: 12 }}
          >
            {LUMO_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* ------------------------------------------------- messages ------ */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {messages.length === 0 && (
            <div className="muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 24 }}>
              Ask Lumo about your Jira issues.
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0' }}>
                <div
                  style={{
                    maxWidth: 320,
                    background: '#4F46E5',
                    color: '#FFFFFF',
                    borderRadius: '18px 18px 6px 18px',
                    padding: '8px 12px',
                    fontSize: 12.5,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} style={{ margin: '8px 0' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <Avatar size={34} />
                  <div
                    className="card"
                    style={{
                      borderRadius: '6px 18px 18px 18px',
                      padding: '8px 12px',
                      fontSize: 12.5,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      minWidth: 0,
                    }}
                  >
                    {m.text}
                  </div>
                </div>
                {m.cards.length > 0 && <CardGroup cards={m.cards} onCardClick={onCardClick} />}
              </div>
            ),
          )}
          {thinking && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 0 42px' }}>
              <span style={{ color: '#818CF8', letterSpacing: 2 }}>●●●</span>
              <span className="muted" style={{ fontSize: 11.5 }}>
                {statusText}
              </span>
            </div>
          )}
        </div>

        {/* ------------------------------------------- context drill-down --- */}
        <div style={{ padding: '0 12px', flexShrink: 0 }}>
          <button
            onClick={toggleCtx}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#818CF8',
              fontSize: 11,
              padding: '2px 0',
            }}
          >
            {ctxOpen ? '▾ Hide cluster picker' : '▸ Cluster picker (project · cluster · HW/SW)'}
          </button>
          {ctxOpen && (
            <div style={{ display: 'flex', gap: 6, paddingBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={program} onChange={(e) => setProgram(e.target.value)} style={{ fontSize: 12 }}>
                <option value="kedem">KEDEM</option>
                <option value="david">DAVID</option>
              </select>
              <select value={cluster} onChange={(e) => setCluster(e.target.value)} style={{ fontSize: 12, minWidth: 70 }}>
                {clusters.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select value={scope} onChange={(e) => setScope(e.target.value as 'ALL' | 'HW' | 'SW')} style={{ fontSize: 12 }}>
                <option value="ALL">ALL</option>
                <option value="HW">HW</option>
                <option value="SW">SW</option>
              </select>
              <button className="btn" style={{ fontSize: 12, padding: '4px 10px' }} onClick={askContext} disabled={!cluster || thinking}>
                Ask
              </button>
            </div>
          )}
        </div>

        {/* ---------------------------------------------------- input ------ */}
        <div style={{ display: 'flex', gap: 8, padding: 12, flexShrink: 0 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask Lumo anything..."
            disabled={thinking}
            style={{
              flex: 1,
              minWidth: 0,
              borderRadius: 10,
              border: '1.5px solid #4F46E5',
              padding: '9px 12px',
            }}
          />
          <button
            onClick={() => void send()}
            disabled={thinking}
            title="Send"
            aria-label="Send"
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: 10,
              border: 'none',
              cursor: thinking ? 'default' : 'pointer',
              background: '#4F46E5',
              color: '#FFFFFF',
              fontSize: 16,
              opacity: thinking ? 0.5 : 1,
            }}
          >
            ➤
          </button>
        </div>
      </div>

      {modalCard && <LumoCardModal card={modalCard} onClose={() => setModalCard(null)} />}
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { metadata } from '../api/client';
import {
  applyJqlSuggestion,
  COMMON_JQL_FIELDS,
  getJqlCompletionContext,
  getJqlSuggestions,
  type JqlSuggestion,
} from '../lib/jqlAutocomplete';

export interface JqlEditorProps {
  value: string;
  onChange: (value: string) => void;
}

async function fallbackValues(field: string): Promise<string[]> {
  switch (field.toLowerCase().replace(/\s+/g, '')) {
    case 'project':
      return metadata.kind('projects');
    case 'issuetype':
    case 'type':
      return metadata.kind('issuetypes');
    case 'status':
    case 'statuscategory':
      return metadata.kind('statuses');
    case 'priority':
      return metadata.kind('priorities');
    case 'resolution':
      return metadata.kind('resolutions');
    case 'fixversion':
    case 'affectedversion':
      return metadata.versions();
    case 'component':
    case 'components':
      return metadata.components();
    case 'assignee':
    case 'reporter':
    case 'creator':
    case 'worklogauthor':
      return (await metadata.users()).map((user) => user.displayName);
    default:
      return [];
  }
}

export function JqlEditor({ value, onChange }: JqlEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef(0);
  const blurTimerRef = useRef<number | null>(null);
  const [caret, setCaret] = useState(value.length);
  const [fields, setFields] = useState<string[]>([...COMMON_JQL_FIELDS]);
  const [remoteValues, setRemoteValues] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    metadata
      .kind('fields')
      .then((items) => {
        if (!cancelled) setFields(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const context = useMemo(() => getJqlCompletionContext(value, caret, fields), [value, caret, fields]);

  useEffect(() => {
    setActive(0);
    if (context.mode !== 'value' || !context.field) {
      setRemoteValues([]);
      setLoading(false);
      return;
    }
    const request = ++requestRef.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      metadata
        .suggestions(context.field!, context.query)
        .then(async (items) => (items.length > 0 ? items : fallbackValues(context.field!)))
        .then((items) => {
          if (request === requestRef.current) setRemoteValues(items);
        })
        .catch(() => {
          if (request === requestRef.current) setRemoteValues([]);
        })
        .finally(() => {
          if (request === requestRef.current) setLoading(false);
        });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [context.field, context.mode, context.query]);

  const suggestions = useMemo(
    () => getJqlSuggestions(context, fields, remoteValues),
    [context, fields, remoteValues],
  );

  const updateCaret = (target: HTMLTextAreaElement) => {
    setCaret(target.selectionStart ?? target.value.length);
  };

  const choose = (suggestion: JqlSuggestion) => {
    const next = applyJqlSuggestion(value, context, suggestion);
    onChange(next.value);
    setCaret(next.caret);
    setOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.ctrlKey && event.key === ' ') {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(suggestions.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if ((event.key === 'Enter' || event.key === 'Tab') && suggestions[active]) {
      event.preventDefault();
      choose(suggestions[active]);
    }
  };

  const showMenu = open && (suggestions.length > 0 || loading);

  return (
    <div style={{ position: 'relative', marginTop: 4 }}>
      <textarea
        ref={textareaRef}
        value={value}
        aria-label="JQL"
        aria-autocomplete="list"
        aria-expanded={showMenu}
        spellCheck={false}
        placeholder="Start typing a field, for example: project = ISW AND status = Done"
        onFocus={(event) => {
          updateCaret(event.currentTarget);
          setOpen(true);
        }}
        onChange={(event) => {
          onChange(event.target.value);
          updateCaret(event.target);
          setOpen(true);
        }}
        onClick={(event) => {
          updateCaret(event.currentTarget);
          setOpen(true);
        }}
        onSelect={(event) => updateCaret(event.currentTarget)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          blurTimerRef.current = window.setTimeout(() => setOpen(false), 120);
        }}
        style={{
          width: '100%',
          height: 120,
          resize: 'vertical',
          fontFamily: 'Consolas, monospace',
          lineHeight: 1.5,
        }}
      />
      {showMenu ? (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 3,
            maxHeight: 260,
            overflowY: 'auto',
            zIndex: 3000,
            background: 'var(--bg-panel-high)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {suggestions.map((suggestion, index) => (
            <div
              key={`${suggestion.kind}:${suggestion.label}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
                choose(suggestion);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '6px 10px',
                cursor: 'pointer',
                background: index === active
                  ? 'color-mix(in srgb, var(--accent-cyan) 14%, transparent)'
                  : 'transparent',
              }}
            >
              <span style={{ fontFamily: 'Consolas, monospace', fontSize: 12.5 }}>{suggestion.label}</span>
              <span className="muted" style={{ fontSize: 11 }}>{suggestion.detail}</span>
            </div>
          ))}
          {loading && suggestions.length === 0 ? (
            <div className="muted" style={{ padding: '7px 10px', fontSize: 12 }}>Loading Jira suggestions…</div>
          ) : null}
        </div>
      ) : null}
      <div className="muted" style={{ marginTop: 3, fontSize: 10.5 }}>
        ↑/↓ choose · Enter or Tab insert · Esc close · Ctrl+Space reopen
      </div>
    </div>
  );
}

// Settings page primitives (redesign): flat sections with an uppercase
// kicker + hairline, 2-col field rows (label left, control right) and the
// uniform connection-block chrome. Styles live in theme.css ("Settings page").

import type { ReactNode } from 'react';

/** One flat settings section — anchor target for the sticky mini-nav. */
export function Section({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <section id={id} className="set-section">
      <h3 className="set-kicker">{label}</h3>
      {children}
    </section>
  );
}

/** Label-left / control-right field row on the shared 2-col grid. */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-field">
      <div>
        <div className="set-field-label">{label}</div>
        {hint ? <div className="set-field-hint">{hint}</div> : null}
      </div>
      <div className="set-field-control">{children}</div>
    </div>
  );
}

/** Connection block: status dot + service name + status text, then the
 *  hardcoded service URL (read-only) and fields. */
export function ConnBlock({
  name,
  url,
  ok,
  statusText,
  children,
}: {
  name: string;
  /** Fixed service endpoint (lib/serviceUrls) — informational, never editable. */
  url?: string;
  ok: boolean;
  statusText: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="conn">
      <div className="conn-head">
        <span className={`conn-dot ${ok ? 'on' : 'off'}`} />
        <span className="conn-name">{name}</span>
        <span className="conn-status">{statusText}</span>
      </div>
      {url ? <div className="conn-url">{url}</div> : null}
      {children}
    </div>
  );
}

/** Per-service inline status line ("✕ …" renders red, "✓ …" green). */
export function ConnNote({ text }: { text: string }) {
  if (!text) return null;
  const tone = text.startsWith('✕') ? ' err' : text.startsWith('✓') ? ' ok' : '';
  return <div className={`conn-note${tone}`}>{text}</div>;
}

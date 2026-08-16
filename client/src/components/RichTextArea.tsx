// WYSIWYG textarea replacement for the case editor: a contentEditable that
// SHOWS bold / lists / tables while persisting TestRail markdown. Enter
// inside a numbered list continues the numbering natively. Value in/out is
// markdown; the component is uncontrolled between edits (re-seeds only when
// the incoming value differs from what it last emitted, e.g. draft discard).

import { useEffect, useRef } from 'react';
import { htmlToMd, mdToHtml } from '../lib/caseMarkdown';

export interface RichTextAreaProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  minRows?: number;
  /** Registers the element as the rich-toolbar target on focus. */
  onFocusTarget?: (el: HTMLElement) => void;
}

export function RichTextArea({ value, onChange, placeholder, minRows = 2, onFocusTarget }: RichTextAreaProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (value === lastEmitted.current) return; // our own edit echoing back
    ref.current.innerHTML = mdToHtml(value);
    lastEmitted.current = value;
  }, [value]);

  const emit = () => {
    if (!ref.current) return;
    const md = htmlToMd(ref.current);
    lastEmitted.current = md;
    onChange(md);
  };

  return (
    <div
      ref={ref}
      className="rich-ta"
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder ?? ''}
      style={{ minHeight: `${minRows * 1.5 + 0.8}em` }}
      onInput={emit}
      onBlur={emit}
      onFocus={() => {
        if (ref.current) onFocusTarget?.(ref.current);
      }}
    />
  );
}

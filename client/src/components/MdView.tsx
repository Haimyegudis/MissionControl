// Rendered markdown display for TestRail text (case drawer preconditions,
// steps, expected). Legacy HTML tags are stripped first (richText), then the
// markdown renders to real bold/lists/tables. mdToHtml escapes all source
// text, so the injected HTML is safe.

import { mdToHtml } from '../lib/caseMarkdown';
import { richText } from '../lib/testrail';

export function MdView({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  return (
    <div
      className={`md-view${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: mdToHtml(richText(text)) }}
    />
  );
}

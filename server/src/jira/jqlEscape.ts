// JQL value quoting — port of MissionControl.Core JqlEscape.Quote.
// docs/reference/jira-rest-layer.md §6.

/**
 * Quote a value for safe embedding in JQL.
 * - null/empty -> `""` (quoted empty string)
 * - `\` and `"` are backslash-escaped
 * - control characters below 0x20 are DROPPED
 */
export function jqlQuote(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) return '""';
  let out = '"';
  for (const ch of value) {
    if (ch === '\\' || ch === '"') {
      out += '\\' + ch;
    } else if (ch.charCodeAt(0) < 0x20) {
      // drop control chars
    } else {
      out += ch;
    }
  }
  return out + '"';
}

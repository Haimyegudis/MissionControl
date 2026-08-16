// Shared error → text helper. The `err instanceof Error ? err.message :
// String(err)` incantation appeared 50+ times across the app.

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

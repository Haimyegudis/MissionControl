// Base64 without Node's Buffer. Core runs inside an Android WebView, where
// Buffer does not exist — using it there throws ReferenceError before any
// request is made, which is exactly how the TestRail Basic auth header failed.
//
// btoa only accepts a binary string, so the value is UTF-8 encoded first;
// otherwise any non-ASCII character in an email or key would throw
// InvalidCharacterError.

export function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

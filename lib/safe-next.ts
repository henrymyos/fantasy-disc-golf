/** A same-site absolute path from a `next` value, or null. Rejects external
 *  URLs, protocol-relative "//host", "/\host" and anything not starting with
 *  "/" (e.g. "@evil.com", which turns `${origin}${next}` into another host). */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}

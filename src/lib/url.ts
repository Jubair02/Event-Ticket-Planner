/**
 * Returns the value only if it is a plain http(s) URL, otherwise null.
 *
 * Organizer-supplied links (e.g. an event's Google Maps URL) end up in an
 * `href`. React does not block `javascript:` there, so a link like
 * `javascript:...` would execute on click. Everything that is not http/https
 * is rejected.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : null
  } catch {
    // Not an absolute URL at all.
    return null
  }
}

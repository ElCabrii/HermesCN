/**
 * Open-redirect guard for the login page's `?next=` redirect target.
 *
 * Ported exactly from static/login.js:28-58 (`_safeNextPath`), which mirrors
 * the server-side `api/routes.py:_safe_login_redirect_path` (#5578). Rules:
 * - must be path-absolute (start with `/`)
 * - must NOT start with `//` or `/\` (protocol-relative / backslash variants)
 * - must not contain control characters or whitespace
 * - must be ≤ 2048 characters
 * - must not resolve to the login route — even through up to 8 levels of
 *   nested percent-encoding; if still decoding at the cap, fail closed
 * - any parse error returns './'
 *
 * The default fallback is './' (relative to the current scope), matching the
 * legacy page.
 */
export function safeNextPath(raw: string | null): string {
  try {
    if (!raw) return './'
    if (raw.charAt(0) !== '/') return './' // must be path-absolute
    if (raw.charAt(1) === '/' || raw.charAt(1) === '\\') return './' // reject // and /\
    if (/[\x00-\x1f\x7f\s]/.test(raw)) return './' // reject control chars / whitespace
    // #5578: never redirect back to the login page — that self-referential
    // chain is what grows the URL exponentially on repeated expired-auth
    // bounces. Detect the login route even through nested percent-encoding
    // (a nested chain looks like `/session/login%3Fnext%3D...`, where the `?`
    // is encoded so a plain split('?') wouldn't isolate the path). Decode a
    // few levels and check the leading PATH. Only collapse login-route chains
    // — a legitimate non-login path that merely carries its own `next=` query
    // key must still round-trip.
    if (raw.length > 2048) return './'
    let probe = raw
    let stabilized = false
    for (let i = 0; i < 8; i++) {
      const pathOnly = probe.split('?')[0].split('#')[0].split('&')[0].replace(/\/+$/, '')
      if (pathOnly === '/login' || /\/login$/.test(pathOnly)) return './'
      let decoded: string
      try {
        decoded = decodeURIComponent(probe)
      } catch {
        stabilized = true
        break
      }
      if (decoded === probe) {
        stabilized = true
        break
      }
      probe = decoded
    }
    // If still decoding at the cap (pathologically deep encoding), fail closed.
    if (!stabilized) return './'
    return raw
  } catch {
    return './'
  }
}

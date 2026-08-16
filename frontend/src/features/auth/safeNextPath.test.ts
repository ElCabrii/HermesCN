import { describe, expect, it } from 'vitest'
import { safeNextPath } from './safeNextPath'

/**
 * Port of the open-redirect guard from static/login.js:28-58 (`_safeNextPath`),
 * plus the server-side twin api/routes.py `_safe_login_redirect_path` (#5578).
 * Expected values are the known-good literals from the legacy implementation.
 */
describe('safeNextPath()', () => {
  it('returns ./ when there is no next param', () => {
    expect(safeNextPath(null)).toBe('./')
    expect(safeNextPath('')).toBe('./')
  })

  it('rejects absolute URLs', () => {
    expect(safeNextPath('https://evil.example/phish')).toBe('./')
    expect(safeNextPath('http://evil.example/phish')).toBe('./')
    expect(safeNextPath('javascript:alert(1)')).toBe('./')
    expect(safeNextPath('mailto:x@example.com')).toBe('./')
  })

  it('rejects protocol-relative URLs', () => {
    expect(safeNextPath('//evil.example/phish')).toBe('./')
  })

  it('rejects backslash protocol-relative variants', () => {
    expect(safeNextPath('/\\evil.example/phish')).toBe('./')
  })

  it('rejects control characters and whitespace', () => {
    expect(safeNextPath('/ok\npath')).toBe('./')
    expect(safeNextPath('/ok\tpath')).toBe('./')
    expect(safeNextPath('/ok path')).toBe('./')
    expect(safeNextPath('/ok\x00path')).toBe('./')
    expect(safeNextPath('/ok\x1fpath')).toBe('./')
    expect(safeNextPath('/ok\x7fpath')).toBe('./')
  })

  it('rejects next paths pointing back at the login route', () => {
    expect(safeNextPath('/login')).toBe('./')
    expect(safeNextPath('/login/')).toBe('./')
    expect(safeNextPath('/session/login')).toBe('./')
    expect(safeNextPath('/session/login?next=/chat')).toBe('./')
  })

  it('rejects the login route through nested percent-encoding', () => {
    expect(safeNextPath('/session/login%3Fnext%3D/chat')).toBe('./')
    expect(safeNextPath('/%6cogin')).toBe('./')
    expect(safeNextPath('/session/%256cogin')).toBe('./')
  })

  it('fails closed when still decoding at the 8-level cap', () => {
    // Percent-encode every character (including letters and '%' itself) so
    // each pass adds one nesting level; the leading '/' is preserved so the
    // value passes the initial checks and reaches the decode loop.
    const pct = (s: string) =>
      Array.from(s, (ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
    let nested = '/login'
    for (let i = 0; i < 10; i++) nested = '/' + pct(nested.slice(1))
    // 10 levels of nesting: the guard gives up after 8 decode iterations.
    expect(safeNextPath(nested)).toBe('./')
    // Even a benign path is rejected if it decodes for more than 8 levels.
    let deep = '/chat'
    for (let i = 0; i < 10; i++) deep = '/' + pct(deep.slice(1))
    expect(safeNextPath(deep)).toBe('./')
  })

  it('rejects next longer than 2048 characters', () => {
    expect(safeNextPath(`/${'a'.repeat(2048)}`)).toBe('./')
  })

  it('accepts a legitimate path-absolute relative redirect', () => {
    expect(safeNextPath('/chat?x=1')).toBe('/chat?x=1')
    expect(safeNextPath('/')).toBe('/')
    expect(safeNextPath('/sessions/abc123')).toBe('/sessions/abc123')
    // A legitimate non-login path that merely carries its own next= query key
    // must still round-trip (#5578 regression).
    expect(safeNextPath('/admin?action=foo&next=/x')).toBe('/admin?action=foo&next=/x')
  })

  it('fails closed on malformed input', () => {
    // Not path-absolute → './' (never a valid redirect target).
    expect(safeNextPath('%')).toBe('./')
    // A malformed escape inside the decode loop is treated as "stabilized"
    // by the legacy guard and the raw path is returned unchanged — the value
    // is still path-absolute, so this matches static/login.js exactly.
    expect(safeNextPath('/%zz')).toBe('/%zz')
  })
})

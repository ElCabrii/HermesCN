import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import {
  getAuthStatus,
  login,
  logout,
  OIDC_CALLBACK_PATH,
  startOidcLoginUrl,
  type AuthStatus,
} from './auth'

const FULL_STATUS: AuthStatus = {
  auth_enabled: true,
  logged_in: true,
  oidc_enabled: true,
  password_auth_enabled: true,
  passwordless_enabled: false,
  passkeys_enabled: false,
  passkeys_count: 0,
  passkey_feature_flag: false,
  auth_disabled_acknowledged: false,
  trusted_auth_enabled: true,
  auth_type: 'trusted',
  user: 'alice',
  bound_profile: 'default',
}

describe('getAuthStatus()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the parsed status payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(FULL_STATUS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    await expect(getAuthStatus()).resolves.toEqual(FULL_STATUS)
  })

  it('requests /api/auth/status with credentials included (auth cookie)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await getAuthStatus()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/status')
    expect(init.credentials).toBe('include')
  })
})

describe('login()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the password to /api/auth/login and resolves { ok: true } on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    vi.stubGlobal('fetch', fetchMock)
    await expect(login('s3cret')).resolves.toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/login')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(String(init.body))).toEqual({ password: 's3cret' })
  })

  it('resolves with the "Auth not enabled" message when auth is disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, message: 'Auth not enabled' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    await expect(login('x')).resolves.toEqual({ ok: true, message: 'Auth not enabled' })
  })

  it('throws ApiError with "Invalid password" on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid password' }), { status: 401 })),
    )
    const err = await login('wrong').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 401, message: 'Invalid password' })
  })

  it('throws ApiError with the rate-limit message on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'Too many attempts. Try again in a minute.' }), { status: 429 }),
        ),
    )
    await expect(login('wrong')).rejects.toMatchObject({
      name: 'ApiError',
      status: 429,
      message: 'Too many attempts. Try again in a minute.',
    })
  })
})

describe('logout()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs /api/auth/logout with credentials and resolves { ok: true }', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    vi.stubGlobal('fetch', fetchMock)
    await expect(logout()).resolves.toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/logout')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
  })

  it('surfaces trusted_logout_url when the backend provides one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, trusted_logout_url: 'https://idp.example/logout' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    await expect(logout()).resolves.toEqual({ ok: true, trusted_logout_url: 'https://idp.example/logout' })
  })
})

describe('OIDC endpoints', () => {
  it('builds the /api/auth/oidc/start URL without a next path', () => {
    expect(startOidcLoginUrl()).toBe('/api/auth/oidc/start')
  })

  it('builds the /api/auth/oidc/start URL with an encoded next path', () => {
    expect(startOidcLoginUrl('/chat?session_id=a b')).toBe(
      '/api/auth/oidc/start?next=%2Fchat%3Fsession_id%3Da%20b',
    )
  })

  it('exposes the browser-driven /api/auth/oidc/callback path', () => {
    expect(OIDC_CALLBACK_PATH).toBe('/api/auth/oidc/callback')
  })
})

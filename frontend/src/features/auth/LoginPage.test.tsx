import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthStatus } from '@/api/auth'
import { LoginPage } from './LoginPage'

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeStatus(overrides: Partial<AuthStatus> = {}): AuthStatus {
  return {
    auth_enabled: true,
    logged_in: false,
    oidc_enabled: false,
    password_auth_enabled: true,
    passwordless_enabled: false,
    passkeys_enabled: false,
    passkeys_count: 0,
    passkey_feature_flag: true,
    auth_disabled_acknowledged: false,
    ...overrides,
  }
}

type RouteHandler = (init: RequestInit) => Response | Promise<Response>

/** URL-routed fetch stub; unknown URLs reject like a dead network. */
function mockFetch(routes: Record<string, Response | RouteHandler>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const handler = routes[url]
    if (!handler) return Promise.reject(new TypeError(`fetch failed: ${url}`))
    return Promise.resolve(typeof handler === 'function' ? handler(init ?? {}) : handler)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const okRoutes = { '/health': okJson({ ok: true }) }

describe('LoginPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows the password form when unauthenticated', async () => {
    vi.stubGlobal('location', { search: '', assign: vi.fn() })
    mockFetch({ '/api/auth/status': okJson(makeStatus()), ...okRoutes })
    render(<LoginPage />)

    expect(await screen.findByPlaceholderText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /sign in with provider/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /passkey/i })).not.toBeInTheDocument()
  })

  it('submits the password and redirects to the safe next path', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { search: '?next=%2Fchat%3Fx%3D1', assign })
    const fetchMock = mockFetch({
      '/api/auth/status': okJson(makeStatus()),
      '/api/auth/login': okJson({ ok: true }),
      ...okRoutes,
    })
    render(<LoginPage />)
    const user = userEvent.setup()
    await user.type(await screen.findByPlaceholderText('Password'), 's3cret')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/chat?x=1'))
    const loginCall = fetchMock.mock.calls.find(([input]) => String(input) === '/api/auth/login')
    expect(loginCall).toBeDefined()
    const [, init] = loginCall as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(String(init.body))).toEqual({ password: 's3cret' })
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  })

  it('shows the server error message on a 401', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { search: '', assign })
    mockFetch({
      '/api/auth/status': okJson(makeStatus()),
      '/api/auth/login': okJson({ error: 'Invalid password' }, 401),
      ...okRoutes,
    })
    render(<LoginPage />)
    const user = userEvent.setup()
    await user.type(await screen.findByPlaceholderText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid password')
    expect(assign).not.toHaveBeenCalled()
  })

  it('shows the rate-limit message on a 429', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { search: '', assign })
    mockFetch({
      '/api/auth/status': okJson(makeStatus()),
      '/api/auth/login': okJson({ error: 'Too many attempts. Try again in a minute.' }, 429),
      ...okRoutes,
    })
    render(<LoginPage />)
    const user = userEvent.setup()
    await user.type(await screen.findByPlaceholderText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in a minute.')
    expect(assign).not.toHaveBeenCalled()
  })

  it('redirects to / without showing the form when auth is not enabled', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { search: '', assign })
    mockFetch({ '/api/auth/status': okJson(makeStatus({ auth_enabled: false })), ...okRoutes })
    render(<LoginPage />)

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument()
  })

  it('renders the OIDC link with the safe next path when OIDC is enabled', async () => {
    vi.stubGlobal('location', { search: '?next=%2Fchat', assign: vi.fn() })
    mockFetch({
      '/api/auth/status': okJson(makeStatus({ oidc_enabled: true, password_auth_enabled: false })),
      ...okRoutes,
    })
    render(<LoginPage />)

    const link = await screen.findByRole('link', { name: /sign in with provider/i })
    expect(link).toHaveAttribute('href', '/api/auth/oidc/start?next=%2Fchat')
  })

  it('renders the passkey button when passkeys are enabled', async () => {
    vi.stubGlobal('location', { search: '', assign: vi.fn() })
    mockFetch({
      '/api/auth/status': okJson(makeStatus({ passkeys_enabled: true, passkeys_count: 2 })),
      ...okRoutes,
    })
    render(<LoginPage />)

    expect(await screen.findByRole('button', { name: /sign in with passkey/i })).toBeInTheDocument()
  })

  it('disables the form, retries every 3s, and reloads once the server is back', async () => {
    vi.useFakeTimers()
    const reload = vi.fn()
    vi.stubGlobal('location', { search: '', assign: vi.fn(), reload })
    let healthCalls = 0
    mockFetch({
      '/api/auth/status': okJson(makeStatus()),
      '/health': () => {
        healthCalls += 1
        if (healthCalls === 1) return Promise.reject(new TypeError('fetch failed'))
        return okJson({ ok: true })
      },
    })
    render(<LoginPage />)
    await act(async () => {}) // flush status fetch + first probe

    expect(
      screen.getByText('Cannot reach server — check your VPN / Tailscale connection.'),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Password')).toBeDisabled()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(healthCalls).toBe(2)
  })

  it('surfaces the connectivity failure when the status request also fails', async () => {
    vi.useFakeTimers()
    const reload = vi.fn()
    vi.stubGlobal('location', { search: '', assign: vi.fn(), reload })
    let healthCalls = 0
    mockFetch({
      '/health': () => {
        healthCalls += 1
        if (healthCalls === 1) return Promise.reject(new TypeError('fetch failed'))
        return okJson({ ok: true })
      },
    })
    render(<LoginPage />)
    await act(async () => {})

    expect(
      screen.getByText('Cannot reach server — check your VPN / Tailscale connection.'),
    ).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

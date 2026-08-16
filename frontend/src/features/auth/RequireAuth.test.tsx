import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthStatus } from '@/api/auth'
import { RequireAuth } from './RequireAuth'

const { getAuthStatusMock } = vi.hoisted(() => ({ getAuthStatusMock: vi.fn() }))
vi.mock('@/api/auth', () => ({ getAuthStatus: getAuthStatusMock }))

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

/** Minimal /login route stand-in that exposes the current location. */
function LoginStub() {
  const loc = useLocation()
  return <div>Login page {loc.search}</div>
}

describe('RequireAuth', () => {
  beforeEach(() => {
    getAuthStatusMock.mockReset()
  })

  it('shows a loading placeholder while the auth status request is pending', () => {
    getAuthStatusMock.mockReturnValue(new Promise(() => {}))
    render(
      <MemoryRouter>
        <RequireAuth>
          <div>Home content</div>
        </RequireAuth>
      </MemoryRouter>,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Home content')).not.toBeInTheDocument()
  })

  it('redirects to /login with the current path as next when unauthenticated', async () => {
    getAuthStatusMock.mockResolvedValue(makeStatus({ logged_in: false }))
    render(
      <MemoryRouter initialEntries={['/chat?x=1']}>
        <Routes>
          <Route element={<RequireAuth><div>Home content</div></RequireAuth>}>
            <Route path="/chat" element={<div>Chat</div>} />
          </Route>
          <Route path="/login" element={<LoginStub />} />
        </Routes>
      </MemoryRouter>,
    )

    const login = await screen.findByText(/Login page/)
    expect(login).toBeInTheDocument()
    expect(login).toHaveTextContent('next=%2Fchat%3Fx%3D1')
    expect(screen.queryByText('Home content')).not.toBeInTheDocument()
  })

  it('renders children when authenticated', async () => {
    getAuthStatusMock.mockResolvedValue(makeStatus({ logged_in: true }))
    render(
      <MemoryRouter>
        <RequireAuth>
          <div>Home content</div>
        </RequireAuth>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Home content')).toBeInTheDocument()
  })

  it('renders children when auth is not enabled', async () => {
    getAuthStatusMock.mockResolvedValue(makeStatus({ auth_enabled: false }))
    render(
      <MemoryRouter>
        <RequireAuth>
          <div>Home content</div>
        </RequireAuth>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Home content')).toBeInTheDocument()
  })

  it('renders the outlet when used as a layout route', async () => {
    getAuthStatusMock.mockResolvedValue(makeStatus({ logged_in: true }))
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/" element={<div>Layout child</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Layout child')).toBeInTheDocument()
  })
})

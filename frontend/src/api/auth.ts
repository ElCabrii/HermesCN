import { api } from './client'

/**
 * Typed client for the HermesCN auth API.
 *
 * Endpoints (verified against `api/routes.py` handlers):
 * - GET  /api/auth/status
 * - POST /api/auth/login    { password }
 * - POST /api/auth/logout
 * - GET  /api/auth/oidc/start   (302 redirect to the IdP — browser-driven)
 * - GET  /api/auth/oidc/callback (302 back to the app — browser-driven)
 *
 * Passkey endpoints (POST /api/auth/passkey/options, POST /api/auth/passkey/login)
 * exist but are out of scope for this client — they need WebAuthn ceremony
 * (navigator.credentials.get) and will land with the passkey surface.
 *
 * All requests send `credentials: 'include'` so the auth cookie set by
 * login/oidc-callback is sent and cleared by logout.
 */

/** Response of GET /api/auth/status (api/routes.py `_handle_get`). */
export interface AuthStatus {
  /** Master auth switch (HERMES_WEBUI_PASSWORD / webui_password set). */
  auth_enabled: boolean
  /** A session cookie is present and valid. */
  logged_in: boolean
  /** OIDC provider configured. */
  oidc_enabled: boolean
  /** A local password hash is configured. */
  password_auth_enabled: boolean
  /** Passkeys registered and no password set. */
  passwordless_enabled: boolean
  /** Passkeys registered (feature flag on). */
  passkeys_enabled: boolean
  passkeys_count: number
  passkey_feature_flag: boolean
  /** User acknowledged the auth-disabled warning (only when auth is off). */
  auth_disabled_acknowledged: boolean
  /** Present only when trusted-auth (HERMES_TRUSTED_AUTH) is enabled. */
  trusted_auth_enabled?: boolean
  /** Present only when the active session uses trusted auth. */
  auth_type?: string
  user?: string
  bound_profile?: string
}

/** Response of POST /api/auth/login. */
export type LoginResult = { ok: true; message?: string }

/** Response of POST /api/auth/logout. */
export type LogoutResult = { ok: true; trusted_logout_url?: string }

/** Fetch the current auth state. */
export function getAuthStatus(): Promise<AuthStatus> {
  return api<AuthStatus>('/api/auth/status', { credentials: 'include' })
}

/**
 * Log in with the configured password.
 * - auth disabled → 200 `{ ok: true, message: "Auth not enabled" }`
 * - wrong password → 401 `{ error: "Invalid password" }`
 * - rate limited → 429 `{ error: "Too many attempts. Try again in a minute." }`
 * - success → 200 `{ ok: true }` + sets the auth cookie
 */
export function login(password: string): Promise<LoginResult> {
  return api<LoginResult>('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ password }),
  })
}

/** Clear the auth cookie. */
export function logout(): Promise<LogoutResult> {
  return api<LogoutResult>('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  })
}

/**
 * URL for GET /api/auth/oidc/start — the backend 302-redirects to the IdP, so
 * the app navigates here (window.location) rather than fetching it.
 * `next` is a relative redirect path preserved by the backend across the flow
 * (open-redirect guarded server-side via `_safe_login_redirect_path`).
 */
export function startOidcLoginUrl(next?: string): string {
  if (!next) return '/api/auth/oidc/start'
  return `/api/auth/oidc/start?next=${encodeURIComponent(next)}`
}

/**
 * GET /api/auth/oidc/callback — the IdP redirects the browser here with
 * `code` + `state`; the backend validates, sets the auth cookie, and
 * 302-redirects back into the app. Never fetched by the client itself;
 * exported for the router to recognize.
 */
export const OIDC_CALLBACK_PATH = '/api/auth/oidc/callback'

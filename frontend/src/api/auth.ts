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

// ── Passkeys (WebAuthn) ────────────────────────────────────────────────────
// The ceremony is browser-driven (navigator.credentials.get/create); the
// client only exchanges the base64url-encoded options/assertion payloads with
// the backend. Endpoints (api/routes.py):
//   POST /api/auth/passkey/options        → { ok, publicKey }
//   POST /api/auth/passkey/login          → { ok } (sets auth cookie)
//   POST /api/auth/passkey/register/options → { ok, publicKey }
//   POST /api/auth/passkey/register       → { ok, credentials }
//   POST /api/auth/passkey/delete         → { ok }
//   GET  /api/auth/passkeys               → { credentials }

/** Base64url → Uint8Array (WebAuthn options carry b64u-encoded bytes). */
export function b64uToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = String(s || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** ArrayBuffer/Uint8Array → base64url (WebAuthn assertion payloads). */
export function bytesToB64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/** Fetch WebAuthn authentication options for a passkey sign-in. */
export async function getPasskeyLoginOptions(): Promise<Record<string, unknown>> {
  const data = await api<{ ok: boolean; publicKey?: Record<string, unknown>; error?: string }>(
    '/api/auth/passkey/options',
    { method: 'POST', credentials: 'include', body: '{}' },
  )
  if (!data?.publicKey) throw new Error(data?.error || 'Passkey unavailable')
  return data.publicKey
}

/** Submit a WebAuthn assertion to complete a passkey sign-in. */
export async function passkeyLogin(payload: Record<string, unknown>): Promise<LoginResult> {
  return api<LoginResult>('/api/auth/passkey/login', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(payload),
  })
}

/** Fetch WebAuthn registration options (requires an authenticated session). */
export async function getPasskeyRegisterOptions(): Promise<Record<string, unknown>> {
  const data = await api<{ ok: boolean; publicKey?: Record<string, unknown>; error?: string }>(
    '/api/auth/passkey/register/options',
    { method: 'POST', credentials: 'include', body: '{}' },
  )
  if (!data?.publicKey) throw new Error(data?.error || 'Passkey registration unavailable')
  return data.publicKey
}

/** Submit a WebAuthn attestation to register a new passkey. */
export async function passkeyRegister(payload: Record<string, unknown>): Promise<{ ok: boolean; credentials?: unknown[] }> {
  return api<{ ok: boolean; credentials?: unknown[] }>('/api/auth/passkey/register', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(payload),
  })
}

/** Delete a registered passkey by credential id. */
export async function passkeyDelete(id: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>('/api/auth/passkey/delete', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ id }),
  })
}

/** List registered passkeys. */
export async function listPasskeys(): Promise<{ credentials: unknown[]; disabled?: boolean }> {
  return api<{ credentials: unknown[]; disabled?: boolean }>('/api/auth/passkeys', {
    credentials: 'include',
  })
}

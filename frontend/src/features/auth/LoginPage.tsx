import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { login, startOidcLoginUrl } from '@/api/auth'
import { CONNECTION_FAILED, useAuth } from './useAuth'
import { safeNextPath } from './safeNextPath'

const REACHABILITY_ERROR = 'Cannot reach server — check your VPN / Tailscale connection.'

function nextParam(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('next')
  } catch {
    return null
  }
}

/**
 * Login page — HermesCN auth surface.
 *
 * Flow (ported from static/login.js):
 * 1. On mount, probe /health; while unreachable show the connectivity error,
 *    disable the form and retry every 3s, reloading once the server is back.
 * 2. GET /api/auth/status; if auth is disabled, bounce straight to '/'.
 * 3. Password form → POST /api/auth/login; on success redirect to the
 *    open-redirect-guarded ?next= (safeNextPath), on failure show the
 *    server's error (401 "Invalid password", 429 rate-limit message).
 * 4. OIDC: "Sign in with provider" link → /api/auth/oidc/start?next=<safe>.
 * 5. Passkeys: button rendered when enabled; WebAuthn ceremony is out of
 *    scope (TODO below — see static/login.js:101-140).
 */
export function LoginPage() {
  const { loading, unreachable, status } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const next = nextParam()
  const safeNext = safeNextPath(next)

  // Auth disabled → nothing to sign in to; go straight to the app root.
  useEffect(() => {
    if (!loading && !unreachable && status && !status.auth_enabled) {
      window.location.assign('/')
    }
  }, [loading, unreachable, status])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await login(password)
      if (result.ok) {
        window.location.assign(safeNext)
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : CONNECTION_FAILED)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return null

  // Auth disabled (and the server is reachable) → nothing to sign in to.
  if (!unreachable && (!status || !status.auth_enabled)) return null

  const unreachableAlert = unreachable ? (
    <p className="text-sm text-destructive" role="alert">
      {REACHABILITY_ERROR}
    </p>
  ) : null

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the password to continue.</p>

        {status && status.password_auth_enabled && (
          <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
            <Input
              type="password"
              placeholder="Password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={unreachable}
            />
            <Button type="submit" className="w-full" disabled={submitting || unreachable}>
              Sign in
            </Button>
          </form>
        )}

        {status && status.oidc_enabled && (
          <a
            href={startOidcLoginUrl(safeNext === './' ? undefined : safeNext)}
            className="mt-3 block text-center text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in with provider
          </a>
        )}

        {status && status.passkeys_enabled && (
          <Button
            type="button"
            variant="outline"
            className="mt-3 w-full"
            disabled={unreachable}
            onClick={() => {
              // TODO(passkeys): WebAuthn ceremony — port static/login.js:101-140
              // (b64u<->bytes conversion, navigator.credentials.get, then POST
              // /api/auth/passkey/login with the assertion payload).
              throw new Error('Passkey sign-in is not implemented yet')
            }}
          >
            Sign in with passkey
          </Button>
        )}

        {error && (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {unreachableAlert}
      </div>
    </main>
  )
}

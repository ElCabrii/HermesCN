import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthStatus, type AuthStatus } from '@/api/auth'

/** Server error message, or the generic fallback used when the request itself fails. */
export const CONNECTION_FAILED = 'Connection failed'

export interface UseAuthState {
  /** True until the initial /api/auth/status probe resolves. */
  loading: boolean
  /** True when /health is unreachable — server is down or the network is off. */
  unreachable: boolean
  /** Auth status from GET /api/auth/status (null when it could not be fetched). */
  status: AuthStatus | null
}

/**
 * Login flow for the auth page.
 *
 * - On mount, probes GET /health so we can distinguish "can't reach server"
 *   (Tailscale off, wrong network) from "session expired / need to log in".
 *   Unreachable → retries every 3s and reloads the page once the server is
 *   back (port of static/login.js:162-197).
 * - Fetches GET /api/auth/status (credentials: 'include') to decide what to
 *   render (password form / OIDC / passkey).
 */
export function useAuth(): UseAuthState {
  const [loading, setLoading] = useState(true)
  const [unreachable, setUnreachable] = useState(false)
  const [status, setStatus] = useState<AuthStatus | null>(null)

  // Connectivity probe — runs on mount, retries every 3s while unreachable.
  const retryTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const probe = useCallback(() => {
    fetch('/health', { method: 'GET', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) {
          // Server is reachable — if we were in retry mode, reload so the
          // page reflects the correct auth state (expired session, etc.).
          if (retryTimer.current !== null) {
            clearInterval(retryTimer.current)
            retryTimer.current = null
            window.location.reload()
          }
        }
        // Non-OK /health (e.g. a proxy 5xx) is not a connectivity failure —
        // the status probe below will surface the real auth state.
      })
      .catch(() => {
        setUnreachable(true)
        if (retryTimer.current === null) {
          retryTimer.current = setInterval(probe, 3000)
        }
      })
  }, [])
  useEffect(() => {
    probe()
    return () => {
      if (retryTimer.current !== null) clearInterval(retryTimer.current)
    }
  }, [probe])

  // Auth status — only meaningful once the server is reachable.
  useEffect(() => {
    let cancelled = false
    getAuthStatus()
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch(() => {
        // The connectivity probe owns the "server unreachable" messaging.
        if (!cancelled) setStatus(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { loading, unreachable, status }
}

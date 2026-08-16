import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { getAuthStatus, type AuthStatus } from '@/api/auth'

/**
 * Route guard — port of the legacy auth gate (static/login.js / static/ui.js).
 *
 * On mount, probes GET /api/auth/status:
 * - while the probe is in flight, renders a minimal centered loading
 *   placeholder (role="status");
 * - if auth is enabled and the session cookie is missing, redirects to
 *   /login, preserving the current path as ?next= (open-redirect guarded
 *   on the login page via safeNextPath);
 * - otherwise (auth disabled, or logged in) renders the children — or the
 *   <Outlet /> when used as a layout route.
 */
export function RequireAuth({ children }: { children?: React.ReactNode }) {
  const location = useLocation()
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getAuthStatus()
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch(() => {
        // Status unreachable (server down / network off) — fail open and
        // render the app; the API calls surface connectivity errors.
        if (!cancelled) setStatus(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground" />
      </div>
    )
  }

  if (status?.auth_enabled && !status.logged_in) {
    const next = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }

  return children ?? <Outlet />
}

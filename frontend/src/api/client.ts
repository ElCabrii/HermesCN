import type { JsonObject } from './types'

/**
 * Error thrown by `api()` for non-2xx responses.
 * `message` prefers the server's `{ error }` field; the raw parsed body is
 * kept on `body` for callers that need more detail.
 */
export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, message: string, body: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/**
 * Typed fetch wrapper for the HermesCN HTTP API.
 * - JSON in/out: parses the response body (null when empty/unparseable).
 * - Throws `ApiError` (server `error` message preferred) on non-2xx.
 * - Sends `Content-Type: application/json` by default, but a caller-provided
 *   Content-Type (e.g. multipart FormData uploads) always wins.
 * - On unsafe methods (POST/PUT/PATCH/DELETE), injects the server-provided
 *   CSRF token (window.__HERMES_CONFIG__.csrfToken) as X-Hermes-CSRF-Token
 *   when one is configured — required under auth-enabled deployments.
 */
export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const method = (init.method ?? 'GET').toUpperCase()
  const csrfToken = window.__HERMES_CONFIG__?.csrfToken
  if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !headers.has('X-Hermes-CSRF-Token')) {
    headers.set('X-Hermes-CSRF-Token', csrfToken)
  }
  const res = await fetch(path, { ...init, headers })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as JsonObject).error)
        : res.statusText
    throw new ApiError(res.status, message, body)
  }
  return body as T
}

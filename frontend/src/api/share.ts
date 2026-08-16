import { api } from './client'
import type { SessionDetail } from './sessions'
import type { JsonObject } from './types'

/**
 * Typed client for the public share surface.
 *
 * Backend contracts (api/shares.py + api/routes.py):
 * - POST /api/share/create { session_id } → { ok, share, session } — the
 *   `share` object carries the public link metadata; `session` is the
 *   redacted full session projection (with messages) for UI refresh.
 * - POST /api/share/revoke { session_id } → { ok, session } — revokes the
 *   session's share token (a no-op when the session has none).
 * - GET /api/share/<token> → { share } — the sanitized snapshot: only
 *   user/assistant messages survive `_sanitize_message` (tool/system traces
 *   are dropped server-side), and prose is credential/path-redacted.
 */

/** Public share link metadata returned by POST /api/share/create. */
export interface ShareInfo extends JsonObject {
  token: string
  url: string
  title: string
  message_count: number
  created_at: number
  updated_at: number
}

export interface ShareCreateResult extends JsonObject {
  ok: true
  share: ShareInfo
  session: SessionDetail
}

export interface ShareRevokeResult extends JsonObject {
  ok: true
  session: SessionDetail
}

/** One sanitized message in a public share snapshot. */
export interface SharedMessage extends JsonObject {
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
}

/** Public share snapshot served by GET /api/share/<token>. */
export interface SharedTranscript extends JsonObject {
  title: string
  messages: SharedMessage[]
  message_count: number
  created_at?: number
  updated_at?: number
}

/** Create (or refresh) the share link for a session. */
export function createShare(sessionId: string): Promise<ShareCreateResult> {
  return api<ShareCreateResult>('/api/share/create', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId }),
  })
}

/** Revoke the share link for a session (no-op when none exists). */
export function revokeShare(sessionId: string): Promise<ShareRevokeResult> {
  return api<ShareRevokeResult>('/api/share/revoke', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId }),
  })
}

/** Fetch the sanitized public snapshot for a share token (no auth required). */
export function getSharedTranscript(token: string): Promise<{ share: SharedTranscript }> {
  return api<{ share: SharedTranscript }>(`/api/share/${encodeURIComponent(token)}`, {
    credentials: 'include',
  })
}

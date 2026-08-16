import { api, ApiError } from './client'
import type { JsonObject, JsonValue } from './types'

/**
 * Typed client for the HermesCN sessions API.
 *
 * Endpoints (verified against `api/routes.py` / `api/models.py` /
 * `api/session_ops.py` / `api/agent_sessions.py` handlers):
 * - GET  /api/sessions                    (sidebar list + counts)
 * - GET  /api/session                     ?session_id= (detail; messages=0|1,
 *                                          resolve_model=0|1, msg_limit, msg_before)
 * - GET  /api/sessions/search             ?q= (title + content search)
 * - POST /api/session/new                 { workspace?, worktree?, model?, ... }
 * - POST /api/session/update              { session_id, workspace?, model?, ... }
 * - POST /api/session/delete              { session_id }
 * - POST /api/session/rename              { session_id, title }
 * - POST /api/session/duplicate           { session_id }
 * - POST /api/session/clear               { session_id }
 * - POST /api/session/truncate            { session_id, keep_count }
 * - POST /api/session/branch              { session_id, keep_count?, title? }
 * - POST /api/session/retry / undo        { session_id }
 * - POST /api/session/toolsets            { session_id, toolsets }
 * - GET  /api/session/export              ?session_id=&format= (download)
 * - GET  /api/session/status|usage|lineage/report
 *
 * All requests send `credentials: 'include'` so the auth cookie is carried.
 */

// ── shared helpers ────────────────────────────────────────────────────────

/** Build a query string from defined params (undefined/null keys are skipped). */
function buildQuery(params: object): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    sp.set(key, String(value))
  }
  // URLSearchParams encodes spaces as '+'; normalize to '%20' so session ids
  // and search queries use the canonical query-string form (parse_qs on the
  // backend decodes both, but '%20' round-trips unchanged through proxies).
  const qs = sp.toString().replace(/\+/g, '%20')
  return qs ? `?${qs}` : ''
}

// ── GET /api/sessions ─────────────────────────────────────────────────────

/**
 * Sidebar attention metadata attached to every row (`_session_attention_summary`):
 * null when the session has no pending approval/clarify work.
 */
export interface SessionAttention {
  kind: 'approval' | 'clarify'
  count: number
  severity: 'critical' | 'question'
}

/**
 * One sidebar row (`api/routes.py` `_SIDEBAR_SESSION_RESPONSE_FIELDS` +
 * computed `attention`). Common fields are typed; the index signature carries
 * the remainder (lineage/collapse internals, match_type/match_preview on
 * search rows, `_sidebar_reference_only` on reference rows, ...).
 */
export interface SidebarSessionRow extends JsonObject {
  session_id: string
  title: string | null
  display_title?: string | null
  _state_db_title?: string | null
  workspace: string
  model?: string | null
  model_provider?: string | null
  message_count: number
  user_message_count: number
  created_at: number
  updated_at: number
  last_message_at: number | null
  pinned: boolean
  archived: boolean
  project_id: string | null
  profile: string
  input_tokens: number
  output_tokens: number
  estimated_cost: number
  cache_read_tokens: number
  cache_write_tokens: number
  cache_hit_percent: number | null
  personality?: string | null
  context_length?: number
  config_context_length?: number
  window_usage_percent?: number | null
  source_tag?: string | null
  raw_source?: string | null
  session_source?: string | null
  source_label?: string | null
  is_cli_session: boolean
  is_messaging_session?: boolean
  is_streaming: boolean
  cron_running?: boolean
  active_stream_id?: string | null
  has_pending_user_message?: boolean
  pending_started_at?: number | null
  default_hidden?: boolean
  worktree_path?: string | null
  worktree_branch?: string | null
  parent_session_id?: string | null
  parent_title?: string | null
  parent_source?: string | null
  relationship_type?: string | null
  pre_compression_snapshot?: boolean
  read_only?: boolean
  is_read_only?: boolean
  gateway_routing?: JsonValue
  /** Computed per-row; null when nothing needs attention. */
  attention: SessionAttention | null
  /** Reference rows (hidden archived ancestors) are flagged server-side. */
  _sidebar_reference_only?: boolean
}

/** Query params of GET /api/sessions (verified in `handle_get`). */
export interface SessionListParams {
  /** Include archived sessions in `sessions` (default false). */
  include_archived?: boolean
  /** Hide sessions flagged default_hidden (e.g. greeting rows). */
  exclude_hidden?: boolean
  /** Cap on archived rows included with include_archived (server max 2000). */
  archived_limit?: number
  /** Pagination offset for archived rows (with archived_limit). */
  archived_offset?: number
  /** Aggregate sessions across profiles where profile mode allows it. */
  all_profiles?: boolean
  /** Restrict rows to one surface: 'webui' or 'cli'. */
  sidebar_source?: 'webui' | 'cli'
}

/**
 * Response of GET /api/sessions (`_session_list_payload_to_response`).
 * `webui_session_count`/`cli_session_count` appear only when the matching
 * list was loaded; `archived_limit`/`archived_offset` only echo pagination.
 */
export interface SessionListResponse extends JsonObject {
  sessions: SidebarSessionRow[]
  sidebar_reference_sessions: SidebarSessionRow[]
  cli_count: number
  archived_count: number
  archived_webui_count: number
  archived_cli_count: number
  include_archived: boolean
  all_profiles: boolean
  active_profile: string
  other_profile_count: number
  server_time: number
  server_tz: string
  webui_session_count?: number
  cli_session_count?: number
  archived_limit?: number
  archived_offset?: number
}

/** Fetch the sidebar session list. */
export function listSessions(params: SessionListParams = {}): Promise<SessionListResponse> {
  return api<SessionListResponse>(`/api/sessions${buildQuery(params)}`, {
    credentials: 'include',
  })
}

// ── GET /api/session ──────────────────────────────────────────────────────

/** One message in a session transcript (legacy shape, extra fields allowed). */
export interface SessionMessage extends JsonObject {
  role: string
  content: string | JsonValue[]
  ts?: number
  tool_calls?: JsonValue[]
  tool_call_id?: string
  tool_name?: string
}

/**
 * Session detail (`api/models.py` `Session.compact()` + `messages`/`tool_calls`
 * when loaded). Common fields are typed; the index signature carries the rest
 * (compression internals, context-engine state, gateway routing history, ...).
 */
export interface SessionDetail extends JsonObject {
  session_id: string
  title: string | null
  workspace: string
  model: string | null
  model_provider: string | null
  message_count: number
  created_at: number
  updated_at: number
  last_message_at: number | null
  pinned: boolean
  archived: boolean
  project_id: string | null
  profile: string
  input_tokens: number
  output_tokens: number
  estimated_cost: number
  cache_read_tokens: number
  cache_write_tokens: number
  cache_hit_percent: number | null
  personality: string | null
  compression_anchor_visible_idx: number | null
  compression_anchor_message_key: string | null
  compression_anchor_summary: string | null
  pre_compression_snapshot: boolean
  context_engine: string | null
  compression_anchor_engine: string | null
  compression_anchor_mode: string | null
  compression_anchor_details: JsonValue
  context_engine_state: JsonObject
  context_length: number
  threshold_tokens: number
  last_prompt_tokens: number
  post_compression_context_tokens_estimate: number | null
  compression_recovery: boolean
  recommended_recovery_action: string | null
  gateway_routing: JsonValue
  gateway_routing_history: JsonValue[]
  manual_title: boolean
  /** Immutable workspace captured at creation (#6672). */
  created_workspace: string
  /** Present only when the session is a fork (/api/session/branch). */
  parent_session_id?: string
  user_message_count: number
  active_stream_id: string | null
  pending_user_message: string | null
  has_pending_user_message: boolean
  is_cli_session: boolean
  source_tag: string | null
  raw_source: string | null
  session_source: string | null
  source_label: string | null
  read_only: boolean
  enabled_toolsets: string[] | null
  composer_draft: JsonObject
  process_wakeup_pause: JsonObject
  share_token: string | null
  share_created_at: number | null
  is_streaming: boolean
  /** Present when messages=1 (full transcript or msg_limit window). */
  messages?: SessionMessage[]
  tool_calls?: JsonValue[]
  todos?: JsonValue
  /** True when msg_limit clamped the payload to a tail window. */
  _messages_truncated?: boolean
  /** 0-based offset of the returned window into the full transcript. */
  _messages_offset?: number
  /** Server-side clamp ceiling for msg_limit (`_MAX_MSG_LIMIT` = 500). */
  _msg_limit_max?: number
}

/** Query params of GET /api/session (verified in `handle_get`). */
export interface SessionDetailParams {
  /** 0 = metadata only (no messages); 1 = full transcript (default). */
  messages?: 0 | 1
  /** 1 (default) resolves the model against the current config. */
  resolve_model?: 0 | 1
  /** Tail window: last N visible transcript rows (clamped to 500 server-side). */
  msg_limit?: number
  /** 0-based index into the full transcript; pairs with msg_limit for scroll-up paging. */
  msg_before?: number
}

/** Response of GET /api/session. */
export interface SessionDetailResponse {
  session: SessionDetail
}

/**
 * Fetch one session. Errors: 400 (missing session_id), 404 (unknown session),
 * 409 `{ code: 'session_profile_mismatch', session_id, profile }`.
 */
export function getSession(
  sessionId: string,
  params: SessionDetailParams = {},
): Promise<SessionDetailResponse> {
  return api<SessionDetailResponse>(`/api/session${buildQuery({ session_id: sessionId, ...params })}`, {
    credentials: 'include',
  })
}

// ── GET /api/sessions/search ──────────────────────────────────────────────

/** Query params of GET /api/sessions/search (`_handle_sessions_search`). */
export interface SessionSearchParams {
  /** Also scan message text (default true; title-only when false). */
  content?: boolean
  /** Number of most-recent messages to scan per session (default 5). */
  depth?: number
  /** Search across profiles where profile mode allows it. */
  all_profiles?: boolean
}

/**
 * Response of GET /api/sessions/search. Rows carry the same shape as
 * `/api/sessions` rows plus `match_type` ('title'|'content') and, for content
 * matches, a redacted `match_preview`. The empty-query arm omits `query`/`count`.
 */
export interface SessionSearchResponse extends JsonObject {
  sessions: SidebarSessionRow[]
  query?: string
  count?: number
  all_profiles: boolean
  active_profile: string
}

/** Search sessions by title and (optionally) recent message content. */
export function searchSessions(
  q: string,
  params: SessionSearchParams = {},
): Promise<SessionSearchResponse> {
  return api<SessionSearchResponse>(
    `/api/sessions/search${buildQuery({ q, content: params.content, depth: params.depth, all_profiles: params.all_profiles })}`,
    { credentials: 'include' },
  )
}

// ── POST session mutations ────────────────────────────────────────────────

/** Request body of POST /api/session/new (verified in `handle_post`). */
export interface NewSessionRequest {
  workspace?: string
  /** Explicit true/false; absent inherits the config default. */
  worktree?: boolean
  model?: string
  model_provider?: string
  enabled_toolsets?: string[]
  /** Prior session whose memory is committed before creating the new one. */
  prev_session_id?: string
  profile?: string
  project_id?: string
}

/**
 * Response of POST /api/session/new. `worktree_skipped` is present only when
 * a config-default worktree was skipped (non-git workspace).
 */
export interface NewSessionResponse {
  session: SessionDetail
  worktree_skipped?: boolean
}

/** Create a new session. */
export function newSession(request: NewSessionRequest = {}): Promise<NewSessionResponse> {
  return api<NewSessionResponse>('/api/session/new', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(request),
  })
}

/** Request body of POST /api/session/update (mutable fields only). */
export interface UpdateSessionRequest {
  session_id: string
  workspace?: string
  model?: string
  model_provider?: string
}

/** Update a session's workspace / model. Errors: 403 (read-only imported session). */
export function updateSession(request: UpdateSessionRequest): Promise<SessionDetailResponse> {
  return api<SessionDetailResponse>('/api/session/update', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(request),
  })
}

/**
 * Response of POST /api/session/delete. `worktree_retained`/`worktree_path`/
 * `worktree_branch`/`worktree_repo_root` appear when the deleted session's
 * worktree was kept (`_worktree_retained_payload`).
 */
export interface DeleteSessionResult extends JsonObject {
  ok: true
  state_db_cleanup_failed?: boolean
  worktree_retained?: boolean
  worktree_path?: string
  worktree_branch?: string
  worktree_repo_root?: string
}

/** Delete a session (and its CLI state.db row when not a messaging session). */
export function deleteSession(sessionId: string): Promise<DeleteSessionResult> {
  return api<DeleteSessionResult>('/api/session/delete', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId }),
  })
}

/**
 * Rename a session. The title is truncated to 80 chars server-side
 * (`apply_session_title_rename`); the response is the compact session.
 */
export function renameSession(sessionId: string, title: string): Promise<SessionDetailResponse> {
  return api<SessionDetailResponse>('/api/session/rename', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId, title }),
  })
}

/** Duplicate a session (deep copy with a " (copy)" title suffix). */
export function duplicateSession(sessionId: string): Promise<SessionDetailResponse> {
  return api<SessionDetailResponse>('/api/session/duplicate', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId }),
  })
}

/** Response of POST /api/session/pin (the compact session carries the new flag). */
export interface PinSessionResult extends JsonObject {
  ok: true
  session: SessionDetail
}

/** Pin or unpin a session (POST /api/session/pin, verified in routes.py). */
export function pinSession(sessionId: string, pinned: boolean): Promise<PinSessionResult> {
  return api<PinSessionResult>('/api/session/pin', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId, pinned }),
  })
}

/** Response of POST /api/session/archive (the compact session carries the new flag). */
export interface ArchiveSessionResult extends JsonObject {
  ok: true
  session: SessionDetail
}

/** Archive or unarchive a session (POST /api/session/archive, verified in routes.py). */
export function archiveSession(sessionId: string, archived: boolean): Promise<ArchiveSessionResult> {
  return api<ArchiveSessionResult>('/api/session/archive', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId, archived }),
  })
}

/** Response of POST /api/session/clear (full truncate-to-empty). */
export interface ClearSessionResult {
  ok: true
  session: SessionDetail
}

/** Clear a session's transcript (messages + tool calls). */
export function clearSession(sessionId: string): Promise<ClearSessionResult> {
  return api<ClearSessionResult>('/api/session/clear', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId }),
  })
}

/**
 * Truncate a session to its first `keepCount` messages (0 = empty).
 * `keep_count` is required; negative values are rejected server-side.
 */
export function truncateSession(sessionId: string, keepCount: number): Promise<ClearSessionResult> {
  return api<ClearSessionResult>('/api/session/truncate', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId, keep_count: keepCount }),
  })
}

/** Request body of POST /api/session/branch. */
export interface BranchSessionRequest {
  session_id: string
  /** Messages to copy (0 = empty fork; absent = full history). */
  keep_count?: number
  /** Custom fork title (defaults to "<original title> (fork)"). */
  title?: string
}

/** Response of POST /api/session/branch (fork metadata; fetch detail via getSession). */
export interface BranchSessionResult {
  session_id: string
  title: string
  parent_session_id: string
}

/** Fork a session from any message point (#465). */
export function branchSession(
  sessionId: string,
  options: Omit<BranchSessionRequest, 'session_id'> = {},
): Promise<BranchSessionResult> {
  return api<BranchSessionResult>('/api/session/branch', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId, ...options }),
  })
}

/** Response of POST /api/session/retry (`retry_last`). */
export interface RetryResult {
  ok: true
  last_user_text?: string
  removed_count?: number
}

/** Re-run the last turn: remove everything after the last user message. */
export function retryLast(sessionId: string): Promise<RetryResult> {
  return api<RetryResult>('/api/session/retry', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId }),
  })
}

/** Response of POST /api/session/undo (`undo_last`). */
export interface UndoResult {
  ok: true
  removed_count?: number
  removed_preview?: string
}

/** Undo the most recent user message and everything after it. */
export function undoLast(sessionId: string): Promise<UndoResult> {
  return api<UndoResult>('/api/session/undo', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId }),
  })
}

/** Response of POST /api/session/toolsets. */
export interface ToolsetsResult {
  ok: true
  enabled_toolsets: string[] | null
}

/**
 * Override the session's enabled toolsets (null clears the override and
 * inherits config; empty array disables tools entirely).
 */
export function setSessionToolsets(sessionId: string, toolsets: string[] | null): Promise<ToolsetsResult> {
  return api<ToolsetsResult>('/api/session/toolsets', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId, toolsets }),
  })
}

// ── GET /api/session/export ───────────────────────────────────────────────

/** Options for session export (`_handle_session_export`). */
export interface SessionExportOptions {
  /** json (default) or html transcript render. */
  format?: 'json' | 'html'
  /** HTML render theme: 'dark' (default) or 'light'. */
  theme?: 'dark' | 'light'
  /** Base64-encoded JSON palette object for the HTML render. */
  palette?: string
}

/** Build the export URL (the backend answers with a Content-Disposition attachment). */
export function sessionExportUrl(sessionId: string, options: SessionExportOptions = {}): string {
  return `/api/session/export${buildQuery({ session_id: sessionId, ...options })}`
}

/** Pull `filename="..."` out of a Content-Disposition header, if present. */
function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  return match ? match[1] : null
}

/**
 * Fetch a session export and trigger a browser download (object URL + anchor
 * click). Uses raw fetch (not `api()`) because the response is a blob
 * attachment, not JSON. Throws `ApiError` with the server message on failure.
 */
export async function downloadSessionExport(
  sessionId: string,
  options: SessionExportOptions = {},
): Promise<void> {
  const res = await fetch(sessionExportUrl(sessionId, options), { credentials: 'include' })
  if (!res.ok) {
    let message = res.statusText
    try {
      const body: unknown = await res.json()
      if (body && typeof body === 'object' && 'error' in body) {
        message = String((body as JsonObject).error)
      }
    } catch {
      // Non-JSON error body — keep statusText.
    }
    throw new ApiError(res.status, message)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download =
    filenameFromDisposition(res.headers.get('Content-Disposition')) ??
    `hermes-${sessionId}.${options.format === 'html' ? 'html' : 'json'}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ── GET /api/session/status | usage | lineage/report ──────────────────────

/** Response of GET /api/session/status (`api/session_ops.py` `session_status`). */
export interface SessionStatus extends JsonObject {
  session_id: string
  title: string | null
  model: string | null
  profile: string
  hermes_home: string
  workspace: string
  personality: string | null
  message_count: number
  created_at: number
  updated_at: number
  agent_running: boolean
  /** Live stream id only — stale ids after restart are reported as null. */
  active_stream_id: string | null
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_cost: number
}

/** Fetch a snapshot of session state (hidden-tab poller). */
export function getSessionStatus(sessionId: string): Promise<SessionStatus> {
  return api<SessionStatus>(`/api/session/status${buildQuery({ session_id: sessionId })}`, {
    credentials: 'include',
  })
}

/** Response of GET /api/session/usage (`api/session_ops.py` `session_usage`). */
export interface SessionUsage extends JsonObject {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_cost: number
  model: string | null
}

/** Fetch token usage + cost for a session. */
export function getSessionUsage(sessionId: string): Promise<SessionUsage> {
  return api<SessionUsage>(`/api/session/usage${buildQuery({ session_id: sessionId })}`, {
    credentials: 'include',
  })
}

/** One entry of a lineage report (`api/agent_sessions.py` `_lineage_report_row`). */
export interface LineageSegment extends JsonObject {
  session_id: string
  /** 'tip' | 'hidden_segment' in `segments`; 'child_session' in `children`. */
  role: string
  title: string | null
  source: string | null
  started_at: number | null
  updated_at: number | null
  end_reason: string | null
  active: boolean
  archived: boolean
}

/**
 * Response of GET /api/session/lineage/report
 * (`api/agent_sessions.py` `read_session_lineage_report`). `found: false`
 * is returned as a 200 when the session id is absent from state.db.
 */
export interface SessionLineageReport extends JsonObject {
  mutation: false
  found: boolean
  session_id: string
  lineage_key: string
  tip_session_id: string
  total_segments: number
  materialized_segments: number
  segments: LineageSegment[]
  children: LineageSegment[]
  manual_review: boolean
}

/** Fetch the bounded lifecycle report for a session's compression lineage. */
export function getSessionLineageReport(sessionId: string): Promise<SessionLineageReport> {
  return api<SessionLineageReport>(
    `/api/session/lineage/report${buildQuery({ session_id: sessionId })}`,
    { credentials: 'include' },
  )
}

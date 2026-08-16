import { api, ApiError } from './client'
import type { JsonObject, JsonValue } from './types'

/**
 * Typed client for the HermesCN chat + attention (approval/clarify) API.
 *
 * Endpoints (verified against `api/routes.py`, `api/streaming.py`,
 * `api/upload.py` handlers):
 * - POST /api/chat/start          { session_id, message, ... } → { stream_id, session_id }
 * - GET  /api/chat/cancel         ?stream_id=  (GET, query param — routes.py `handle_get`)
 * - POST /api/chat/steer          { session_id, text } (field is `text`, not `message`)
 * - GET  /api/chat/stream/status  ?stream_id= → { active, stream_id, replay_available }
 * - GET  /api/approval/pending    ?session_id= → { pending, pending_count }
 * - POST /api/approval/respond    { session_id, choice, approval_id? }
 * - POST /api/clarify/respond     { session_id, response, clarify_id? }
 * - POST /api/upload              multipart FormData (session_id + file)
 * - GET  /api/approval/stream     ?session_id= — SSE, emits `initial` + `approval`
 * - GET  /api/clarify/stream      ?session_id= — SSE, emits `initial` + `clarify`
 *
 * All requests send `credentials: 'include'` so the auth cookie is carried.
 */

// ── chat/start ──────────────────────────────────────────────────────────

/** One normalized attachment as sent to /api/chat/start (see `_normalize_chat_attachments`). */
export interface ChatAttachment {
  name: string
  path: string
  mime: string
  size?: number
  is_image?: boolean
}

/** Request body of POST /api/chat/start (routes.py `_handle_chat_start`). */
export interface ChatStartRequest {
  session_id: string
  message: string
  model?: string
  model_provider?: string
  workspace?: string
  attachments?: ChatAttachment[]
  profile?: string
  explicit_model_pick?: boolean
  moa_config?: boolean
  enabled_toolsets?: string[]
  personality?: string
}

/** Successful turn start (routes.py `_start_chat_stream_for_session` / `_chat_start_response_from_run_start`). */
export interface ChatStarted {
  stream_id: string
  session_id: string
  pending_started_at?: string
  turn_id?: string
  title?: string
  effective_model?: string
  effective_model_provider?: string
  error?: string
  active_stream_id?: string
}

/**
 * The backend treats the exact sentinel "[SILENT]" as a control turn and
 * replies 200 `{ status: "suppressed", reason: "silent_control_message" }`
 * without starting a stream (routes.py `_is_silent_control_message`). The
 * client passes messages through verbatim and never special-cases them; this
 * arm exists so callers can distinguish the two 200 shapes.
 */
export interface ChatStartSuppressed {
  status: 'suppressed'
  reason: string
}

export type ChatStartResult = ChatStarted | ChatStartSuppressed

/** Start an agent turn. Errors: 400 (validation), 403 (read-only session), 404, 409 (active stream / stale runtime), 501 (adapter). */
export function startChat(request: ChatStartRequest): Promise<ChatStartResult> {
  return api<ChatStartResult>('/api/chat/start', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(request),
  })
}

// ── chat/cancel ─────────────────────────────────────────────────────────

/**
 * Response of GET /api/chat/cancel (routes.py `handle_get` → line 13601).
 * `cancelled: false` means no active stream was found to stop.
 */
export interface CancelStreamResult {
  ok: boolean
  cancelled: boolean
  stream_id: string
  error?: string
}

/**
 * Cancel an active stream. The backend reads `stream_id` from the QUERY
 * STRING and the route lives in the GET handler — no body, no POST.
 */
export function cancelStream(streamId: string): Promise<CancelStreamResult> {
  return api<CancelStreamResult>(`/api/chat/cancel?stream_id=${encodeURIComponent(streamId)}`, {
    credentials: 'include',
  })
}

// ── chat/steer ──────────────────────────────────────────────────────────

/**
 * Response of POST /api/chat/steer (api/streaming.py `_handle_chat_steer`).
 * `accepted: false` + `fallback` (e.g. "gateway_steer_queued") is a 200 —
 * steer is best-effort guidance and must not interrupt the active run.
 */
export interface SteerResult {
  accepted: boolean
  fallback: string | null
  stream_id: string | null
}

/** Inject a steering hint mid-task. Body field is `text` (not `message`). */
export function steerChat(sessionId: string, text: string): Promise<SteerResult> {
  return api<SteerResult>('/api/chat/steer', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId, text }),
  })
}

// ── chat/stream/status ──────────────────────────────────────────────────

/** Response of GET /api/chat/stream/status (routes.py line 13586). */
export interface StreamStatus {
  active: boolean
  stream_id: string
  replay_available: boolean
  /** Present when a run journal exists for the stream. */
  journal?: JsonObject
}

/** Check whether a stream is still active (reconnect decisions). */
export function getStreamStatus(streamId: string): Promise<StreamStatus> {
  return api<StreamStatus>(`/api/chat/stream/status?stream_id=${encodeURIComponent(streamId)}`, {
    credentials: 'include',
  })
}

// ── approval ────────────────────────────────────────────────────────────

/**
 * One pending approval entry. Common fields are typed; the index signature
 * carries the rest (args, risk_level, choices, allow_permanent, gateway
 * mirror tokens, ...). `pattern_keys` (plural) is the current field;
 * `pattern_key` (singular) is the legacy form.
 */
export interface ApprovalEntry extends JsonObject {
  approval_id?: string
  command?: string
  description?: string
  pattern_key?: string
  pattern_keys?: string[]
  run_id?: string
  tool?: string
  args?: JsonValue
  risk_level?: string
  choices?: string[]
  allow_permanent?: boolean
}

/** Response of GET /api/approval/pending (routes.py `_handle_approval_pending`). */
export interface ApprovalPendingResponse {
  pending: ApprovalEntry | null
  pending_count: number
}

/** Fetch the head pending approval for a session (null when none). */
export function getApprovalPending(sessionId: string): Promise<ApprovalPendingResponse> {
  return api<ApprovalPendingResponse>(`/api/approval/pending?session_id=${encodeURIComponent(sessionId)}`, {
    credentials: 'include',
  })
}

/** Choice values accepted by POST /api/approval/respond (routes.py `_handle_approval_respond`). */
export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'

/** Request body of POST /api/approval/respond. `approval_id` is optional but sent when the entry has one. */
export interface ApprovalRespondRequest {
  session_id: string
  choice: ApprovalChoice
  approval_id?: string
}

/** Response of POST /api/approval/respond. */
export interface ApprovalRespondResult {
  ok: boolean
  choice: ApprovalChoice
  relayed?: boolean
  stale_cleared?: boolean
  local_retired?: boolean
  error?: string
  code?: string
}

/** Resolve a pending approval. Errors: 400 (invalid choice), 409 (stale/relay conflict), 502. */
export function respondApproval(request: ApprovalRespondRequest): Promise<ApprovalRespondResult> {
  const body: JsonObject = { session_id: request.session_id, choice: request.choice }
  if (request.approval_id) body.approval_id = request.approval_id
  return api<ApprovalRespondResult>('/api/approval/respond', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(body),
  })
}

// ── clarify ─────────────────────────────────────────────────────────────

/**
 * One pending clarification prompt. `clarify_id` is generated server-side
 * (api/clarify.py `_ClarifyEntry`) and echoed into the serialized entry.
 */
export interface ClarifyEntry extends JsonObject {
  clarify_id?: string
  question?: string
  choices_offered?: string[]
  requested_at?: number
  timeout_seconds?: number
  expires_at?: number
}

/** Request body of POST /api/clarify/respond (routes.py `_handle_clarify_respond`). */
export interface ClarifyRespondRequest {
  session_id: string
  /** Sent as `response`; the backend also falls back to `answer`/`choice`. */
  response: string
  clarify_id?: string
}

/** Response of POST /api/clarify/respond. 409 carries `{ ok: false, stale: true, error }`. */
export interface ClarifyRespondResult {
  ok: boolean
  response?: string
  stale?: boolean
  error?: string
}

/** Answer a clarification prompt. Errors: 400 (missing response), 409 (expired/not found → stale). */
export function respondClarify(request: ClarifyRespondRequest): Promise<ClarifyRespondResult> {
  const body: JsonObject = { session_id: request.session_id, response: request.response }
  if (request.clarify_id) body.clarify_id = request.clarify_id
  return api<ClarifyRespondResult>('/api/clarify/respond', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(body),
  })
}

// ── upload ──────────────────────────────────────────────────────────────

/** Response of POST /api/upload (api/upload.py `handle_upload`). */
export interface UploadResult {
  filename: string
  path: string
  size: number
  mime: string
  is_image: boolean
}

/**
 * Upload a file as multipart/form-data (fields: `session_id`, `file`).
 *
 * Deliberately bypasses `api()`: it force-sets `Content-Type:
 * application/json` when the caller didn't, which would suppress the
 * browser-generated multipart boundary and break `parse_multipart` on the
 * server. No Content-Type header is set here — fetch derives it (with the
 * boundary) from the FormData body. Errors keep the same ApiError contract.
 */
export async function uploadFile(sessionId: string, file: File): Promise<UploadResult> {
  const form = new FormData()
  form.append('session_id', sessionId)
  form.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: form })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as JsonObject).error)
        : res.statusText
    throw new ApiError(res.status, message, body)
  }
  return body as UploadResult
}

// ── approval / clarify SSE streams ──────────────────────────────────────

/** One frame from GET /api/approval/stream (routes.py `_handle_approval_sse_stream`). */
export type ApprovalStreamEvent = {
  type: 'initial' | 'approval'
  pending: ApprovalEntry | null
  pending_count: number
}

export interface ApprovalStreamHandlers {
  onEvent(event: ApprovalStreamEvent): void
  /** Transport-level EventSource failure (no data payload). */
  onError?(error: unknown): void
}

/** One frame from GET /api/clarify/stream (routes.py `_handle_clarify_sse_stream`). */
export type ClarifyStreamEvent = {
  type: 'initial' | 'clarify'
  pending: ClarifyEntry | null
  pending_count: number
}

export interface ClarifyStreamHandlers {
  onEvent(event: ClarifyStreamEvent): void
  onError?(error: unknown): void
}

/** Parsed `{ pending, pending_count }` payload shared by both notify streams. */
interface NotifyPayload {
  pending: JsonObject | null
  pending_count: number
}

function parseNotifyPayload(raw: string): NotifyPayload | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const payload = data as { pending?: unknown; pending_count?: unknown }
  if (typeof payload.pending_count !== 'number') return null
  const pending = payload.pending === undefined ? null : payload.pending
  if (pending !== null && (typeof pending !== 'object' || Array.isArray(pending))) return null
  return { pending: pending as JsonObject | null, pending_count: payload.pending_count }
}

/**
 * Shared opener for the approval/clarify SSE streams: subscribes to the
 * named frames, parses `{ pending, pending_count }` payloads, and dispatches
 * typed events. Malformed frames are ignored, never thrown. Returns a
 * `close()` that closes the underlying EventSource.
 */
function openNotifyStream(
  url: string,
  eventNames: readonly string[],
  onEvent: (type: string, payload: NotifyPayload) => void,
  onError?: (error: unknown) => void,
): () => void {
  const source = new EventSource(url)
  for (const name of eventNames) {
    source.addEventListener(name, (event: Event) => {
      const raw = (event as MessageEvent).data
      if (typeof raw !== 'string') return
      const parsed = parseNotifyPayload(raw)
      if (parsed) onEvent(name, parsed)
    })
  }
  source.addEventListener('error', (event: Event) => {
    onError?.(event)
  })
  return () => source.close()
}

/**
 * Open the real-time approval stream for a session. The backend pushes an
 * `initial` snapshot on connect, then `approval` events as the queue
 * changes — replacing the 1.5s polling loop.
 */
export function openApprovalStream(sessionId: string, handlers: ApprovalStreamHandlers): () => void {
  return openNotifyStream(
    `/api/approval/stream?session_id=${encodeURIComponent(sessionId)}`,
    ['initial', 'approval'],
    (type, payload) =>
      handlers.onEvent({
        type: type as ApprovalStreamEvent['type'],
        pending: payload.pending as ApprovalEntry | null,
        pending_count: payload.pending_count,
      }),
    handlers.onError,
  )
}

/** Open the real-time clarify stream for a session (same protocol as the approval stream). */
export function openClarifyStream(sessionId: string, handlers: ClarifyStreamHandlers): () => void {
  return openNotifyStream(
    `/api/clarify/stream?session_id=${encodeURIComponent(sessionId)}`,
    ['initial', 'clarify'],
    (type, payload) =>
      handlers.onEvent({
        type: type as ClarifyStreamEvent['type'],
        pending: payload.pending as ClarifyEntry | null,
        pending_count: payload.pending_count,
      }),
    handlers.onError,
  )
}

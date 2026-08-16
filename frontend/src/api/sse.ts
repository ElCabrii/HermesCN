import type { JsonObject } from './types'

/**
 * One frame from the chat stream endpoint (GET /api/chat/stream?stream_id=…),
 * discriminated by `type`. Payload shapes mirror the `_sse` emissions in
 * api/streaming.py. Events whose payload carries its own `type` field
 * (approval, warning, cancel, …) keep the payload under `data` so the outer
 * `type` stays the discriminant; flat events (token, tool, reasoning, done,
 * error) expose their fields directly.
 */
export type ChatStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string; preview?: string; args?: unknown; event_type?: string; tid?: string }
  | { type: 'approval'; data: JsonObject }
  | { type: 'clarify'; data: JsonObject }
  | { type: 'reasoning'; text: string }
  | { type: 'metering'; data: JsonObject }
  | { type: 'compressing'; data: { session_id: string; message: string } }
  | { type: 'warning'; data: JsonObject }
  | {
      type: 'cancel'
      data: {
        message: string
        type: string
        status: string
        session?: unknown
        session_id?: string
      }
    }
  | { type: 'apperror'; data: JsonObject }
  | {
      type: 'done'
      session: unknown
      usage: unknown
      terminal_state?: string
      terminal_reason?: string
      ephemeral?: boolean
      answer?: string
    }
  | { type: 'error'; message: string; trace?: string }

export interface ChatStreamHandlers {
  /** Called for every recognized, well-formed frame. */
  onEvent(event: ChatStreamEvent): void
  /** Called on transport-level failures (EventSource error without frame data). */
  onError?(error: unknown): void
  /** Called when the underlying EventSource connection opens. */
  onOpen?(): void
}

/** Frame event names (the server-sent `error` frame is handled separately). */
const FRAME_EVENTS = [
  'token',
  'tool',
  'approval',
  'clarify',
  'reasoning',
  'metering',
  'compressing',
  'warning',
  'cancel',
  'apperror',
  'done',
] as const

type FrameEventName = (typeof FRAME_EVENTS)[number]

/**
 * Parse one frame's JSON payload into a typed event. Returns null for
 * malformed JSON or payloads that do not match the expected shape — unknown
 * or broken frames are ignored, never thrown.
 */
function parseFrame(name: FrameEventName | 'error', raw: string): ChatStreamEvent | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null

  switch (name) {
    case 'token':
    case 'reasoning': {
      const text = (data as { text?: unknown }).text
      return typeof text === 'string' ? { type: name, text } : null
    }
    case 'tool': {
      const payload = data as { name?: unknown; preview?: unknown; args?: unknown; event_type?: unknown; tid?: unknown }
      if (typeof payload.name !== 'string') return null
      return {
        type: 'tool',
        name: payload.name,
        ...(typeof payload.preview === 'string' ? { preview: payload.preview } : {}),
        ...(payload.args !== undefined ? { args: payload.args } : {}),
        ...(typeof payload.event_type === 'string' ? { event_type: payload.event_type } : {}),
        ...(typeof payload.tid === 'string' ? { tid: payload.tid } : {}),
      }
    }
    case 'approval':
      return { type: 'approval', data: data as JsonObject }
    case 'clarify':
      return { type: 'clarify', data: data as JsonObject }
    case 'metering':
      return { type: 'metering', data: data as JsonObject }
    case 'warning':
      return { type: 'warning', data: data as JsonObject }
    case 'apperror':
      return { type: 'apperror', data: data as JsonObject }
    case 'compressing': {
      const payload = data as { session_id?: unknown; message?: unknown }
      if (typeof payload.session_id !== 'string' || typeof payload.message !== 'string') return null
      return { type: 'compressing', data: { session_id: payload.session_id, message: payload.message } }
    }
    case 'cancel': {
      const payload = data as {
        message?: unknown
        type?: unknown
        status?: unknown
        session?: unknown
        session_id?: unknown
      }
      if (typeof payload.message !== 'string') return null
      return {
        type: 'cancel',
        data: {
          message: payload.message,
          type: typeof payload.type === 'string' ? payload.type : 'cancelled',
          status: typeof payload.status === 'string' ? payload.status : 'cancelled',
          ...(payload.session !== undefined ? { session: payload.session } : {}),
          ...(payload.session_id !== undefined ? { session_id: String(payload.session_id) } : {}),
        },
      }
    }
    case 'done': {
      const payload = data as {
        session?: unknown
        usage?: unknown
        terminal_state?: unknown
        terminal_reason?: unknown
        ephemeral?: unknown
        answer?: unknown
      }
      return {
        type: 'done',
        session: payload.session,
        usage: payload.usage,
        ...(typeof payload.terminal_state === 'string' ? { terminal_state: payload.terminal_state } : {}),
        ...(typeof payload.terminal_reason === 'string' ? { terminal_reason: payload.terminal_reason } : {}),
        ...(typeof payload.ephemeral === 'boolean' ? { ephemeral: payload.ephemeral } : {}),
        ...(typeof payload.answer === 'string' ? { answer: payload.answer } : {}),
      }
    }
    case 'error': {
      const payload = data as { message?: unknown; trace?: unknown }
      if (typeof payload.message !== 'string') return null
      return typeof payload.trace === 'string'
        ? { type: 'error', message: payload.message, trace: payload.trace }
        : { type: 'error', message: payload.message }
    }
    default:
      return null
  }
}

/**
 * Open an SSE stream for a chat run and dispatch typed events to `handlers`.
 *
 * - URL: `/api/chat/stream?stream_id=<encoded>` (same-origin, dev-proxied).
 * - Known frames are parsed and delivered via `handlers.onEvent`; unknown
 *   event names and malformed payloads are ignored.
 * - A server-sent `error` frame (which carries `data`) is dispatched as a
 *   `ChatStreamEvent`; a bare transport-level EventSource error has no data
 *   and is surfaced via `handlers.onError`. No auto-reconnect happens here —
 *   the caller decides (see chat feature task).
 *
 * Returns a `close()` function that closes the underlying EventSource.
 */
export function openChatStream(streamId: string, handlers: ChatStreamHandlers): () => void {
  const source = new EventSource(`/api/chat/stream?stream_id=${encodeURIComponent(streamId)}`)

  source.onopen = () => handlers.onOpen?.()

  for (const name of FRAME_EVENTS) {
    source.addEventListener(name, (event: Event) => {
      const raw = (event as MessageEvent).data
      if (typeof raw !== 'string') return
      const parsed = parseFrame(name, raw)
      if (parsed) handlers.onEvent(parsed)
    })
  }

  source.addEventListener('error', (event: Event) => {
    // Server-sent `error` frames arrive as message events with a `data`
    // payload; bare transport failures arrive as ErrorEvent with none.
    if ('data' in event && typeof (event as MessageEvent).data === 'string') {
      const parsed = parseFrame('error', (event as MessageEvent).data)
      if (parsed) handlers.onEvent(parsed)
      return
    }
    handlers.onError?.(event)
  })

  return () => source.close()
}

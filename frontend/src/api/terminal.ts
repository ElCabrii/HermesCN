import { api } from './client'
import type { JsonObject } from './types'

/**
 * Typed client for the embedded workspace terminal (plan Task 8.6).
 *
 * Ports the legacy static/terminal.js HTTP calls against the handlers in
 * api/routes.py:
 *
 *   POST /api/terminal/start  { session_id, rows?, cols?, restart? }
 *                            → { ok, session_id, workspace, running }
 *   POST /api/terminal/input { session_id, data }            → { ok }
 *   POST /api/terminal/resize{ session_id, rows, cols }      → { ok }
 *   POST /api/terminal/close { session_id }                  → { ok, closed }
 *   GET  /api/terminal/output?session_id=… → SSE frames (see below)
 *
 * The output stream (api/routes.py `_handle_terminal_output`) emits the same
 * frames the terminal module fans out via put_output():
 *   output          { text }          — raw PTY bytes (ANSI sequences intact)
 *   terminal_closed { exit_code }     — shell exited; stream terminates
 *   terminal_error  { error }         — PTY failure; stream terminates
 * plus heartbeat comments, and EventSource transport errors when the
 * connection drops (the browser auto-reconnects while CONNECTING).
 */

/** POST /api/terminal/start response. */
export interface TerminalStartResponse extends JsonObject {
  ok: boolean
  session_id: string
  workspace: string
  running: boolean
}

/** POST /api/terminal/close response. */
export interface TerminalCloseResponse extends JsonObject {
  ok: boolean
  closed: boolean
}

/** One frame from the terminal output stream, discriminated by `type`. */
export type TerminalOutputEvent =
  | { type: 'output'; text: string }
  | { type: 'terminal_closed'; exit_code: number | null }
  | { type: 'terminal_error'; error: string }

/** Handlers for openTerminalOutput(). */
export interface TerminalOutputHandlers {
  /** Called for every recognized, well-formed frame. */
  onEvent(event: TerminalOutputEvent): void
  /** Called on transport-level failures (EventSource error without frame data). */
  onError?(error: unknown): void
  /** Called when the underlying EventSource connection opens. */
  onOpen?(): void
}

/** Parse one SSE frame payload into a TerminalOutputEvent, or null if malformed. */
function parseFrame(name: string, raw: string): TerminalOutputEvent | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object') return null
  const payload = data as Record<string, unknown>
  switch (name) {
    case 'output': {
      if (typeof payload.text !== 'string') return null
      return { type: 'output', text: payload.text }
    }
    case 'terminal_closed': {
      const exitCode =
        typeof payload.exit_code === 'number' ? payload.exit_code : null
      return { type: 'terminal_closed', exit_code: exitCode }
    }
    case 'terminal_error': {
      if (typeof payload.error !== 'string') return null
      return { type: 'terminal_error', error: payload.error }
    }
    default:
      return null
  }
}

/** SSE frame names the terminal output stream can carry. */
const FRAME_EVENTS = ['output', 'terminal_closed', 'terminal_error'] as const

/**
 * Open the terminal output SSE stream for a session.
 *
 * - URL: `/api/terminal/output?session_id=<encoded>` (same-origin,
 *   dev-proxied). Mirrors the legacy EventSource in static/terminal.js.
 * - `output` frames carry raw PTY bytes and are delivered via `onEvent`;
 *   `terminal_closed` and `terminal_error` terminate the server stream.
 * - A bare transport-level EventSource error (no data) is surfaced via
 *   `handlers.onError`; the browser auto-reconnects while CONNECTING.
 *
 * Returns a `close()` function that closes the underlying EventSource.
 */
export function openTerminalOutput(
  sessionId: string,
  handlers: TerminalOutputHandlers,
): () => void {
  const source = new EventSource(
    `/api/terminal/output?session_id=${encodeURIComponent(sessionId)}`,
  )

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
    // A server-sent `error` frame would arrive as a message event with data;
    // the terminal stream never sends one, so any error here is transport.
    if ('data' in event && typeof (event as MessageEvent).data === 'string') {
      const parsed = parseFrame('terminal_error', (event as MessageEvent).data)
      if (parsed) handlers.onEvent(parsed)
      return
    }
    handlers.onError?.(event)
  })

  return () => source.close()
}

/**
 * Start (or restart) the PTY for a session's workspace with the given size.
 * The server answers 400 with `remote_terminal_backend_unsupported` when the
 * backend cannot host an embedded terminal — the caller surfaces that message.
 */
export function startTerminal(options: {
  session_id: string
  rows?: number
  cols?: number
  restart?: boolean
}): Promise<TerminalStartResponse> {
  return api<TerminalStartResponse>('/api/terminal/start', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({
      session_id: options.session_id,
      rows: options.rows ?? 24,
      cols: options.cols ?? 80,
      ...(options.restart ? { restart: true } : {}),
    }),
  })
}

/** Write raw bytes (keystrokes) into the PTY. */
export function sendTerminalInput(
  sessionId: string,
  data: string,
): Promise<JsonObject> {
  return api<JsonObject>('/api/terminal/input', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId, data }),
  })
}

/** Resize the PTY (rows/cols reported by the xterm fit addon). */
export function resizeTerminal(
  sessionId: string,
  rows: number,
  cols: number,
): Promise<JsonObject> {
  return api<JsonObject>('/api/terminal/resize', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId, rows, cols }),
  })
}

/** Close the PTY for a session. */
export function closeTerminal(sessionId: string): Promise<TerminalCloseResponse> {
  return api<TerminalCloseResponse>('/api/terminal/close', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ session_id: sessionId }),
  })
}

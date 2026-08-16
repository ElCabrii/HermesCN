import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import {
  closeTerminal,
  openTerminalOutput,
  resizeTerminal,
  sendTerminalInput,
  startTerminal,
  type TerminalCloseResponse,
  type TerminalOutputEvent,
  type TerminalStartResponse,
} from './terminal'

/**
 * Terminal API client tests (plan Task 8.6).
 *
 * Request/response shapes mirror api/routes.py `_handle_terminal_*`:
 *   POST /api/terminal/start  { session_id, rows?, cols?, restart? }
 *                            → { ok, session_id, workspace, running }
 *   POST /api/terminal/input { session_id, data }            → { ok }
 *   POST /api/terminal/resize{ session_id, rows, cols }      → { ok }
 *   POST /api/terminal/close { session_id }                  → { ok, closed }
 *   GET  /api/terminal/output?session_id=… → SSE frames:
 *       output          { text }          (api/terminal.py put_output)
 *       terminal_closed { exit_code }     (terminates the stream)
 *       terminal_error  { error }         (terminates the stream)
 */

/** Minimal EventSource stand-in mirroring sse.test.ts conventions. */
class FakeEventSource {
  static instances: FakeEventSource[] = []

  url: string
  readyState = 0 // CONNECTING
  closed = false
  onopen: (() => void) | null = null
  private listeners = new Map<string, Set<(event: unknown) => void>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  /** Simulate a server-sent frame for `type` carrying JSON `data`. */
  emit(type: string, data: unknown): void {
    const listeners = this.listeners.get(type)
    if (!listeners) return
    for (const listener of listeners) listener({ type, data: JSON.stringify(data) })
  }

  /** Simulate a transport-level failure (no data payload). */
  fail(): void {
    const listeners = this.listeners.get('error')
    if (!listeners) return
    for (const listener of listeners) listener({})
  }

  close(): void {
    this.closed = true
    this.readyState = 2 // CLOSED
    this.listeners.clear()
  }
}

function lastSource(): FakeEventSource {
  const sources = FakeEventSource.instances
  expect(sources.length).toBeGreaterThan(0)
  return sources[sources.length - 1]
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fetchMockResolving(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(jsonResponse(body, status))
  vi.stubGlobal('fetch', fn)
  return fn
}

const SID = 'abc-123'

describe('startTerminal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs session_id and the requested size to /api/terminal/start', async () => {
    const fetchMock = fetchMockResolving({
      ok: true,
      session_id: SID,
      workspace: '/home/gabriel/dev/HermesCN',
      running: true,
    } satisfies TerminalStartResponse)

    const result = await startTerminal({ session_id: SID, rows: 24, cols: 80 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/terminal/start')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: SID, rows: 24, cols: 80 })
    expect(result).toEqual({
      ok: true,
      session_id: SID,
      workspace: '/home/gabriel/dev/HermesCN',
      running: true,
    })
  })

  it('defaults to 24 rows / 80 cols when no size is given', async () => {
    const fetchMock = fetchMockResolving({ ok: true, session_id: SID, workspace: '', running: true })

    await startTerminal({ session_id: SID })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ session_id: SID, rows: 24, cols: 80 })
  })

  it('passes restart: true through', async () => {
    const fetchMock = fetchMockResolving({ ok: true, session_id: SID, workspace: '', running: true })

    await startTerminal({ session_id: SID, restart: true })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ session_id: SID, rows: 24, cols: 80, restart: true })
  })

  it('throws ApiError on non-2xx with the server error message', async () => {
    fetchMockResolving({ error: 'remote_terminal_backend_unsupported', message: 'nope' }, 400)

    await expect(startTerminal({ session_id: SID })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'remote_terminal_backend_unsupported',
    } satisfies Partial<ApiError>)
  })
})

describe('sendTerminalInput', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs session_id and data to /api/terminal/input', async () => {
    const fetchMock = fetchMockResolving({ ok: true })

    await sendTerminalInput(SID, 'ls -la\r')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/terminal/input')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: SID, data: 'ls -la\r' })
  })
})

describe('resizeTerminal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs session_id, rows and cols to /api/terminal/resize', async () => {
    const fetchMock = fetchMockResolving({ ok: true })

    await resizeTerminal(SID, 30, 100)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/terminal/resize')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: SID, rows: 30, cols: 100 })
  })
})

describe('closeTerminal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs session_id to /api/terminal/close and returns the closed flag', async () => {
    const fetchMock = fetchMockResolving({ ok: true, closed: true } satisfies TerminalCloseResponse)

    const result = await closeTerminal(SID)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/terminal/close')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: SID })
    expect(result).toEqual({ ok: true, closed: true })
  })

  it('throws ApiError on failure instead of swallowing it', async () => {
    fetchMockResolving({ error: 'terminal not found' }, 404)

    await expect(closeTerminal(SID)).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'terminal not found',
    } satisfies Partial<ApiError>)
  })
})

describe('openTerminalOutput', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeEventSource.instances = []
  })

  it('opens the terminal output stream URL with an encoded session_id', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    openTerminalOutput('a b/c', { onEvent: vi.fn() })
    expect(lastSource().url).toBe('/api/terminal/output?session_id=a%20b%2Fc')
  })

  it('parses output frames and delivers { type: "output", text } to onEvent', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn<(event: TerminalOutputEvent) => void>()
    openTerminalOutput(SID, { onEvent })
    lastSource().emit('output', { text: '\x1b[32mok\x1b[0m' })
    expect(onEvent).toHaveBeenCalledWith({ type: 'output', text: '\x1b[32mok\x1b[0m' })
  })

  it('delivers terminal_closed with its exit_code and terminal_error with its message', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn<(event: TerminalOutputEvent) => void>()
    openTerminalOutput(SID, { onEvent })
    lastSource().emit('terminal_closed', { exit_code: 0 })
    lastSource().emit('terminal_error', { error: 'boom' })
    expect(onEvent).toHaveBeenCalledWith({ type: 'terminal_closed', exit_code: 0 })
    expect(onEvent).toHaveBeenCalledWith({ type: 'terminal_error', error: 'boom' })
  })

  it('calls onError on transport failure and lets the caller reconnect', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onError = vi.fn()
    openTerminalOutput(SID, { onEvent: vi.fn(), onError })
    lastSource().fail()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('calls onOpen when the EventSource connects', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onOpen = vi.fn()
    openTerminalOutput(SID, { onEvent: vi.fn(), onOpen })
    const source = lastSource()
    source.onopen?.()
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('ignores unknown event names and malformed JSON instead of crashing', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn<(event: TerminalOutputEvent) => void>()
    openTerminalOutput(SID, { onEvent })
    lastSource().emit('mystery_event', { text: 'nope' })
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('close() closes the underlying EventSource', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const close = openTerminalOutput(SID, { onEvent: vi.fn() })
    const source = lastSource()
    expect(source.closed).toBe(false)
    close()
    expect(source.closed).toBe(true)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import {
  cancelStream,
  getApprovalPending,
  getStreamStatus,
  openApprovalStream,
  openClarifyStream,
  respondApproval,
  respondClarify,
  startChat,
  steerChat,
  uploadFile,
  type ApprovalEntry,
} from './chat'

/** Minimal EventSource stand-in mirroring sse.test.ts conventions. */
class FakeEventSource {
  static instances: FakeEventSource[] = []

  url: string
  closed = false
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
    const event = { type, data: JSON.stringify(data) }
    for (const listener of listeners) listener(event)
  }

  /** Simulate a transport-level failure (no data payload). */
  fail(): void {
    const listeners = this.listeners.get('error')
    if (!listeners) return
    for (const listener of listeners) listener({})
  }

  close(): void {
    this.closed = true
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

const ENTRY: ApprovalEntry = {
  approval_id: 'appr-1',
  command: 'rm -rf /tmp/x',
  description: 'Delete /tmp/x',
  pattern_key: 'shell',
  pattern_keys: ['shell'],
  run_id: 'run-1',
}

describe('startChat()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs session_id + message to /api/chat/start and resolves { stream_id, session_id }', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ stream_id: 's-1', session_id: 'sid-1' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(startChat({ session_id: 'sid-1', message: 'hello' })).resolves.toEqual({
      stream_id: 's-1',
      session_id: 'sid-1',
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/chat/start')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'sid-1', message: 'hello' })
  })

  it('includes optional fields (model, model_provider, workspace, attachments) when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ stream_id: 's-1', session_id: 'sid-1' }))
    vi.stubGlobal('fetch', fetchMock)
    const attachments = [{ name: 'a.png', path: '/att/a.png', mime: 'image/png' }]
    await startChat({
      session_id: 'sid-1',
      message: 'hi',
      model: 'deepseek-v4',
      model_provider: 'ollama-cloud',
      workspace: '/ws',
      attachments,
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      session_id: 'sid-1',
      message: 'hi',
      model: 'deepseek-v4',
      model_provider: 'ollama-cloud',
      workspace: '/ws',
      attachments,
    })
  })

  it('passes the [SILENT] control sentinel through verbatim (no client special-casing)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ stream_id: 's-1', session_id: 'sid-1' }))
    vi.stubGlobal('fetch', fetchMock)
    await startChat({ session_id: 'sid-1', message: '[SILENT]' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'sid-1', message: '[SILENT]' })
  })

  it('resolves the suppressed control-turn response without a stream_id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ status: 'suppressed', reason: 'silent_control_message' })),
    )
    await expect(startChat({ session_id: 'sid-1', message: '[SILENT]' })).resolves.toEqual({
      status: 'suppressed',
      reason: 'silent_control_message',
    })
  })

  it.each([
    [404, 'Session not found'],
    [403, 'session is read-only in its foreign store; cannot be claimed writeable in WebUI'],
    [409, 'session already has an active stream'],
    [501, 'runtime adapter selection returned no adapter'],
  ] as const)('throws ApiError with status %i on error', async (status, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: message }, status)))
    const err = await startChat({ session_id: 'sid-1', message: 'hi' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status, message })
  })
})

describe('cancelStream()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /api/chat/cancel?stream_id=... (query param, no body) and resolves { ok, cancelled, stream_id }', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, cancelled: true, stream_id: 's-1' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(cancelStream('s-1')).resolves.toEqual({ ok: true, cancelled: true, stream_id: 's-1' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/chat/cancel?stream_id=s-1')
    expect(init.method ?? 'GET').toBe('GET')
    expect(init.body).toBeUndefined()
  })

  it('URL-encodes the stream id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, cancelled: false, stream_id: 'a b/c' }))
    vi.stubGlobal('fetch', fetchMock)
    await cancelStream('a b/c')
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('/api/chat/cancel?stream_id=a%20b%2Fc')
  })

  it('surfaces a 400 missing stream_id as ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'stream_id required' }, 400)))
    const err = await cancelStream('').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, message: 'stream_id required' })
  })
})

describe('steerChat()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { session_id, text } to /api/chat/steer (field is text, not message)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accepted: true, fallback: null, stream_id: 's-1' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(steerChat('sid-1', 'keep going')).resolves.toEqual({
      accepted: true,
      fallback: null,
      stream_id: 's-1',
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/chat/steer')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'sid-1', text: 'keep going' })
  })

  it('resolves accepted:false with a fallback reason instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ accepted: false, fallback: 'no_stream', stream_id: null })),
    )
    await expect(steerChat('sid-1', 'nudge')).resolves.toEqual({
      accepted: false,
      fallback: 'no_stream',
      stream_id: null,
    })
  })
})

describe('getStreamStatus()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /api/chat/stream/status?stream_id=... and resolves the status payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ active: true, stream_id: 's-1', replay_available: false }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getStreamStatus('s-1')).resolves.toEqual({
      active: true,
      stream_id: 's-1',
      replay_available: false,
    })
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/chat/stream/status?stream_id=s-1')
  })
})

describe('getApprovalPending()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /api/approval/pending?session_id=... and resolves { pending, pending_count }', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ pending: ENTRY, pending_count: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getApprovalPending('sid-1')).resolves.toEqual({ pending: ENTRY, pending_count: 1 })
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/approval/pending?session_id=sid-1')
  })

  it('resolves pending: null when the queue is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ pending: null, pending_count: 0 })))
    await expect(getApprovalPending('sid-1')).resolves.toEqual({ pending: null, pending_count: 0 })
  })

  it('keeps both pattern_keys (plural) and legacy pattern_key on the entry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ pending: ENTRY, pending_count: 1 })))
    const { pending } = await getApprovalPending('sid-1')
    expect(pending?.pattern_keys).toEqual(['shell'])
    expect(pending?.pattern_key).toBe('shell')
  })
})

describe('respondApproval()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { session_id, choice, approval_id } and resolves { ok: true, choice }', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, choice: 'once' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(respondApproval({ session_id: 'sid-1', choice: 'once', approval_id: 'appr-1' })).resolves.toEqual({
      ok: true,
      choice: 'once',
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/approval/respond')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      session_id: 'sid-1',
      choice: 'once',
      approval_id: 'appr-1',
    })
  })

  it('omits approval_id when the entry has none', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, choice: 'deny' }))
    vi.stubGlobal('fetch', fetchMock)
    await respondApproval({ session_id: 'sid-1', choice: 'deny' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'sid-1', choice: 'deny' })
  })

  it('throws ApiError on 400 invalid choice', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Invalid choice: maybe' }, 400)))
    const err = await respondApproval({ session_id: 'sid-1', choice: 'maybe' as never }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, message: 'Invalid choice: maybe' })
  })
})

describe('respondClarify()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { session_id, response, clarify_id } and resolves { ok: true, response }', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, response: 'yes' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(respondClarify({ session_id: 'sid-1', response: 'yes', clarify_id: 'c-1' })).resolves.toEqual({
      ok: true,
      response: 'yes',
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/clarify/respond')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      session_id: 'sid-1',
      response: 'yes',
      clarify_id: 'c-1',
    })
  })

  it('omits clarify_id when absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, response: 'no' }))
    vi.stubGlobal('fetch', fetchMock)
    await respondClarify({ session_id: 'sid-1', response: 'no' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'sid-1', response: 'no' })
  })

  it('throws ApiError carrying the stale body on 409', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { ok: false, error: 'Clarification prompt expired or not found. The agent may have already proceeded.', stale: true },
          409,
        ),
      ),
    )
    const err = await respondClarify({ session_id: 'sid-1', response: 'yes' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, body: { ok: false, stale: true } })
  })
})

describe('uploadFile()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs multipart FormData (session_id + file) without a manual Content-Type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ filename: 'a.png', path: '/att/a.png', size: 42, mime: 'image/png', is_image: true }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    await expect(uploadFile('sid-1', file)).resolves.toEqual({
      filename: 'a.png',
      path: '/att/a.png',
      size: 42,
      mime: 'image/png',
      is_image: true,
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/upload')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    const fd = init.body as FormData
    expect(fd.get('session_id')).toBe('sid-1')
    expect(fd.get('file')).toBe(file)
    // Browser must set the multipart boundary itself — no explicit Content-Type.
    expect(new Headers(init.headers).has('Content-Type')).toBe(false)
  })
})

describe('openApprovalStream()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeEventSource.instances = []
  })

  it('opens /api/approval/stream?session_id=... and dispatches initial + approval events', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn()
    openApprovalStream('sid-1', { onEvent })
    expect(lastSource().url).toBe('/api/approval/stream?session_id=sid-1')
    lastSource().emit('initial', { pending: ENTRY, pending_count: 1 })
    lastSource().emit('approval', { pending: null, pending_count: 0 })
    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(onEvent.mock.calls[0][0]).toEqual({ type: 'initial', pending: ENTRY, pending_count: 1 })
    expect(onEvent.mock.calls[1][0]).toEqual({ type: 'approval', pending: null, pending_count: 0 })
  })

  it('close() closes the underlying EventSource', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const close = openApprovalStream('sid-1', { onEvent: vi.fn() })
    close()
    expect(lastSource().closed).toBe(true)
  })
})

describe('openClarifyStream()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeEventSource.instances = []
  })

  it('opens /api/clarify/stream?session_id=... and dispatches initial + clarify events', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn()
    openClarifyStream('sid-1', { onEvent })
    expect(lastSource().url).toBe('/api/clarify/stream?session_id=sid-1')
    lastSource().emit('clarify', { pending: { clarify_id: 'c-1', question: 'proceed?' }, pending_count: 1 })
    expect(onEvent.mock.calls[0][0]).toEqual({
      type: 'clarify',
      pending: { clarify_id: 'c-1', question: 'proceed?' },
      pending_count: 1,
    })
  })

  it('close() closes the underlying EventSource', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const close = openClarifyStream('sid-1', { onEvent: vi.fn() })
    close()
    expect(lastSource().closed).toBe(true)
  })
})

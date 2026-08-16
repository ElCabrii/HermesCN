import { afterEach, describe, expect, it, vi } from 'vitest'
import { openChatStream, type ChatStreamEvent } from './sse'

/**
 * Minimal EventSource stand-in: records the constructed URL, stores listeners,
 * and lets tests simulate server frames (`emit`) and transport failures
 * (`fail`) the way a real EventSource would deliver them.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = []

  url: string
  readyState = 0 // CONNECTING
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

  /** Simulate a frame whose data is not valid JSON. */
  emitRaw(type: string, raw: string): void {
    const listeners = this.listeners.get(type)
    if (!listeners) return
    for (const listener of listeners) listener({ type, data: raw })
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

describe('openChatStream', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeEventSource.instances = []
  })

  it('opens the chat stream URL for the given stream id', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    openChatStream('abc-123', { onEvent: vi.fn() })
    expect(lastSource().url).toBe('/api/chat/stream?stream_id=abc-123')
  })

  it('URL-encodes the stream id', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    openChatStream('a b/c', { onEvent: vi.fn() })
    expect(lastSource().url).toBe('/api/chat/stream?stream_id=a%20b%2Fc')
  })

  it('parses and dispatches a token event', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn<(event: ChatStreamEvent) => void>()
    openChatStream('s1', { onEvent })
    lastSource().emit('token', { text: 'Hello' })
    expect(onEvent).toHaveBeenCalledWith({ type: 'token', text: 'Hello' })
  })

  it('dispatches data-wrapped events (approval) with the payload under data', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn<(event: ChatStreamEvent) => void>()
    openChatStream('s1', { onEvent })
    const payload = { command: 'rm -rf', description: 'Delete everything', approval_id: 'a1' }
    lastSource().emit('approval', payload)
    expect(onEvent).toHaveBeenCalledWith({ type: 'approval', data: payload })
  })

  it('ignores unknown event names', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn<(event: ChatStreamEvent) => void>()
    openChatStream('s1', { onEvent })
    lastSource().emit('mystery_event', { text: 'nope' })
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('calls onError on transport failure without dispatching an event', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn<(event: ChatStreamEvent) => void>()
    const onError = vi.fn()
    openChatStream('s1', { onEvent, onError })
    lastSource().fail()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('dispatches a server-sent error frame as a ChatStreamEvent, not a transport error', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn<(event: ChatStreamEvent) => void>()
    const onError = vi.fn()
    openChatStream('s1', { onEvent, onError })
    lastSource().emit('error', { message: 'boom', trace: 'stack' })
    expect(onEvent).toHaveBeenCalledWith({ type: 'error', message: 'boom', trace: 'stack' })
    expect(onError).not.toHaveBeenCalled()
  })

  it('ignores malformed JSON instead of crashing', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const onEvent = vi.fn<(event: ChatStreamEvent) => void>()
    openChatStream('s1', { onEvent })
    lastSource().emitRaw('token', '{not json')
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('close() closes the underlying EventSource', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const close = openChatStream('s1', { onEvent: vi.fn() })
    const source = lastSource()
    expect(source.closed).toBe(false)
    close()
    expect(source.closed).toBe(true)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { getStreamStatus, startChat, type StreamStatus } from '@/api/chat'
import { openChatStream, type ChatStreamEvent } from '@/api/sse'
import { toast } from 'sonner'
import {
  busyAtom,
  chatStore,
  compressingAtom,
  contextUsageAtom,
  inflightAtom,
  liveToolCallsAtom,
  loadSession,
  messagesAtom,
  pendingApprovalAtom,
  pendingClarifyAtom,
  pendingFilesAtom,
  reconnectAtom,
  sendMessage,
  sessionAtom,
  streamIdAtom,
  type Session,
} from './chatStore'

vi.mock('@/api/client', () => ({ api: vi.fn() }))
vi.mock('@/api/chat', () => ({
  startChat: vi.fn(),
  uploadFile: vi.fn(),
  cancelStream: vi.fn(),
  getStreamStatus: vi.fn(),
}))
vi.mock('@/api/sse', () => ({ openChatStream: vi.fn() }))
vi.mock('sonner', () => ({ toast: vi.fn() }))

/**
 * Fake EventSource transport. Each openChatStream call pushes a FakeStream the
 * test drives: emit() delivers a typed frame, fail() simulates a transport
 * error, open() simulates the connection opening (onOpen).
 */
interface FakeStream {
  emit(event: ChatStreamEvent): void
  fail(): void
  open(): void
  close: () => void
}

let fakeStreams: FakeStream[] = []

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  return { session_id: id, title: `Session ${id}`, model: 'test-model', messages: [], ...overrides }
}

function mockApiRouter(): void {
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path.startsWith('/api/session?')) {
      const sid = new URL(path, 'http://localhost').searchParams.get('session_id') ?? ''
      return { session: serverSessions.get(sid) ?? null }
    }
    if (path === '/api/session/new') {
      const session = makeSession(`s${++seed}`)
      serverSessions.set(session.session_id, session)
      return { session }
    }
    if (path === '/api/sessions') return { sessions: [...serverSessions.values()] }
    throw new Error(`unexpected api call: ${path}`)
  })
}

const serverSessions = new Map<string, Session>()
let seed = 0

function status(overrides: Partial<StreamStatus> = {}): StreamStatus {
  return { active: true, stream_id: 'stream-1', replay_available: false, ...overrides }
}

/** Load session 'a' and send a turn, opening the (fake) SSE stream. */
async function startStream(sessionId = 'a'): Promise<void> {
  if (!serverSessions.has(sessionId)) serverSessions.set(sessionId, makeSession(sessionId))
  await loadSession(sessionId)
  await sendMessage('hi')
}

function currentStream(): FakeStream {
  return fakeStreams[fakeStreams.length - 1]
}

beforeEach(() => {
  seed = 0
  serverSessions.clear()
  fakeStreams = []
  vi.clearAllMocks()
  chatStore.set(sessionAtom, null)
  chatStore.set(messagesAtom, [])
  chatStore.set(busyAtom, false)
  chatStore.set(streamIdAtom, null)
  chatStore.set(pendingFilesAtom, [])
  chatStore.set(inflightAtom, {})
  chatStore.set(pendingApprovalAtom, null)
  chatStore.set(pendingClarifyAtom, null)
  chatStore.set(contextUsageAtom, null)
  chatStore.set(compressingAtom, null)
  chatStore.set(reconnectAtom, null)
  chatStore.set(liveToolCallsAtom, [])
  mockApiRouter()
  vi.mocked(startChat).mockResolvedValue({ stream_id: 'stream-1', session_id: 'a' })
  vi.mocked(getStreamStatus).mockResolvedValue(status())
  vi.mocked(openChatStream).mockImplementation((_streamId, handlers) => {
    const stream: FakeStream = {
      emit: (event) => handlers.onEvent(event),
      fail: () => handlers.onError?.(new Event('error')),
      open: () => handlers.onOpen?.(),
      close: vi.fn(() => undefined),
    }
    fakeStreams.push(stream)
    return stream.close
  })
})

describe('sendMessage streaming wiring', () => {
  it('opens the SSE stream for the started run and stays busy until a terminal event', async () => {
    await startStream()

    expect(openChatStream).toHaveBeenCalledWith('stream-1', expect.anything())
    expect(chatStore.get(streamIdAtom)).toBe('stream-1')
    expect(chatStore.get(busyAtom)).toBe(true)
  })

  it('token events append to the live assistant row, creating it on the first token', async () => {
    await startStream()

    currentStream().emit({ type: 'token', text: 'Hel' })
    currentStream().emit({ type: 'token', text: 'lo' })

    expect(chatStore.get(messagesAtom).at(-1)).toEqual(
      expect.objectContaining({ role: 'assistant', content: 'Hello' }),
    )
  })

  it('reasoning events append to the live turn reasoning buffer', async () => {
    await startStream()

    currentStream().emit({ type: 'reasoning', text: 'Let me think' })
    currentStream().emit({ type: 'reasoning', text: ' more' })

    expect(chatStore.get(messagesAtom).at(-1)).toEqual(
      expect.objectContaining({ role: 'assistant', reasoning: 'Let me think more' }),
    )
  })

  it('tool events add and update a live tool card, marked in-flight', async () => {
    await startStream()

    currentStream().emit({ type: 'tool', name: 'bash', preview: 'ls -la', args: { cmd: 'ls -la' }, event_type: 'tool.started', tid: 't1' })
    expect(chatStore.get(liveToolCallsAtom)).toEqual([
      expect.objectContaining({ name: 'bash', preview: 'ls -la', args: { cmd: 'ls -la' }, event_type: 'tool.started', tid: 't1', done: false }),
    ])

    // A second frame for the same tool call updates in place (no duplicate card).
    currentStream().emit({ type: 'tool', name: 'bash', preview: 'ls -la /tmp', tid: 't1' })
    expect(chatStore.get(liveToolCallsAtom)).toHaveLength(1)
    expect(chatStore.get(liveToolCallsAtom)[0]).toMatchObject({ preview: 'ls -la /tmp' })
  })

  it('approval and clarify events surface via store atoms and are cleared on done', async () => {
    await startStream()

    currentStream().emit({ type: 'approval', data: { approval_id: 'ap1', command: 'rm -rf /tmp/x', description: 'Delete' } })
    expect(chatStore.get(pendingApprovalAtom)).toMatchObject({ approval_id: 'ap1' })

    currentStream().emit({ type: 'clarify', data: { clarify_id: 'c1', question: 'Which file?' } })
    expect(chatStore.get(pendingClarifyAtom)).toMatchObject({ clarify_id: 'c1' })

    currentStream().emit({ type: 'done', session: null, usage: null })
    expect(chatStore.get(pendingApprovalAtom)).toBeNull()
    expect(chatStore.get(pendingClarifyAtom)).toBeNull()
  })

  it('metering updates the context usage atom and done refreshes it from usage', async () => {
    await startStream()

    currentStream().emit({ type: 'metering', data: { session_id: 'a', usage: { input_tokens: 5, output_tokens: 2 }, tps: 12.5 } })
    expect(chatStore.get(contextUsageAtom)).toMatchObject({ input_tokens: 5, output_tokens: 2, tps: 12.5 })

    currentStream().emit({ type: 'done', session: null, usage: { input_tokens: 12, output_tokens: 34 } })
    expect(chatStore.get(contextUsageAtom)).toMatchObject({ input_tokens: 12, output_tokens: 34 })
  })

  it('compressing sets the compressing atom and terminal events clear it', async () => {
    await startStream()

    currentStream().emit({ type: 'compressing', data: { session_id: 'a', message: 'Compressing context' } })
    expect(chatStore.get(compressingAtom)).toBe('Compressing context')

    currentStream().emit({ type: 'done', session: null, usage: null })
    expect(chatStore.get(compressingAtom)).toBeNull()
  })

  it('warning events toast the server message', async () => {
    await startStream()

    currentStream().emit({ type: 'warning', data: { type: 'fallback', message: 'Falling back to a smaller model' } })

    expect(toast).toHaveBeenCalledWith('Falling back to a smaller model')
  })

  it('apperror appends an inline error row, toasts, and unlocks the session', async () => {
    await startStream()

    currentStream().emit({ type: 'apperror', data: { message: 'Provider down', type: 'provider', hint: 'Retry later' } })

    expect(chatStore.get(messagesAtom).at(-1)).toEqual(
      expect.objectContaining({ role: 'assistant', content: expect.stringContaining('**Error:** Provider down') }),
    )
    expect(chatStore.get(busyAtom)).toBe(false)
    expect(chatStore.get(streamIdAtom)).toBeNull()
    expect(toast).toHaveBeenCalledWith('Provider down')
  })

  it('cancel clears the stream, toasts Cancelled, and applies the carried session', async () => {
    await startStream()

    currentStream().emit({ type: 'cancel', data: { message: 'Cancelled by user', type: 'cancelled', status: 'cancelled' } })
    expect(chatStore.get(busyAtom)).toBe(false)
    expect(chatStore.get(streamIdAtom)).toBeNull()
    expect(chatStore.get(inflightAtom)['a']).toBeUndefined()
    expect(toast).toHaveBeenCalledWith('Cancelled')
  })

  it('cancel applies the session payload when present (partial transcript sync)', async () => {
    await startStream()

    currentStream().emit({
      type: 'cancel',
      data: {
        message: 'Cancelled by user',
        type: 'cancelled',
        status: 'cancelled',
        session: { session_id: 'a', messages: [{ role: 'assistant', content: 'partial answer' }] },
      },
    })

    expect(chatStore.get(messagesAtom)).toEqual([expect.objectContaining({ role: 'assistant', content: 'partial answer' })])
    expect(chatStore.get(sessionAtom)).toMatchObject({ session_id: 'a' })
  })

  it('done syncs messages and the compact session, clears inflight, and closes the stream', async () => {
    await startStream()
    currentStream().emit({ type: 'token', text: 'Hi' })

    const finalMessages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Final answer' },
    ]
    currentStream().emit({
      type: 'done',
      session: { session_id: 'a', title: 'Renamed', messages: finalMessages },
      usage: { input_tokens: 12, output_tokens: 34 },
    })

    expect(chatStore.get(messagesAtom)).toEqual(finalMessages)
    expect(chatStore.get(sessionAtom)).toMatchObject({ session_id: 'a', title: 'Renamed' })
    expect(chatStore.get(sessionAtom)?.active_stream_id).toBeNull()
    expect(chatStore.get(busyAtom)).toBe(false)
    expect(chatStore.get(streamIdAtom)).toBeNull()
    expect(chatStore.get(inflightAtom)['a']).toBeUndefined()
    expect(chatStore.get(contextUsageAtom)).toMatchObject({ input_tokens: 12, output_tokens: 34 })
    expect(fakeStreams[0].close).toHaveBeenCalled()
  })

  it('done with terminal_state tool_limit_reached toasts the limit', async () => {
    await startStream()

    currentStream().emit({ type: 'done', session: null, usage: null, terminal_state: 'tool_limit_reached', terminal_reason: 'max_iterations' })

    expect(toast).toHaveBeenCalledWith('Tool limit reached — stopping the run.')
  })
})

describe('stream reconnect', () => {
  it('transport error with an active stream re-attaches exactly once, then gives up on a second failure', async () => {
    await startStream()
    expect(openChatStream).toHaveBeenCalledTimes(1)

    // First transport failure: status says the run is still active → single re-attach.
    currentStream().fail()

    await vi.waitFor(() => expect(openChatStream).toHaveBeenCalledTimes(2))
    expect(getStreamStatus).toHaveBeenCalledWith('stream-1')
    expect(chatStore.get(reconnectAtom)).toEqual({ stream_id: 'stream-1', message: 'Connection lost — reconnecting…' })
    expect(chatStore.get(busyAtom)).toBe(true)
    expect(chatStore.get(streamIdAtom)).toBe('stream-1')

    // Re-attach succeeds: the banner clears once the connection is back.
    currentStream().open()
    expect(chatStore.get(reconnectAtom)).toBeNull()

    // Second transport failure: give up — error row, unlock, no more status probes.
    currentStream().fail()
    await vi.waitFor(() => expect(chatStore.get(busyAtom)).toBe(false))
    expect(getStreamStatus).toHaveBeenCalledTimes(1)
    expect(chatStore.get(streamIdAtom)).toBeNull()
    expect(chatStore.get(reconnectAtom)).toBeNull()
    expect(chatStore.get(messagesAtom).at(-1)).toEqual(
      expect.objectContaining({ role: 'assistant', content: '**Error:** Connection lost.' }),
    )
    expect(toast).toHaveBeenCalledWith('Connection lost.')
  })

  it('transport error with an inactive stream reloads the session and clears stream state', async () => {
    serverSessions.set('a', makeSession('a', { messages: [{ role: 'assistant', content: 'Saved answer' }] }))
    await startStream()
    vi.mocked(getStreamStatus).mockResolvedValue(status({ active: false }))

    currentStream().fail()

    await vi.waitFor(() => expect(chatStore.get(busyAtom)).toBe(false))
    expect(getStreamStatus).toHaveBeenCalledWith('stream-1')
    expect(openChatStream).toHaveBeenCalledTimes(1) // no re-attach
    expect(chatStore.get(reconnectAtom)).toBeNull()
    expect(chatStore.get(streamIdAtom)).toBeNull()
    expect(chatStore.get(inflightAtom)['a']).toBeUndefined()
    // The run ended server-side; the transcript is refreshed from the session.
    expect(chatStore.get(sessionAtom)?.session_id).toBe('a')
    expect(chatStore.get(messagesAtom)).toEqual([expect.objectContaining({ role: 'assistant', content: 'Saved answer' })])
  })

  it('a transport error after a terminal event never re-attaches', async () => {
    await startStream()
    currentStream().emit({ type: 'done', session: null, usage: null })
    expect(chatStore.get(busyAtom)).toBe(false)

    currentStream().fail()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getStreamStatus).not.toHaveBeenCalled()
    expect(openChatStream).toHaveBeenCalledTimes(1)
  })

  it('a transport error for a stream the user switched away from is ignored', async () => {
    serverSessions.set('a', makeSession('a'))
    serverSessions.set('b', makeSession('b'))
    await loadSession('a')
    await sendMessage('hi') // stream-1 streams on session 'a'
    await loadSession('b') // user switched away; streamIdAtom cleared

    fakeStreams[0].fail()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getStreamStatus).not.toHaveBeenCalled()
    expect(openChatStream).toHaveBeenCalledTimes(1)
    expect(chatStore.get(reconnectAtom)).toBeNull()
    expect(chatStore.get(sessionAtom)?.session_id).toBe('b')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { cancelStream as apiCancelStream, startChat, uploadFile } from '@/api/chat'
import type { CancelStreamResult, ChatStartResult } from '@/api/chat'
import { toast } from 'sonner'
import {
  applyStreamEvent,
  busyAtom,
  cancelStream,
  chatStore,
  deleteSession,
  inflightAtom,
  loadSession,
  messagesAtom,
  newSession,
  onChatEvent,
  pendingFilesAtom,
  sessionAtom,
  sendMessage,
  streamIdAtom,
  type Session,
} from './chatStore'

vi.mock('@/api/client', () => ({ api: vi.fn() }))
vi.mock('@/api/chat', () => ({ startChat: vi.fn(), uploadFile: vi.fn(), cancelStream: vi.fn() }))
vi.mock('sonner', () => ({ toast: vi.fn() }))

/** Minimal in-memory backend so session CRUD stays deterministic. */
const serverSessions = new Map<string, Session>()
let seed = 0

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  return { session_id: id, title: `Session ${id}`, model: 'test-model', messages: [], ...overrides }
}

function mockApiRouter(): void {
  vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/session/new') {
      const session = makeSession(`s${++seed}`)
      serverSessions.set(session.session_id, session)
      return { session }
    }
    if (path.startsWith('/api/session?')) {
      const sid = new URL(path, 'http://localhost').searchParams.get('session_id') ?? ''
      return { session: serverSessions.get(sid) ?? null }
    }
    if (path === '/api/sessions') {
      return { sessions: [...serverSessions.values()] }
    }
    if (path === '/api/session/delete') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { session_id?: string }
      if (body.session_id) serverSessions.delete(body.session_id)
      return { ok: true, state_db_cleanup_failed: false }
    }
    throw new Error(`unexpected api call: ${path}`)
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  seed = 0
  serverSessions.clear()
  vi.clearAllMocks()
  chatStore.set(sessionAtom, null)
  chatStore.set(messagesAtom, [])
  chatStore.set(busyAtom, false)
  chatStore.set(streamIdAtom, null)
  chatStore.set(pendingFilesAtom, [])
  chatStore.set(inflightAtom, {})
  mockApiRouter()
  vi.mocked(startChat).mockResolvedValue({ stream_id: 'stream-1', session_id: 's1' })
  vi.mocked(uploadFile).mockResolvedValue({
    filename: 'note.txt',
    path: '/tmp/note.txt',
    mime: 'text/plain',
    size: 8,
    is_image: false,
  })
  vi.mocked(apiCancelStream).mockResolvedValue({ ok: true, cancelled: true, stream_id: 'stream-1' })
})

describe('boot (invariant b: boot never auto-creates a session)', () => {
  it('starts in the empty state and performs no API calls', () => {
    expect(chatStore.get(sessionAtom)).toBeNull()
    expect(chatStore.get(messagesAtom)).toEqual([])
    expect(chatStore.get(busyAtom)).toBe(false)
    expect(chatStore.get(streamIdAtom)).toBeNull()
    expect(chatStore.get(pendingFilesAtom)).toEqual([])
    expect(chatStore.get(inflightAtom)).toEqual({})
    expect(api).not.toHaveBeenCalled()
  })

  it('newSession() is the explicit + button creation point and resets to an idle state', async () => {
    const session = await newSession()
    expect(session?.session_id).toBeTruthy()
    expect(chatStore.get(sessionAtom)?.session_id).toBe(session?.session_id)
    expect(chatStore.get(busyAtom)).toBe(false)
    expect(chatStore.get(messagesAtom)).toEqual([])
    expect(chatStore.get(streamIdAtom)).toBeNull()
  })
})

describe('sendMessage', () => {
  it('send-on-empty is the second legal creation point (invariant b)', async () => {
    await sendMessage('hello')

    expect(api).toHaveBeenCalledWith('/api/session/new', expect.objectContaining({ method: 'POST' }))
    expect(startChat).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: expect.any(String), message: 'hello' }),
    )
    const sid = chatStore.get(sessionAtom)?.session_id
    expect(sid).toBeTruthy()
    expect(chatStore.get(busyAtom)).toBe(true)
    expect(chatStore.get(streamIdAtom)).toBe('stream-1')
    // The send-time INFLIGHT snapshot is recorded for the new session.
    expect(chatStore.get(inflightAtom)[sid!]).toEqual({
      messages: [expect.objectContaining({ role: 'user', content: 'hello' })],
      uploaded: [],
    })
  })

  it('returns without doing anything when there is no text and no files (invariant d)', async () => {
    serverSessions.set('a', makeSession('a'))
    await loadSession('a')
    const before = chatStore.get(messagesAtom)

    await sendMessage('   ')

    expect(startChat).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalledWith('/api/session/new', expect.anything())
    expect(chatStore.get(messagesAtom)).toEqual(before)
    expect(chatStore.get(busyAtom)).toBe(false)
  })

  it('ignores a second send while busy (invariant d)', async () => {
    serverSessions.set('a', makeSession('a'))
    await loadSession('a')
    chatStore.set(busyAtom, true)

    await sendMessage('second')

    expect(startChat).not.toHaveBeenCalled()
    expect(chatStore.get(messagesAtom)).toEqual([])
    expect(chatStore.get(sessionAtom)?.session_id).toBe('a')
  })

  it('uploads staged files, records them on the inflight snapshot, and clears the pending queue', async () => {
    serverSessions.set('a', makeSession('a'))
    await loadSession('a')
    const file = new File(['x'], 'note.txt')
    chatStore.set(pendingFilesAtom, [file])

    await sendMessage('with file', [file])

    expect(uploadFile).toHaveBeenCalledWith('a', file)
    expect(startChat).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [expect.objectContaining({ name: 'note.txt', path: '/tmp/note.txt' })] }),
    )
    expect(chatStore.get(pendingFilesAtom)).toEqual([])
    expect(chatStore.get(inflightAtom)['a']?.uploaded).toEqual(['note.txt'])
  })

  it('captures activeSid before any await and never applies results to a switched session (invariant a)', async () => {
    serverSessions.set('a', makeSession('a'))
    serverSessions.set('b', makeSession('b', { messages: [{ role: 'assistant', content: 'B saved' }] }))
    await loadSession('a')

    const gate = deferred<ChatStartResult>()
    vi.mocked(startChat).mockReturnValue(gate.promise)

    const sending = sendMessage('from A')
    // While the send is in flight, the user switches to session B.
    await loadSession('b')
    gate.resolve({ stream_id: 'stream-a', session_id: 'a' })
    await sending

    // The stale completion must not clobber B's transcript, its stream id, or busy state.
    expect(chatStore.get(messagesAtom)).toEqual([expect.objectContaining({ role: 'assistant', content: 'B saved' })])
    expect(chatStore.get(streamIdAtom)).toBeNull()
    expect(chatStore.get(busyAtom)).toBe(false)
    // The send-time snapshot for A is preserved so switching back shows it.
    expect(chatStore.get(inflightAtom)['a']).toBeDefined()
  })

  it('a stale send completion never unlocks a newer session that is itself streaming (invariant a)', async () => {
    serverSessions.set('a', makeSession('a'))
    serverSessions.set('b', makeSession('b'))
    await loadSession('a')

    const gate = deferred<ChatStartResult>()
    vi.mocked(startChat).mockReturnValueOnce(gate.promise).mockResolvedValue({ stream_id: 'stream-b', session_id: 'b' })

    const sendingA = sendMessage('from A')
    await loadSession('b')
    const sendingB = sendMessage('from B') // B is now streaming: busy=true
    gate.resolve({ stream_id: 'stream-a', session_id: 'a' })
    await Promise.all([sendingA, sendingB])

    // A's stale completion must NOT call setBusy(false) on B's running stream.
    expect(chatStore.get(busyAtom)).toBe(true)
    expect(chatStore.get(streamIdAtom)).toBe('stream-b')
    expect(chatStore.get(sessionAtom)?.session_id).toBe('b')
  })

  it('switching back to an in-flight session shows the send-time snapshot, not the saved state', async () => {
    serverSessions.set('a', makeSession('a'))
    serverSessions.set('b', makeSession('b', { messages: [{ role: 'assistant', content: 'B saved' }] }))
    await loadSession('a')

    const gate = deferred<ChatStartResult>()
    vi.mocked(startChat).mockReturnValue(gate.promise)
    const sending = sendMessage('pending from A')
    await loadSession('b')
    gate.resolve({ stream_id: 'stream-a', session_id: 'a' })
    await sending

    // The server now holds the saved (pre-turn) transcript for A.
    serverSessions.set('a', makeSession('a', { messages: [{ role: 'assistant', content: 'A saved' }] }))
    await loadSession('a')

    // INFLIGHT contract: the in-progress snapshot wins over the saved state.
    expect(chatStore.get(messagesAtom)).toEqual([
      expect.objectContaining({ role: 'user', content: 'pending from A' }),
    ])
    expect(chatStore.get(busyAtom)).toBe(true)
  })
})

describe('deleteSession (invariant c: deleting never creates)', () => {
  it('deleting the active session loads the most recent remaining session and never creates one', async () => {
    serverSessions.set('a', makeSession('a', { messages: [{ role: 'assistant', content: 'A' }] }))
    serverSessions.set('b', makeSession('b'))
    serverSessions.set('c', makeSession('c'))
    await loadSession('c')

    await deleteSession('c')

    expect(chatStore.get(sessionAtom)?.session_id).toBe('a') // sessions[0] = most recent
    expect(chatStore.get(messagesAtom)).toEqual([expect.objectContaining({ role: 'assistant', content: 'A' })])
    expect(api).not.toHaveBeenCalledWith('/api/session/new', expect.anything())
    expect(toast).toHaveBeenCalledWith('Conversation deleted')
  })

  it('deleting the last active session shows the empty state and never creates one', async () => {
    serverSessions.set('a', makeSession('a'))
    await loadSession('a')

    await deleteSession('a')

    expect(chatStore.get(sessionAtom)).toBeNull()
    expect(chatStore.get(messagesAtom)).toEqual([])
    expect(chatStore.get(busyAtom)).toBe(false)
    expect(api).not.toHaveBeenCalledWith('/api/session/new', expect.anything())
    expect(toast).toHaveBeenCalledWith('Conversation deleted')
  })

  it('deleting a non-active session leaves the active session untouched and never creates one', async () => {
    serverSessions.set('a', makeSession('a'))
    serverSessions.set('b', makeSession('b'))
    await loadSession('a')

    await deleteSession('b')

    expect(chatStore.get(sessionAtom)?.session_id).toBe('a')
    expect(api).not.toHaveBeenCalledWith('/api/session/new', expect.anything())
    expect(toast).toHaveBeenCalledWith('Conversation deleted')
  })
})

describe('applyStreamEvent', () => {
  async function startStreamingSession(): Promise<string> {
    serverSessions.set('a', makeSession('a'))
    await loadSession('a')
    await sendMessage('hi')
    return chatStore.get(sessionAtom)!.session_id
  }

  it('token events stream into the assistant message while the stream is active', async () => {
    await startStreamingSession()
    applyStreamEvent({ type: 'token', text: 'Hel' })
    applyStreamEvent({ type: 'token', text: 'lo' })
    expect(chatStore.get(messagesAtom).at(-1)).toEqual(
      expect.objectContaining({ role: 'assistant', content: 'Hello' }),
    )
  })

  it('done unlocks busy, clears the stream id and the inflight snapshot', async () => {
    const sid = await startStreamingSession()
    applyStreamEvent({ type: 'done', session: { session_id: sid }, usage: null })
    expect(chatStore.get(busyAtom)).toBe(false)
    expect(chatStore.get(streamIdAtom)).toBeNull()
    expect(chatStore.get(inflightAtom)[sid]).toBeUndefined()
  })

  it('error events append an error message and unlock the session', async () => {
    await startStreamingSession()
    applyStreamEvent({ type: 'error', message: 'boom' })
    expect(chatStore.get(messagesAtom).at(-1)).toEqual(
      expect.objectContaining({ role: 'assistant', content: '**Error:** boom' }),
    )
    expect(chatStore.get(busyAtom)).toBe(false)
    expect(chatStore.get(streamIdAtom)).toBeNull()
  })

  it('terminal events from a stale stream never unlock or mutate the current session', async () => {
    serverSessions.set('a', makeSession('a'))
    await loadSession('a')
    // No stream is active on the current session — a late done frame must be ignored.
    applyStreamEvent({ type: 'done', session: null, usage: null })
    expect(chatStore.get(busyAtom)).toBe(false)
    expect(chatStore.get(messagesAtom)).toEqual([])
    expect(chatStore.get(streamIdAtom)).toBeNull()
  })
})

describe('cancelStream', () => {
  it('cancels the active stream and unlocks the session', async () => {
    serverSessions.set('a', makeSession('a'))
    await loadSession('a')
    await sendMessage('hi')
    const sid = chatStore.get(sessionAtom)!.session_id

    await cancelStream()

    expect(apiCancelStream).toHaveBeenCalledWith('stream-1')
    expect(chatStore.get(busyAtom)).toBe(false)
    expect(chatStore.get(streamIdAtom)).toBeNull()
    expect(chatStore.get(inflightAtom)[sid]).toBeUndefined()
  })

  it('is a no-op when no stream is active', async () => {
    await cancelStream()
    expect(apiCancelStream).not.toHaveBeenCalled()
  })

  it('a cancel that resolves after the user switched sessions does not unlock the new session (invariant a)', async () => {
    serverSessions.set('a', makeSession('a'))
    serverSessions.set('b', makeSession('b'))
    await loadSession('a')
    await sendMessage('from A') // A streaming: busy=true, streamId='stream-1'

    const cancelGate = deferred<CancelStreamResult>()
    vi.mocked(apiCancelStream).mockReturnValue(cancelGate.promise)
    const cancelling = cancelStream() // captures sid='a' before the await

    await loadSession('b') // switch mid-cancel; B idle
    vi.mocked(startChat).mockResolvedValueOnce({ stream_id: 'stream-b', session_id: 'b' })
    await sendMessage('from B') // B streaming: busy=true, streamId='stream-b'

    cancelGate.resolve({ ok: true, cancelled: true, stream_id: 'stream-1' })
    await cancelling

    // The stale cancel must not unlock B's running stream.
    expect(apiCancelStream).toHaveBeenCalledWith('stream-1')
    expect(chatStore.get(busyAtom)).toBe(true)
    expect(chatStore.get(streamIdAtom)).toBe('stream-b')
    expect(chatStore.get(sessionAtom)?.session_id).toBe('b')
  })
})

describe('sendMessage with an explicit model', () => {
  it('threads a chosen model id into chat/start with explicit_model_pick', async () => {
    serverSessions.set('a', makeSession('a'))
    await loadSession('a')

    await sendMessage('hi', [], 'gpt-4o')

    expect(startChat).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 'a', message: 'hi', model: 'gpt-4o', explicit_model_pick: true }),
    )
  })

  it('omits the model fields when none was chosen', async () => {
    serverSessions.set('a', makeSession('a'))
    await loadSession('a')

    await sendMessage('hi')

    const request = vi.mocked(startChat).mock.calls[0][0]
    expect(request.model).toBeUndefined()
    expect(request.explicit_model_pick).toBeUndefined()
  })
})

describe('onChatEvent', () => {
  it('notifies subscribers of every event applied to the active stream', async () => {
    serverSessions.set('a', makeSession('a'))
    await loadSession('a')
    chatStore.set(streamIdAtom, 'stream-1')

    const seen: string[] = []
    const unsubscribe = onChatEvent((event) => seen.push(event.type))

    applyStreamEvent({ type: 'approval', data: { command: 'rm -rf /tmp/x' } })
    applyStreamEvent({ type: 'clarify', data: { question: 'which?' } })
    applyStreamEvent({ type: 'done', session: null, usage: null })

    expect(seen).toEqual(['approval', 'clarify', 'done'])
    unsubscribe()
    applyStreamEvent({ type: 'approval', data: { command: 'ignored' } })
    expect(seen).toEqual(['approval', 'clarify', 'done'])
  })

  it('does not notify when no stream is active on the current session', async () => {
    serverSessions.set('a', makeSession('a'))
    await loadSession('a')
    const listener = vi.fn()
    const unsubscribe = onChatEvent(listener)

    applyStreamEvent({ type: 'approval', data: { command: 'ignored' } })

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})

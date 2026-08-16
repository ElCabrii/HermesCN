import { atom, createStore } from 'jotai/vanilla'
import { api } from '@/api/client'
import { cancelStream as apiCancelStream, startChat, uploadFile, type ChatAttachment, type ChatStartResult } from '@/api/chat'
import type { ChatStreamEvent } from '@/api/sse'
import { toast } from 'sonner'

/**
 * Chat state store (Jotai).
 *
 * Ports the legacy global state (ARCHITECTURE.md §5.2) and its product
 * invariants (§5.6 session delete rules, §5.7 send() session guard):
 *
 * - `inflightAtom` is the INFLIGHT contract: a per-session snapshot taken at
 *   send time. If the user switches sessions while a request is pending,
 *   switching back shows the in-progress state instead of the saved state.
 * - Boot never auto-creates a session. The only two creation points are the
 *   + button (`newSession()`) and send-on-empty (`sendMessage`).
 * - `deleteSession()` never creates a session.
 * - `sendMessage()` captures `activeSid` before any await and applies its
 *   results only if the active session is still `activeSid`; otherwise it only
 *   refreshes the sidebar and never unlocks busy on the wrong session.
 */

/** One message in a session transcript (legacy shape, extra fields allowed). */
export interface Message {
  role: string
  content: string
  ts?: number
  [key: string]: unknown
}

/** Compact session dict as returned by the session endpoints (legacy shape). */
export interface Session {
  session_id: string
  title?: string
  model?: string
  model_provider?: string | null
  workspace?: string
  profile?: string
  messages?: Message[]
  active_stream_id?: string | null
  pending_started_at?: number
  [key: string]: unknown
}

/** INFLIGHT snapshot for one session, taken at send time (§5.2). */
export interface InflightSnapshot {
  messages: Message[]
  uploaded: string[]
}

export type InflightMap = Record<string, InflightSnapshot>

/** Single store instance shared by every consumer of the chat feature. */
export const chatStore = createStore()

export const sessionAtom = atom<Session | null>(null)
export const messagesAtom = atom<Message[]>([])
export const busyAtom = atom(false)
export const streamIdAtom = atom<string | null>(null)
export const pendingFilesAtom = atom<File[]>([])
export const inflightAtom = atom<InflightMap>({})

function withoutInflight(entries: InflightMap, sid: string): InflightMap {
  const next = { ...entries }
  delete next[sid]
  return next
}

function errorMessage(e: unknown): string {
  return e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? 'unknown error')
}

/**
 * Explicit session creation — the "+" button. Never called on boot and never
 * called by `deleteSession()`.
 */
export async function newSession(): Promise<Session | null> {
  try {
    const data = await api<{ session: Session | null }>('/api/session/new', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({}),
    })
    const session = data?.session
    if (!session) return null
    chatStore.set(sessionAtom, session)
    chatStore.set(messagesAtom, Array.isArray(session.messages) ? session.messages : [])
    chatStore.set(busyAtom, false)
    chatStore.set(streamIdAtom, null)
    return session
  } catch {
    return null
  }
}

/**
 * Load a session's transcript. When an INFLIGHT snapshot exists for the
 * session (a turn is in progress), the snapshot wins over the saved state so
 * switching back shows the in-progress transcript (§5.2).
 */
export async function loadSession(sid: string): Promise<Session | null> {
  const data = await api<{ session: Session | null }>(
    `/api/session?session_id=${encodeURIComponent(sid)}&messages=1&resolve_model=0`,
    { credentials: 'include' },
  )
  const session = data?.session
  if (!session) return null
  const inflight = chatStore.get(inflightAtom)[sid]
  chatStore.set(sessionAtom, session)
  chatStore.set(messagesAtom, inflight ? inflight.messages : Array.isArray(session.messages) ? session.messages : [])
  chatStore.set(streamIdAtom, null)
  chatStore.set(busyAtom, Boolean(inflight))
  return session
}

/**
 * Send a user turn. Creation points: the caller must have a session, or this
 * is the send-on-empty path (the second of exactly two legal creation points).
 *
 * Guards (§5.7 / plan invariants):
 * - Returns immediately when there is no text and no files, or when busy.
 * - Captures `activeSid` BEFORE any await; results are applied only if the
 *   active session is still `activeSid`. A stale completion never unlocks
 *   busy on the session the user switched to.
 */
export async function sendMessage(text: string, files: File[] = [], model?: string): Promise<void> {
  const message = text.trim()
  const pending = files.length > 0 ? files : chatStore.get(pendingFilesAtom)
  if (!message && pending.length === 0) return
  if (chatStore.get(busyAtom)) return

  // Guard: capture activeSid before any await. send-on-empty is the only other
  // legal session creation point besides newSession() (the + button).
  let session = chatStore.get(sessionAtom)
  if (!session) {
    session = await newSession()
    if (!session) return
  }
  const activeSid = session.session_id

  // Send-time snapshot (INFLIGHT contract §5.2): record before the first await
  // so switching away and back shows the in-progress state, not the saved one.
  const userMessage: Message = { role: 'user', content: message, ts: Date.now() / 1000 }
  const optimistic = [...chatStore.get(messagesAtom), userMessage]
  chatStore.set(messagesAtom, optimistic)
  chatStore.set(busyAtom, true)
  chatStore.set(streamIdAtom, null)
  chatStore.set(pendingFilesAtom, [])
  chatStore.set(inflightAtom, {
    ...chatStore.get(inflightAtom),
    [activeSid]: { messages: optimistic, uploaded: [] },
  })

  // Upload staged files before starting the turn.
  const attachments: ChatAttachment[] = []
  try {
    for (const file of pending) {
      const uploaded = await uploadFile(activeSid, file)
      attachments.push({
        name: uploaded.filename,
        path: uploaded.path,
        mime: uploaded.mime,
        size: uploaded.size,
        is_image: uploaded.is_image,
      })
    }
  } catch (e) {
    if (chatStore.get(sessionAtom)?.session_id === activeSid) {
      chatStore.set(busyAtom, false)
      chatStore.set(streamIdAtom, null)
      chatStore.set(inflightAtom, withoutInflight(chatStore.get(inflightAtom), activeSid))
      chatStore.set(messagesAtom, chatStore.get(messagesAtom).filter((m) => m !== userMessage))
      chatStore.set(pendingFilesAtom, pending)
    }
    return
  }
  chatStore.set(inflightAtom, {
    ...chatStore.get(inflightAtom),
    [activeSid]: { messages: chatStore.get(messagesAtom), uploaded: attachments.map((a) => a.name) },
  })

  let started: ChatStartResult
  try {
    started = await startChat({
      session_id: activeSid,
      message,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(model ? { model, explicit_model_pick: true } : {}),
    })
  } catch (e) {
    if (chatStore.get(sessionAtom)?.session_id === activeSid) {
      chatStore.set(messagesAtom, [
        ...chatStore.get(messagesAtom),
        { role: 'assistant', content: `**Error:** ${errorMessage(e)}` },
      ])
      chatStore.set(busyAtom, false)
      chatStore.set(streamIdAtom, null)
      chatStore.set(inflightAtom, withoutInflight(chatStore.get(inflightAtom), activeSid))
    }
    return
  }

  // §5.7 session guard: apply results only if the active session is still the
  // one the turn was started on. Otherwise only the sidebar refreshes — busy
  // must NOT be unlocked on the session the user switched to.
  if (chatStore.get(sessionAtom)?.session_id !== activeSid) return

  if ('status' in started && started.status === 'suppressed') {
    chatStore.set(busyAtom, false)
    chatStore.set(streamIdAtom, null)
    chatStore.set(inflightAtom, withoutInflight(chatStore.get(inflightAtom), activeSid))
    return
  }
  if ('error' in started && started.error) {
    chatStore.set(messagesAtom, [...chatStore.get(messagesAtom), { role: 'assistant', content: `**Error:** ${started.error}` }])
    chatStore.set(busyAtom, false)
    chatStore.set(streamIdAtom, null)
    chatStore.set(inflightAtom, withoutInflight(chatStore.get(inflightAtom), activeSid))
    return
  }

  if (!('stream_id' in started)) return
  chatStore.set(streamIdAtom, started.stream_id)
  // busy stays true until a terminal stream event (done/cancel/error) arrives.
}

/**
 * Cancel the active stream. Captures the stream/session before the await; a
 * cancel that resolves after the user switched sessions never unlocks the new
 * session's busy state (§5.7).
 */
export async function cancelStream(): Promise<void> {
  const streamId = chatStore.get(streamIdAtom)
  if (!streamId) return
  const sid = chatStore.get(sessionAtom)?.session_id ?? null
  try {
    await apiCancelStream(streamId)
  } catch {
    // fall through: still unlock if we own the session
  }
  if (sid && chatStore.get(sessionAtom)?.session_id === sid) {
    chatStore.set(busyAtom, false)
    chatStore.set(streamIdAtom, null)
    chatStore.set(inflightAtom, withoutInflight(chatStore.get(inflightAtom), sid))
  }
}

/**
 * Apply one SSE frame to the active session's transcript. Events are ignored
 * when no stream is active on the current pane (stale stream frames must never
 * mutate or unlock the session the user is looking at).
 *
 * Every applied event is also fanned out to `onChatEvent` subscribers so
 * surface components (approval card, clarify dialog) can react without owning
 * the EventSource.
 */
export function applyStreamEvent(event: ChatStreamEvent): void {
  const sid = chatStore.get(sessionAtom)?.session_id
  if (!sid) return
  if (!chatStore.get(streamIdAtom)) return

  switch (event.type) {
    case 'token': {
      const messages = [...chatStore.get(messagesAtom)]
      const last = messages.at(-1)
      if (last && last.role === 'assistant') {
        messages[messages.length - 1] = { ...last, content: String(last.content ?? '') + event.text }
      } else {
        messages.push({ role: 'assistant', content: event.text })
      }
      chatStore.set(messagesAtom, messages)
      break
    }
    case 'done':
    case 'cancel':
      chatStore.set(busyAtom, false)
      chatStore.set(streamIdAtom, null)
      chatStore.set(inflightAtom, withoutInflight(chatStore.get(inflightAtom), sid))
      break
    case 'error':
      chatStore.set(messagesAtom, [...chatStore.get(messagesAtom), { role: 'assistant', content: `**Error:** ${event.message}` }])
      chatStore.set(busyAtom, false)
      chatStore.set(streamIdAtom, null)
      chatStore.set(inflightAtom, withoutInflight(chatStore.get(inflightAtom), sid))
      break
    default:
      // tool / reasoning / approval / clarify / metering / compressing /
      // warning / apperror are surfaced to subscribers below (Task 3.5 owns
      // the streaming integration that drives these frames).
      break
  }

  // Fan out to subscribers (Composer approval card / clarify dialog). A
  // listener must never break stream state application.
  for (const listener of chatEventListeners) {
    try {
      listener(event)
    } catch {
      // ignore listener errors
    }
  }
}

/** Listener for events applied by `applyStreamEvent`. */
export type ChatEventListener = (event: ChatStreamEvent) => void

const chatEventListeners = new Set<ChatEventListener>()

/**
 * Subscribe to stream events applied to the active session. Returns an
 * unsubscribe function. The Composer uses this to surface the approval card
 * and clarify dialog without owning the EventSource.
 */
export function onChatEvent(listener: ChatEventListener): () => void {
  chatEventListeners.add(listener)
  return () => {
    chatEventListeners.delete(listener)
  }
}

/**
 * Delete a session. NEVER creates a session (§5.6):
 * - deleted session was active AND others remain → load sessions[0] (most recent)
 * - deleted session was active AND none remain → empty state
 * - deleted session was not active → just re-render the list
 * Always shows the "Conversation deleted" toast.
 */
export async function deleteSession(sid: string): Promise<boolean> {
  try {
    await api('/api/session/delete', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ session_id: sid }),
    })
  } catch {
    return false
  }

  chatStore.set(inflightAtom, withoutInflight(chatStore.get(inflightAtom), sid))

  if (chatStore.get(sessionAtom)?.session_id === sid) {
    chatStore.set(sessionAtom, null)
    chatStore.set(messagesAtom, [])
    chatStore.set(busyAtom, false)
    chatStore.set(streamIdAtom, null)
    const data = await api<{ sessions: Session[] | null }>('/api/sessions', { credentials: 'include' })
    const remaining = (data?.sessions ?? []).filter((s) => s && s.session_id !== sid)
    if (remaining.length > 0) {
      await loadSession(remaining[0].session_id)
    }
  }

  toast('Conversation deleted')
  return true
}

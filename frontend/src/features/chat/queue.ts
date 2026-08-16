/**
 * Per-session queued-message store (plan Task 8.7).
 *
 * Ports the legacy `static/ui.js` session queue (`SESSION_QUEUES` +
 * `queueSessionMessage` / `shiftQueuedSessionMessage` / `getQueuedSessionCount`
 * + `hermes-queue-<sid>` persistence). `/queue`, `/interrupt`, and steer
 * fallbacks enqueue follow-up turns while the agent is running; the drain
 * path (`shiftQueuedSessionMessage`) feeds the next turn when the stream
 * completes.
 *
 * Persistence mirrors the legacy keys exactly (`hermes-queue-<sid>` in both
 * sessionStorage and localStorage) so queued messages survive a reload.
 */

export interface QueuedSessionMessage {
  text: string
  files?: File[]
  model?: string
  model_provider?: string
  profile?: string
  /** Stamped at enqueue time (legacy `_queued_at`). */
  _queued_at?: number
}

/** In-memory queues keyed by session_id (legacy `SESSION_QUEUES`). */
const SESSION_QUEUES = new Map<string, QueuedSessionMessage[]>()

function queueStorageKey(sid: string): string {
  return `hermes-queue-${sid}`
}

function readPersistedQueue(sid: string): QueuedSessionMessage[] {
  try {
    const raw =
      sessionStorage.getItem(queueStorageKey(sid)) ??
      localStorage.getItem(queueStorageKey(sid))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as QueuedSessionMessage[]) : []
  } catch {
    return []
  }
}

function clearPersistedQueue(sid: string): void {
  try {
    sessionStorage.removeItem(queueStorageKey(sid))
  } catch {
    // storage unavailable
  }
  try {
    localStorage.removeItem(queueStorageKey(sid))
  } catch {
    // storage unavailable
  }
}

function persistQueue(sid: string, queue: QueuedSessionMessage[]): void {
  if (queue.length === 0) {
    clearPersistedQueue(sid)
    return
  }
  let payload = '[]'
  try {
    payload = JSON.stringify(queue)
  } catch {
    return
  }
  try {
    sessionStorage.setItem(queueStorageKey(sid), payload)
  } catch {
    // storage unavailable
  }
  try {
    localStorage.setItem(queueStorageKey(sid), payload)
  } catch {
    // storage unavailable
  }
}

function getQueue(sid: string, create = false): QueuedSessionMessage[] {
  if (!sid) return []
  let queue = SESSION_QUEUES.get(sid)
  if (!queue && create) {
    queue = readPersistedQueue(sid)
    SESSION_QUEUES.set(sid, queue)
  }
  return queue ?? []
}

/** Enqueue a follow-up message for a session. Returns the new queue length. */
export function queueSessionMessage(sid: string, payload: QueuedSessionMessage): number {
  if (!sid || !payload) return 0
  const queue = getQueue(sid, true)
  const entry: QueuedSessionMessage = { ...payload, _queued_at: Date.now() }
  queue.push(entry)
  persistQueue(sid, queue)
  return queue.length
}

/** Dequeue the next queued message for a session (drain path). */
export function shiftQueuedSessionMessage(sid: string): QueuedSessionMessage | null {
  const queue = getQueue(sid, false)
  if (queue.length === 0) return null
  const next = queue.shift() ?? null
  if (queue.length === 0) {
    SESSION_QUEUES.delete(sid)
    clearPersistedQueue(sid)
  } else {
    persistQueue(sid, queue)
  }
  return next
}

/** Number of queued follow-up messages for a session. */
export function getQueuedSessionCount(sid: string): number {
  return getQueue(sid, false).length
}

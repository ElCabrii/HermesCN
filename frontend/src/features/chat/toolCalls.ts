import type { ToolCall } from './ToolCard'

/**
 * Normalization for tool activity.
 *
 * The transcript API returns OpenAI-shaped tool calls —
 * `{ id, call_id, type: "function", function: { name, arguments } }` — while
 * the SSE stream emits the flat `{ name, args, preview, done }` shape. The UI
 * only ever read the flat shape, so every settled call rendered as an anonymous
 * row named "tool", with no arguments and a spinner that never resolved.
 *
 * Tool RESULTS arrive as separate `role: "tool"` messages carrying a
 * `tool_call_id` and no name at all. Joining them back onto the call they
 * answer is what turns the activity disclosure from a list of identical stubs
 * into a readable log: one row per call, named, with its arguments and its
 * result together.
 */

/** Raw tool-call value straight off a message payload. */
type RawToolCall = Record<string, unknown>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Stable identity used to pair a `role: "tool"` result with its call. */
export function toolCallId(raw: RawToolCall): string | undefined {
  return asString(raw.call_id) ?? asString(raw.id) ?? asString(raw.tool_call_id) ?? asString(raw.tid)
}

/**
 * A short, human-readable target for the collapsed row: the command being run,
 * the file being read, the query being searched. Falls back to nothing rather
 * than dumping a JSON blob into a one-line row.
 */
const PREVIEW_KEYS = [
  'command',
  'cmd',
  'path',
  'file_path',
  'filename',
  'file',
  'query',
  'q',
  'url',
  'pattern',
  'name',
  'text',
]

export function previewOf(args: unknown): string | undefined {
  const record = asRecord(args)
  if (!record) return typeof args === 'string' && args !== '' ? args : undefined
  for (const key of PREVIEW_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') return value
    if (typeof value === 'number') return String(value)
  }
  return undefined
}

/**
 * Map any tool-call payload onto the flat shape the row renderer expects.
 *
 * `settled` marks calls read back from saved history: those finished by
 * definition, so a missing `done` means "complete", not "still running". Live
 * SSE calls keep their own flag so the spinner stays truthful.
 */
export function normalizeToolCall(raw: unknown, { settled }: { settled: boolean }): ToolCall {
  const record = asRecord(raw)
  if (!record) return { name: 'tool', done: settled }

  const fn = asRecord(record.function)
  const name =
    asString(record.name) ??
    (fn ? asString(fn.name) : undefined) ??
    asString(record.tool_name) ??
    asString(record.tool) ??
    'tool'

  // `function.arguments` is a JSON *string* in the OpenAI shape; parse it so the
  // expansion shows formatted arguments instead of an escaped one-liner.
  let args: unknown = record.args ?? record.arguments ?? (fn ? fn.arguments : undefined)
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      // Not JSON — keep the raw string, it is still the best thing to show.
    }
  }

  const done = typeof record.done === 'boolean' ? record.done : settled

  return {
    ...record,
    name,
    args,
    preview: asString(record.preview) ?? asString(record.snippet) ?? previewOf(args),
    result: asString(record.result),
    done,
    is_error: Boolean(record.is_error),
  }
}

/**
 * Attach a `role: "tool"` message's output to the call it answers.
 *
 * Returns true when the result was claimed by an existing call; a false return
 * means the result has no matching call in this turn and needs a row of its own
 * so its output is never silently dropped.
 */
export function attachToolResult(
  calls: ToolCall[],
  message: { content?: string; [key: string]: unknown },
): boolean {
  const id = asString(message.tool_call_id)
  const errored = Boolean(message.is_error)
  const target = id
    ? calls.find((call) => toolCallId(call as RawToolCall) === id && call.result === undefined)
    : // Without an id, the oldest call still missing a result is the best guess:
      // providers stream results back in call order.
      calls.find((call) => call.result === undefined)
  if (!target) return false
  target.result = message.content ?? ''
  target.done = true
  if (errored) target.is_error = true
  return true
}

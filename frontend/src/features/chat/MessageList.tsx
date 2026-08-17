import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Check, ChevronDown, Copy, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Message } from './chatStore'
import { Markdown } from './Markdown'
import { ToolCard, type ToolCall } from './ToolCard'
import { attachToolResult, normalizeToolCall } from './toolCalls'

/**
 * Chat transcript (DESIGN.md / docs/UIUX-GUIDE.md contract):
 * - Assistant prose: left-aligned, prose-first, NO heavy bubble, no shadow.
 * - User messages: right-aligned compact bubble, sans stack; very long pastes
 *   clamp so one wall of text cannot bury the reply that follows it.
 * - Tool calls: quiet debug rows grouped per assistant turn behind ONE terse
 *   "Activity: N tools" disclosure. This includes settled `role: "tool"`
 *   transcript entries — the guide is explicit that internal events must not
 *   each become a first-class chat card, so they fold into the turn that
 *   produced them instead of stacking as full-width rows.
 * - Thinking/context traces: same quiet metadata family as tool rows.
 * - Compression events: centered non-interactive text between horizontal rules.
 *
 * Nesting: the activity disclosure is a plain region, not a card, and the rows
 * inside it are separated by hairlines rather than each carrying its own
 * border+fill. DESIGN.md: "If a card contains another card, one of them is
 * probably unnecessary."
 *
 * Per-turn disclosure persistence: the open/closed state of each ActivityGroup
 * is keyed by the assistant turn's identity (a stable hash of its content +
 * tool name list). The state persists in a `Map` for the lifetime of the
 * transcript so a user who expanded a long run can navigate away and back
 * without losing their place — matches the DESIGN.md instruction.
 */

export interface LiveToolCall extends ToolCall {
  /** SSE tool events are in-flight until the session payload settles them. */
  _live?: boolean
}

export type LiveCompressionPhase = 'running' | 'done'

export interface MessageListProps {
  messages: Message[]
  liveToolCalls?: LiveToolCall[]
  liveCompression?: LiveCompressionPhase | null
  /** Renders the "working" affordance at the tail of the transcript. */
  streaming?: boolean
  className?: string
}

/** User messages longer than this clamp behind a "show more" toggle. */
const USER_CLAMP_CHARS = 900

function asToolCalls(value: unknown, settled = true): ToolCall[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v) => v !== null && typeof v === 'object')
    .map((v) => normalizeToolCall(v, { settled }))
}

interface TurnGroup {
  /** Index of the owning assistant message in `messages`, or -1 for a live-only trailing group. */
  index: number
  calls: ToolCall[]
  /** Stable identity used to persist the disclosure's open/closed state. */
  key: string
}

/** A `role: "tool"` message that matched no call, expressed as its own row. */
function toolMessageAsCall(message: Message): ToolCall {
  const name = typeof message.name === 'string' && message.name !== '' ? message.name : 'tool'
  return { name, result: message.content, done: true, is_error: Boolean(message.is_error) }
}

/**
 * Group tool activity per assistant turn, anchored to the owning assistant
 * message (legacy convention). A `role: "tool"` message is the RESULT of a call
 * in the turn above it, so it is merged into that call rather than added as an
 * extra row; only a result with no matching call becomes a row of its own. Live
 * SSE tool events join the LAST assistant turn, and activity with no assistant
 * turn to attach to forms a trailing group.
 */
function buildTurnGroups(messages: Message[], liveToolCalls: LiveToolCall[]): TurnGroup[] {
  const groups: TurnGroup[] = []
  const orphanToolCalls: ToolCall[] = []
  messages.forEach((m, i) => {
    if (m.role === 'tool') {
      const last = groups[groups.length - 1]
      if (last && attachToolResult(last.calls, m)) return
      if (last) last.calls.push(toolMessageAsCall(m))
      else orphanToolCalls.push(toolMessageAsCall(m))
      return
    }
    if (m.role !== 'assistant') return
    const calls = [...asToolCalls(m.tool_calls), ...asToolCalls(m._partial_tool_calls, false)]
    groups.push({
      index: i,
      calls,
      key: activityKey(m, calls),
    })
  })
  // Re-key any turn whose folded tool results changed its shape, so the
  // disclosure identity still tracks what it actually contains.
  for (const group of groups) {
    if (group.index >= 0) group.key = `${group.key}::${group.calls.length}`
  }
  if (orphanToolCalls.length > 0) {
    groups.unshift({
      index: -1,
      calls: orphanToolCalls,
      key: `orphan:${orphanToolCalls.map((c) => c.name ?? 'tool').join('|')}`,
    })
  }
  if (liveToolCalls.length > 0) {
    // Normalized copies: the rows must never mutate the live SSE atom, and the
    // stream's payloads deserve the same name/preview resolution as history.
    const live = liveToolCalls.map((c) => normalizeToolCall(c, { settled: false }))
    const liveKey = `live:${live.map((c) => c.name ?? 'tool').slice(0, 8).join('|')}`
    const lastGroup = groups[groups.length - 1]
    if (lastGroup && lastGroup.index >= 0) {
      lastGroup.calls.push(...live)
      lastGroup.key = `${lastGroup.key}::${liveKey}`
    } else {
      groups.push({ index: -1, calls: live, key: liveKey })
    }
  }
  return groups
}

/** Deterministic key for an assistant turn's activity disclosure persistence. */
function activityKey(message: Message, calls: ToolCall[]): string {
  const ts = typeof message.ts === 'number' ? message.ts : 0
  const names = calls.map((c) => c.name ?? '').slice(0, 16).join('|')
  return `${ts}::${names}`
}

function ActivityGroup({
  calls,
  reasoning,
  persistedOpen,
  onTogglePersist,
  hasTools,
}: {
  calls: ToolCall[]
  reasoning: string
  persistedOpen: boolean
  onTogglePersist: () => void
  hasTools: boolean
}) {
  const hasThinking = reasoning !== ''
  if (!hasTools && !hasThinking) return null
  const label = hasTools
    ? `Activity: ${calls.length} ${calls.length === 1 ? 'tool' : 'tools'}`
    : 'Thinking'
  const open = persistedOpen
  const running = calls.some((c) => !c.done && !c.is_error)
  const failed = calls.some((c) => c.is_error)
  // Suffix only when both tool calls and reasoning coexist; otherwise the
  // accessible name matches the contract used by the tests and other callers.
  const fullLabel = hasTools && hasThinking ? `${label} (+thinking)` : label
  return (
    <div
      data-role={hasTools ? 'tool' : 'thinking'}
      data-collapsed={!open}
      // w-full + min-w-0: the disclosure button is shrink-to-fit, but the
      // expanded body holds long reasoning text and tool previews and must be
      // bounded by the transcript column instead of stretching past its edge.
      className="flex w-full min-w-0 flex-col items-start"
    >
      <button
        type="button"
        className={cn(
          'inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 pl-1.5 text-left font-sans text-xs font-medium transition-colors',
          'text-muted-foreground hover:bg-muted hover:text-foreground',
          open && 'text-foreground',
        )}
        aria-expanded={open}
        aria-label={fullLabel}
        onClick={onTogglePersist}
      >
        <Activity
          className={cn(
            'size-3.5 shrink-0',
            running && 'animate-pulse text-warning',
            failed && 'text-destructive',
          )}
        />
        <span>{fullLabel}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        // One quiet rail marks the disclosure's extent; the rows inside are
        // plain, so the transcript never stacks a card inside a card.
        <div className="mt-1 ml-[9px] flex w-[calc(100%-9px)] min-w-0 flex-col border-l border-border pl-3">
          {hasThinking && (
            <div
              data-role="thinking"
              className="mb-1.5 py-0.5 text-xs leading-[1.6] whitespace-pre-wrap text-muted-foreground"
            >
              {reasoning}
            </div>
          )}
          <div className="flex flex-col divide-y divide-border/60">
            {calls.map((call, i) => (
              <ToolCard key={`${call.name ?? 'tool'}-${i}`} call={call} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function asAttachmentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is Record<string, unknown> => v !== null && typeof v === 'object')
    .map((a) => String(a.name ?? a.file_name ?? a.filename ?? a.path ?? ''))
    .filter((s) => s !== '')
}

/** Absolute clock time for a transcript entry, or null when unstamped. */
function formatTime(ts: unknown): string | null {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null
  const date = new Date(ts * 1000)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Copy-to-clipboard affordance for transcript blocks. Hover-revealed to keep
 * the prose calm until the user needs it, and always reachable by keyboard.
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable; silently no-op.
    }
  }
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? 'Copied' : 'Copy message'}
      title={copied ? 'Copied' : 'Copy'}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors',
        'hover:bg-muted hover:text-foreground',
        copied && 'text-success',
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

/**
 * Hover-revealed footer for a turn: timestamp plus per-message actions. Sits in
 * normal flow under the message (the previous absolutely-positioned variant was
 * pushed outside the reading column, where it could overlap the workspace
 * panel and was unreachable at narrow widths).
 */
function MessageMeta({
  time,
  align,
  children,
}: {
  time: string | null
  align: 'start' | 'end'
  children?: React.ReactNode
}) {
  if (!time && !children) return null
  return (
    <div
      className={cn(
        'flex items-center gap-1 text-[11px] text-muted-foreground opacity-0 transition-opacity',
        'group-hover:opacity-100 group-focus-within:opacity-100',
        align === 'end' ? 'justify-end' : 'justify-start',
      )}
    >
      {children}
      {time && <span className="px-1 tabular-nums">{time}</span>}
    </div>
  )
}

function UserMessage({ message }: { message: Message }) {
  const attachments = asAttachmentNames(message.attachments)
  const [expanded, setExpanded] = useState(false)
  const content = message.content ?? ''
  const clamped = content.length > USER_CLAMP_CHARS && !expanded
  const shown = clamped ? `${content.slice(0, USER_CLAMP_CHARS)}…` : content
  return (
    <div data-role="user" className="group flex flex-col items-end justify-end gap-1">
      <div className="flex max-w-[85%] flex-col gap-1.5 rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-sm leading-[1.55] text-secondary-foreground sm:max-w-[80%]">
        {content !== '' && <p className="break-words whitespace-pre-wrap">{shown}</p>}
        {content.length > USER_CLAMP_CHARS && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-fit cursor-pointer text-[11px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {expanded ? 'Show less' : `Show all ${content.length.toLocaleString()} characters`}
          </button>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((name, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] text-foreground"
              >
                <Paperclip className="size-3 shrink-0" />
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
      <MessageMeta time={formatTime(message.ts)} align="end">
        {content !== '' && <CopyButton text={content} />}
      </MessageMeta>
    </div>
  )
}

function AssistantTurn({
  message,
  calls,
  groupKey,
  disclosureState,
  onToggleDisclosure,
}: {
  message: Message
  calls: ToolCall[]
  groupKey: string
  disclosureState: Map<string, boolean>
  onToggleDisclosure: (key: string) => void
}) {
  const reasoning = typeof message.reasoning === 'string' ? message.reasoning : ''
  return (
    <div data-role="assistant" className="group flex flex-col gap-2">
      {message.content !== '' && <Markdown content={message.content} prose />}
      <ActivityGroup
        calls={calls}
        reasoning={reasoning}
        persistedOpen={disclosureState.get(groupKey) ?? false}
        onTogglePersist={() => onToggleDisclosure(groupKey)}
        hasTools={calls.length > 0}
      />
      {message.content !== '' && (
        <MessageMeta time={formatTime(message.ts)} align="start">
          <CopyButton text={message.content} />
        </MessageMeta>
      )}
    </div>
  )
}

function SystemRow({ message }: { message: Message }) {
  return (
    <div
      data-role={message.role === 'system' ? 'system' : message.role}
      className="max-w-[60ch] self-center text-center text-[11px] text-muted-foreground"
    >
      {message.content}
    </div>
  )
}

function CompressionDivider({ phase }: { phase: LiveCompressionPhase }) {
  const label = phase === 'running' ? 'Compressing context' : 'Context auto-compressed'
  return (
    <div
      data-role="compression"
      className="flex items-center gap-3 py-1 text-[11px] text-muted-foreground"
      aria-label={label}
    >
      <hr className="flex-1 border-t border-border" />
      <span className="font-sans tracking-wide whitespace-nowrap uppercase">{label}</span>
      <hr className="flex-1 border-t border-border" />
    </div>
  )
}

/**
 * Tail-of-transcript "the agent is working" affordance. Without it a turn that
 * has been dispatched but has not produced its first token looks like a UI that
 * swallowed the message.
 */
function WorkingIndicator() {
  return (
    <div
      data-testid="working-indicator"
      data-role="working"
      role="status"
      aria-label="Hermes is working"
      className="flex items-center gap-2 text-xs text-muted-foreground"
    >
      <span className="flex gap-1" aria-hidden="true">
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current" />
      </span>
      <span>Working…</span>
    </div>
  )
}

export function MessageList({
  messages,
  liveToolCalls = [],
  liveCompression = null,
  streaming = false,
  className,
}: MessageListProps) {
  const turnGroups = useMemo(
    () => buildTurnGroups(messages, liveToolCalls),
    [messages, liveToolCalls],
  )
  const callsByIndex = useMemo(() => {
    const map = new Map<number, { calls: ToolCall[]; key: string }>()
    for (const group of turnGroups) {
      if (group.index === -1) continue
      map.set(group.index, { calls: group.calls, key: group.key })
    }
    return map
  }, [turnGroups])

  // Persistent open/closed state for activity disclosures (DESIGN.md).
  const [disclosureState, setDisclosureState] = useState<Map<string, boolean>>(() => new Map())
  const onToggleDisclosure = (key: string) => {
    setDisclosureState((prev) => {
      const next = new Map(prev)
      next.set(key, !(prev.get(key) ?? false))
      return next
    })
  }

  const orphanGroups = turnGroups.filter((g) => g.index === -1)
  const leadingGroup = orphanGroups.find((g) => g.key.startsWith('orphan:'))
  const trailingGroup = orphanGroups.find((g) => !g.key.startsWith('orphan:'))

  // The tail affordance is only useful before the turn has produced text; once
  // tokens are landing the growing prose is its own progress indicator.
  const lastMessage = messages[messages.length - 1]
  const showWorking =
    streaming &&
    liveToolCalls.length === 0 &&
    !liveCompression &&
    !(lastMessage?.role === 'assistant' && (lastMessage.content ?? '') !== '')

  if (
    messages.length === 0 &&
    liveToolCalls.length === 0 &&
    !liveCompression &&
    !streaming
  ) {
    return (
      <div
        className={cn('flex flex-col items-center justify-center gap-2 text-center', className)}
        data-testid="message-list"
      >
        <div className="text-sm font-medium text-foreground">Start a conversation</div>
        <p className="max-w-sm text-xs text-muted-foreground">
          Ask a question, give the agent a task, or type <code className="rounded bg-muted px-1">/</code> to
          browse slash commands. Your conversation appears here.
        </p>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-5', className)} data-testid="message-list">
      {leadingGroup && (
        <ActivityGroup
          calls={leadingGroup.calls}
          reasoning=""
          persistedOpen={disclosureState.get(leadingGroup.key) ?? false}
          onTogglePersist={() => onToggleDisclosure(leadingGroup.key)}
          hasTools
        />
      )}
      {messages.map((message, i) => {
        if (message.role === 'user') return <UserMessage key={i} message={message} />
        if (message.role === 'assistant') {
          const group = callsByIndex.get(i) ?? { calls: [], key: `turn-${i}` }
          return (
            <AssistantTurn
              key={i}
              message={message}
              calls={group.calls}
              groupKey={group.key}
              disclosureState={disclosureState}
              onToggleDisclosure={onToggleDisclosure}
            />
          )
        }
        // `role: "tool"` entries are folded into their owning turn's activity
        // disclosure by buildTurnGroups and never render a row of their own.
        if (message.role === 'tool') return null
        return <SystemRow key={i} message={message} />
      })}
      {trailingGroup && (
        <ActivityGroup
          calls={trailingGroup.calls}
          reasoning=""
          persistedOpen={disclosureState.get(trailingGroup.key) ?? true}
          onTogglePersist={() => onToggleDisclosure(trailingGroup.key)}
          hasTools
        />
      )}
      {liveCompression && <CompressionDivider phase={liveCompression} />}
      {showWorking && <WorkingIndicator />}
    </div>
  )
}

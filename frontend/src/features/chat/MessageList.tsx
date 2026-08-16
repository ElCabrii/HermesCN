import { useMemo, useState } from 'react'
import { Activity, ChevronDown, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Message } from './chatStore'
import { Markdown } from './Markdown'
import { ToolCard, type ToolCall } from './ToolCard'

/**
 * Chat transcript (DESIGN.md contract):
 * - Assistant prose: left-aligned, prose-first, serif stack, NO heavy bubble.
 * - User messages: right-aligned compact bubble, sans stack.
 * - Tool calls: debug event rows grouped per assistant turn behind ONE terse
 *   "Activity: N tools" disclosure — never first-class cards in the collapsed
 *   state, no redundant trailing count badges.
 * - Thinking/context traces: same quiet metadata family as tool rows.
 * - Compression events: centered non-interactive text between horizontal rules.
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
  className?: string
}

function asToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is ToolCall => v !== null && typeof v === 'object')
}

interface TurnGroup {
  /** Index of the owning assistant message in `messages`, or -1 for a live-only trailing group. */
  index: number
  calls: ToolCall[]
}

/**
 * Group tool calls per assistant turn, anchored to the owning assistant
 * message (legacy convention). Live SSE tool events join the LAST assistant
 * turn; with no assistant message yet they form a trailing group.
 */
function buildTurnGroups(messages: Message[], liveToolCalls: LiveToolCall[]): TurnGroup[] {
  const groups: TurnGroup[] = []
  let lastAssistant = -1
  messages.forEach((m, i) => {
    if (m.role !== 'assistant') return
    lastAssistant = i
    groups.push({
      index: i,
      calls: [...asToolCalls(m.tool_calls), ...asToolCalls(m._partial_tool_calls)],
    })
  })
  if (liveToolCalls.length > 0) {
    if (lastAssistant >= 0) {
      const group = groups[groups.length - 1]
      if (group) group.calls.push(...liveToolCalls)
    } else {
      groups.push({ index: -1, calls: [...liveToolCalls] })
    }
  }
  return groups
}

function ActivityGroup({ calls, reasoning }: { calls: ToolCall[]; reasoning: string }) {
  const [open, setOpen] = useState(false)
  const hasTools = calls.length > 0
  const hasThinking = reasoning !== ''
  if (!hasTools && !hasThinking) return null
  const label = hasTools
    ? `Activity: ${calls.length} ${calls.length === 1 ? 'tool' : 'tools'}`
    : 'Thinking'
  return (
    <div
      data-role={hasTools ? 'tool' : 'thinking'}
      data-collapsed={!open}
      className="activity-group"
    >
      <button
        type="button"
        className="activity-summary"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Activity className="size-3.5 shrink-0" />
        <span className="activity-label">{label}</span>
        <ChevronDown className={cn('size-3.5 shrink-0', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="activity-body">
          {hasThinking && (
            <div data-role="thinking" className="thinking-body">
              {reasoning}
            </div>
          )}
          {calls.map((call, i) => (
            <ToolCard key={`${call.name ?? 'tool'}-${i}`} call={call} />
          ))}
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

function UserMessage({ message }: { message: Message }) {
  const attachments = asAttachmentNames(message.attachments)
  return (
    <div data-role="user" className="flex justify-end">
      <div className="user-bubble">
        {message.content !== '' && (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        )}
        {attachments.length > 0 && (
          <div className="attachment-list">
            {attachments.map((name, i) => (
              <span key={i} className="attachment-chip">
                <Paperclip className="size-3 shrink-0" />
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AssistantTurn({ message, calls }: { message: Message; calls: ToolCall[] }) {
  const reasoning = typeof message.reasoning === 'string' ? message.reasoning : ''
  return (
    <div data-role="assistant" className="flex flex-col gap-2">
      {message.content !== '' && (
        <div className="prose" data-prose="true">
          <Markdown content={message.content} />
        </div>
      )}
      <ActivityGroup calls={calls} reasoning={reasoning} />
    </div>
  )
}

function ToolResultRow({ message }: { message: Message }) {
  const name = typeof message.name === 'string' && message.name !== '' ? message.name : 'tool'
  return <ToolCard call={{ name, result: message.content, done: true }} />
}

function SystemRow({ message }: { message: Message }) {
  return (
    <div data-role={message.role === 'system' ? 'system' : message.role} className="system-row">
      {message.content}
    </div>
  )
}

function CompressionDivider({ phase }: { phase: LiveCompressionPhase }) {
  const label = phase === 'running' ? 'Compressing context' : 'Context auto-compressed'
  return (
    <div data-role="compression" className="compression-divider" aria-label={label}>
      <hr className="compression-rule" />
      <span className="compression-label">{label}</span>
      <hr className="compression-rule" />
    </div>
  )
}

export function MessageList({
  messages,
  liveToolCalls = [],
  liveCompression = null,
  className,
}: MessageListProps) {
  const turnGroups = useMemo(() => buildTurnGroups(messages, liveToolCalls), [messages, liveToolCalls])
  const callsByIndex = useMemo(() => {
    const map = new Map<number, ToolCall[]>()
    for (const group of turnGroups) map.set(group.index, group.calls)
    return map
  }, [turnGroups])

  return (
    <div className={cn('flex flex-col gap-3', className)} data-testid="message-list">
      {messages.map((message, i) => {
        if (message.role === 'user') return <UserMessage key={i} message={message} />
        if (message.role === 'assistant') {
          return <AssistantTurn key={i} message={message} calls={callsByIndex.get(i) ?? []} />
        }
        if (message.role === 'tool') return <ToolResultRow key={i} message={message} />
        return <SystemRow key={i} message={message} />
      })}
      {callsByIndex.has(-1) && <ActivityGroup calls={callsByIndex.get(-1) ?? []} reasoning="" />}
      {liveCompression && <CompressionDivider phase={liveCompression} />}
    </div>
  )
}

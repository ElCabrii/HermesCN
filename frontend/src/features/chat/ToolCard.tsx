import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * One tool call rendered as a DEBUG EVENT ROW (DESIGN.md), not a chat message:
 * status glyph first, then name + short target/preview on one quiet row.
 * Arguments and result snippets live behind an expansion; long content is
 * truncated with a "show more" toggle for full logs. Live (in-flight) and
 * settled calls share the same shape — `done: false` / missing means running.
 *
 * The row carries no surface of its own. It always renders inside the turn's
 * activity disclosure, which already supplies the container, and giving each
 * row a border plus a fill produced exactly the stack of nested rounded
 * rectangles DESIGN.md tells us to avoid.
 */

export type ToolStatus = 'running' | 'done' | 'error'

export interface ToolCall {
  name?: string
  args?: unknown
  preview?: string
  snippet?: string
  result?: string
  done?: boolean
  is_error?: boolean
  duration?: number
  [key: string]: unknown
}

/** Result snippets are truncated after this many characters; full logs behind "show more". */
const MAX_SNIPPET = 400

function statusOf(call: ToolCall): ToolStatus {
  if (call.is_error) return 'error'
  if (call.done) return 'done'
  return 'running'
}

function stringifyArgs(args: unknown): string {
  if (typeof args === 'string') return args
  if (args === undefined || args === null) return ''
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

function StatusIcon({ status }: { status: ToolStatus }) {
  if (status === 'running') {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-warning" />
  }
  if (status === 'error') {
    return <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
  }
  return <Check className="size-3.5 shrink-0 text-success" />
}

export function ToolCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false)
  const [showMore, setShowMore] = useState(false)

  const name = call.name && call.name.trim() !== '' ? call.name : 'tool'
  const status = statusOf(call)
  const preview = call.preview ?? call.snippet ?? ''
  const argsText = stringifyArgs(call.args)
  const resultText = call.result ?? (call.done ? (call.snippet ?? '') : '')
  const argsTruncated = argsText.length > MAX_SNIPPET
  const resultTruncated = resultText.length > MAX_SNIPPET
  const anyTruncated = argsTruncated || resultTruncated
  const clip = (text: string) =>
    showMore ? text : text.length > MAX_SNIPPET ? `${text.slice(0, MAX_SNIPPET)}…` : text

  return (
    <div
      data-role="tool"
      data-tool-name={name}
      data-tool-status={status}
      data-collapsed={!open}
      className="flex flex-col"
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1.5 text-left font-sans transition-colors hover:bg-muted/60"
        aria-expanded={open}
        aria-label={`${name} details`}
        onClick={() => setOpen((o) => !o)}
      >
        <StatusIcon status={status} />
        <span className="shrink-0 font-mono text-[11px] font-medium text-foreground">{name}</span>
        {preview !== '' && <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{preview}</span>}
        <span className="flex-1" />
        {typeof call.duration === 'number' && (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{call.duration}s</span>
        )}
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 px-1.5 pt-0.5 pb-2">
          {argsText !== '' && (
            <div className="flex flex-col gap-0.5">
              <div className="text-[11px] font-semibold text-muted-foreground">Arguments</div>
              <pre className="m-0 max-h-80 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-[1.5] break-words whitespace-pre-wrap">
                {clip(argsText)}
              </pre>
            </div>
          )}
          {resultText !== '' && (
            <div className="flex flex-col gap-0.5">
              <div className="text-[11px] font-semibold text-muted-foreground">Result</div>
              <pre className="m-0 max-h-80 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-[1.5] break-words whitespace-pre-wrap">
                {clip(resultText)}
              </pre>
            </div>
          )}
          {anyTruncated && (
            <button
              type="button"
              className="cursor-pointer self-start p-0 text-[11px] text-accent underline underline-offset-2"
              onClick={() => setShowMore((s) => !s)}
            >
              {showMore ? 'show less' : 'show more'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

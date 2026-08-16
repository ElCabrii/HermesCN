import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * One tool call rendered as a DEBUG EVENT ROW (DESIGN.md), not a chat message:
 * status glyph first, then name + short target/preview on one quiet row.
 * Arguments and result snippets live behind an expansion; long content is
 * truncated with a "show more" toggle for full logs. Live (in-flight) and
 * settled calls share the same shape — `done: false` / missing means running.
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
      className="tool-row"
    >
      <button
        type="button"
        className="tool-row-toggle"
        aria-expanded={open}
        aria-label={`${name} details`}
        onClick={() => setOpen((o) => !o)}
      >
        <StatusIcon status={status} />
        <span className="tool-name">{name}</span>
        {preview !== '' && <span className="tool-preview">{preview}</span>}
        {typeof call.duration === 'number' && (
          <span className="tool-duration">{call.duration}s</span>
        )}
        <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="tool-detail">
          {argsText !== '' && (
            <div className="tool-section">
              <div className="tool-section-label">Arguments</div>
              <pre className="tool-code">{clip(argsText)}</pre>
            </div>
          )}
          {resultText !== '' && (
            <div className="tool-section">
              <div className="tool-section-label">Result</div>
              <pre className="tool-code">{clip(resultText)}</pre>
            </div>
          )}
          {anyTruncated && (
            <button
              type="button"
              className="tool-show-more"
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

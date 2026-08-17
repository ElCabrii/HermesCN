import { cn } from '@/lib/utils'

/**
 * Circular context-usage meter for the composer.
 *
 * The composer previously showed a bare percentage pill that read "—" whenever
 * usage was unknown, which is both the most common state and the least
 * informative thing to print. A ring carries the same number pre-attentively:
 * you read the arc without reading the digits, and the colour changes only when
 * the number starts to matter. Semantic colours are used as state, not
 * decoration (DESIGN.md) — neutral until 75%, warning at 75%, destructive at
 * 90%, where the conversation is close to being compressed.
 */

const SIZE = 22
const STROKE = 2.5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export interface ContextRingProps {
  /** Percent of the context window in use, or null when the model is unknown. */
  pct: number | null
  /** Absolute token counts for the tooltip, when the session reports them. */
  detail?: string | null
  className?: string
}

export function ContextRing({ pct, detail, className }: ContextRingProps) {
  const known = pct != null
  const value = known ? Math.min(100, Math.max(0, pct)) : 0
  const tone =
    !known ? 'text-muted-foreground/50'
    : value >= 90 ? 'text-destructive'
    : value >= 75 ? 'text-warning'
    : 'text-muted-foreground'

  const title = known
    ? `Context: ${value}% used${detail ? ` — ${detail}` : ''}`
    : 'Context usage unknown until the first turn'

  return (
    <span
      data-testid="context-usage"
      data-context-pct={known ? value : undefined}
      title={title}
      aria-label={title}
      role="img"
      className={cn('relative flex size-7 shrink-0 items-center justify-center', tone, className)}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          className="opacity-20"
        />
        {known && (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - value / 100)}
            // Rotate so the arc starts at 12 o'clock and fills clockwise.
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            className="transition-[stroke-dashoffset] duration-500 ease-out"
          />
        )}
      </svg>
      {/* The digits stay available for anyone who wants the exact figure, but
          only once the ring is worth reading precisely. */}
      {known && value >= 75 && (
        <span className="absolute font-mono text-[8px] leading-none font-semibold tabular-nums">
          {value}
        </span>
      )}
    </span>
  )
}

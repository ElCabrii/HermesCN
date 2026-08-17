import { useCallback, useEffect, useState } from 'react'
import { Loader2Icon, RefreshCwIcon } from 'lucide-react'
import { getInsights, type InsightsResponse } from '@/api/insights'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Insights tab of the Control Center.
 *
 * Port of the legacy Settings → Insights section (static/panels.js
 * `loadInsights`), which the React remake dropped. The backend contract is
 * typed in `@/api/insights` (verified against api/routes.py
 * `_handle_insights`):
 *
 * - a period selector (7/30/90/365 days) that refetches the window,
 * - summary stat cards (sessions, messages, total tokens, cost, cache hit),
 * - a simple CSS-bar daily-token chart (no charting dependency),
 * - a per-model breakdown (tokens, cost, cost share).
 *
 * The panel reloads whenever the period changes or the refresh button is
 * pressed, so the cards always reflect the server's current aggregation.
 */

const PERIODS = [7, 30, 90, 365] as const

// ── formatting helpers ──────────────────────────────────────────────────────

function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString()
}

function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `$${n.toFixed(2)}`
}

function fmtPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${Math.max(0, Math.min(100, Math.round(n)))}%`
}

// ── summary stat card ───────────────────────────────────────────────────────

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-lg font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

// ── daily token chart (CSS bars, no charting dependency) ───────────────────

function DailyChart({ daily }: { daily: InsightsResponse['daily_tokens'] }) {
  const max = Math.max(...daily.map((d) => d.input_tokens + d.output_tokens), 1e-9)
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">Daily tokens</div>
      <div className="mt-2 flex h-20 items-end gap-1">
        {daily.map((d) => {
          const total = d.input_tokens + d.output_tokens
          const pct = total > 0 ? Math.max((total / max) * 100, 2) : 0
          return (
            <div
              key={d.date}
              title={`${d.date} · ${fmtInt(total)} tokens · ${d.sessions} session${d.sessions === 1 ? '' : 's'}`}
              className="flex flex-1 flex-col items-center gap-0.5"
            >
              <div className="flex w-full flex-1 items-end">
                <div className="w-full rounded-t bg-accent/70" style={{ height: `${pct}%` }} />
              </div>
              <span className="text-[9px] text-muted-foreground">{d.date.slice(5)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── panel ──────────────────────────────────────────────────────────────────

export function InsightsPanel() {
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<InsightsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (d: number) => {
    setLoading(true)
    setError(null)
    try {
      setData(await getInsights(d))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load insights.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(days)
  }, [days, load])

  const refresh = () => void load(days)

  if (error && !data) {
    return <p className="px-1 text-sm text-destructive">{error}</p>
  }

  if (!data) {
    return (
      <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" /> Loading insights…
      </p>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto pr-0.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="Insights period">
          {PERIODS.map((p) => (
            <Button
              key={p}
              variant={p === days ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setDays(p)}
              aria-pressed={p === days}
            >
              {p}d
            </Button>
          ))}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Refresh insights" onClick={refresh} disabled={loading}>
          <RefreshCwIcon className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatCard label="Sessions" value={fmtInt(data.total_sessions)} />
        <StatCard label="Messages" value={fmtInt(data.total_messages)} />
        <StatCard label="Total tokens" value={fmtInt(data.total_tokens)} />
        <StatCard label="Cost" value={fmtMoney(data.total_cost)} />
        <StatCard label="Cache hit" value={fmtPercent(data.total_cache_hit_percent)} />
      </div>

      <DailyChart daily={data.daily_tokens} />

      {data.models.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="text-xs font-medium text-muted-foreground">By model</div>
          <div className="mt-2 space-y-1.5">
            {data.models.map((m) => (
              <div key={m.model} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-mono">{m.model}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {fmtInt(m.total_tokens)} tokens · {fmtMoney(m.cost)}
                </span>
                <Badge variant="outline" className="shrink-0">
                  {m.cost_share}%
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

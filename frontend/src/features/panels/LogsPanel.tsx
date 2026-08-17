import { useCallback, useEffect, useState } from 'react'
import { Loader2Icon, RefreshCwIcon } from 'lucide-react'
import {
  getLogs,
  LOG_FILE_KEYS,
  LOG_TAIL_VALUES,
  type LogFileKey,
  type LogsResponse,
  type LogTail,
} from '@/api/logs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { NativeSelect } from '@/components/ui/native-select'

/**
 * Logs tab of the Control Center: a bounded tail viewer for the active
 * profile's Hermes log files (agent / errors / gateway).
 *
 * Port of the legacy Logs panel (static/panels.js `loadLogs`): a file
 * selector, a tail-size selector, a scrollable monospace view of the last N
 * lines, a "truncated" badge when the file exceeds the server's read cap, and
 * a manual refresh. Re-fetches whenever the selectors change.
 */

const FILE_LABELS: Record<LogFileKey, string> = {
  agent: 'Agent',
  errors: 'Errors',
  gateway: 'Gateway',
}

function fmtMtime(mtime: number | null): string {
  if (mtime === null || mtime === undefined) return ''
  const d = new Date(mtime * 1000)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return d.toLocaleString()
  } catch {
    return ''
  }
}

export function LogsPanel() {
  const [file, setFile] = useState<LogFileKey>('agent')
  const [tail, setTail] = useState<LogTail>(200)
  const [data, setData] = useState<LogsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (f: LogFileKey, t: LogTail) => {
    setRefreshing(true)
    try {
      const res = await getLogs(f, t)
      setData(res)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load logs.')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(file, tail)
  }, [file, tail, load])

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">File</label>
        <NativeSelect
          aria-label="Log file"
          className="h-8 text-xs" containerClassName="w-auto"
          value={file}
          onChange={(e) => setFile(e.target.value as LogFileKey)}
        >
          {LOG_FILE_KEYS.map((k) => (
            <option key={k} value={k}>
              {FILE_LABELS[k]}
            </option>
          ))}
        </NativeSelect>

        <label className="text-xs text-muted-foreground">Lines</label>
        <NativeSelect
          aria-label="Tail size"
          className="h-8 text-xs" containerClassName="w-auto"
          value={tail}
          onChange={(e) => setTail(Number(e.target.value) as LogTail)}
        >
          {LOG_TAIL_VALUES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </NativeSelect>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2 text-xs"
          onClick={() => void load(file, tail)}
          disabled={refreshing}
        >
          <RefreshCwIcon className={cn('size-3', refreshing && 'animate-spin')} />
          Refresh
        </Button>

        {data?.truncated && (
          <Badge variant="outline" className="gap-1">
            Truncated
          </Badge>
        )}
        {data?.mtime != null && (
          <span className="text-[11px] text-muted-foreground">Modified {fmtMtime(data.mtime)}</span>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!data && !error && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" /> Loading logs…
        </p>
      )}

      {data && data.lines.length === 0 && (
        <p className="text-xs text-muted-foreground">{data.hint || 'No log lines yet.'}</p>
      )}

      {data && data.lines.length > 0 && (
        <pre className="min-h-0 flex-1 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
          {data.lines.join('\n')}
        </pre>
      )}
    </div>
  )
}

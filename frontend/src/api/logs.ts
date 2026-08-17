import { api } from './client'
import type { JsonObject } from './types'

/**
 * Logs API client: bounded tail windows for the active profile's Hermes log
 * files. Contract verified against `api/routes.py` `_handle_logs` (and the
 * legacy `static/panels.js` `loadLogs` it served).
 */

/** Whitelisted log file keys (routes.py `_LOG_FILE_WHITELIST`). */
export const LOG_FILE_KEYS = ['agent', 'errors', 'gateway'] as const
export type LogFileKey = (typeof LOG_FILE_KEYS)[number]

/** Allowed tail window sizes (routes.py `_LOG_TAIL_VALUES`). */
export const LOG_TAIL_VALUES = [100, 200, 500, 1000] as const
export type LogTail = (typeof LOG_TAIL_VALUES)[number]

/**
 * GET /api/logs response. `mtime` is a unix timestamp (float seconds) or null
 * when the file does not exist yet; `hint` carries a human message when the
 * file is missing. `truncated` is true when the file exceeds the server's
 * 4 MiB read cap (so the window is a tail of the tail).
 */
export interface LogsResponse extends JsonObject {
  file: string
  tail: number
  lines: string[]
  truncated: boolean
  total_bytes: number
  mtime: number | null
  hint: string | null
}

/** Fetch a bounded tail window for a whitelisted Hermes log file. */
export function getLogs(file: LogFileKey = 'agent', tail: LogTail = 200): Promise<LogsResponse> {
  return api<LogsResponse>(`/api/logs?file=${encodeURIComponent(file)}&tail=${tail}`, {
    credentials: 'include',
  })
}

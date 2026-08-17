import { api } from './client'
import type { JsonObject } from './types'

/**
 * Updates API client: self-update check, What's New summary, and the
 * apply / force / clear-lock mutation endpoints.
 *
 * Every contract below was verified against the handlers in `api/routes.py`
 * and `api/updates.py`.
 *
 * NOTE — "force" is overloaded in the backend:
 *   - `checkUpdates(force)` hits GET /api/updates/check (the server returns
 *     its cached status; the query flag is accepted but the route does not
 *     currently force a re-fetch — it exists for parity with the legacy
 *     "Check now" affordance).
 *   - `forceUpdateCheck()` maps to POST /api/updates/force, which is the
 *     DESTRUCTIVE "discard local changes and force-update" action, NOT a
 *     re-check. It is exported for completeness but is not wired into the
 *     Settings UI.
 */

/** One repo's update status row (webui or agent) in GET /api/updates/check. */
export interface UpdateRepoInfo extends JsonObject {
  name?: string
  behind?: number
  current_sha?: string | null
  latest_sha?: string | null
  branch?: string | null
  repo_url?: string | null
  compare_url?: string | null
  release_based?: boolean
  current_version?: string | null
  latest_version?: string | null
  channel?: string
  error?: string
  ignored?: boolean
}

/**
 * GET /api/updates/check response (`cached_update_status`). When
 * `check_for_updates` is disabled the server returns `{ disabled: true }`.
 */
export interface UpdateStatusResponse extends JsonObject {
  webui?: UpdateRepoInfo
  agent?: UpdateRepoInfo
  checked_at?: number
  include_agent?: boolean
  channel?: string
  cached?: boolean
  stale_channel?: boolean
  disabled?: boolean
}

/** One summarized target in POST /api/updates/summary (`targets`). */
export interface UpdateSummaryTarget extends JsonObject {
  name: string
  label: string
  behind: number
  current_sha?: string | null
  latest_sha?: string | null
  compare_url?: string | null
  commits: string[]
  commits_limit: number
  commits_truncated: boolean
}

/** POST /api/updates/summary response (`summarize_update_payload`). */
export interface UpdateSummaryResponse extends JsonObject {
  ok: boolean
  summary?: string
  summary_sections?: unknown[]
  generated_by?: string
  cached?: boolean
  cache_key?: string
  target?: string | null
  targets?: UpdateSummaryTarget[]
}

/**
 * POST /api/updates/apply | force | clear_lock response. The exact fields
 * vary by endpoint and outcome (`lock_conflict`, `lock_held`, `up_to_date`,
 * `refused_rewind`, `restart_scheduled`, `manual_command`, ...).
 */
export interface UpdateMutationResponse extends JsonObject {
  ok: boolean
  message?: string
  target?: string
  channel?: string
  restart_scheduled?: boolean
  up_to_date?: boolean
  lock_conflict?: boolean
  lock_held?: boolean
  refused_rewind?: boolean
  manual_command?: string
  restart_blocked?: boolean
  error?: string
}

/** Fetch the cached update status for the webui and agent repos. */
export function checkUpdates(force = false): Promise<UpdateStatusResponse> {
  return api<UpdateStatusResponse>(`/api/updates/check${force ? '?force=1' : ''}`, {
    credentials: 'include',
  })
}

/** Build a human-readable "What's New" summary for the given update status. */
export function getUpdatesSummary(
  updates: JsonObject,
  target?: string,
): Promise<UpdateSummaryResponse> {
  return api<UpdateSummaryResponse>('/api/updates/summary', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ updates, target }),
  })
}

/** Apply a pending update (stash, pull --ff-only, pop) for a target repo. */
export function applyUpdate(
  target: 'webui' | 'agent',
  channel?: string,
): Promise<UpdateMutationResponse> {
  return api<UpdateMutationResponse>('/api/updates/apply', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ target, channel }),
  })
}

/**
 * DESTRUCTIVE force-update: discard local changes and reset to the selected
 * ref for a target repo. This is NOT a re-check — see the module note.
 */
export function forceUpdateCheck(
  target: 'webui' | 'agent',
  channel?: string,
): Promise<UpdateMutationResponse> {
  return api<UpdateMutationResponse>('/api/updates/force', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ target, channel }),
  })
}

/** Clear a git lock conflict for a target repo (non-destructive recovery). */
export function clearUpdateLock(target: 'webui' | 'agent'): Promise<UpdateMutationResponse> {
  return api<UpdateMutationResponse>('/api/updates/clear_lock', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ target }),
  })
}

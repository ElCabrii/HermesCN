import { api } from './client'
import type { JsonObject } from './types'

/**
 * Panels API client: crons (Tasks), skills, memory, profiles, and settings.
 *
 * Every contract below was verified against the handlers in `api/routes.py`
 * (and the legacy `static/panels.js` it serves).
 *
 * NOTE — todos: there is NO `/api/todo` endpoint. The legacy todo panel
 * derives todos from tool-call results in the session transcript
 * client-side (the backend only attaches todo state onto session payloads
 * via `api/todo_state.attach_todo_state`). Do not invent an endpoint here.
 */

function qs(params: Record<string, string | number | undefined>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

// ── Crons (Tasks panel) ────────────────────────────────────────────────────

/** A cron schedule descriptor (`kind`: cron/interval/at/script, ...). */
export interface CronSchedule extends JsonObject {
  kind?: string
  expression?: string
}

/**
 * A cron job row. Persisted job dicts are passed through with UI settings
 * normalized (`toast_notifications` defaults true, `profile` defaults null);
 * cross-profile listings add `owner_profile` and `read_only`.
 */
export interface CronJob extends JsonObject {
  id: string
  name?: string | null
  schedule?: CronSchedule | null
  schedule_display?: string | null
  enabled?: boolean
  state?: string | null
  next_run_at?: string | null
  last_run_at?: string | null
  last_status?: string | null
  last_error?: string | null
  last_delivery_error?: string | null
  repeat?: unknown
  deliver?: string | null
  skills?: string[]
  prompt?: string | null
  model?: string | null
  provider?: string | null
  profile?: string | null
  owner_profile?: string
  read_only?: boolean
  toast_notifications?: boolean
}

/** GET /api/crons response. `cron_unavailable` is set in split-container deployments. */
export interface CronsResponse extends JsonObject {
  jobs: CronJob[]
  all_profiles?: boolean
  active_profile?: string
  other_profile_count?: number
  cron_unavailable?: boolean
}

/** One cron output file (content is a windowed excerpt). */
export interface CronOutputFile extends JsonObject {
  filename: string
  content: string
}

/** GET /api/crons/output response. */
export interface CronOutputResponse extends JsonObject {
  job_id: string
  outputs: CronOutputFile[]
}

/** Optional token/cost metadata parsed from a cron run output file. */
export interface CronRunUsage extends JsonObject {
  model?: string
  provider?: string
  estimated_cost_usd?: number
  duration_seconds?: number
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

/** One entry in GET /api/crons/history (metadata only, no content). */
export interface CronRun extends JsonObject {
  filename: string
  size: number
  modified: number
  usage: CronRunUsage
}

/** GET /api/crons/history response. */
export interface CronHistoryResponse extends JsonObject {
  job_id: string
  runs: CronRun[]
  total: number
  offset: number
}

/** GET /api/crons/run (detail) response — full content of a single run file. */
export interface CronRunDetail extends JsonObject {
  job_id: string
  filename: string
  content: string
  snippet: string
  usage: CronRunUsage
}

/** GET /api/crons/status response for a single job. */
export interface CronJobStatus extends JsonObject {
  job_id: string
  running: boolean
  elapsed: number
}

/** GET /api/crons/status response for all jobs (job_id → elapsed seconds). */
export interface CronAllStatus extends JsonObject {
  running: Record<string, number>
}

export type CronStatus = CronJobStatus | CronAllStatus

/** A delivery platform option for cron jobs. */
export interface CronDeliveryPlatform extends JsonObject {
  value: string
  label: string
}

/** GET /api/crons/delivery-options response. */
export interface CronDeliveryOptionsResponse extends JsonObject {
  platforms: CronDeliveryPlatform[]
}

/** One completed cron run in GET /api/crons/recent. */
export interface CronCompletion extends JsonObject {
  job_id: string
  name: string
  status: string
  completed_at: number
  toast_notifications: boolean
  session_id?: string
  message_count?: number
}

/** GET /api/crons/recent response. */
export interface CronRecentResponse extends JsonObject {
  completions: CronCompletion[]
  since: number
}

/** Fields accepted by POST /api/crons/create. */
export interface CreateCronParams extends JsonObject {
  prompt: string
  schedule: string
  name?: string
  deliver?: string
  skills?: string[]
  model?: string | null
  provider?: string | null
  profile?: string
  toast_notifications?: boolean
}

/** Fields accepted by POST /api/crons/update (partial; `job_id` required). */
export interface CronUpdateParams extends JsonObject {
  job_id: string
  name?: string
  prompt?: string
  schedule?: string
  schedule_display?: string
  deliver?: string
  skills?: string[]
  model?: string | null
  provider?: string | null
  profile?: string
  enabled?: boolean
  toast_notifications?: boolean
}

/** POST /api/crons/create|update|pause|resume response. */
export interface CronMutationResponse extends JsonObject {
  ok: true
  job: CronJob
}

/** POST /api/crons/delete response. */
export interface CronDeleteResponse extends JsonObject {
  ok: true
  job_id: string
}

/** POST /api/crons/run response (may report `already_running`). */
export interface CronRunResponse extends JsonObject {
  ok: boolean
  job_id: string
  status: string
  elapsed?: number
}

/** List cron jobs; `allProfiles` requests rows from every profile. */
export function getCrons(opts: { allProfiles?: boolean } = {}): Promise<CronsResponse> {
  const query = qs({ all_profiles: opts.allProfiles ? 1 : undefined })
  return api<CronsResponse>(`/api/crons${query}`, { credentials: 'include' })
}

/** List a job's output files (newest first, content windowed). */
export function getCronOutput(jobId: string, limit = 5): Promise<CronOutputResponse> {
  return api<CronOutputResponse>(`/api/crons/output${qs({ job_id: jobId, limit })}`, {
    credentials: 'include',
  })
}

/** List a job's run history (metadata only, paginated). */
export function getCronHistory(
  jobId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<CronHistoryResponse> {
  return api<CronHistoryResponse>(
    `/api/crons/history${qs({ job_id: jobId, limit: opts.limit ?? 50, offset: opts.offset ?? 0 })}`,
    { credentials: 'include' },
  )
}

/** Fetch the full content of a single cron run output file. */
export function getCronRunDetail(jobId: string, filename: string): Promise<CronRunDetail> {
  return api<CronRunDetail>(`/api/crons/run${qs({ job_id: jobId, filename })}`, {
    credentials: 'include',
  })
}

/** Report whether a job is running (all jobs when `jobId` is omitted). */
export function getCronStatus(jobId?: string): Promise<CronStatus> {
  return api<CronStatus>(`/api/crons/status${qs({ job_id: jobId })}`, { credentials: 'include' })
}

/** List the delivery platforms available for cron jobs. */
export function getCronDeliveryOptions(): Promise<CronDeliveryOptionsResponse> {
  return api<CronDeliveryOptionsResponse>('/api/crons/delivery-options', { credentials: 'include' })
}

/** List cron jobs that completed since a unix timestamp. */
export function getCronRecent(since: number): Promise<CronRecentResponse> {
  return api<CronRecentResponse>(`/api/crons/recent${qs({ since })}`, { credentials: 'include' })
}

/** Create a cron job. */
export function createCron(params: CreateCronParams): Promise<CronMutationResponse> {
  return api<CronMutationResponse>('/api/crons/create', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(params),
  })
}

/** Update a cron job with partial fields. */
export function updateCron(params: CronUpdateParams): Promise<CronMutationResponse> {
  return api<CronMutationResponse>('/api/crons/update', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(params),
  })
}

/** Delete a cron job. */
export function deleteCron(jobId: string): Promise<CronDeleteResponse> {
  return api<CronDeleteResponse>('/api/crons/delete', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ job_id: jobId }),
  })
}

/** Trigger a cron job immediately. */
export function runCron(jobId: string): Promise<CronRunResponse> {
  return api<CronRunResponse>('/api/crons/run', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ job_id: jobId }),
  })
}

/** Pause a cron job (optionally with a reason). */
export function pauseCron(jobId: string, reason?: string): Promise<CronMutationResponse> {
  return api<CronMutationResponse>('/api/crons/pause', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ job_id: jobId, reason }),
  })
}

/** Resume a paused cron job. */
export function resumeCron(jobId: string): Promise<CronMutationResponse> {
  return api<CronMutationResponse>('/api/crons/resume', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ job_id: jobId }),
  })
}

// ── Skills ─────────────────────────────────────────────────────────────────

/** One row in GET /api/skills. */
export interface SkillSummary extends JsonObject {
  name: string
  description: string
  category: string
  disabled: boolean
}

/** GET /api/skills response. */
export interface SkillsResponse extends JsonObject {
  skills: SkillSummary[]
}

/** Per-skill usage counters (plus agent metadata passthrough). */
export interface SkillUsageEntry extends JsonObject {
  use_count: number
  view_count: number
  patch_count: number
}

/** GET /api/skills/usage response. */
export interface SkillUsageResponse extends JsonObject {
  usage: Record<string, SkillUsageEntry>
  skill_names: string[]
  total_invocations: number
  unique_skills_used: number
}

/** GET /api/skills/content response for a skill (success case). */
export interface SkillContentSuccess extends JsonObject {
  success: true
  name: string
  description: string
  tags: string[]
  related_skills: string[]
  content: string
  path: string
  skill_dir: string | null
  linked_files: Record<string, string[]>
}

/** GET /api/skills/content response for a missing skill. */
export interface SkillContentFailure extends JsonObject {
  success: false
  error: string
  available_skills?: string[]
  hint?: string
}

export type SkillContent = SkillContentSuccess | SkillContentFailure

/** GET /api/skills/content?file=... response — a single linked file. */
export interface SkillFile extends JsonObject {
  content: string
  path: string
}

/** POST /api/skills/save response. */
export interface SkillSaveResponse extends JsonObject {
  ok: true
  name: string
  path: string
}

/** POST /api/skills/delete response. */
export interface SkillDeleteResponse extends JsonObject {
  ok: true
  name: string
}

/** List skills, optionally filtered by category. */
export function getSkills(category?: string): Promise<SkillsResponse> {
  return api<SkillsResponse>(`/api/skills${qs({ category })}`, { credentials: 'include' })
}

/** Fetch per-skill usage statistics. */
export function getSkillUsage(): Promise<SkillUsageResponse> {
  return api<SkillUsageResponse>('/api/skills/usage', { credentials: 'include' })
}

/** Fetch a skill's full content and linked files. */
export function getSkillContent(name: string): Promise<SkillContent> {
  return api<SkillContent>(`/api/skills/content${qs({ name })}`, { credentials: 'include' })
}

/** Fetch a linked file (references/, templates/, assets/, scripts/) of a skill. */
export function getSkillFile(name: string, file: string): Promise<SkillFile> {
  return api<SkillFile>(`/api/skills/content${qs({ name, file })}`, { credentials: 'include' })
}

/** Create or overwrite a skill's SKILL.md. */
export function saveSkill(params: {
  name: string
  content: string
  category?: string
}): Promise<SkillSaveResponse> {
  return api<SkillSaveResponse>('/api/skills/save', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(params),
  })
}

/** Delete a skill directory. */
export function deleteSkill(name: string): Promise<SkillDeleteResponse> {
  return api<SkillDeleteResponse>('/api/skills/delete', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ name }),
  })
}

// ── Memory ─────────────────────────────────────────────────────────────────

/**
 * GET /api/memory response (routes.py `_handle_memory_read`).
 * Contents are redacted server-side; `*_mtime` is unix time or null.
 */
export interface MemoryData extends JsonObject {
  memory: string
  user: string
  soul: string
  project_context: string
  memory_path: string
  user_path: string
  soul_path: string
  project_context_path: string
  project_context_name: string
  project_context_workspace: string
  memory_mtime: number | null
  user_mtime: number | null
  soul_mtime: number | null
  project_context_mtime: number | null
  project_context_shadowed: boolean
  external_notes_enabled: boolean
}

/** POST /api/memory/write response. */
export interface MemoryWriteResponse extends JsonObject {
  ok: true
  section: string
  path: string
}

/** Read all memory sections (memory/user/soul/project context). */
export function readMemory(): Promise<MemoryData> {
  return api<MemoryData>('/api/memory', { credentials: 'include' })
}

/**
 * Write one memory section (`memory`, `user`, or `soul`).
 * The backend rejects other sections with 400.
 */
export function writeMemory(section: string, content: string): Promise<MemoryWriteResponse> {
  return api<MemoryWriteResponse>('/api/memory/write', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ section, content }),
  })
}

// ── Profiles ───────────────────────────────────────────────────────────────

/** One row in GET /api/profiles / POST /api/profile/switch. */
export interface ProfileRow extends JsonObject {
  name: string
  path: string
  is_default: boolean
  is_active: boolean
  gateway_running: boolean
  model: string | null
  provider: string | null
  has_env: boolean
  visible: boolean
  skill_count: number
  enabled_skills: number
  total_skills: number
}

/** GET /api/profiles response. */
export interface ProfilesResponse extends JsonObject {
  profiles: ProfileRow[]
  active: string
  single_profile_mode: boolean
}

/** GET /api/profile/active response. */
export interface ActiveProfile extends JsonObject {
  name: string
  path: string
  is_default: boolean
  default_workspace: string | null
}

/** POST /api/profile/switch response. */
export interface ProfileSwitchResponse extends JsonObject {
  profiles: ProfileRow[]
  active: string
}

/** List profiles with metadata (in isolated mode only the pinned profile). */
export function getProfiles(): Promise<ProfilesResponse> {
  return api<ProfilesResponse>('/api/profiles', { credentials: 'include' })
}

/** Fetch the active profile and its configured default workspace. */
export function getActiveProfile(): Promise<ActiveProfile> {
  return api<ActiveProfile>('/api/profile/active', { credentials: 'include' })
}

/** Switch the per-client active profile (cookie-scoped, not process-wide). */
export function switchProfile(name: string): Promise<ProfileSwitchResponse> {
  return api<ProfileSwitchResponse>('/api/profile/switch', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ name }),
  })
}

// ── Settings ───────────────────────────────────────────────────────────────

/**
 * GET /api/settings response: the settings.json dict plus computed fields
 * (`persisted_speech_keys`, auth state, max-token status, versions, ...).
 * Arbitrary settings keys are preserved; only the known extras are typed.
 */
export interface Settings extends JsonObject {
  persisted_speech_keys?: string[]
  auth_enabled?: boolean
  password_auth_enabled?: boolean
  passkeys_enabled?: boolean
  passwordless_enabled?: boolean
  password_env_var?: boolean
  webui_version?: string
  agent_version?: string
  update_channel?: string
  update_channel_version?: string
  max_tokens?: number | null
  max_tokens_effective?: number | null
  max_tokens_fallback?: number | null
}

/** Read the full settings payload. */
export function getSettings(): Promise<Settings> {
  return api<Settings>('/api/settings', { credentials: 'include' })
}

/**
 * Update settings with a partial patch (any settings.json key, plus the
 * special `_set_password` / `_clear_password` / `_passwordless` fields).
 * Returns the saved settings dict (same shape as GET).
 */
export function updateSettings(patch: JsonObject): Promise<Settings> {
  return api<Settings>('/api/settings', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(patch),
  })
}

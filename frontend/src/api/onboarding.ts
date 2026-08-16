import { api } from './client'
import type { JsonObject } from './types'

/**
 * Typed client for the HermesCN onboarding API.
 *
 * Endpoints (verified against `api/onboarding.py` / `api/oauth.py` /
 * `api/routes.py` handlers):
 * - GET  /api/onboarding/status    (get_onboarding_status)
 * - POST /api/onboarding/setup     (apply_onboarding_setup)
 * - POST /api/onboarding/complete  (complete_onboarding)
 * - POST /api/onboarding/probe     (probe_provider_endpoint)
 * - POST /api/onboarding/oauth/start    (start_onboarding_oauth_flow)
 * - GET  /api/onboarding/oauth/poll     (poll_onboarding_oauth_flow)
 * - POST /api/onboarding/oauth/cancel   (cancel_onboarding_oauth_flow)
 *
 * All mutating endpoints are gated server-side to local/private networks
 * (unless HERMES_WEBUI_ONBOARDING_OPEN=1); a 403 carries the operator-facing
 * error message that the wizard surfaces as-is.
 */

// ── shared shapes ─────────────────────────────────────────────────────────

/** One model option inside a provider setup or a probe result. */
export interface OnboardingModelOption extends JsonObject {
  id: string
  label: string
}

/** One provider entry in the status `setup.providers` catalog. */
export interface OnboardingProviderSetup extends JsonObject {
  id: string
  label: string
  env_var: string
  env_var_aliases?: string[]
  default_model: string
  default_base_url?: string
  requires_base_url: boolean
  /** key_optional providers (ollama, lmstudio, custom) may onboard keyless. */
  key_optional?: boolean
  models: OnboardingModelOption[]
  category: string
  quick?: boolean
  /** When set, this provider can be linked via OAuth instead of an API key. */
  oauth_provider?: string
  oauth_label?: string
}

/** Provider setup catalog (`setup` in the status payload). */
export interface OnboardingSetupCatalog extends JsonObject {
  providers: OnboardingProviderSetup[]
  categories: { id: string; label: string; providers: string[] }[]
  unsupported_note: string
  /** True when the current provider is OAuth-based (Codex, Copilot, ...). */
  current_is_oauth: boolean
  current: { provider: string; model: string; base_url: string | null }
}

/** Runtime/system status (`system` in the status payload). */
export interface OnboardingSystemStatus extends JsonObject {
  hermes_found: boolean
  imports_ok: boolean
  missing_modules: string[]
  import_errors: unknown
  config_path: string
  config_exists: boolean
  provider_configured: boolean
  provider_ready: boolean
  chat_ready: boolean
  setup_state: 'agent_unavailable' | 'ready' | 'provider_incomplete' | 'needs_provider'
  provider_note: string
  provider_note_key: string
  provider_note_args: string[]
  current_provider: string | null
  current_model: string | null
  current_base_url: string | null
  env_path: string
}

/** Full GET /api/onboarding/status payload. */
export interface OnboardingStatus extends JsonObject {
  completed: boolean
  settings: {
    default_model: string
    default_workspace: string
    password_enabled: boolean
    bot_name: string
  }
  system: OnboardingSystemStatus
  setup: OnboardingSetupCatalog
  workspaces: { items: { path: string; name?: string }[]; last: string | null }
  models: {
    active_provider: string | null
    default_model: string
    groups: { provider: string; models: OnboardingModelOption[] }[]
  }
}

/** Body of POST /api/onboarding/setup. */
export interface OnboardingSetupParams {
  provider: string
  model: string
  api_key?: string
  base_url?: string
  /** Acknowledge overwriting an existing config.yaml (server demands it). */
  confirm_overwrite?: boolean
}

/**
 * POST /api/onboarding/setup can return either the full status or — when
 * config.yaml already exists and `confirm_overwrite` was not passed — a 200
 * `config_exists` confirmation request (api/onboarding.py:990).
 */
export interface SetupRequiresConfirm extends JsonObject {
  error: 'config_exists'
  message: string
  requires_confirm: true
}

export type OnboardingSetupResponse = OnboardingStatus | SetupRequiresConfirm

/** POST /api/onboarding/probe response. `ok:false` carries error+detail. */
export interface ProbeResult extends JsonObject {
  ok: boolean
  models?: OnboardingModelOption[]
  status?: number
  error?: string
  detail?: string
}

/** POST /api/onboarding/oauth/start response (provider-specific extras). */
export interface OAuthStartResponse extends JsonObject {
  ok: boolean
  provider: string
  flow_id: string
  status: string
  poll_interval_seconds?: number
  /** openai-codex device-code flow: */
  verification_uri?: string
  user_code?: string
  expires_at?: number | string | null
  /** anthropic credential flow: */
  action_required?: string
  error?: string
}

/** GET /api/onboarding/oauth/poll response. */
export interface OAuthPollResponse extends JsonObject {
  ok: boolean
  provider: string
  flow_id: string
  status: 'pending' | 'success' | 'expired' | 'cancelled' | 'error'
  error?: string
}

/** POST /api/onboarding/oauth/cancel response. */
export interface OAuthCancelResponse extends JsonObject {
  flow_id: string
  status: string
  error?: string
}

// ── endpoints ─────────────────────────────────────────────────────────────

/** Fetch the onboarding status (completed flag + system/setup/workspaces). */
export function getOnboardingStatus(): Promise<OnboardingStatus> {
  return api<OnboardingStatus>('/api/onboarding/status', { credentials: 'include' })
}

/**
 * Persist the wizard's provider setup (config.yaml + .env). Unsupported
 * providers (openai-codex, copilot, nous, ...) are auto-completed server-side
 * with no file writes. Returns the full status (possibly `config_exists`).
 */
export function applyOnboardingSetup(
  params: OnboardingSetupParams,
): Promise<OnboardingSetupResponse> {
  const body: JsonObject = { provider: params.provider, model: params.model }
  if (params.api_key) body.api_key = params.api_key
  if (params.base_url) body.base_url = params.base_url
  if (params.confirm_overwrite) body.confirm_overwrite = true
  return api<OnboardingSetupResponse>('/api/onboarding/setup', {
    method: 'POST',
    body: JSON.stringify(body),
    credentials: 'include',
  })
}

/** Mark onboarding as completed; returns the (now completed) status. */
export function completeOnboarding(): Promise<OnboardingStatus> {
  return api<OnboardingStatus>('/api/onboarding/complete', {
    method: 'POST',
    body: '{}',
    credentials: 'include',
  })
}

/**
 * Probe a self-hosted OpenAI-compatible endpoint (single GET to
 * `<base_url>/models`). Read-only; returns the model catalog for the wizard
 * dropdown, or `{ ok: false, error, detail }` (api/onboarding.py:358).
 */
export function probeProviderEndpoint(params: {
  provider: string
  base_url: string
  api_key?: string
}): Promise<ProbeResult> {
  const body: JsonObject = { provider: params.provider, base_url: params.base_url }
  if (params.api_key) body.api_key = params.api_key
  return api<ProbeResult>('/api/onboarding/probe', {
    method: 'POST',
    body: JSON.stringify(body),
    credentials: 'include',
  })
}

/** Start an OAuth linking flow (`openai-codex` device code or `anthropic`). */
export function startOnboardingOAuth(params: { provider: string }): Promise<OAuthStartResponse> {
  return api<OAuthStartResponse>('/api/onboarding/oauth/start', {
    method: 'POST',
    body: JSON.stringify({ provider: params.provider }),
    credentials: 'include',
  })
}

/** Poll a pending OAuth flow by id (GET with the `flow_id` query param). */
export function pollOnboardingOAuth(flowId: string): Promise<OAuthPollResponse> {
  return api<OAuthPollResponse>(`/api/onboarding/oauth/poll?flow_id=${encodeURIComponent(flowId)}`, {
    credentials: 'include',
  })
}

/** Cancel a pending OAuth flow. */
export function cancelOnboardingOAuth(params: {
  flow_id: string
  provider?: string
}): Promise<OAuthCancelResponse> {
  const body: JsonObject = { flow_id: params.flow_id }
  if (params.provider) body.provider = params.provider
  return api<OAuthCancelResponse>('/api/onboarding/oauth/cancel', {
    method: 'POST',
    body: JSON.stringify(body),
    credentials: 'include',
  })
}

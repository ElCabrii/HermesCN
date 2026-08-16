import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyOnboardingSetup,
  cancelOnboardingOAuth,
  completeOnboarding,
  getOnboardingStatus,
  pollOnboardingOAuth,
  probeProviderEndpoint,
  startOnboardingOAuth,
  type OnboardingStatus,
} from './onboarding'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fetchMockResolving(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(jsonResponse(body, status))
  vi.stubGlobal('fetch', fn)
  return fn
}

const STATUS: OnboardingStatus = {
  completed: false,
  settings: {
    default_model: 'anthropic/claude-sonnet-4.6',
    default_workspace: '/home/me',
    password_enabled: false,
    bot_name: 'Hermes',
  },
  system: {
    hermes_found: true,
    imports_ok: true,
    missing_modules: [],
    import_errors: null,
    config_path: '/home/me/.hermes/config.yaml',
    config_exists: false,
    provider_configured: false,
    provider_ready: false,
    chat_ready: false,
    setup_state: 'needs_provider',
    provider_note: 'Hermes is installed, but you still need to choose a provider.',
    provider_note_key: 'onboarding_notice_provider_choice_required',
    provider_note_args: [],
    current_provider: null,
    current_model: null,
    current_base_url: null,
    env_path: '/home/me/.hermes/.env',
  },
  setup: {
    providers: [
      {
        id: 'openrouter',
        label: 'OpenRouter',
        env_var: 'OPENROUTER_API_KEY',
        default_model: 'anthropic/claude-sonnet-4.6',
        requires_base_url: false,
        models: [{ id: 'anthropic/claude-sonnet-4.6', label: 'anthropic/claude-sonnet-4.6' }],
        category: 'easy_start',
        quick: true,
      },
    ],
    categories: [{ id: 'easy_start', label: 'Easy start', providers: ['openrouter'] }],
    unsupported_note: '',
    current_is_oauth: false,
    current: { provider: '', model: '', base_url: null },
  },
  workspaces: { items: [{ path: '/home/me', name: 'Home' }], last: '/home/me' },
  models: {
    active_provider: null,
    default_model: 'anthropic/claude-sonnet-4.6',
    groups: [],
  },
}

describe('onboarding API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getOnboardingStatus GETs /api/onboarding/status and parses the payload', async () => {
    const fetchMock = fetchMockResolving(STATUS)
    await expect(getOnboardingStatus()).resolves.toEqual(STATUS)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/onboarding/status')
    expect(init.credentials).toBe('include')
    expect(init.method ?? 'GET').toBe('GET')
  })

  it('applyOnboardingSetup POSTs provider/model/api_key/base_url to /api/onboarding/setup', async () => {
    const fetchMock = fetchMockResolving(STATUS)
    await applyOnboardingSetup({
      provider: 'lmstudio',
      model: 'gpt-4o-mini',
      api_key: 'sk-test',
      base_url: 'http://localhost:1234/v1',
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/onboarding/setup')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(String(init.body))).toEqual({
      provider: 'lmstudio',
      model: 'gpt-4o-mini',
      api_key: 'sk-test',
      base_url: 'http://localhost:1234/v1',
    })
  })

  it('applyOnboardingSetup omits empty optional fields and forwards confirm_overwrite', async () => {
    const fetchMock = fetchMockResolving(STATUS)
    await applyOnboardingSetup({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4.6',
      confirm_overwrite: true,
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4.6',
      confirm_overwrite: true,
    })
  })

  it('applyOnboardingSetup surfaces the config_exists confirmation response', async () => {
    fetchMockResolving({
      error: 'config_exists',
      message: 'Hermes is already configured (config.yaml exists). Pass confirm_overwrite=true to overwrite it.',
      requires_confirm: true,
    })
    const res = await applyOnboardingSetup({ provider: 'openrouter', model: 'm' })
    expect(res).toMatchObject({ error: 'config_exists', requires_confirm: true })
  })

  it('completeOnboarding POSTs /api/onboarding/complete and returns the status', async () => {
    const done = { ...STATUS, completed: true }
    const fetchMock = fetchMockResolving(done)
    await expect(completeOnboarding()).resolves.toEqual(done)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/onboarding/complete')
    expect(init.method).toBe('POST')
  })

  it('probeProviderEndpoint POSTs provider/base_url/api_key and parses the model catalog', async () => {
    const fetchMock = fetchMockResolving({
      ok: true,
      models: [{ id: 'qwen3:32b', label: 'qwen3:32b' }],
      status: 200,
    })
    const res = await probeProviderEndpoint({
      provider: 'lmstudio',
      base_url: 'http://localhost:1234/v1',
      api_key: 'sk-test',
    })
    expect(res).toMatchObject({ ok: true, models: [{ id: 'qwen3:32b', label: 'qwen3:32b' }] })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/onboarding/probe')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      provider: 'lmstudio',
      base_url: 'http://localhost:1234/v1',
      api_key: 'sk-test',
    })
  })

  it('probeProviderEndpoint omits api_key when empty and parses failure payloads', async () => {
    const fetchMock = fetchMockResolving({ ok: false, error: 'unreachable', detail: 'refused' })
    const res = await probeProviderEndpoint({ provider: 'custom', base_url: 'http://x/v1' })
    expect(res).toMatchObject({ ok: false, error: 'unreachable', detail: 'refused' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ provider: 'custom', base_url: 'http://x/v1' })
  })

  it('startOnboardingOAuth POSTs the provider and returns the device-code payload', async () => {
    const payload = {
      ok: true,
      provider: 'openai-codex',
      flow_id: 'f1',
      status: 'pending',
      verification_uri: 'https://chatgpt.com/device',
      user_code: 'ABCD-EFGH',
      expires_at: 12345,
      poll_interval_seconds: 5,
    }
    const fetchMock = fetchMockResolving(payload)
    await expect(startOnboardingOAuth({ provider: 'openai-codex' })).resolves.toEqual(payload)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/onboarding/oauth/start')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ provider: 'openai-codex' })
  })

  it('pollOnboardingOAuth GETs the flow status with the flow_id query param', async () => {
    const fetchMock = fetchMockResolving({ ok: true, provider: 'openai-codex', flow_id: 'f1', status: 'success' })
    await expect(pollOnboardingOAuth('f1')).resolves.toMatchObject({ status: 'success' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/onboarding/oauth/poll?flow_id=f1')
    expect(init.method ?? 'GET').toBe('GET')
  })

  it('cancelOnboardingOAuth POSTs flow_id and provider to /api/onboarding/oauth/cancel', async () => {
    const fetchMock = fetchMockResolving({ flow_id: 'f2', status: 'cancelled' })
    await expect(
      cancelOnboardingOAuth({ flow_id: 'f2', provider: 'anthropic' }),
    ).resolves.toMatchObject({ status: 'cancelled' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/onboarding/oauth/cancel')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ flow_id: 'f2', provider: 'anthropic' })
  })

  it('rejects with the server error message on a 403', async () => {
    fetchMockResolving(
      {
        error:
          'Onboarding setup is only available from local networks when auth is not enabled. To bypass this on a remote server, set HERMES_WEBUI_ONBOARDING_OPEN=1.',
      },
      403,
    )
    await expect(
      applyOnboardingSetup({ provider: 'openrouter', model: 'm' }),
    ).rejects.toThrow('only available from local networks')
  })
})

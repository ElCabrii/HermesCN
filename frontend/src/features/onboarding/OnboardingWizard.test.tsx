import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OnboardingStatus } from '@/api/onboarding'
import { OnboardingWizard } from './OnboardingWizard'

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type RouteHandler = (init: RequestInit) => Response | Promise<Response>

/** URL-routed fetch stub; unknown URLs reject like a dead network. */
function mockFetch(routes: Record<string, Response | RouteHandler>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const handler = routes[url]
    if (!handler) return Promise.reject(new TypeError(`fetch failed: ${url}`))
    return Promise.resolve(typeof handler === 'function' ? handler(init ?? {}) : handler)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function makeStatus(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return {
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
      provider_note: 'Hermes is installed, but you still need to choose a provider and save working credentials.',
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
          models: [
            { id: 'anthropic/claude-sonnet-4.6', label: 'anthropic/claude-sonnet-4.6' },
            { id: 'openai/gpt-5.4-mini', label: 'openai/gpt-5.4-mini' },
          ],
          category: 'easy_start',
          quick: true,
        },
        {
          id: 'anthropic',
          label: 'Anthropic',
          env_var: 'ANTHROPIC_API_KEY',
          default_model: 'claude-sonnet-4.6',
          requires_base_url: false,
          models: [{ id: 'claude-sonnet-4.6', label: 'claude-sonnet-4.6' }],
          category: 'easy_start',
          oauth_provider: 'anthropic',
          oauth_label: 'Claude Code OAuth',
        },
        {
          id: 'lmstudio',
          label: 'LM Studio',
          env_var: 'LM_API_KEY',
          default_model: 'gpt-4o-mini',
          default_base_url: 'http://localhost:1234/v1',
          requires_base_url: true,
          key_optional: true,
          models: [],
          category: 'self_hosted',
        },
      ],
      categories: [
        { id: 'easy_start', label: 'Easy start', providers: ['openrouter', 'anthropic'] },
        { id: 'self_hosted', label: 'Self-hosted / local', providers: ['lmstudio'] },
      ],
      unsupported_note:
        'Other providers (OpenAI Codex, Copilot, Nous…) are configured with the hermes CLI.',
      current_is_oauth: false,
      current: { provider: '', model: '', base_url: null },
    },
    workspaces: { items: [{ path: '/home/me', name: 'Home' }], last: '/home/me' },
    models: { active_provider: null, default_model: 'anthropic/claude-sonnet-4.6', groups: [] },
    ...overrides,
  }
}

function wizardRoutes(
  status: OnboardingStatus,
  extra: Record<string, Response | RouteHandler> = {},
): Record<string, Response | RouteHandler> {
  return {
    '/api/onboarding/status': okJson(status),
    '/api/settings': okJson({ auth_enabled: false }),
    ...extra,
  }
}

describe('OnboardingWizard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders nothing when onboarding is already completed', async () => {
    const fetchMock = mockFetch(
      wizardRoutes(makeStatus({ completed: true })),
    )
    render(<OnboardingWizard />)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/onboarding/status',
        expect.objectContaining({ credentials: 'include' }),
      ),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('System check')).not.toBeInTheDocument()
  })

  it('shows the system check step first when onboarding is incomplete', async () => {
    mockFetch(wizardRoutes(makeStatus()))
    render(<OnboardingWizard />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('System check')).toBeInTheDocument()
    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByText('Provider')).toBeInTheDocument()
    expect(screen.getByText('Password')).toBeInTheDocument()
    expect(screen.getByText('/home/me/.hermes/config.yaml')).toBeInTheDocument()
    expect(screen.getByText(/still need to choose a provider/)).toBeInTheDocument()
  })

  it('walks system → setup → workspace → password → finish and posts provider/model/api_key on finish', async () => {
    const status = makeStatus()
    const setupCall: { init?: RequestInit } = {}
    const completeCall: { init?: RequestInit } = {}
    const settingsCall: { init?: RequestInit } = {}
    const fetchMock = mockFetch(
      wizardRoutes(status, {
        '/api/onboarding/setup': (init) => {
          setupCall.init = init
          return okJson(status)
        },
        '/api/settings': (init) => {
          settingsCall.init = init
          return okJson({ auth_enabled: false })
        },
        '/api/onboarding/complete': (init) => {
          completeCall.init = init
          return okJson({ ...status, completed: true })
        },
      }),
    )
    render(<OnboardingWizard />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Continue' })) // → setup
    expect(screen.getByText('Provider setup')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Paste your OpenRouter API key'), 'sk-test-123')
    await user.click(screen.getByRole('button', { name: 'Continue' })) // → workspace
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' })) // → password
    await user.click(screen.getByRole('button', { name: 'Continue' })) // → finish
    expect(screen.getByText('Finish')).toBeInTheDocument()
    expect(screen.getByText('OpenRouter')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open Hermes' }))

    await waitFor(() => expect(completeCall.init).toBeDefined())
    const setupBody = setupCall.init ? JSON.parse(String(setupCall.init.body)) : null
    expect(setupBody).toEqual({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4.6',
      api_key: 'sk-test-123',
    })
    expect(settingsCall.init && JSON.parse(String(settingsCall.init.body))).toEqual({
      default_workspace: '/home/me',
    })
    // Workspace is already known — no /api/workspaces/add call.
    expect(
      fetchMock.mock.calls.some(([input]) => String(input) === '/api/workspaces/add'),
    ).toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('adds an unknown workspace and sets the password when provided', async () => {
    const status = makeStatus()
    const addCall: { init?: RequestInit } = {}
    const settingsCall: { init?: RequestInit } = {}
    mockFetch(
      wizardRoutes(status, {
        '/api/onboarding/setup': () => okJson(status),
        '/api/workspaces/add': (init) => {
          addCall.init = init
          return okJson({ ok: true })
        },
        '/api/settings': (init) => {
          settingsCall.init = init
          return okJson({ auth_enabled: true })
        },
        '/api/onboarding/complete': () => okJson({ ...status, completed: true }),
      }),
    )
    render(<OnboardingWizard />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Continue' })) // → setup
    await user.click(screen.getByRole('button', { name: 'Continue' })) // → workspace
    const workspaceInput = screen.getByPlaceholderText('/home/you/projects')
    await user.clear(workspaceInput)
    await user.type(workspaceInput, '/home/new-project')
    await user.click(screen.getByRole('button', { name: 'Continue' })) // → password
    await user.type(screen.getByPlaceholderText('Leave empty to keep it disabled'), 'hunter2')
    await user.click(screen.getByRole('button', { name: 'Continue' })) // → finish
    await user.click(screen.getByRole('button', { name: 'Open Hermes' }))

    await waitFor(() => expect(addCall.init).toBeDefined())
    expect(addCall.init && JSON.parse(String(addCall.init.body))).toEqual({
      path: '/home/new-project',
    })
    expect(settingsCall.init && JSON.parse(String(settingsCall.init.body))).toEqual({
      default_workspace: '/home/new-project',
      _set_password: 'hunter2',
    })
  })

  it('skips the setup POST when the current OAuth provider is unchanged and finishes via complete', async () => {
    const status = makeStatus({
      system: {
        hermes_found: true,
        imports_ok: true,
        missing_modules: [],
        import_errors: null,
        config_path: '/home/me/.hermes/config.yaml',
        config_exists: false,
        provider_configured: true,
        provider_ready: false,
        chat_ready: false,
        setup_state: 'provider_incomplete',
        provider_note: "Provider 'openai-codex' is configured but not yet authenticated.",
        provider_note_key: 'onboarding_notice_provider_auth_required',
        provider_note_args: ['openai-codex'],
        current_provider: 'openai-codex',
        current_model: 'gpt-5.4-mini',
        current_base_url: null,
        env_path: '/home/me/.hermes/.env',
      },
      setup: {
        ...makeStatus().setup,
        current_is_oauth: true,
        current: { provider: 'openai-codex', model: 'gpt-5.4-mini', base_url: null },
      },
      settings: {
        default_model: 'gpt-5.4-mini',
        default_workspace: '/home/me',
        password_enabled: false,
        bot_name: 'Hermes',
      },
    })
    const fetchMock = mockFetch(
      wizardRoutes(status, {
        '/api/onboarding/complete': () => okJson({ ...status, completed: true }),
      }),
    )
    render(<OnboardingWizard />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Continue' })) // → setup
    expect(screen.getByRole('button', { name: 'Login with ChatGPT' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' })) // → workspace
    await user.click(screen.getByRole('button', { name: 'Continue' })) // → password
    await user.click(screen.getByRole('button', { name: 'Continue' })) // → finish
    await user.click(screen.getByRole('button', { name: 'Open Hermes' }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => String(input) === '/api/onboarding/complete'),
      ).toBe(true),
    )
    expect(
      fetchMock.mock.calls.some(([input]) => String(input) === '/api/onboarding/setup'),
    ).toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('auto-completes when the server marks onboarding done for an unsupported provider', async () => {
    const status = makeStatus({
      system: {
        ...makeStatus().system,
        provider_configured: true,
        chat_ready: false,
        setup_state: 'provider_incomplete',
        current_provider: 'openai-codex',
        current_model: '',
        current_base_url: null,
      },
      setup: {
        ...makeStatus().setup,
        current_is_oauth: true,
        current: { provider: 'openai-codex', model: '', base_url: null },
      },
      settings: {
        default_model: 'gpt-5.4-mini',
        default_workspace: '/home/me',
        password_enabled: false,
        bot_name: 'Hermes',
      },
    })
    const setupCall: { init?: RequestInit } = {}
    mockFetch(
      wizardRoutes(status, {
        // Unsupported providers are auto-completed server-side: setup returns
        // a status payload with completed=true (api/onboarding.py:969).
        '/api/onboarding/setup': (init) => {
          setupCall.init = init
          return okJson({ ...status, completed: true })
        },
        '/api/onboarding/complete': () => okJson({ ...status, completed: true }),
      }),
    )
    render(<OnboardingWizard />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Continue' })) // → setup
    await user.click(screen.getByRole('button', { name: 'Continue' })) // → workspace
    await user.click(screen.getByRole('button', { name: 'Continue' })) // → password
    await user.click(screen.getByRole('button', { name: 'Continue' })) // → finish
    await user.click(screen.getByRole('button', { name: 'Open Hermes' }))

    await waitFor(() => expect(setupCall.init).toBeDefined())
    expect(setupCall.init && JSON.parse(String(setupCall.init.body))).toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.4-mini',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the server error message when the onboarding gate rejects with a 403', async () => {
    mockFetch(
      wizardRoutes(makeStatus(), {
        '/api/onboarding/complete': okJson(
          {
            error:
              'Onboarding is only available from local networks when auth is not enabled. To bypass this on a remote server, set HERMES_WEBUI_ONBOARDING_OPEN=1.',
          },
          403,
        ),
      }),
    )
    render(<OnboardingWizard />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Skip setup' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Onboarding is only available from local networks when auth is not enabled',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('requires a successful probe before continuing for self-hosted providers', async () => {
    const status = makeStatus()
    const fetchMock = mockFetch(
      wizardRoutes(status, {
        // Handler (not a static Response): the wizard probes twice — once on
        // "Test connection" and once when Continue re-validates the endpoint.
        '/api/onboarding/probe': () =>
          okJson({ ok: false, error: 'unreachable', detail: 'Connection refused' }),
      }),
    )
    render(<OnboardingWizard />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Continue' })) // → setup
    await user.selectOptions(screen.getByLabelText('Provider'), 'lmstudio')
    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText(/Could not reach the configured base URL/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the configured base URL',
    )
    expect(
      fetchMock.mock.calls.some(([input]) => String(input) === '/api/onboarding/setup'),
    ).toBe(false)
    expect(screen.getByText('Provider setup')).toBeInTheDocument()
  })

  it('probe populates the model dropdown with the endpoint catalog', async () => {
    const status = makeStatus()
    mockFetch(
      wizardRoutes(status, {
        // Handler (not a static Response): the wizard probes twice — once on
        // "Test connection" and once when Continue re-validates the endpoint.
        '/api/onboarding/probe': () =>
          okJson({
            ok: true,
            models: [
              { id: 'qwen3:32b', label: 'qwen3:32b' },
              { id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
            ],
            status: 200,
          }),
      }),
    )
    render(<OnboardingWizard />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Continue' })) // → setup
    await user.selectOptions(screen.getByLabelText('Provider'), 'lmstudio')
    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText(/Connected\. 2 models? available/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue' })) // → workspace
    const modelSelect = (await screen.findByLabelText('Model')) as HTMLSelectElement
    const optionValues = Array.from(modelSelect.options).map((o) => o.value)
    expect(optionValues).toEqual(['qwen3:32b', 'gpt-4o-mini'])
    expect(modelSelect.value).toBe('qwen3:32b')
  })

  it('runs a Codex OAuth device-code flow and hides the wizard once linked', async () => {
    // NOTE: @testing-library/dom's waitFor only auto-advances JEST fake timers,
    // and user-event's click() hangs under vi.useFakeTimers(), so this test
    // drives the UI with fireEvent + explicit microtask flushes.
    vi.useFakeTimers()
    let status = makeStatus({
      system: {
        ...makeStatus().system,
        provider_configured: true,
        chat_ready: false,
        setup_state: 'provider_incomplete',
        current_provider: 'openai-codex',
        current_model: 'gpt-5.4-mini',
        current_base_url: null,
      },
      setup: {
        ...makeStatus().setup,
        current_is_oauth: true,
        current: { provider: 'openai-codex', model: 'gpt-5.4-mini', base_url: null },
      },
      settings: {
        default_model: 'gpt-5.4-mini',
        default_workspace: '/home/me',
        password_enabled: false,
        bot_name: 'Hermes',
      },
    })
    let polls = 0
    const fetchMock = mockFetch({
      // Live handler so the post-success status refetch sees chat_ready:true.
      '/api/onboarding/status': () => okJson(status),
      '/api/settings': okJson({ auth_enabled: false }),
      '/api/onboarding/oauth/start': okJson({
        ok: true,
        provider: 'openai-codex',
        flow_id: 'f1',
        status: 'pending',
        verification_uri: 'https://chatgpt.com/device',
        user_code: 'ABCD-EFGH',
        expires_at: 9999999999,
        poll_interval_seconds: 2,
      }),
      '/api/onboarding/oauth/poll?flow_id=f1': () => {
        polls += 1
        if (polls === 1) {
          return okJson({ ok: true, provider: 'openai-codex', flow_id: 'f1', status: 'pending' })
        }
        status = {
          ...status,
          system: { ...status.system, chat_ready: true, provider_ready: true },
        }
        return okJson({ ok: true, provider: 'openai-codex', flow_id: 'f1', status: 'success' })
      },
    })
    render(<OnboardingWizard />)
    await act(async () => {}) // flush the initial status fetch

    fireEvent.click(screen.getByRole('button', { name: 'Continue' })) // → setup
    fireEvent.click(screen.getByRole('button', { name: 'Login with ChatGPT' }))
    await act(async () => {}) // flush the oauth/start fetch

    expect(screen.getByText('ABCD-EFGH')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://chatgpt.com/device' })).toBeInTheDocument()

    // First poll (pending) → second poll (success) → status refetched.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    await act(async () => {}) // flush the post-success status refetch

    expect(
      screen.getByText(/Credentials saved to the Hermes credential pool/),
    ).toBeInTheDocument()
    const statusCalls = fetchMock.mock.calls.filter(
      ([input]) => String(input) === '/api/onboarding/status',
    )
    expect(statusCalls.length).toBeGreaterThanOrEqual(2)
    // The wizard stays open after linking (completed is still false server-side);
    // the setup step now shows the ready state and the user continues normally.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/ready to chat/)).toBeInTheDocument()
  })

  it('offers the Claude Code OAuth card for Anthropic and cancels the flow', async () => {
    const cancelCall: { init?: RequestInit } = {}
    mockFetch(
      wizardRoutes(makeStatus(), {
        '/api/onboarding/oauth/start': okJson({
          ok: true,
          provider: 'anthropic',
          flow_id: 'f2',
          status: 'pending',
          action_required: "Please run 'claude setup-token' on the host, then return here.",
          poll_interval_seconds: 3,
        }),
        '/api/onboarding/oauth/cancel': (init) => {
          cancelCall.init = init
          return okJson({ flow_id: 'f2', status: 'cancelled' })
        },
      }),
    )
    render(<OnboardingWizard />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Continue' })) // → setup
    await user.selectOptions(screen.getByLabelText('Provider'), 'anthropic')
    await user.click(screen.getByRole('button', { name: 'Login with Claude Code' }))

    expect(
      await screen.findByText(/Please run 'claude setup-token' on the host/),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText(/The login flow was cancelled/)).toBeInTheDocument()
    expect(cancelCall.init && JSON.parse(String(cancelCall.init.body))).toEqual({
      flow_id: 'f2',
      provider: 'anthropic',
    })
  })
})

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyOnboardingSetup,
  cancelOnboardingOAuth,
  completeOnboarding,
  getOnboardingStatus,
  pollOnboardingOAuth,
  probeProviderEndpoint,
  startOnboardingOAuth,
  type OnboardingModelOption,
  type OnboardingStatus,
  type OnboardingSetupParams,
  type ProbeResult,
  type SetupRequiresConfirm,
} from '@/api/onboarding'
import { updateSettings } from '@/api/panels'
import type { JsonObject } from '@/api/types'
import { addWorkspace } from '@/api/workspace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'

/**
 * First-run onboarding wizard.
 *
 * Port of the legacy `static/onboarding.js` overlay flow:
 * system check → provider setup (API key / OAuth linking / self-hosted probe)
 * → workspace → optional password → finish. All backend contracts are typed
 * in `@/api/onboarding` (verified against api/onboarding.py + api/oauth.py).
 *
 * The wizard renders nothing when GET /api/onboarding/status reports
 * `completed` — including the HERMES_WEBUI_SKIP_ONBOARDING override and the
 * config.yaml auto-complete path, so CLI-configured users never see it.
 * Mounted in App.tsx as a self-gating full-screen overlay.
 */

const STEPS = [
  { key: 'system', title: 'System check', desc: 'Make sure Hermes is installed and importable' },
  { key: 'setup', title: 'Provider setup', desc: 'Connect an AI provider' },
  { key: 'workspace', title: 'Workspace', desc: 'Pick your default workspace' },
  { key: 'password', title: 'Password', desc: 'Protect this Web UI (optional)' },
  { key: 'finish', title: 'Finish', desc: 'Review and open Hermes' },
] as const

interface WizardForm {
  provider: string
  workspace: string
  model: string
  password: string
  apiKey: string
  baseUrl: string
}

interface ProbeState {
  status: 'idle' | 'probing' | 'ok' | 'error'
  error: string | null
  detail: string
  models: OnboardingModelOption[] | null
  probedKey: string
}

const IDLE_PROBE: ProbeState = { status: 'idle', error: null, detail: '', models: null, probedKey: '' }

type OAuthFlow = 'codex' | 'anthropic'

interface OAuthState {
  kind: OAuthFlow
  phase: 'pending' | 'terminal'
  flowId?: string
  userCode?: string
  verificationUri?: string
  actionRequired?: string
  pollIntervalSeconds?: number
  terminal?: { tone: 'success' | 'error' | 'info'; message: string }
}

function probeMessage(p: ProbeState): string {
  if (p.status === 'idle') return ''
  if (p.status === 'probing') return 'Testing connection…'
  if (p.status === 'ok') {
    const count = (p.models ?? []).length
    return `Connected. ${count} model${count === 1 ? '' : 's'} available.`
  }
  const heading =
    p.error === 'parse'
      ? 'The endpoint did not return a valid model list.'
      : 'Could not reach the configured base URL.'
  return p.detail ? `${heading} (${p.detail})` : heading
}

export function OnboardingWizard({ onComplete }: { onComplete?: () => void }) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [done, setDone] = useState(false)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<WizardForm>({
    provider: 'openrouter',
    workspace: '',
    model: '',
    password: '',
    apiKey: '',
    baseUrl: '',
  })
  const [probe, setProbe] = useState<ProbeState>(IDLE_PROBE)
  const [oauth, setOauth] = useState<OAuthState | null>(null)
  const [notice, setNotice] = useState<{ msg: string; tone: 'warn' | 'info' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)

  const probeRef = useRef<ProbeState>(probe)
  const oauthRef = useRef<OAuthState | null>(oauth)
  const probeTimer = useRef<number | null>(null)
  const pollTimer = useRef<number | null>(null)
  useEffect(() => {
    probeRef.current = probe
  }, [probe])
  useEffect(() => {
    oauthRef.current = oauth
  }, [oauth])
  useEffect(
    () => () => {
      if (probeTimer.current !== null) window.clearTimeout(probeTimer.current)
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
    },
    [],
  )

  // Derived data (safe to compute before hooks — status may be null).
  const providers = useMemo(() => status?.setup?.providers ?? [], [status?.setup?.providers])
  const currentProvider = providers.find((p) => p.id === form.provider) ?? null

  const clearPoll = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const s = await getOnboardingStatus()
      setStatus(s)
      const current = s.setup?.current ?? { provider: '', model: '', base_url: null }
      setForm((f) => ({
        ...f,
        provider: current.provider || 'openrouter',
        workspace: s.workspaces?.last || s.settings?.default_workspace || f.workspace,
        model: s.settings?.default_model || current.model || f.model,
        baseUrl: current.base_url || f.baseUrl,
      }))
      if (s.completed) setDone(true)
    } catch (e) {
      // Status unavailable (server down, network gate…): stay hidden, like the
      // legacy overlay, so a broken wizard never blocks the app.
      console.warn('onboarding status unavailable', e)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const runProbe = useCallback(
    async ({ force = false } = {}): Promise<ProbeState> => {
      const p = providers.find((x) => x.id === form.provider) ?? null
      if (!p || !p.requires_base_url) {
        const idle = IDLE_PROBE
        setProbe(idle)
        return idle
      }
      const baseUrl = form.baseUrl.trim()
      if (!baseUrl) {
        const idle = IDLE_PROBE
        setProbe(idle)
        return idle
      }
      const apiKey = form.apiKey.trim()
      const key = `${form.provider}|${baseUrl.replace(/\/+$/, '')}|${apiKey}`
      const prev = probeRef.current
      if (!force && prev.probedKey === key && prev.status !== 'probing') return prev
      const probing: ProbeState = {
        status: 'probing',
        error: null,
        detail: '',
        models: null,
        probedKey: key,
      }
      setProbe(probing)
      let result: ProbeState
      try {
        const res: ProbeResult = await probeProviderEndpoint({
          provider: form.provider,
          base_url: baseUrl,
          api_key: apiKey || undefined,
        })
        if (res.ok) {
          const models = Array.isArray(res.models) ? res.models : []
          result = { status: 'ok', error: null, detail: '', models, probedKey: key }
          setForm((f) => {
            const stillValid = f.model && models.some((m) => m.id === f.model)
            return stillValid || models.length === 0 ? f : { ...f, model: models[0].id }
          })
        } else {
          result = {
            status: 'error',
            error: res.error ?? 'unreachable',
            detail: res.detail ?? '',
            models: null,
            probedKey: key,
          }
        }
      } catch (e) {
        result = {
          status: 'error',
          error: 'unreachable',
          detail: e instanceof Error ? e.message : String(e),
          models: null,
          probedKey: key,
        }
      }
      setProbe(result)
      return result
    },
    [providers, form.provider, form.baseUrl, form.apiKey],
  )

  const pollOAuth = useCallback(async () => {
    const flow = oauthRef.current
    if (!flow || flow.phase !== 'pending' || !flow.flowId) return
    try {
      const resp = await pollOnboardingOAuth(flow.flowId)
      if (resp.status === 'pending') {
        pollTimer.current = window.setTimeout(
          () => void pollOAuth(),
          Math.max(1000, (flow.pollIntervalSeconds ?? 3) * 1000),
        )
        return
      }
      clearPoll()
      if (resp.status === 'success') {
        setOauth({
          kind: flow.kind,
          phase: 'terminal',
          terminal: {
            tone: 'success',
            message:
              flow.kind === 'codex'
                ? 'Credentials saved to the Hermes credential pool. Refreshing provider status…'
                : 'Hermes is now linked to Claude Code credentials.',
          },
        })
        await loadStatus()
      } else if (resp.status === 'expired') {
        setOauth({
          kind: flow.kind,
          phase: 'terminal',
          terminal: { tone: 'error', message: 'The login code expired. Please start a new login.' },
        })
      } else if (resp.status === 'cancelled') {
        setOauth({
          kind: flow.kind,
          phase: 'terminal',
          terminal: { tone: 'info', message: 'The login flow was cancelled.' },
        })
      } else {
        setOauth({
          kind: flow.kind,
          phase: 'terminal',
          terminal: { tone: 'error', message: resp.error ?? 'OAuth login failed. Please try again.' },
        })
      }
    } catch (e) {
      clearPoll()
      setOauth({
        kind: flow.kind,
        phase: 'terminal',
        terminal: { tone: 'error', message: e instanceof Error ? e.message : String(e) },
      })
    }
  }, [clearPoll, loadStatus])

  if (!status || done) return null

  const system = status.system
  const setup = status.setup
  const categories = setup?.categories ?? []
  const currentIsOauth = Boolean(setup?.current_is_oauth)
  const isCodexOAuth = currentIsOauth && system.current_provider === 'openai-codex'
  const stepMeta = STEPS[step]

  const syncProvider = (value: string) => {
    const p = providers.find((x) => x.id === value) ?? null
    setForm((f) => {
      const choices = p ? p.models : []
      const modelInvalid =
        !f.model ||
        (value !== 'custom' && choices.length > 0 && !choices.some((m) => m.id === f.model))
      return {
        ...f,
        provider: value,
        model: value === 'custom' || modelInvalid ? (p?.default_model ?? '') : f.model,
        baseUrl: p ? (p.requires_base_url ? f.baseUrl || p.default_base_url || '' : '') : '',
      }
    })
    setProbe(IDLE_PROBE)
    setOauth(null)
    setNotice(null)
  }

  const scheduleProbe = () => {
    if (probeTimer.current !== null) window.clearTimeout(probeTimer.current)
    probeTimer.current = window.setTimeout(() => {
      void runProbe()
    }, 400)
  }

  const startCodexOAuth = async () => {
    clearPoll()
    setOauth(null)
    try {
      const resp = await startOnboardingOAuth({ provider: 'openai-codex' })
      if (resp.error) throw new Error(resp.error)
      if (!resp.flow_id || !resp.user_code || !resp.verification_uri) {
        throw new Error('Invalid OAuth response from the server.')
      }
      setOauth({
        kind: 'codex',
        phase: 'pending',
        flowId: resp.flow_id,
        userCode: resp.user_code,
        verificationUri: resp.verification_uri,
        pollIntervalSeconds: resp.poll_interval_seconds ?? 3,
      })
      pollTimer.current = window.setTimeout(
        () => void pollOAuth(),
        Math.max(1000, (resp.poll_interval_seconds ?? 3) * 1000),
      )
    } catch (e) {
      setOauth({
        kind: 'codex',
        phase: 'terminal',
        terminal: { tone: 'error', message: e instanceof Error ? e.message : String(e) },
      })
    }
  }

  const startAnthropicOAuth = async () => {
    clearPoll()
    setOauth(null)
    try {
      const resp = await startOnboardingOAuth({ provider: 'anthropic' })
      if (resp.error) throw new Error(resp.error)
      if (!resp.flow_id) throw new Error('Invalid OAuth response from the server.')
      if (resp.status === 'success') {
        setOauth({
          kind: 'anthropic',
          phase: 'terminal',
          terminal: { tone: 'success', message: 'Hermes is now linked to Claude Code credentials.' },
        })
        await loadStatus()
        return
      }
      setOauth({
        kind: 'anthropic',
        phase: 'pending',
        flowId: resp.flow_id,
        actionRequired:
          resp.action_required ??
          "Please run 'claude login' or 'claude setup-token' in a terminal on the host, then return here.",
        pollIntervalSeconds: resp.poll_interval_seconds ?? 3,
      })
      pollTimer.current = window.setTimeout(
        () => void pollOAuth(),
        Math.max(1000, (resp.poll_interval_seconds ?? 3) * 1000),
      )
    } catch (e) {
      setOauth({
        kind: 'anthropic',
        phase: 'terminal',
        terminal: { tone: 'error', message: e instanceof Error ? e.message : String(e) },
      })
    }
  }

  const cancelOAuth = async () => {
    const flow = oauthRef.current
    clearPoll()
    if (flow && flow.phase === 'pending' && flow.flowId) {
      try {
        await cancelOnboardingOAuth({ flow_id: flow.flowId, provider: flow.kind })
      } catch {
        // Best-effort: the flow expires server-side anyway.
      }
    }
    setOauth({
      kind: flow?.kind ?? 'codex',
      phase: 'terminal',
      terminal: { tone: 'info', message: 'The login flow was cancelled.' },
    })
  }

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard?.writeText(code)
    } catch {
      // Clipboard unavailable (non-secure context) — the code stays visible.
    }
  }

  const saveProviderSetup = async (): Promise<'saved' | 'confirm'> => {
    const current = setup?.current ?? { provider: '', model: '', base_url: null }
    const unchanged =
      current.provider === form.provider &&
      (current.model ?? '') === form.model &&
      (current.base_url ?? '') === form.baseUrl
    // Legacy flow: when the current provider is already saved (OAuth providers
    // are configured via the CLI) and nothing changed, skip the setup POST.
    if (unchanged && !form.apiKey.trim() && (system.chat_ready || currentIsOauth)) {
      return 'saved'
    }
    const body: OnboardingSetupParams = {
      provider: form.provider,
      model: form.model,
      api_key: form.apiKey.trim() || undefined,
      base_url: form.baseUrl.trim() || undefined,
      confirm_overwrite: confirmOverwrite || undefined,
    }
    const res = await applyOnboardingSetup(body)
    const confirm = res as SetupRequiresConfirm
    if (confirm.error === 'config_exists' && confirm.requires_confirm) {
      setConfirmOverwrite(true)
      setNotice({ msg: confirm.message, tone: 'warn' })
      return 'confirm'
    }
    setStatus(res as OnboardingStatus)
    return 'saved'
  }

  const saveDefaults = async () => {
    const workspace = form.workspace.trim()
    const model = form.model.trim()
    if (!workspace) throw new Error('Choose a workspace.')
    if (!model) throw new Error('Choose a model.')
    const known = (status.workspaces?.items ?? []).some((ws) => ws.path === workspace)
    if (!known) {
      await addWorkspace(workspace)
    }
    const patch: JsonObject = { default_workspace: workspace }
    if (form.password.trim()) patch._set_password = form.password.trim()
    const saved = await updateSettings(patch)
    if (saved.auth_enabled !== undefined) {
      setStatus((s) =>
        s
          ? { ...s, settings: { ...s.settings, password_enabled: Boolean(saved.auth_enabled) } }
          : s,
      )
    }
  }

  const finish = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const outcome = await saveProviderSetup()
      if (outcome === 'confirm') return
      await saveDefaults()
      const completed = await completeOnboarding()
      setStatus(completed)
      setDone(true)
      onComplete?.()
    } catch (e) {
      setNotice({ msg: e instanceof Error ? e.message : String(e), tone: 'warn' })
    } finally {
      setBusy(false)
    }
  }

  const skip = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const completed = await completeOnboarding()
      setStatus(completed)
      setDone(true)
      onComplete?.()
    } catch (e) {
      setNotice({ msg: e instanceof Error ? e.message : String(e), tone: 'warn' })
    } finally {
      setBusy(false)
    }
  }

  const next = async () => {
    setNotice(null)
    try {
      if (stepMeta.key === 'setup') {
        if (!form.provider) throw new Error('Choose a provider first.')
        if (currentProvider?.requires_base_url) {
          if (!form.baseUrl.trim()) throw new Error('A base URL is required for custom endpoints.')
          const result = await runProbe({ force: true })
          if (result.status !== 'ok') throw new Error(probeMessage(result))
        }
      }
      if (stepMeta.key === 'workspace') {
        if (!form.workspace.trim()) throw new Error('Choose a workspace.')
        if (!form.model.trim()) throw new Error('Choose a model.')
      }
      if (stepMeta.key === 'finish') {
        await finish()
        return
      }
      setStep((s) => s + 1)
    } catch (e) {
      setNotice({ msg: e instanceof Error ? e.message : String(e), tone: 'warn' })
    }
  }

  const back = () => {
    setNotice(null)
    setStep((s) => Math.max(0, s - 1))
  }

  const hermesOk = system.hermes_found && system.imports_ok
  const modelChoices =
    currentProvider?.requires_base_url && probe.status === 'ok' && probe.models?.length
      ? probe.models
      : (currentProvider?.models ?? [])

  return (
    <div
      role="dialog"
      aria-label="Onboarding wizard"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-background/95 p-4 backdrop-blur-sm"
    >
      {/* A card, not a full-height column: stretching to the viewport pinned
          the footer to the bottom of a 900px screen and left a field of empty
          space between the checks and the Continue button. */}
      <div className="my-auto flex w-full max-w-2xl flex-col rounded-xl border border-border bg-card p-6 shadow-lg">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Set up Hermes</h1>
            <p className="text-sm text-muted-foreground">
              <span>{stepMeta.title}</span> · <span>{stepMeta.desc}</span>
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void skip()} disabled={busy}>
            Skip setup
          </Button>
        </header>

        {/* Five labelled pills do not fit a phone: they wrapped into multi-line
            blobs and the last step fell off the edge. Narrow screens get a
            progress bar with a "step N of M" caption instead. */}
        <nav aria-label="Wizard steps" className="mt-4">
          <div className="hidden flex-wrap items-center gap-1.5 text-xs sm:flex">
            {STEPS.map((s, i) => (
              <span
                key={s.key}
                aria-current={i === step ? 'step' : undefined}
                className={`rounded-full px-2.5 py-1 whitespace-nowrap ${
                  i === step
                    ? 'bg-primary text-primary-foreground'
                    : i < step
                      ? 'bg-muted text-foreground/70'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {i + 1}. {s.title}
              </span>
            ))}
          </div>
          <div className="sm:hidden">
            {/* The step's name is already the header subtitle; repeating it
                here would just cost a line on the narrowest screen. */}
            <div className="flex items-baseline justify-end text-xs">
              <span className="text-muted-foreground tabular-nums">
                Step {step + 1} of {STEPS.length}
              </span>
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
              />
            </div>
          </div>
        </nav>

        {notice && (
          <div
            role="alert"
            className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
              notice.tone === 'warn'
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'border-border bg-muted text-foreground'
            }`}
          >
            {notice.msg}
          </div>
        )}

        <main className="mt-6">
          {stepMeta.key === 'system' && (
            <div className="space-y-3">
              <CheckRow
                ok={hermesOk}
                title="Agent"
                detail={
                  hermesOk
                    ? 'Hermes is installed and importable.'
                    : 'Hermes is missing or not fully importable. Finish the bootstrap first.'
                }
              />
              <CheckRow
                ok={Boolean(system.chat_ready)}
                title="Provider"
                detail={system.provider_note || 'No provider configured yet.'}
              />
              <CheckRow
                ok={Boolean(status.settings.password_enabled)}
                title="Password"
                detail={
                  status.settings.password_enabled
                    ? 'A password is already set.'
                    : 'No password set — you can add one later in this wizard.'
                }
              />
              {!hermesOk && system.missing_modules.length > 0 && (
                <p className="text-sm text-destructive">
                  Missing modules: {system.missing_modules.join(', ')}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Config: <span>{system.config_path}</span>
                {system.config_exists ? ' (exists)' : ' (will be created)'}
                <br />
                Environment: {system.env_path}
              </p>
            </div>
          )}

          {stepMeta.key === 'setup' && (
            <div className="space-y-4">
              {isCodexOAuth && (
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <p className="text-sm font-medium">OpenAI Codex is configured via the CLI.</p>
                  {system.chat_ready ? (
                    <>
                      <p className="text-sm text-foreground">
                        Hermes is already authenticated with Codex and ready to chat.
                      </p>
                      {oauth?.kind === 'codex' && oauth.phase === 'terminal' && (
                        <p
                          className={`mt-1 text-sm ${
                            oauth.terminal?.tone === 'error'
                              ? 'text-destructive'
                              : oauth.terminal?.tone === 'success'
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-muted-foreground'
                          }`}
                        >
                          {oauth.terminal?.message}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Link your ChatGPT account to finish the setup:
                      </p>
                      <OAuthControls
                        flow={oauth}
                        kind="codex"
                        onStart={() => void startCodexOAuth()}
                        onCancel={() => void cancelOAuth()}
                        onCopy={copyCode}
                      />
                    </>
                  )}
                </div>
              )}

              <label className="block text-sm font-medium">
                Provider
                <NativeSelect
                  containerClassName="mt-1"
                  value={providers.some((p) => p.id === form.provider) ? form.provider : ''}
                  onChange={(e) => syncProvider(e.target.value)}
                >
                  {categories.length > 0
                    ? categories.map((cat) => (
                        <optgroup key={cat.id} label={cat.label}>
                          {cat.providers.map((pid) => {
                            const p = providers.find((x) => x.id === pid)
                            return p ? (
                              <option key={pid} value={p.id}>
                                {p.label}
                                {p.quick ? ' — Quick setup' : ''}
                              </option>
                            ) : null
                          })}
                        </optgroup>
                      ))
                    : providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                </NativeSelect>
              </label>

              <label className="block text-sm font-medium">
                {currentProvider?.key_optional ? 'API key (optional)' : 'API key'}
                <Input
                  type="password"
                  className="mt-1"
                  value={form.apiKey}
                  autoComplete="off"
                  placeholder={
                    currentProvider?.key_optional
                      ? 'Optional for local servers'
                      : `Paste your ${currentProvider?.label ?? ''} API key`
                  }
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                />
              </label>
              {currentProvider && (
                <p className="text-xs text-muted-foreground">
                  Key path: {currentProvider.env_var}
                  {currentProvider.key_optional
                    ? ' — optional for local servers'
                    : ' in ~/.hermes/.env'}
                  .
                </p>
              )}

              {currentProvider?.oauth_provider === 'anthropic' && (
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <p className="text-sm font-medium">{currentProvider.oauth_label}</p>
                  <p className="text-sm text-muted-foreground">
                    Claude Code subscription credentials are not the same as an Anthropic API key.
                    Link them instead:
                  </p>
                  <OAuthControls
                    flow={oauth}
                    kind="anthropic"
                    onStart={() => void startAnthropicOAuth()}
                    onCancel={() => void cancelOAuth()}
                    onCopy={copyCode}
                  />
                </div>
              )}

              {currentProvider?.requires_base_url && (
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium">
                    Base URL
                    <Input
                      className="mt-1"
                      value={form.baseUrl}
                      placeholder={currentProvider.default_base_url || 'http://localhost:1234/v1'}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, baseUrl: e.target.value }))
                        scheduleProbe()
                      }}
                      onBlur={() => void runProbe({ force: true })}
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={probe.status === 'probing' || busy}
                      onClick={() => void runProbe({ force: true })}
                    >
                      Test connection
                    </Button>
                    {probe.status !== 'idle' && (
                      <span
                        className={`text-xs ${
                          probe.status === 'ok'
                            ? 'text-green-600 dark:text-green-400'
                            : probe.status === 'error'
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                        }`}
                      >
                        {probeMessage(probe)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {setup?.unsupported_note && (
                <p className="text-xs text-muted-foreground">{setup.unsupported_note}</p>
              )}
            </div>
          )}

          {stepMeta.key === 'workspace' && (
            <div className="space-y-4">
              <label className="block text-sm font-medium">
                Default workspace
                <NativeSelect
                  containerClassName="mt-1"
                  value={
                    (status.workspaces?.items ?? []).some((w) => w.path === form.workspace)
                      ? form.workspace
                      : ''
                  }
                  onChange={(e) => setForm((f) => ({ ...f, workspace: e.target.value }))}
                >
                  {(status.workspaces?.items?.length
                    ? status.workspaces.items
                    : [{ path: form.workspace || '', name: 'Home' }]
                  ).map((w) => (
                    <option key={w.path || 'home'} value={w.path}>
                      {w.name || w.path}
                      {w.path === status.workspaces?.last ? ' (last used)' : ''}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="block text-sm font-medium">
                …or enter a path
                <Input
                  className="mt-1"
                  value={form.workspace}
                  placeholder="/home/you/projects"
                  onChange={(e) => setForm((f) => ({ ...f, workspace: e.target.value }))}
                />
              </label>
              {form.provider === 'custom' ? (
                <label className="block text-sm font-medium">
                  Model
                  <Input
                    className="mt-1"
                    value={form.model}
                    placeholder="e.g. my-model-7b"
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  />
                </label>
              ) : (
                <label className="block text-sm font-medium">
                  Model
                  <NativeSelect
                    containerClassName="mt-1"
                    value={modelChoices.some((m) => m.id === form.model) ? form.model : ''}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  >
                    {modelChoices.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              )}
            </div>
          )}

          {stepMeta.key === 'password' && (
            <div className="space-y-3">
              <label className="block text-sm font-medium">
                Password (optional)
                <Input
                  type="password"
                  className="mt-1"
                  value={form.password}
                  autoComplete="new-password"
                  placeholder="Leave empty to keep it disabled"
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                {status.settings.password_enabled
                  ? 'A password is already set — entering one here replaces it.'
                  : 'Setting a password protects this Web UI. You can skip this and set one later.'}
              </p>
            </div>
          )}

          {stepMeta.key === 'finish' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
                <SummaryRow label="Provider" value={currentProvider?.label ?? form.provider} />
                <SummaryRow label="Model" value={form.model} />
                <SummaryRow label="Workspace" value={form.workspace} />
                {form.baseUrl && <SummaryRow label="Base URL" value={form.baseUrl} />}
                <SummaryRow
                  label="Password"
                  value={
                    form.password.trim()
                      ? status.settings.password_enabled
                        ? 'Will replace the existing password'
                        : 'Will be enabled'
                      : status.settings.password_enabled
                        ? 'Keeps the existing password'
                        : 'Remains disabled'
                  }
                />
              </div>
              {confirmOverwrite && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={confirmOverwrite}
                    onChange={(e) => setConfirmOverwrite(e.target.checked)}
                  />
                  <span>
                    I understand — overwrite the existing config.yaml with these settings.
                  </span>
                </label>
              )}
              <p className="text-xs text-muted-foreground">
                Hermes will save your provider credentials, set the default workspace, and open
                the chat. You can change all of this later in Settings.
              </p>
            </div>
          )}
        </main>

        <footer className="mt-8 flex items-center justify-between border-t border-border/60 pt-4">
          <Button variant="outline" onClick={back} disabled={step === 0 || busy}>
            Back
          </Button>
          <Button onClick={() => void next()} disabled={busy}>
            {busy ? 'Working…' : stepMeta.key === 'finish' ? 'Open Hermes' : 'Continue'}
          </Button>
        </footer>
      </div>
    </div>
  )
}

function CheckRow({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
      <span aria-hidden="true" className="mt-0.5 text-base">
        {ok ? '✅' : '⚠️'}
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}

function OAuthControls({
  flow,
  kind,
  onStart,
  onCancel,
  onCopy,
}: {
  flow: OAuthState | null
  kind: OAuthFlow
  onStart: () => void
  onCancel: () => void
  onCopy: (code: string) => void
}) {
  const active = flow?.kind === kind ? flow : null
  if (active?.phase === 'pending') {
    return (
      <div className="mt-2 space-y-2">
        {kind === 'codex' && active.userCode && (
          <div className="flex items-center gap-2">
            <code className="rounded-md border border-border bg-background px-3 py-1.5 text-lg font-semibold tracking-widest">
              {active.userCode}
            </code>
            <Button variant="outline" size="sm" onClick={() => void onCopy(active.userCode!)}>
              Copy
            </Button>
          </div>
        )}
        {kind === 'codex' && active.verificationUri && (
          <p className="text-sm text-muted-foreground">
            Open{' '}
            <a
              href={active.verificationUri}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              {active.verificationUri}
            </a>{' '}
            and enter the code. Waiting for the login to complete…
          </p>
        )}
        {kind === 'anthropic' && active.actionRequired && (
          <p className="text-sm text-muted-foreground">{active.actionRequired}</p>
        )}
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    )
  }
  if (active?.phase === 'terminal') {
    return (
      <p
        className={`mt-2 text-sm ${
          active.terminal?.tone === 'error'
            ? 'text-destructive'
            : active.terminal?.tone === 'success'
              ? 'text-green-600 dark:text-green-400'
              : 'text-muted-foreground'
        }`}
      >
        {active.terminal?.message}
      </p>
    )
  }
  return (
    <Button variant="outline" size="sm" className="mt-2" onClick={onStart}>
      {kind === 'codex' ? 'Login with ChatGPT' : 'Login with Claude Code'}
    </Button>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDownIcon,
  Loader2Icon,
  RefreshCwIcon,
  Trash2Icon,
  CheckIcon,
  CircleAlertIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  deleteProviderKey,
  getProviderCostHistory,
  getProviderQuota,
  getProviders,
  refreshProviderModels,
  setProviderCostBudget,
  setProviderKey,
  setupSelfHostedProvider,
  type ProviderCostHistoryResponse,
  type ProviderInfo,
  type ProviderQuotaResponse,
} from '@/api/panels'
import { probeProviderEndpoint } from '@/api/onboarding'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Providers tab of the Control Center.
 *
 * Port of the legacy Settings → Providers section (static/panels.js
 * `loadProvidersPanel` + `_buildProviderCard` + the quota card), which the
 * React remake dropped. Every backend contract is typed in `@/api/panels`
 * (verified against api/providers.py + api/onboarding.py):
 *
 * - a quota / account-limits card for the active provider (refreshable),
 * - one collapsible card per provider: OAuth providers show status only;
 *   API-key providers can set/remove a key; self-hosted providers
 *   (ollama/lmstudio) configure base URL + model (optionally a key) and
 *   can test the connection; custom/plugin providers are read-only,
 * - a model-tag list (+N more when the catalog is trimmed), with a
 *   per-provider "Refresh models" action,
 * - an OpenRouter 7-day spend bar list with a monthly budget set/clear.
 *
 * After any mutation the panel reloads from GET /api/providers so the
 * cards reflect the server truth (the legacy flow did the same).
 */

const SELF_HOSTED_DEFAULT_BASE_URLS: Record<string, string> = {
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
}

const SELF_HOSTED_IDS = new Set(['ollama', 'lmstudio'])

// ── formatting helpers (ported from the legacy panel) ──────────────────────

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

function fmtReset(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return d.toLocaleString()
  } catch {
    return value
  }
}

function windowMeta(used: number | null | undefined, reset: string | null | undefined): string[] {
  const parts: string[] = []
  if (used !== null && used !== undefined) parts.push(`${fmtPercent(used)} used`)
  const r = fmtReset(reset)
  if (r) parts.push(`resets ${r}`)
  return parts
}

function statusLabel(state: string | null | undefined): string {
  switch (state) {
    case 'available':
      return 'Available'
    case 'exhausted':
      return 'Exhausted'
    case 'failed':
      return 'Failed'
    case 'checked':
      return 'Checked'
    case 'no_key':
      return 'No key'
    case 'invalid_key':
      return 'Invalid key'
    case 'unsupported':
      return 'Unsupported'
    case 'missing_provider':
      return 'No provider'
    default:
      return 'Unavailable'
  }
}

function statusTone(state: string | null | undefined): 'ok' | 'warn' | 'err' | 'muted' {
  switch (state) {
    case 'available':
      return 'ok'
    case 'exhausted':
    case 'invalid_key':
    case 'failed':
      return 'err'
    case 'checked':
    case 'no_key':
      return 'warn'
    default:
      return 'muted'
  }
}

// ── quota card ─────────────────────────────────────────────────────────────

function QuotaCard({ quota }: { quota: ProviderQuotaResponse | null }) {
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const next = await getProviderQuota(true)
      toast.success(next.ok ? 'Quota refreshed' : 'Quota refresh failed')
      // The parent reloads the whole panel on refresh; no local state here.
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Quota refresh failed')
    } finally {
      setRefreshing(false)
    }
  }, [])

  const accountLimits = quota?.account_limits ?? null
  const windows = useMemo(() => accountLimits?.windows ?? [], [accountLimits])

  if (!quota) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Loader2Icon className="mr-1 inline size-3 animate-spin" /> Loading quota…
      </div>
    )
  }

  const state = quota.status ?? 'unavailable'
  const tone = statusTone(state)
  const providerBase = quota.display_name ?? quota.provider ?? 'Active provider'
  const provider = accountLimits?.plan ? `${providerBase} · ${accountLimits.plan}` : providerBase

  const details = accountLimits && !accountLimits.pool ? (accountLimits.details ?? []) : []
  const pool = accountLimits?.pool ?? null
  const poolCredentials = pool?.credentials ?? []
  const poolTotal = Number.isFinite(Number(pool?.total_credentials))
    ? Number(pool!.total_credentials)
    : poolCredentials.length
  const poolAvailable = Number.isFinite(Number(pool?.available_credentials))
    ? Number(pool!.available_credentials)
    : poolCredentials.filter((c) => c?.status === 'available').length
  const poolExhausted = Number.isFinite(Number(pool?.exhausted_credentials))
    ? Number(pool!.exhausted_credentials)
    : 0
  const poolFailed = Number.isFinite(Number(pool?.failed_credentials)) ? Number(pool!.failed_credentials) : 0
  const poolQueried = Number.isFinite(Number(pool?.queried_credentials)) ? Number(pool!.queried_credentials) : 0

  const quotaBody = (() => {
    if (accountLimits && (state === 'available' || pool)) {
      const windowHtml = windows.map((w, i) => (
        <div key={i} className="flex items-baseline justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5">
          <span className="text-xs text-muted-foreground">{w.label ?? 'Usage window'}</span>
          <strong className="text-sm tabular-nums">{fmtPercent(w.remaining_percent)}</strong>
          <span className="text-[11px] text-muted-foreground">
            {windowMeta(w.used_percent, w.reset_at).join(' · ')}
            {w.detail ? ` · ${w.detail}` : ''}
          </span>
        </div>
      ))
      const detailHtml = details.length ? (
        <div className="flex flex-wrap gap-1 pt-1">
          {details.map((d, i) => (
            <span key={i} className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {d}
            </span>
          ))}
        </div>
      ) : null

      const poolHtml =
        pool && poolCredentials.length > 0 ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              <span className="inline-flex items-center gap-1">
                <ChevronDownIcon className="size-3" />
                Credential pool
              </span>
              <strong className="ml-1 font-medium">
                {poolAvailable}/{poolTotal} available
                {poolExhausted > 0 ? ` · ${poolExhausted} exhausted` : ''}
                {poolFailed > 0 ? ` · ${poolFailed} failed` : ''}
                {poolQueried > 0 ? ` · ${poolQueried} checked` : ''}
              </strong>
            </summary>
            {Array.isArray(pool.plans) && pool.plans.length > 0 && (
              <p className="px-2 pt-1 text-[11px] text-muted-foreground">{pool.plans.join(', ')}</p>
            )}
            <div className="mt-1 space-y-1">
              {poolCredentials.map((cred, i) => {
                const credState = cred?.status ?? 'unavailable'
                const credWindows = cred?.windows ?? []
                return (
                  <div key={i} className="rounded-md border border-border/60 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs">{cred?.label ?? `Credential ${i + 1}`}</span>
                      <strong className={cn('text-[11px]', toneClass(credState))}>{statusLabel(credState)}</strong>
                    </div>
                    {credWindows.length > 0 ? (
                      <div className="mt-1 space-y-0.5">
                        {credWindows.map((w, j) => (
                          <div key={j} className="flex items-baseline justify-between gap-2 text-[11px]">
                            <span className="text-muted-foreground">{w.label ?? 'Window'}</span>
                            <span className="tabular-nums">{fmtPercent(w.remaining_percent)}</span>
                          </div>
                        ))}
                      </div>
                    ) : cred?.unavailable_reason ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{cred.unavailable_reason}</p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </details>
        ) : null

      return (
        <>
          {windowHtml}
          {detailHtml}
          {poolHtml}
          {!windowHtml.length && !detailHtml && !poolHtml && (
            <p className="text-xs text-muted-foreground">{quota.message ?? 'Account limits loaded.'}</p>
          )}
        </>
      )
    }

    if (state === 'available' && quota.quota) {
      return (
        <>
          <div className="flex items-baseline justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5">
            <span className="text-xs text-muted-foreground">Remaining</span>
            <strong className="text-sm tabular-nums">{fmtMoney(quota.quota.limit_remaining)}</strong>
          </div>
          <div className="flex items-baseline justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5">
            <span className="text-xs text-muted-foreground">Used</span>
            <strong className="text-sm tabular-nums">{fmtMoney(quota.quota.usage)}</strong>
          </div>
          <div className="flex items-baseline justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5">
            <span className="text-xs text-muted-foreground">Limit</span>
            <strong className="text-sm tabular-nums">{fmtMoney(quota.quota.limit)}</strong>
          </div>
        </>
      )
    }

    return <p className="text-xs text-muted-foreground">{quota.message ?? 'Quota unavailable.'}</p>
  })()

  return (
    <div className="mb-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">Provider quota</div>
          <div className="truncate text-sm font-medium">{provider}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className={cn('gap-1', tone === 'ok' && 'text-green-600 dark:text-green-400', tone === 'err' && 'text-destructive')}>
            <CircleAlertIcon className="size-3" />
            {statusLabel(state)}
          </Badge>
          <Button variant="ghost" size="icon-sm" aria-label="Refresh quota" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCwIcon className={cn('size-3.5', refreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>
      <div className="mt-2 space-y-1">{quotaBody}</div>
      {accountLimits?.fetched_at && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">Checked {fmtReset(accountLimits.fetched_at)}</p>
      )}
    </div>
  )
}

function toneClass(state: string | null | undefined): string {
  switch (statusTone(state)) {
    case 'ok':
      return 'text-green-600 dark:text-green-400'
    case 'err':
      return 'text-destructive'
    case 'warn':
      return 'text-warning'
    default:
      return 'text-muted-foreground'
  }
}

// ── OpenRouter cost history ────────────────────────────────────────────────

function CostHistory({ history, onBudgetChanged }: { history: ProviderCostHistoryResponse | null; onBudgetChanged: () => void }) {
  const [budgetInput, setBudgetInput] = useState<string>(
    history?.monthly_budget != null ? Number(history.monthly_budget).toFixed(2) : '',
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setBudgetInput(history?.monthly_budget != null ? Number(history.monthly_budget).toFixed(2) : '')
  }, [history?.monthly_budget])

  const snaps = Array.isArray(history?.snapshots) ? (history.snapshots ?? []) : []
  const hasData = snaps.some((s) => s.delta != null)
  const maxDelta = Math.max(...snaps.map((s) => (s.delta != null ? Number(s.delta) : 0)), 1e-9)
  const nonNull = snaps.filter((s) => s.delta != null).map((s) => Number(s.delta))
  const avg = nonNull.length ? nonNull.reduce((a, b) => a + b, 0) / nonNull.length : 0
  const paceNum = avg * 30
  const budget = history?.monthly_budget != null ? Number(history.monthly_budget) : null

  const saveBudget = async (value: number | null) => {
    setSaving(true)
    try {
      await setProviderCostBudget(value)
      toast.success(value == null ? 'Budget cleared' : `Budget set to $${value.toFixed(2)}`)
      onBudgetChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save budget')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">7-day spend</span>
        {hasData && (
          <span className="text-[11px] text-muted-foreground">
            Monthly pace: ${paceNum.toFixed(2)}
            {budget != null && paceNum > 0 && ` (${Math.round((paceNum / budget) * 100)}%)`}
          </span>
        )}
      </div>
      {!history || history.ok === false ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {history?.message ?? 'Cost history is only available for OpenRouter.'}
        </p>
      ) : !hasData ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Not enough data yet. Cost chart builds after 2 daily snapshots.
        </p>
      ) : (
        <div className="mt-2 flex h-16 items-end gap-1">
          {snaps.map((s, i) => {
            const delta = s.delta != null ? Number(s.delta) : null
            const pct = delta != null ? Math.max((delta / maxDelta) * 100, delta > 0 ? 2 : 0) : 0
            return (
              <div
                key={i}
                title={delta != null ? `${s.date} · $${delta.toFixed(4)}` : `${s.date} · no baseline`}
                className="flex flex-1 flex-col items-center gap-0.5"
              >
                <div className="flex w-full flex-1 items-end">
                  <div className="w-full rounded-t bg-accent/70" style={{ height: `${pct}%` }} />
                </div>
                <span className="text-[9px] text-muted-foreground">{(s.date ?? '').slice(5)}</span>
              </div>
            )
          })}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Monthly budget</span>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground">$</span>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            placeholder="e.g. 50.00"
            className="h-7 w-24 text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={saving || !budgetInput || !Number.isFinite(parseFloat(budgetInput)) || parseFloat(budgetInput) <= 0}
            onClick={() => void saveBudget(parseFloat(budgetInput))}
          >
            Set
          </Button>
          {budget != null && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={saving} onClick={() => void saveBudget(null)}>
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── provider card ──────────────────────────────────────────────────────────

function ProviderCard({ provider, onChanged }: { provider: ProviderInfo; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [keyValue, setKeyValue] = useState('')
  // self-hosted fields
  const [baseUrl, setBaseUrl] = useState(provider.base_url ?? SELF_HOSTED_DEFAULT_BASE_URLS[provider.id] ?? '')
  const [model, setModel] = useState('')
  const [selfHostedKey, setSelfHostedKey] = useState('')
  const [probeStatus, setProbeStatus] = useState<{ tone: 'ok' | 'err' | 'muted'; text: string } | null>(null)
  const [probeBusy, setProbeBusy] = useState(false)

  const isOauth = provider.is_oauth === true
  const isSelfHosted = SELF_HOSTED_IDS.has(provider.id) || provider.is_self_hosted === true
  const modelCount = Number.isFinite(Number(provider.models_total))
    ? Number(provider.models_total)
    : (Array.isArray(provider.models) ? provider.models.length : 0)
  const renderedModels = Array.isArray(provider.models) ? provider.models : []
  const hiddenCount = Math.max(0, modelCount - renderedModels.length)

  const sourceLabel =
    provider.key_source === 'oauth'
      ? 'OAuth'
      : provider.key_source === 'config_yaml'
        ? 'Configured'
        : provider.key_source === 'pool'
          ? 'Credential pool'
          : provider.has_key
            ? 'API key'
            : 'Not configured'

  const saveKey = async () => {
    const key = keyValue.trim()
    if (!key) {
      toast.error('Enter an API key first')
      return
    }
    setBusy(true)
    try {
      const res = await setProviderKey(provider.id, key)
      if (res.ok) {
        toast.success(`${res.provider ?? provider.id} key ${res.action ?? 'updated'}`)
        setKeyValue('')
        onChanged()
      } else {
        toast.error(res.error ?? 'Failed to save key')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save key')
    } finally {
      setBusy(false)
    }
  }

  const removeKey = async () => {
    setBusy(true)
    try {
      const res = await deleteProviderKey(provider.id)
      if (res.ok) {
        toast.success(`${res.provider ?? provider.id} key removed`)
        onChanged()
      } else {
        toast.error(res.error ?? 'Failed to remove key')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove key')
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async () => {
    const url = baseUrl.trim()
    if (!url) {
      toast.error('Base URL is required')
      return
    }
    setProbeBusy(true)
    setProbeStatus({ tone: 'muted', text: 'Testing connection…' })
    try {
      const res = await probeProviderEndpoint({
        provider: provider.id,
        base_url: url,
        api_key: selfHostedKey.trim() || undefined,
      })
      if (res.ok) {
        const count = Array.isArray(res.models) ? res.models.length : 0
        setProbeStatus({ tone: 'ok', text: `Connected. ${count} model${count === 1 ? '' : 's'} available.` })
        if (!model && Array.isArray(res.models) && res.models[0]) {
          const first = res.models[0]
          setModel(typeof first === 'string' ? first : (first.id ?? ''))
        }
      } else {
        setProbeStatus({
          tone: 'err',
          text: `${res.error ?? 'unreachable'}${res.detail ? ` (${res.detail})` : ''}`,
        })
      }
    } catch (e) {
      setProbeStatus({ tone: 'err', text: e instanceof Error ? e.message : 'Connection test failed' })
    } finally {
      setProbeBusy(false)
    }
  }

  const saveSelfHosted = async () => {
    const url = baseUrl.trim()
    const m = model.trim()
    if (!url) {
      toast.error('Base URL is required')
      return
    }
    if (!m) {
      toast.error('Model is required')
      return
    }
    setBusy(true)
    try {
      const res = await setupSelfHostedProvider({
        provider: provider.id,
        base_url: url,
        model: m,
        api_key: selfHostedKey.trim() || undefined,
      })
      if (res.ok) {
        toast.success(`${res.provider ?? provider.id} configured`)
        setSelfHostedKey('')
        onChanged()
      } else {
        toast.error(res.error ?? 'Failed to save provider')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save provider')
    } finally {
      setBusy(false)
    }
  }

  const refreshModels = async () => {
    setBusy(true)
    try {
      const res = await refreshProviderModels(provider.id)
      toast.success(res.ok ? `Models refreshed for ${res.provider ?? provider.id}` : (res.error ?? 'Refresh failed'))
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to refresh models')
    } finally {
      setBusy(false)
    }
  }

  const body = (() => {
    if (isOauth) {
      if (provider.key_source === 'config_yaml') {
        return (
          <p className="text-xs text-muted-foreground">
            Token configured via config.yaml. To update, edit the providers section in your config.yaml or run hermes auth.
          </p>
        )
      }
      if (provider.auth_error) {
        return <p className="text-xs text-warning">{provider.auth_error}</p>
      }
      if (provider.has_key) {
        return <p className="text-xs text-muted-foreground">Authenticated. Managed with hermes auth in the terminal.</p>
      }
      return <p className="text-xs text-muted-foreground">Not authenticated. Run hermes auth in the terminal to configure this provider.</p>
    }

    if (isSelfHosted) {
      return (
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">Base URL</label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={SELF_HOSTED_DEFAULT_BASE_URLS[provider.id] ?? 'http://localhost:11434/v1'}
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">Model</label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. llama3.1" className="h-7 text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">API key (optional)</label>
            <Input
              type="password"
              value={selfHostedKey}
              onChange={(e) => setSelfHostedKey(e.target.value)}
              placeholder={provider.has_key ? '•••••••• (replace)' : 'Leave empty if not required'}
              className="h-7 text-xs"
            />
          </div>
          {probeStatus && (
            <p className={cn('text-[11px]', probeStatus.tone === 'ok' ? 'text-green-600 dark:text-green-400' : probeStatus.tone === 'err' ? 'text-destructive' : 'text-muted-foreground')}>
              {probeStatus.text}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => void testConnection()} disabled={probeBusy || busy}>
              {probeBusy ? <Loader2Icon className="size-3 animate-spin" /> : null}
              Test connection
            </Button>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => void saveSelfHosted()} disabled={busy}>
              {busy ? <Loader2Icon className="size-3 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      )
    }

    if (!provider.configurable && !provider.is_plugin_provider) {
      return (
        <p className="text-xs text-muted-foreground">
          {provider.is_custom
            ? 'Custom provider loaded from config.yaml / hermes model. Edit it from the CLI or config file.'
            : 'Provider is managed outside the WebUI.'}
        </p>
      )
    }

    return (
      <div className="space-y-2">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">API key</label>
          <Input
            type="password"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            placeholder={provider.has_key ? '•••••••• (replace)' : 'Enter API key'}
            className="h-7 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" className="h-7 px-2 text-xs" onClick={() => void saveKey()} disabled={busy || !keyValue.trim()}>
            {busy ? <Loader2Icon className="size-3 animate-spin" /> : null}
            {provider.has_key ? 'Replace' : 'Save'}
          </Button>
          {provider.has_key && (
            <Button variant="destructive" size="sm" className="h-7 px-2 text-xs" onClick={() => void removeKey()} disabled={busy}>
              <Trash2Icon className="size-3" />
              Remove
            </Button>
          )}
        </div>
      </div>
    )
  })()

  return (
    <div className="rounded-lg border border-border bg-muted/30" data-provider-card={provider.id}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronDownIcon className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{provider.display_name}</div>
          <div className="text-[11px] text-muted-foreground">
            {modelCount > 0 && `${modelCount} model${modelCount === 1 ? '' : 's'} · `}
            {sourceLabel}
          </div>
        </div>
        {provider.has_key && (
          <Badge variant="outline" className="shrink-0">
            <CheckIcon className="size-3" /> Configured
          </Badge>
        )}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border/60 px-3 py-2">
          {body}
          {modelCount > 0 && (
            <div>
              <div className="text-[11px] text-muted-foreground">Models</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {renderedModels.slice(0, 12).map((m) => (
                  <span key={m.id} className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {m.id}
                  </span>
                ))}
                {hiddenCount > 0 && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title="The /model slash command can autocomplete every model in this provider's catalog.">
                    +{hiddenCount} more
                  </span>
                )}
              </div>
            </div>
          )}
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void refreshModels()} disabled={busy}>
            <RefreshCwIcon className={cn('size-3', busy && 'animate-spin')} />
            Refresh models
          </Button>
        </div>
      )}
    </div>
  )
}

// ── panel ──────────────────────────────────────────────────────────────────

export function ProvidersPanel() {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null)
  const [quota, setQuota] = useState<ProviderQuotaResponse | null>(null)
  const [history, setHistory] = useState<ProviderCostHistoryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [historyProvider, setHistoryProvider] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [p, q] = await Promise.all([
        getProviders(),
        getProviderQuota(false).catch(() => null),
      ])
      setProviders(p.providers.filter(
        (pr) => pr.configurable || pr.is_oauth || pr.is_custom || pr.is_plugin_provider || pr.is_self_hosted,
      ))
      setQuota(q)
      setError(null)
      // OpenRouter cost history (only supported provider).
      const hp = p.providers.find((pr) => pr.id === 'openrouter')
      if (hp && hp.has_key) {
        setHistoryProvider('openrouter')
        getProviderCostHistory('openrouter')
          .then((h) => setHistory(h))
          .catch(() => setHistory(null))
      } else {
        setHistoryProvider(null)
        setHistory(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load providers.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const reloadHistory = useCallback(() => {
    if (historyProvider !== 'openrouter') return
    getProviderCostHistory('openrouter')
      .then((h) => setHistory(h))
      .catch(() => setHistory(null))
  }, [historyProvider])

  if (error && !providers) {
    return <p className="px-1 text-sm text-destructive">{error}</p>
  }

  if (!providers) {
    return (
      <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" /> Loading providers…
      </p>
    )
  }

  if (providers.length === 0) {
    return <p className="px-1 text-xs text-muted-foreground">No configurable providers found.</p>
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto pr-0.5">
      {quota && <QuotaCard quota={quota} />}
      {historyProvider === 'openrouter' && <CostHistory history={history} onBudgetChanged={reloadHistory} />}
      {providers.map((p) => (
        <ProviderCard key={p.id} provider={p} onChanged={() => void load()} />
      ))}
    </div>
  )
}

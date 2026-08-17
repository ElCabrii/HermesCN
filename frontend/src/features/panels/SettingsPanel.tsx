import { useCallback, useEffect, useState } from 'react'
import { KeyRoundIcon, Loader2Icon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { getModels, type CatalogModel } from '@/api/models'
import {
  b64uToBytes,
  bytesToB64u,
  getPasskeyRegisterOptions,
  listPasskeys,
  passkeyDelete,
  passkeyRegister,
} from '@/api/auth'
import { getSettings, updateSettings, type Settings } from '@/api/panels'
import { getWorkspaces } from '@/api/workspace'
import { UpdatesSection } from './UpdatesSection'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'

interface PasskeyCredential {
  id: string
  name?: string
  created_at?: number
  [key: string]: unknown
}

/**
 * Passkey management (WebAuthn). Lists registered credentials and supports
 * registering a new one (navigator.credentials.create) and deleting one.
 * The ceremony mirrors the login flow: b64u<->bytes conversion around the
 * backend's options/attestation payloads.
 */
function PasskeyManager() {
  const [credentials, setCredentials] = useState<PasskeyCredential[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    try {
      const data = await listPasskeys()
      setCredentials((data.credentials ?? []) as PasskeyCredential[])
    } catch {
      setCredentials([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const register = async () => {
    if (!window.PublicKeyCredential || !navigator.credentials) {
      toast.error('WebAuthn is not supported in this browser.')
      return
    }
    setBusy(true)
    try {
      const pk = await getPasskeyRegisterOptions()
      const publicKey: PublicKeyCredentialCreationOptions = {
        ...(pk as unknown as PublicKeyCredentialCreationOptions),
        challenge: b64uToBytes(String(pk.challenge)),
        user: {
          ...(pk.user as PublicKeyCredentialUserEntity),
          id: b64uToBytes(String((pk.user as { id?: string })?.id ?? '')),
        },
        excludeCredentials: Array.isArray(pk.excludeCredentials)
          ? (pk.excludeCredentials as { id: string; type: string }[]).map((c) => ({
              ...c,
              type: 'public-key' as const,
              id: b64uToBytes(c.id),
            }))
          : undefined,
      }
      const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null
      if (!cred) throw new Error('Passkey registration cancelled')
      const response = cred.response as AuthenticatorAttestationResponse
      const payload = {
        id: cred.id,
        rawId: bytesToB64u(cred.rawId),
        type: cred.type,
        response: {
          attestationObject: bytesToB64u(response.attestationObject),
          clientDataJSON: bytesToB64u(response.clientDataJSON),
        },
      }
      const result = await passkeyRegister(payload)
      if (result.ok) {
        toast.success('Passkey registered.')
        await refresh()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to register passkey.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await passkeyDelete(id)
      toast.success('Passkey removed.')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove passkey.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">Passkeys</label>
        <Button size="sm" variant="outline" onClick={() => void register()} disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon className="size-3.5" />}
          Register passkey
        </Button>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading passkeys…</p>
      ) : credentials.length === 0 ? (
        <p className="text-xs text-muted-foreground">No passkeys registered.</p>
      ) : (
        <ul className="grid gap-1.5">
          {credentials.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5"
            >
              <span className="truncate text-xs">{c.name || c.id}</span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove passkey ${c.name || c.id}`}
                disabled={busy}
                onClick={() => void remove(c.id)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Settings tab of the Control Center: a small form over a SAFE subset of
 * settings.json keys, using the exact key names from the legacy settings
 * tab (static/panels.js + static/index.html):
 *
 *   - `default_model`      — model id, options from GET /api/models
 *   - `default_workspace`  — workspace path, options from GET /api/workspaces
 *   - `send_key`           — 'enter' | 'ctrl+enter' | 'shift+enter'
 *   - `language`           — locale code, the LOCALES set from static/i18n.js
 *
 * Save posts a partial update (POST /api/settings) with only these keys;
 * every other settings.json key is left untouched.
 */

/** Locale codes shipped by the legacy i18n bundles (static/i18n.js LOCALES). */
const LANGUAGES = ['en', 'it', 'ja', 'ru', 'es', 'de', 'zh', 'pt', 'ko', 'fr', 'cs', 'tr', 'pl', 'vi']

/** Send-key options from the legacy settings tab (static/index.html). */
const SEND_KEYS = ['enter', 'ctrl+enter', 'shift+enter']

interface FormFields {
  default_model: string
  default_workspace: string
  send_key: string
  language: string
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [models, setModels] = useState<CatalogModel[]>([])
  const [workspaces, setWorkspaces] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<FormFields>({
    default_model: '',
    default_workspace: '',
    send_key: 'enter',
    language: 'en',
  })
  const [saving, setSaving] = useState(false)

  // Persist a partial settings patch (used by embedded sections like Updates
  // that own their own controls) and refresh the local settings snapshot.
  const updateSetting = useCallback(async (patch: Partial<Settings>) => {
    try {
      const saved = await updateSettings(patch)
      setSettings(saved)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save setting.')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([getSettings(), getModels(), getWorkspaces()])
      .then(([s, catalog, ws]) => {
        if (cancelled) return
        setSettings(s)
        setModels(catalog.groups.flatMap((g) => g.models))
        setWorkspaces((ws.workspaces ?? []).map((w) => w.path))
        setFields({
          default_model:
            typeof s.default_model === 'string' && s.default_model
              ? s.default_model
              : catalog.default_model || '',
          default_workspace: typeof s.default_workspace === 'string' ? s.default_workspace : '',
          send_key: SEND_KEYS.includes(s.send_key as string) ? (s.send_key as string) : 'enter',
          language: LANGUAGES.includes(s.language as string) ? (s.language as string) : 'en',
        })
        setError(null)
      })
      .catch((e) => {
        if (!cancelled)
          setError('Failed to load settings: ' + (e instanceof Error ? e.message : String(e)))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const saved = await updateSettings({
        default_model: fields.default_model,
        default_workspace: fields.default_workspace,
        send_key: fields.send_key,
        language: fields.language,
      })
      setSettings(saved)
      toast.success('Settings saved.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  if (error && !settings) {
    return <p className="px-1 text-sm text-destructive">{error}</p>
  }

  if (!settings) {
    return (
      <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" /> Loading settings…
      </p>
    )
  }

  // keep the currently configured model selectable even if it left the catalog
  const modelOptions = models.some((m) => m.id === fields.default_model)
    ? models
    : [{ id: fields.default_model, label: fields.default_model }, ...models]

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid max-w-md gap-3">
        <div className="grid gap-1.5">
          <label htmlFor="cc-default-model" className="text-xs text-muted-foreground">
            Default model
          </label>
          <NativeSelect
            id="cc-default-model"
            aria-label="Default model"
            value={fields.default_model}
            onChange={(e) => setFields({ ...fields, default_model: e.target.value })}
          >
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="cc-default-workspace" className="text-xs text-muted-foreground">
            Default workspace
          </label>
          <NativeSelect
            id="cc-default-workspace"
            aria-label="Default workspace"
            value={fields.default_workspace}
            onChange={(e) => setFields({ ...fields, default_workspace: e.target.value })}
          >
            {workspaces.length === 0 && <option value="">None</option>}
            {workspaces.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="cc-send-key" className="text-xs text-muted-foreground">
            Send key
          </label>
          <NativeSelect
            id="cc-send-key"
            aria-label="Send key"
            value={fields.send_key}
            onChange={(e) => setFields({ ...fields, send_key: e.target.value })}
          >
            {SEND_KEYS.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="cc-language" className="text-xs text-muted-foreground">
            Language
          </label>
          <NativeSelect
            id="cc-language"
            aria-label="Language"
            value={fields.language}
            onChange={(e) => setFields({ ...fields, language: e.target.value })}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="mt-auto border-t border-border/60 pt-3">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving && <Loader2Icon className="animate-spin" />}
          Save settings
        </Button>
      </div>

      <div className="border-t border-border/60 pt-3">
        <PasskeyManager />
      </div>

      <div className="border-t border-border/60 pt-3">
        <UpdatesSection settings={settings} onChange={(patch) => void updateSetting(patch)} />
      </div>
    </div>
  )
}

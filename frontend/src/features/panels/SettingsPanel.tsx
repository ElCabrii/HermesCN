import { useEffect, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { getModels, type CatalogModel } from '@/api/models'
import { getSettings, updateSettings, type Settings } from '@/api/panels'
import { getWorkspaces } from '@/api/workspace'
import { Button } from '@/components/ui/button'

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
          <select
            id="cc-default-model"
            aria-label="Default model"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            value={fields.default_model}
            onChange={(e) => setFields({ ...fields, default_model: e.target.value })}
          >
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="cc-default-workspace" className="text-xs text-muted-foreground">
            Default workspace
          </label>
          <select
            id="cc-default-workspace"
            aria-label="Default workspace"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            value={fields.default_workspace}
            onChange={(e) => setFields({ ...fields, default_workspace: e.target.value })}
          >
            {workspaces.length === 0 && <option value="">None</option>}
            {workspaces.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="cc-send-key" className="text-xs text-muted-foreground">
            Send key
          </label>
          <select
            id="cc-send-key"
            aria-label="Send key"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            value={fields.send_key}
            onChange={(e) => setFields({ ...fields, send_key: e.target.value })}
          >
            {SEND_KEYS.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="cc-language" className="text-xs text-muted-foreground">
            Language
          </label>
          <select
            id="cc-language"
            aria-label="Language"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            value={fields.language}
            onChange={(e) => setFields({ ...fields, language: e.target.value })}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-auto border-t border-border/60 pt-3">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving && <Loader2Icon className="animate-spin" />}
          Save settings
        </Button>
      </div>
    </div>
  )
}

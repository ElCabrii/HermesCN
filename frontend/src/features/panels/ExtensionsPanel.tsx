import { useCallback, useEffect, useState } from 'react'
import { Loader2Icon, RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import {
  getExtensionRegistry,
  getExtensionStatus,
  installExtension,
  toggleExtension,
  uninstallExtension,
  type ExtensionRegistryEntry,
  type ExtensionStatus,
  type ExtensionStatusRow,
} from '@/api/extensions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/**
 * Extensions tab of the Control Center.
 *
 * Mirrors the legacy Extensions panel (static/panels.js): a diagnostics list
 * of installed manifest extensions (enable/disable toggle + uninstall for
 * gallery-installed ones) and a gallery of installable extensions from the
 * remote registry. Toggle/install/uninstall call the API then reload both
 * lists, matching the legacy reload-after-mutation behavior.
 */

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'enabled') return 'default'
  if (status === 'user_disabled') return 'secondary'
  if (status === 'manifest_disabled') return 'destructive'
  return 'outline'
}

export function ExtensionsPanel() {
  const [status, setStatus] = useState<ExtensionStatus | null>(null)
  const [registry, setRegistry] = useState<ExtensionRegistryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [statusData, registryData] = await Promise.all([
        getExtensionStatus(),
        getExtensionRegistry(),
      ])
      setStatus(statusData)
      setRegistry(registryData.entries ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load extensions.')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const installedIds = new Set<string>()
  if (status?.gallery_installed) {
    for (const id of Object.keys(status.gallery_installed)) installedIds.add(id)
  }
  for (const ext of status?.extensions ?? []) {
    if (ext.id) installedIds.add(ext.id)
  }

  const handleToggle = async (ext: ExtensionStatusRow) => {
    const nextEnabled = !ext.user_enabled
    setBusyId(ext.id)
    try {
      await toggleExtension(ext.id, nextEnabled)
      toast.success(
        nextEnabled
          ? 'Extension enabled. Reload WebUI to apply changes.'
          : 'Extension disabled. Reload WebUI to apply changes.',
      )
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update extension.')
    } finally {
      setBusyId(null)
    }
  }

  const handleInstall = async (entry: ExtensionRegistryEntry) => {
    const downloadUrl = entry.download_url || entry.download
    if (!downloadUrl || !entry.sha256) {
      toast.error('This extension is missing a download URL or checksum.')
      return
    }
    setBusyId(entry.id)
    try {
      await installExtension(entry.id, downloadUrl, entry.sha256)
      toast.success('Extension installed.')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to install extension.')
    } finally {
      setBusyId(null)
    }
  }

  const handleUninstall = async (id: string) => {
    setBusyId(id)
    try {
      await uninstallExtension(id)
      toast.success('Extension uninstalled.')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to uninstall extension.')
    } finally {
      setBusyId(null)
    }
  }

  if (error && !status) {
    return <p className="px-1 text-sm text-destructive">{error}</p>
  }

  const installed = status?.extensions ?? []
  const gallery = registry ?? []

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pr-1">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
          Installed extensions
        </h3>
        <Button size="sm" variant="ghost" onClick={() => void refresh()}>
          <RefreshCwIcon />
          Refresh
        </Button>
      </div>

      {status === null ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" /> Loading extensions…
        </p>
      ) : installed.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {status.extension_dir_configured
            ? 'No manifest extensions are installed in the configured bundle.'
            : 'No extension directory is configured.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {installed.map((ext) => {
            const canUninstall = installedIds.has(ext.id)
            return (
              <li
                key={ext.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm">{ext.name}</span>
                    <Badge variant={statusVariant(ext.status)}>{ext.status}</Badge>
                  </div>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {ext.id}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {canUninstall && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Uninstall ${ext.name}`}
                      disabled={busyId === ext.id}
                      onClick={() => void handleUninstall(ext.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!ext.can_toggle || busyId === ext.id}
                    onClick={() => void handleToggle(ext)}
                  >
                    {busyId === ext.id && <Loader2Icon className="animate-spin" />}
                    {ext.user_enabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <h3 className="mt-2 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
        Gallery
      </h3>
      {registry === null ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" /> Loading gallery…
        </p>
      ) : gallery.length === 0 ? (
        <p className="text-xs text-muted-foreground">No extensions found in the registry.</p>
      ) : (
        <ul className="space-y-2">
          {gallery.map((entry) => {
            const isInstalled = installedIds.has(entry.id)
            const metaBits: string[] = []
            if (entry.author) metaBits.push(`by ${entry.author}`)
            if (entry.version) metaBits.push(`v${entry.version}`)
            return (
              <li
                key={entry.id}
                className="rounded-md border border-border/60 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm">{entry.name || entry.id}</span>
                      {isInstalled && <Badge variant="secondary">Installed</Badge>}
                    </div>
                    {metaBits.length > 0 && (
                      <p className="truncate text-xs text-muted-foreground">
                        {metaBits.join(' · ')}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={isInstalled ? 'outline' : 'default'}
                    disabled={busyId === entry.id}
                    onClick={() =>
                      void (isInstalled
                        ? handleUninstall(entry.id)
                        : handleInstall(entry))
                    }
                  >
                    {busyId === entry.id && <Loader2Icon className="animate-spin" />}
                    {isInstalled ? 'Uninstall' : 'Install'}
                  </Button>
                </div>
                {entry.description && (
                  <p className="mt-1 text-xs text-muted-foreground">{entry.description}</p>
                )}
                {Array.isArray(entry.capabilities) && entry.capabilities.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {entry.capabilities.map((cap) => (
                      <Badge key={cap} variant="outline">
                        {cap}
                      </Badge>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

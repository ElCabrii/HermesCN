import { useEffect, useState } from 'react'
import { Loader2Icon, RefreshCwIcon, ShieldAlertIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { Settings } from '@/api/panels'
import { applyUpdate, checkUpdates, clearUpdateLock, type UpdateStatusResponse } from '@/api/updates'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'

const CHANNELS = ['stable', 'experimental'] as const

interface UpdatesSectionProps {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
}

/**
 * Updates section of the Settings tab: shows the installed WebUI version, an
 * "update available" indicator with an Apply button, a release-channel
 * selector, and a "Check now" affordance. The parent SettingsPanel owns the
 * settings state (this component reads/writes `update_channel` through the
 * `settings`/`onChange` props and never fetches /api/settings itself).
 *
 * The "Clear lock" action appears only after an apply attempt reports a git
 * lock conflict (`lock_conflict`), matching the backend's non-destructive
 * recovery flow (POST /api/updates/clear_lock).
 */
export function UpdatesSection({ settings, onChange }: UpdatesSectionProps) {
  const [status, setStatus] = useState<UpdateStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lockConflict, setLockConflict] = useState(false)

  const load = async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      setStatus(await checkUpdates(force))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to check for updates.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const webui = status?.webui
  const updateAvailable = Boolean(webui && (webui.behind ?? 0) > 0)
  const currentVersion = webui?.current_version || webui?.current_sha || 'unknown'
  const latestVersion = webui?.latest_version || webui?.latest_sha
  const channel = settings.update_channel === 'experimental' ? 'experimental' : 'stable'

  const handleCheckNow = async () => {
    setBusy(true)
    try {
      await load(true)
      toast.success('Update check complete.')
    } catch {
      // load() already surfaced the error state
    } finally {
      setBusy(false)
    }
  }

  const handleApply = async () => {
    setBusy(true)
    try {
      const res = await applyUpdate('webui', channel)
      if (res.ok) {
        toast.success(res.message || 'Update applied.')
        // The server re-execs shortly after a successful apply.
        setTimeout(() => window.location.reload(), 2500)
      } else {
        if (res.lock_conflict) setLockConflict(true)
        toast.error(res.message || 'Update failed.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed.')
    } finally {
      setBusy(false)
    }
  }

  const handleClearLock = async () => {
    setBusy(true)
    try {
      const res = await clearUpdateLock('webui')
      if (res.ok) {
        setLockConflict(false)
        toast.success(res.message || 'Lock cleared.')
        await load(true)
      } else {
        if (res.lock_held) setLockConflict(true)
        toast.error(res.message || 'Could not clear the update lock.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear the update lock.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">Updates</label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleCheckNow()}
          disabled={busy || loading}
        >
          {busy ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
          Check now
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Checking for updates…</p>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : status?.disabled ? (
        <p className="text-xs text-muted-foreground">Update checks are disabled.</p>
      ) : (
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5">
            <span className="text-xs text-muted-foreground">WebUI version</span>
            <span className="font-mono text-xs">{currentVersion}</span>
          </div>

          {updateAvailable ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <SparklesIcon className="size-3.5 text-amber-500" />
                Update available
                {latestVersion ? <span className="font-mono">{latestVersion}</span> : null}
              </span>
              <Button size="sm" onClick={() => void handleApply()} disabled={busy}>
                {busy && <Loader2Icon className="animate-spin" />}
                Apply update
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">You are up to date.</p>
          )}

          {lockConflict && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 px-2 py-1.5">
              <span className="flex items-center gap-1.5 text-xs text-destructive">
                <ShieldAlertIcon className="size-3.5" />
                Update lock detected
              </span>
              <Button size="sm" variant="outline" onClick={() => void handleClearLock()} disabled={busy}>
                {busy && <Loader2Icon className="animate-spin" />}
                Clear lock
              </Button>
            </div>
          )}

          <div className="grid gap-1.5">
            <label htmlFor="cc-update-channel" className="text-xs text-muted-foreground">
              Update channel
            </label>
            <NativeSelect
              id="cc-update-channel"
              aria-label="Update channel"
              value={channel}
              onChange={(e) => onChange({ update_channel: e.target.value })}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { getProfiles, switchProfile, type ProfilesResponse } from '@/api/panels'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/**
 * Profiles tab of the Control Center: list the available Hermes profiles
 * (GET /api/profiles) and switch the per-client active one
 * (POST /api/profile/switch via the panels client). The switcher is
 * hidden entirely in single-profile mode (`single_profile_mode`), where
 * only the pinned profile exists.
 */

export function ProfilesPanel() {
  const [data, setData] = useState<ProfilesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getProfiles()
      .then((response) => {
        if (!cancelled) {
          setData(response)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load profiles.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const doSwitch = async (name: string) => {
    setSwitching(name)
    try {
      const response = await switchProfile(name)
      // the switch response omits `single_profile_mode`; keep the loaded flag
      setData({ ...response, single_profile_mode: data?.single_profile_mode ?? false })
      toast.success(`Switched to "${name}".`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to switch profile.')
    } finally {
      setSwitching(null)
    }
  }

  if (error && !data) {
    return <p className="px-1 text-sm text-destructive">{error}</p>
  }

  if (!data) {
    return (
      <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" /> Loading profiles…
      </p>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {data.single_profile_mode && (
        <p className="border-b border-border/60 px-1 pb-2 text-xs text-muted-foreground">
          Single-profile mode — profile switching is disabled.
        </p>
      )}
      <ul className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto">
        {data.profiles.map((profile) => (
          <li key={profile.name} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm">{profile.name}</span>
                {profile.is_default && (
                  <Badge variant="outline" className="shrink-0">
                    Default
                  </Badge>
                )}
                {profile.is_active && (
                  <Badge variant="secondary" className="shrink-0">
                    Active
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {profile.model && (
                  <span>
                    {profile.model}
                    {profile.provider ? ` · ${profile.provider}` : ''}
                  </span>
                )}
                {typeof profile.total_skills === 'number' && (
                  <span>
                    {profile.enabled_skills ?? 0}/{profile.total_skills} skills
                  </span>
                )}
              </div>
            </div>
            {!data.single_profile_mode && !profile.is_active && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => void doSwitch(profile.name)}
                disabled={switching !== null}
              >
                {switching === profile.name && <Loader2Icon className="animate-spin" />}
                Switch to {profile.name}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

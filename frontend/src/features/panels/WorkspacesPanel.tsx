import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  FolderOpenIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  addWorkspace,
  getWorkspaces,
  removeWorkspace,
  renameWorkspace,
  reorderWorkspaces,
  suggestWorkspaces,
  type WorkspacesResponse,
} from '@/api/workspace'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Workspaces tab of the Control Center: manage the workspace catalog
 * (GET /api/workspaces + the POST /api/workspaces/* mutations via the typed
 * client in `@/api/workspace`).
 *
 * This is the list/switcher manager, distinct from the right-column file-tree
 * panel. The `last` field marks the currently-active workspace (set when a
 * session binds to a workspace). "Switch" here reorders the chosen workspace
 * to the top of the catalog via `reorderWorkspaces` — the closest available
 * workspace-API action, since binding a session to a workspace is
 * session-scoped (`updateSession`) and out of scope for this tab.
 *
 * After any mutation the panel reloads from GET /api/workspaces so the list
 * reflects the server truth.
 */

function displayName(row: { path: string; name?: string }): string {
  return row.name?.trim() || row.path.split('/').filter(Boolean).pop() || row.path
}

export function WorkspacesPanel() {
  const [data, setData] = useState<WorkspacesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // add form
  const [adding, setAdding] = useState(false)
  const [addPath, setAddPath] = useState('')
  const [addName, setAddName] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])

  // rename
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')

  // remove confirm
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await getWorkspaces()
      setData(res)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspaces.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const reload = useCallback(async () => {
    try {
      const res = await getWorkspaces()
      setData(res)
      setError(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reload workspaces.')
    }
  }, [])

  const doSwitch = async (path: string) => {
    if (!data) return
    setBusy(path)
    try {
      const rest = data.workspaces.filter((w) => w.path !== path).map((w) => w.path)
      await reorderWorkspaces([path, ...rest])
      toast.success('Workspace set active')
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to switch workspace.')
    } finally {
      setBusy(null)
    }
  }

  const doMove = async (path: string, dir: -1 | 1) => {
    if (!data) return
    const idx = data.workspaces.findIndex((w) => w.path === path)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= data.workspaces.length) return
    const next = [...data.workspaces]
    const [row] = next.splice(idx, 1)
    next.splice(target, 0, row)
    setBusy(path)
    try {
      await reorderWorkspaces(next.map((w) => w.path))
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reorder workspaces.')
    } finally {
      setBusy(null)
    }
  }

  const loadSuggestions = async (prefix: string) => {
    try {
      const res = await suggestWorkspaces(prefix)
      setSuggestions(res.suggestions)
    } catch {
      setSuggestions([])
    }
  }

  const doAdd = async () => {
    const path = addPath.trim()
    if (!path) {
      toast.error('Enter a workspace path first')
      return
    }
    setBusy('__add__')
    try {
      await addWorkspace(path, { name: addName.trim() || undefined, create: true })
      toast.success('Workspace added')
      setAdding(false)
      setAddPath('')
      setAddName('')
      setSuggestions([])
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add workspace.')
    } finally {
      setBusy(null)
    }
  }

  const doRename = async () => {
    if (!renameTarget) return
    const name = renameName.trim()
    if (!name) {
      toast.error('Enter a name first')
      return
    }
    setBusy(renameTarget)
    try {
      await renameWorkspace(renameTarget, name)
      toast.success('Workspace renamed')
      setRenameTarget(null)
      setRenameName('')
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to rename workspace.')
    } finally {
      setBusy(null)
    }
  }

  const doRemove = async () => {
    if (!confirmRemove) return
    setBusy(confirmRemove)
    try {
      await removeWorkspace(confirmRemove)
      toast.success('Workspace removed')
      setConfirmRemove(null)
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove workspace.')
    } finally {
      setBusy(null)
    }
  }

  if (error && !data) {
    return <p className="px-1 text-sm text-destructive">{error}</p>
  }

  if (!data) {
    return (
      <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" /> Loading workspaces…
      </p>
    )
  }

  const workspaces = data.workspaces

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}
        </p>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <PlusIcon /> Add
        </Button>
      </div>

      {adding && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2">
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">Path</label>
            <Input
              value={addPath}
              onChange={(e) => {
                setAddPath(e.target.value)
                void loadSuggestions(e.target.value)
              }}
              placeholder="/path/to/workspace"
              className="h-7 text-xs"
            />
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => setAddPath(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">Name (optional)</label>
            <Input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Display name"
              className="h-7 text-xs"
            />
          </div>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void doAdd()}
              disabled={busy !== null}
            >
              {busy === '__add__' && <Loader2Icon className="size-3 animate-spin" />}
              Add workspace
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {workspaces.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">No workspaces yet. Add one to get started.</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto">
          {workspaces.map((ws, i) => {
            const isActive = ws.path === data.last
            const isBusy = busy === ws.path
            return (
              <li key={ws.path} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    {renameTarget === ws.path ? (
                      <Input
                        value={renameName}
                        onChange={(e) => setRenameName(e.target.value)}
                        className="h-6 w-40 text-xs"
                        autoFocus
                      />
                    ) : (
                      <span className="truncate text-sm">{displayName(ws)}</span>
                    )}
                    {isActive && (
                      <Badge variant="secondary" className="shrink-0">
                        Active
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{ws.path}</div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {renameTarget === ws.path ? (
                    <>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Confirm rename"
                        onClick={() => void doRename()}
                        disabled={isBusy}
                      >
                        <CheckIcon />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Cancel rename"
                        onClick={() => setRenameTarget(null)}
                      >
                        <XIcon />
                      </Button>
                    </>
                  ) : (
                    <>
                      {!isActive && (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Switch to ${displayName(ws)}`}
                          onClick={() => void doSwitch(ws.path)}
                          disabled={isBusy}
                        >
                          {isBusy ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
                        </Button>
                      )}
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Rename ${displayName(ws)}`}
                        onClick={() => {
                          setRenameTarget(ws.path)
                          setRenameName(displayName(ws))
                        }}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Move ${displayName(ws)} up`}
                        disabled={i === 0 || isBusy}
                        onClick={() => void doMove(ws.path, -1)}
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Move ${displayName(ws)} down`}
                        disabled={i === workspaces.length - 1 || isBusy}
                        onClick={() => void doMove(ws.path, 1)}
                      >
                        <ArrowDownIcon />
                      </Button>
                      {confirmRemove === ws.path ? (
                        <Button
                          size="icon-xs"
                          variant="destructive"
                          aria-label="Confirm remove"
                          onClick={() => void doRemove()}
                          disabled={isBusy}
                        >
                          <Trash2Icon />
                        </Button>
                      ) : (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Remove ${displayName(ws)}`}
                          onClick={() => setConfirmRemove(ws.path)}
                        >
                          <Trash2Icon />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { toast } from 'sonner'
import { updateSession } from '@/api/sessions'
import {
  createDir,
  createFile,
  deleteFile,
  getGitStatus,
  getWorkspaces,
  renameFile,
  type GitStatus,
  type WorkspaceEntry,
  type WorkspaceRow,
} from '@/api/workspace'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  FolderPlusIcon,
  GitBranchIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react'
import { FileEditor } from './FileEditor'
import { FilePreview } from './FilePreview'
import { FileTree } from './FileTree'
import {
  getFileKind,
  WORKSPACE_PANEL_MAX_WIDTH,
  WORKSPACE_PANEL_MIN_WIDTH,
  workspacePanelModeAtom,
  workspacePanelWidthAtom,
  workspaceStore,
} from './workspaceStore'

/**
 * Demand-driven workspace right panel (Task 5.2).
 *
 * Ports static/boot.js `_setWorkspacePanelMode` + static/workspace.js:
 * - The panel is CLOSED by default and only opens while actively browsing
 *   (`browse`) or previewing a file (`preview`); open/closed state persists
 *   via the localStorage-backed `workspacePanelModeAtom`.
 * - Browse mode shows the file tree with create/rename/delete; preview mode
 *   shows a file (image / markdown / text / binary note) with an inline
 *   editor, Escape-to-cancel, and a dirty-state guard before navigating away.
 * - The header carries the workspace switcher (GET /api/workspaces +
 *   POST /api/session/update) and a git badge (GET /api/git/status).
 * - Width is user-resizable (280–600px), persisted to localStorage.
 *
 * Not wired into ChatPage yet — this task ships the component + tests only.
 */

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export interface WorkspacePanelProps {
  sessionId: string
  /** Absolute workspace path bound to the session (null when none). */
  workspace: string | null
  /** Called after a successful workspace switch so the parent can re-bind. */
  onWorkspaceChange?: (workspace: string) => void
}

export function WorkspacePanel({ sessionId, workspace, onWorkspaceChange }: WorkspacePanelProps) {
  const [mode, setMode] = useAtom(workspacePanelModeAtom, { store: workspaceStore })
  const [width, setWidth] = useAtom(workspacePanelWidthAtom, { store: workspaceStore })

  const [currentWorkspace, setCurrentWorkspace] = useState<string | null>(workspace)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  const [treeVersion, setTreeVersion] = useState(0)

  const [wsList, setWsList] = useState<WorkspaceRow[] | null>(null)
  const [git, setGit] = useState<GitStatus | null>(null)

  const [createKind, setCreateKind] = useState<'file' | 'folder' | null>(null)
  const [createName, setCreateName] = useState('')
  const [renameTarget, setRenameTarget] = useState<WorkspaceEntry | null>(null)
  const [renameName, setRenameName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceEntry | null>(null)

  useEffect(() => {
    setCurrentWorkspace(workspace)
  }, [workspace])

  // Workspace catalog for the switcher — fetched once the panel is open.
  useEffect(() => {
    if (mode === 'closed') return
    let alive = true
    getWorkspaces()
      .then((res) => {
        if (alive) setWsList(res.workspaces)
      })
      .catch(() => {
        /* switcher falls back to showing only the current workspace */
      })
    return () => {
      alive = false
    }
  }, [mode])

  // Git badge — only when the session has a workspace.
  useEffect(() => {
    if (mode === 'closed' || !currentWorkspace) {
      setGit(null)
      return
    }
    let alive = true
    getGitStatus(sessionId)
      .then((res) => {
        if (alive) setGit(res.git)
      })
      .catch(() => {
        if (alive) setGit(null)
      })
    return () => {
      alive = false
    }
  }, [sessionId, currentWorkspace, mode])

  /** Legacy dirty guard: navigating away from unsaved edits asks first. */
  function confirmDiscard(): boolean {
    if (!editorDirty) return true
    return window.confirm('Discard unsaved changes?')
  }

  function openFile(path: string) {
    if (!confirmDiscard()) return
    setEditing(false)
    setEditorDirty(false)
    setPreviewPath(path)
    setMode('preview')
  }

  function backToList() {
    if (!confirmDiscard()) return
    setEditing(false)
    setEditorDirty(false)
    setPreviewPath(null)
    setMode('browse')
  }

  function closePanel() {
    if (!confirmDiscard()) return
    setEditing(false)
    setEditorDirty(false)
    setPreviewPath(null)
    setMode('closed')
  }

  async function handleCreate() {
    const name = createName.trim()
    if (!name || !createKind) return
    try {
      if (createKind === 'file') {
        const res = await createFile(sessionId, name)
        toast.success(`Created ${name}`)
        setCreateKind(null)
        setCreateName('')
        setTreeVersion((v) => v + 1)
        openFile(res.path)
      } else {
        await createDir(sessionId, name)
        toast.success(`Created folder ${name}`)
        setCreateKind(null)
        setCreateName('')
        setTreeVersion((v) => v + 1)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteFile(
        sessionId,
        deleteTarget.path,
        deleteTarget.type === 'dir' ? { recursive: true } : {},
      )
      toast.success(`Deleted ${deleteTarget.name}`)
      setDeleteTarget(null)
      if (previewPath === deleteTarget.path) {
        setEditing(false)
        setEditorDirty(false)
        setPreviewPath(null)
        setMode('browse')
      }
      setTreeVersion((v) => v + 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function handleRename() {
    if (!renameTarget) return
    const newName = renameName.trim()
    if (!newName || newName === renameTarget.name) {
      setRenameTarget(null)
      return
    }
    try {
      const res = await renameFile(sessionId, renameTarget.path, newName)
      toast.success(`Renamed to ${newName}`)
      setRenameTarget(null)
      setRenameName('')
      if (previewPath === renameTarget.path) setPreviewPath(res.new_path)
      setTreeVersion((v) => v + 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rename failed')
    }
  }

  async function handleSwitchWorkspace(path: string) {
    if (!currentWorkspace || path === currentWorkspace) return
    if (!confirmDiscard()) return
    try {
      await updateSession({ session_id: sessionId, workspace: path })
      setCurrentWorkspace(path)
      onWorkspaceChange?.(path)
      setEditing(false)
      setEditorDirty(false)
      setPreviewPath(null)
      setMode('browse')
      setTreeVersion((v) => v + 1)
      toast.success('Workspace switched')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Switch failed')
    }
  }

  function startResize(e: React.PointerEvent) {
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(
        WORKSPACE_PANEL_MAX_WIDTH,
        Math.max(WORKSPACE_PANEL_MIN_WIDTH, startWidth - (ev.clientX - startX)),
      )
      setWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (mode === 'closed') return null

  const showBrowse = mode === 'browse' || previewPath === null
  const previewKind = previewPath ? getFileKind(previewPath) : null
  const editable = previewKind === 'text' || previewKind === 'markdown'
  const workspaceLabel = currentWorkspace ? basename(currentWorkspace) : 'No workspace'

  return (
    <aside
      data-testid="workspace-panel"
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-card text-card-foreground"
      style={{ width: `${width}px` }}
    >
      {/* Resize handle (drag to the right shrinks, left grows). */}
      <div
        data-testid="panel-resize-handle"
        aria-hidden="true"
        className="absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize"
        onPointerDown={startResize}
      />

      <header className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                data-testid="workspace-switcher"
                className="max-w-44 justify-start gap-1.5 px-2 text-xs"
              />
            }
          >
            <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{workspaceLabel}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={4} className="max-w-72">
            {(wsList ?? []).map((w) => {
              const active = w.path === currentWorkspace
              return (
                <DropdownMenuItem
                  key={w.path}
                  data-testid={`workspace-option-${w.path}`}
                  disabled={active}
                  onClick={() => void handleSwitchWorkspace(w.path)}
                >
                  <CheckIcon
                    className={cn('size-3.5 shrink-0', active ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">
                      {w.name || basename(w.path)}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {w.path}
                    </span>
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {git?.is_git && (
          <Badge
            variant="outline"
            data-testid="git-badge"
            className="gap-1 rounded-full px-1.5 font-mono text-[11px] font-normal"
          >
            <GitBranchIcon className="size-3" />
            <span className="truncate">{git.branch}</span>
            {git.totals.changed > 0 && (
              <span className="text-muted-foreground">· {git.totals.changed}</span>
            )}
          </Badge>
        )}

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close workspace panel"
          onClick={closePanel}
        >
          <XIcon className="size-4" />
        </Button>
      </header>

      {showBrowse ? (
        <>
          <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 px-2 text-xs"
              onClick={() => setCreateKind('file')}
            >
              <PlusIcon className="size-3.5" />
              New file
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 px-2 text-xs"
              onClick={() => setCreateKind('folder')}
            >
              <FolderPlusIcon className="size-3.5" />
              New folder
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh"
              onClick={() => setTreeVersion((v) => v + 1)}
            >
              <RefreshCwIcon className="size-3.5" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {currentWorkspace ? (
              <FileTree
                sessionId={sessionId}
                selectedPath={previewPath}
                treeVersion={treeVersion}
                onOpenFile={openFile}
                onRename={(entry) => {
                  setRenameTarget(entry)
                  setRenameName(entry.name)
                }}
                onDelete={setDeleteTarget}
              />
            ) : (
              <div className="p-3 text-xs text-muted-foreground">No workspace selected</div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-2">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Back to files"
              className="gap-1 px-2 text-xs"
              onClick={backToList}
            >
              <ArrowLeftIcon className="size-3.5" />
              Files
            </Button>
            <span
              data-testid="preview-path-bar"
              className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
            >
              {previewPath}
            </span>
            {!editing && editable && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 px-2 text-xs"
                onClick={() => setEditing(true)}
              >
                <PencilIcon className="size-3.5" />
                Edit
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {editing && previewPath ? (
              <FileEditor
                key={previewPath}
                sessionId={sessionId}
                path={previewPath}
                onCancel={() => {
                  setEditorDirty(false)
                  setEditing(false)
                }}
                onSaved={() => {
                  setEditorDirty(false)
                  setEditing(false)
                }}
                onDirtyChange={setEditorDirty}
              />
            ) : previewPath ? (
              <FilePreview sessionId={sessionId} path={previewPath} />
            ) : null}
          </div>
        </>
      )}

      {/* Create file/folder dialog */}
      <Dialog
        open={createKind !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateKind(null)
            setCreateName('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createKind === 'folder' ? 'New folder' : 'New file'}</DialogTitle>
          </DialogHeader>
          <Input
            data-testid="create-name-input"
            placeholder={createKind === 'folder' ? 'folder-name' : 'filename.txt'}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate()
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateKind(null)
                setCreateName('')
              }}
            >
              Cancel
            </Button>
            <Button disabled={!createName.trim()} onClick={() => void handleCreate()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null)
            setRenameName('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename {renameTarget?.name ?? ''}</DialogTitle>
          </DialogHeader>
          <Input
            data-testid="rename-name-input"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleRename()
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameTarget(null)
                setRenameName('')
              }}
            >
              Cancel
            </Button>
            <Button disabled={!renameName.trim()} onClick={() => void handleRename()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name ?? ''}?</DialogTitle>
            <DialogDescription>
              &ldquo;{deleteTarget?.name ?? ''}&rdquo; will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}

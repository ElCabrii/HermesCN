import { useEffect, useState, type ReactNode } from 'react'
import { listDir, type WorkspaceEntry } from '@/api/workspace'
import { cn } from '@/lib/utils'
import {
  ChevronRightIcon,
  DownloadIcon,
  FileCode2Icon,
  FileTextIcon,
  FolderIcon,
  ImageIcon,
  PencilIcon,
  SettingsIcon,
  TerminalIcon,
  Trash2Icon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react'
import { getFileIconKind, type FileIconKind } from './workspaceStore'

/**
 * Workspace file tree (Task 5.2).
 *
 * - Root listing comes from GET /api/list for the session's workspace.
 * - Directories render first (defensive client sort; the server already
 *   sorts), expand on click, and fetch their children lazily on first expand
 *   (`GET /api/list?path=<dir>`); expanded dirs are cached so collapsing and
 *   re-expanding never refetches.
 * - File icons mirror the legacy `fileIcon()` mapping (static/ui.js).
 * - Row actions (rename/delete) are delegated up to the panel, which owns the
 *   confirm/create dialogs and bumps `treeVersion` to refresh this tree after
 *   any mutation.
 */

const FILE_ICONS: Record<FileIconKind, LucideIcon> = {
  folder: FolderIcon,
  image: ImageIcon,
  markdown: FileTextIcon,
  python: FileCode2Icon,
  javascript: ZapIcon,
  config: SettingsIcon,
  shell: TerminalIcon,
  download: DownloadIcon,
  file: FileTextIcon,
}

export interface FileTreeProps {
  sessionId: string
  /** Highlight a file row (the path currently previewed). */
  selectedPath?: string | null
  /** Bump to force a root refetch after a create/delete/rename/switch. */
  treeVersion?: number
  onOpenFile: (path: string) => void
  onRename: (entry: WorkspaceEntry) => void
  onDelete: (entry: WorkspaceEntry) => void
}

/** Dirs first, stable within each group (the server already alpha-sorts). */
function sortDirsFirst(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((a, b) => {
    const ad = a.type === 'dir' ? 0 : 1
    const bd = b.type === 'dir' ? 0 : 1
    return ad - bd
  })
}

export function FileTree({
  sessionId,
  selectedPath = null,
  treeVersion = 0,
  onOpenFile,
  onRename,
  onDelete,
}: FileTreeProps) {
  const [rootEntries, setRootEntries] = useState<WorkspaceEntry[] | null>(null)
  const [rootError, setRootError] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [children, setChildren] = useState<Record<string, WorkspaceEntry[]>>({})
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())

  // Root listing; refetches when the session or treeVersion changes.
  useEffect(() => {
    let alive = true
    setRootEntries(null)
    setRootError(false)
    listDir(sessionId)
      .then((res) => {
        if (alive) setRootEntries(res.entries)
      })
      .catch(() => {
        if (alive) setRootError(true)
      })
    return () => {
      alive = false
    }
  }, [sessionId, treeVersion])

  // Lazily fetch children of every newly-expanded directory (cached after).
  useEffect(() => {
    const toFetch = [...expanded].filter((p) => !(p in children))
    if (toFetch.length === 0) return
    let alive = true
    setLoadingDirs((prev) => new Set([...prev, ...toFetch]))
    Promise.all(
      toFetch.map((p) =>
        listDir(sessionId, p)
          .then((res) => [p, res.entries] as const)
          .catch(() => [p, [] as WorkspaceEntry[]] as const),
      ),
    ).then((results) => {
      if (!alive) return
      setChildren((prev) => {
        const next = { ...prev }
        for (const [p, entries] of results) next[p] = entries
        return next
      })
      setLoadingDirs((prev) => {
        const next = new Set(prev)
        for (const [p] of results) next.delete(p)
        return next
      })
    })
    return () => {
      alive = false
    }
  }, [expanded, children, sessionId])

  function toggleDir(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function renderLevel(entries: WorkspaceEntry[], depth: number): ReactNode {
    return sortDirsFirst(entries).map((entry) => {
      const isDir = entry.type === 'dir'
      const isExpanded = expanded.has(entry.path)
      const Icon = FILE_ICONS[getFileIconKind(entry.name, entry.type)]
      const selected = !isDir && selectedPath === entry.path
      return (
        <div key={entry.path}>
          <div
            className={cn(
              'group flex items-center rounded-md pr-1 hover:bg-muted/60',
              selected && 'bg-muted/60',
            )}
            style={{ paddingLeft: `${depth * 14 + 4}px` }}
          >
            <button
              type="button"
              data-testid={`tree-row-${entry.path}`}
              data-path={entry.path}
              aria-expanded={isDir ? isExpanded : undefined}
              title={entry.path}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-[3px] text-left text-[13px] text-foreground/90 outline-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => (isDir ? toggleDir(entry.path) : onOpenFile(entry.path))}
            >
              {isDir ? (
                <ChevronRightIcon
                  className={cn(
                    'size-3.5 shrink-0 text-muted-foreground transition-transform',
                    isExpanded && 'rotate-90',
                  )}
                />
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{entry.name}</span>
            </button>
            <button
              type="button"
              aria-label={`Rename ${entry.name}`}
              title={`Rename ${entry.name}`}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              onClick={() => onRename(entry)}
            >
              <PencilIcon className="size-3" />
            </button>
            <button
              type="button"
              aria-label={`Delete ${entry.name}`}
              title={`Delete ${entry.name}`}
              className="rounded p-1 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(entry)}
            >
              <Trash2Icon className="size-3" />
            </button>
          </div>
          {isDir && isExpanded && (
            <div data-testid={`tree-children-${entry.path}`}>
              {loadingDirs.has(entry.path) ? (
                <div
                  className="py-1 text-xs text-muted-foreground"
                  style={{ paddingLeft: `${(depth + 1) * 14 + 16}px` }}
                >
                  Loading…
                </div>
              ) : (
                renderLevel(children[entry.path] ?? [], depth + 1)
              )}
            </div>
          )}
        </div>
      )
    })
  }

  if (rootError) {
    return <div className="p-3 text-xs text-muted-foreground">Could not load workspace files</div>
  }
  if (rootEntries === null) {
    return <div className="p-3 text-xs text-muted-foreground">Loading…</div>
  }
  if (rootEntries.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">Empty folder</div>
  }
  return <div>{renderLevel(rootEntries, 0)}</div>
}

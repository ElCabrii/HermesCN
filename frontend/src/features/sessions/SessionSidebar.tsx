import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import {
  archiveSession,
  duplicateSession,
  listSessions,
  pinSession,
  renameSession,
  searchSessions,
  type SidebarSessionRow,
} from '@/api/sessions'
import { getProjects, type Project } from '@/api/projects'
import {
  chatStore,
  deleteSession,
  sessionAtom,
  sessionsRevisionAtom,
} from '@/features/chat/chatStore'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react'

/**
 * Session list for the chat surface (Task 4.2).
 *
 * - Rows come from GET /api/sessions (server-sorted by updated_at; order kept).
 * - Collapsible groups: Pinned / Today / Last 7 days / Older, plus a collapsed
 *   Archived group so unarchive stays reachable. Bucketing uses the server's
 *   `server_time` (falling back to the client clock) so groups stay stable
 *   across timezones and clock skew.
 * - Search debounces 250ms and swaps to GET /api/sessions/search?q=; clearing
 *   the query restores the full list.
 * - Row actions (DropdownMenu): rename inline, pin/unpin, archive/unarchive,
 *   duplicate, delete (confirm dialog). Delete delegates to the chat store's
 *   `deleteSession`, which enforces §5.6 (never creates; loads sessions[0]
 *   when the active session was deleted; empty state when none remain; always
 *   toasts "Conversation deleted").
 * - CLI/messaging/reference-only rows are read-only: the source label is
 *   shown and destructive actions are disabled.
 * - Clicking a row emits `onSelect(sessionId)`; the parent wires it to
 *   `loadSession` so the sidebar stays decoupled from the chat surface.
 */

const SEARCH_DEBOUNCE_MS = 250
const WEEK_SEC = 7 * 86_400

type GroupId = 'pinned' | 'today' | 'week' | 'older' | 'archived'

const GROUP_ORDER: GroupId[] = ['pinned', 'today', 'week', 'older', 'archived']

const GROUP_LABELS: Record<GroupId, string> = {
  pinned: 'Pinned',
  today: 'Today',
  week: 'Last 7 days',
  older: 'Older',
  archived: 'Archived',
}

/** Read-only rows are projections of foreign state (CLI/messaging/reference). */
function isReadOnlyRow(row: SidebarSessionRow): boolean {
  return Boolean(
    row.is_cli_session ||
      row.is_messaging_session ||
      row._sidebar_reference_only ||
      row.read_only ||
      row.is_read_only,
  )
}

/** Bucket a row by `updated_at` (epoch seconds) relative to `nowSec`. */
function bucketRow(row: SidebarSessionRow, nowSec: number): GroupId {
  if (row.archived) return 'archived'
  if (row.pinned) return 'pinned'
  const startOfTodaySec = Math.floor(new Date(nowSec * 1000).setHours(0, 0, 0, 0) / 1000)
  const t = row.updated_at
  if (t >= startOfTodaySec) return 'today'
  if (t >= nowSec - WEEK_SEC) return 'week'
  return 'older'
}

function rowTitle(row: SidebarSessionRow): string {
  return row.display_title || row.title || 'Untitled'
}

/** Compact relative-time string for sidebar row metadata. */
function formatRelative(updatedAt: number, nowSec: number = Math.floor(Date.now() / 1000)): string {
  const delta = Math.max(0, nowSec - updatedAt)
  if (delta < 60) return 'now'
  if (delta < 3600) return `${Math.floor(delta / 60)}m`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`
  if (delta < 604800) return `${Math.floor(delta / 86400)}d`
  const d = new Date(updatedAt * 1000)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export interface SessionSidebarProps {
  /** Emitted when the user clicks a row; the parent wires this to loadSession. */
  onSelect: (sessionId: string) => void
  /** Optional explicit active-session id; falls back to the chat store. */
  activeSessionId?: string | null
  className?: string
}

export function SessionSidebar({ onSelect, activeSessionId, className }: SessionSidebarProps) {
  const [rows, setRows] = useState<SidebarSessionRow[]>([])
  const [serverTimeSec, setServerTimeSec] = useState<number | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Partial<Record<GroupId, boolean>>>({
    archived: true,
  })
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<SidebarSessionRow | null>(null)
  // Only the first fetch shows a skeleton; later refreshes keep the list in
  // place so a rename or pin never makes the sidebar flash.
  const [loading, setLoading] = useState(true)
  const storeActive = useAtomValue(sessionAtom, { store: chatStore })
  // Bumped when a conversation is created, deleted, or auto-titled by a turn.
  const sessionsRevision = useAtomValue(sessionsRevisionAtom, { store: chatStore })
  const activeSid = activeSessionId !== undefined ? activeSessionId : storeActive?.session_id ?? null

  const loadList = useCallback(async () => {
    try {
      const res = await listSessions({ include_archived: true, exclude_hidden: true })
      setRows(res.sessions ?? [])
      if (res.server_time) setServerTimeSec(res.server_time)
    } catch {
      // Quiet surface: keep the previous list on failure.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadList()
    getProjects()
      .then((res) => setProjects(res.projects ?? []))
      .catch(() => setProjects([]))
  }, [loadList])

  // Re-read the list whenever the store reports the session set changed.
  useEffect(() => {
    if (sessionsRevision === 0) return
    void loadList()
  }, [sessionsRevision, loadList])

  // Debounced search; an empty query restores the full list.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      void loadList()
      return
    }
    const timer = setTimeout(() => {
      searchSessions(q)
        .then((res) => setRows(res.sessions ?? []))
        .catch(() => {})
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, loadList])

  const refresh = useCallback(() => {
    const q = query.trim()
    if (q) {
      searchSessions(q)
        .then((res) => setRows(res.sessions ?? []))
        .catch(() => {})
    } else {
      void loadList()
    }
  }, [query, loadList])

  const nowSec = serverTimeSec ?? Math.floor(Date.now() / 1000)

  const groups = useMemo(() => {
    const buckets: Record<GroupId, SidebarSessionRow[]> = {
      pinned: [],
      today: [],
      week: [],
      older: [],
      archived: [],
    }
    for (const row of rows) buckets[bucketRow(row, nowSec)].push(row)
    return GROUP_ORDER.map((id) => ({ id, label: GROUP_LABELS[id], rows: buckets[id] })).filter(
      (g) => g.rows.length > 0,
    )
  }, [rows, nowSec])

  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p.project_id, p.name])),
    [projects],
  )

  const toggleGroup = (id: GroupId) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const startRename = (row: SidebarSessionRow) => {
    setRenamingId(row.session_id)
    setRenameValue(rowTitle(row))
  }

  const commitRename = async (row: SidebarSessionRow) => {
    const sid = renamingId
    const title = renameValue.trim()
    setRenamingId(null)
    if (!sid || !title || title === rowTitle(row)) return
    try {
      await renameSession(sid, title)
    } catch {
      // keep the old title on failure
    }
    refresh()
  }

  const cancelRename = () => setRenamingId(null)

  const runMutation = async (op: () => Promise<unknown>) => {
    try {
      await op()
    } catch {
      // Quiet surface: refresh will show the server truth.
    }
    refresh()
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const sid = deleting.session_id
    setDeleting(null)
    // chatStore.deleteSession enforces §5.6 (never creates, loads sessions[0],
    // toasts "Conversation deleted").
    try {
      await deleteSession(sid)
    } catch {
      // Keep the list as-is if the store failed.
    }
    refresh()
  }

  const searching = query.trim().length > 0

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)} data-testid="session-sidebar">
      <div className="relative mb-2 shrink-0">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search conversations"
          placeholder="Search conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Escape clears the filter and hands focus back to the list, so a
            // search never becomes a state the user has to click out of.
            if (e.key === 'Escape' && query !== '') {
              e.preventDefault()
              setQuery('')
            }
          }}
          className="h-8 pl-7 text-sm [&::-webkit-search-cancel-button]:appearance-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {loading && rows.length === 0 && <SidebarSkeleton />}
        {!loading && rows.length === 0 && (
          <p
            data-testid="sidebar-empty"
            className="px-2 py-6 text-center text-xs text-muted-foreground"
          >
            {searching ? 'No conversations match your search' : 'No conversations yet'}
          </p>
        )}
        {groups.map((group) => {
          const isCollapsed = collapsed[group.id]
          return (
            <section key={group.id} data-testid={`group-${group.id}`} className="mb-1">
              <button
                type="button"
                aria-expanded={!isCollapsed}
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              >
                {isCollapsed ? (
                  <ChevronRightIcon className="size-3.5" />
                ) : (
                  <ChevronDownIcon className="size-3.5" />
                )}
                <span>{group.label}</span>
                <span className="ml-auto tabular-nums">{group.rows.length}</span>
              </button>
              {!isCollapsed && (
                <ul className="mt-0.5 space-y-0.5">
                  {group.rows.map((row) => (
                    <SessionRow
                      key={row.session_id}
                      row={row}
                      active={activeSid === row.session_id}
                      projectName={
                        row.project_id ? projectNameById.get(row.project_id) ?? null : null
                      }
                      renaming={renamingId === row.session_id}
                      renameValue={renameValue}
                      onRenameChange={setRenameValue}
                      onRenameCommit={() => void commitRename(row)}
                      onRenameCancel={cancelRename}
                      onSelect={onSelect}
                      onStartRename={() => startRename(row)}
                      onPin={() => void runMutation(() => pinSession(row.session_id, !row.pinned))}
                      onArchive={() =>
                        void runMutation(() => archiveSession(row.session_id, !row.archived))
                      }
                      onDuplicate={() =>
                        void runMutation(() => duplicateSession(row.session_id))
                      }
                      onDelete={() => setDeleting(row)}
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete conversation?</DialogTitle>
            <DialogDescription>
              &ldquo;{deleting ? rowTitle(deleting) : ''}&rdquo; will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** First-paint placeholder for the session list. */
function SidebarSkeleton() {
  return (
    <div data-testid="sidebar-skeleton" aria-hidden="true" className="animate-pulse px-1.5 py-1">
      <div className="mb-2 h-3 w-16 rounded bg-muted" />
      {[72, 88, 64, 80, 56].map((w, i) => (
        <div key={i} className="mb-1.5 h-6 rounded-md bg-muted" style={{ width: `${w}%` }} />
      ))}
    </div>
  )
}

interface SessionRowProps {
  row: SidebarSessionRow
  active: boolean
  projectName: string | null
  renaming: boolean
  renameValue: string
  onRenameChange: (value: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  onSelect: (sessionId: string) => void
  onStartRename: () => void
  onPin: () => void
  onArchive: () => void
  onDuplicate: () => void
  onDelete: () => void
}

function SessionRow({
  row,
  active,
  projectName,
  renaming,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onSelect,
  onStartRename,
  onPin,
  onArchive,
  onDuplicate,
  onDelete,
}: SessionRowProps) {
  const title = rowTitle(row)
  const readOnly = isReadOnlyRow(row)
  const streaming = Boolean(row.is_streaming || row.active_stream_id)

  if (renaming) {
    return (
      <li data-testid={`session-row-${row.session_id}`} className="px-1 py-0.5">
        <Input
          autoFocus
          aria-label="Rename session"
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameCommit()
            else if (e.key === 'Escape') onRenameCancel()
          }}
          onBlur={onRenameCancel}
          className="h-7 text-sm"
        />
      </li>
    )
  }

  return (
    <li
      data-testid={`session-row-${row.session_id}`}
      data-active={active ? 'true' : undefined}
      className="group/row relative"
    >
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        aria-label={title}
        onClick={() => onSelect(row.session_id)}
        className={cn(
          // Roomier rows on touch, dense on the desktop column.
          'relative flex w-full items-center gap-1.5 rounded-md px-1.5 py-2.5 text-left text-sm transition-colors md:py-1.5',
          // `text-accent-foreground` is the ink for a SOLID accent fill; over a
          // 15% tint it collapsed to 1.06:1 on dark and the active
          // conversation's title was unreadable. The selected row is carried by
          // the tint plus the accent marker below, with ordinary foreground ink.
          active
            ? 'bg-accent/15 font-medium text-foreground'
            : 'text-foreground/90 hover:bg-muted/60',
        )}
      >
        {active && (
          <span
            aria-hidden="true"
            className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent"
          />
        )}
        {streaming ? (
          <span
            data-testid={`streaming-indicator-${row.session_id}`}
            title="Streaming"
            aria-label="Streaming"
            className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent"
          />
        ) : row.pinned ? (
          <PinIcon
            className="size-3 shrink-0 text-accent/70"
            aria-label="Pinned"
          />
        ) : (
          <span aria-hidden="true" className="size-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span aria-hidden="true" className="shrink-0 text-[11px] text-muted-foreground/70 tabular-nums">
          {formatRelative(row.updated_at)}
        </span>
        {readOnly && (
          <span
            data-testid={`source-label-${row.session_id}`}
            className="shrink-0 rounded border border-border/60 bg-background/60 px-1 py-px text-[11px] text-muted-foreground"
          >
            {row.source_label || 'CLI'}
          </span>
        )}
        {projectName && (
          <span
            data-testid={`project-chip-${row.session_id}`}
            className="shrink-0 rounded border border-border/60 bg-background/60 px-1 py-px text-[11px] text-muted-foreground"
          >
            {projectName}
          </span>
        )}
      </button>
      <div
        className={cn(
          'absolute top-1/2 right-0.5 -translate-y-1/2 transition-opacity',
          'opacity-0 group-hover/row:opacity-100 focus-within:opacity-100',
          active && 'opacity-100',
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${title}`} />
            }
          >
            <MoreHorizontalIcon className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4}>
            <DropdownMenuItem disabled={readOnly} onClick={onStartRename}>
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem disabled={readOnly} onClick={onPin}>
              {row.pinned ? <PinOffIcon /> : <PinIcon />}
              {row.pinned ? 'Unpin' : 'Pin'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={readOnly} onClick={onArchive}>
              {row.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
              {row.archived ? 'Unarchive' : 'Archive'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <CopyIcon />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={readOnly} onClick={onDelete}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

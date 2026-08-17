import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArchiveIcon,
  Loader2Icon,
  MessageSquareIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  archiveBoard,
  createBoard,
  createTask,
  deleteTask,
  getBoard,
  listBoards,
  patchTask,
  switchBoard,
  type BoardMeta,
  type BoardPayload,
  type KanbanTask,
} from '@/api/kanban'
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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/ui/native-select'

/**
 * Kanban tab of the Control Center: a faithful-core multi-board task board.
 *
 * Mirrors the legacy Kanban panel (static/panels.js): a board switcher, a
 * filter bar, one column per status, task create/edit/delete, and a live
 * refresh. The backend `/api/kanban/*` CRUD is fully ready; this panel is the
 * React surface over it.
 *
 * Deliberately out of scope (documented, not implemented): drag-and-drop
 * reordering, task links (parents/children), comments, attachments, dispatch,
 * bulk ops, run management, workspace/project fields, SSE (we use the cheap
 * `since` poll instead), and i18n keys (plain English labels).
 *
 * Note: the backend rejects moving a task INTO `running` (that state is owned
 * by the kanban dispatcher / claim protocol), so the "Move to" menu omits it.
 */

const COLUMN_LABELS: Record<string, string> = {
  triage: 'Triage',
  todo: 'To do',
  ready: 'Ready',
  running: 'Running',
  blocked: 'Blocked',
  done: 'Done',
  archived: 'Archived',
}

/** Statuses a user may move a task to (running is dispatcher-owned). */
const MOVE_TARGETS = ['triage', 'todo', 'ready', 'blocked', 'done', 'archived']

function columnLabel(name: string): string {
  return COLUMN_LABELS[name] ?? name
}

function boardName(meta: BoardMeta): string {
  return meta.name?.trim() || meta.slug
}

function humanizeAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return ''
  if (seconds < 60) return 'now'
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

interface TaskForm {
  title: string
  body: string
  assignee: string
  tenant: string
  priority: number
  status: string
}

const EMPTY_TASK_FORM: TaskForm = {
  title: '',
  body: '',
  assignee: '',
  tenant: '',
  priority: 0,
  status: 'triage',
}

export function KanbanPanel() {
  const [boards, setBoards] = useState<BoardMeta[] | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [board, setBoard] = useState<BoardPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // filters
  const [search, setSearch] = useState('')
  const [assignee, setAssignee] = useState('')
  const [tenant, setTenant] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [onlyMine, setOnlyMine] = useState(false)

  // new board dialog
  const [newBoardOpen, setNewBoardOpen] = useState(false)
  const [newBoardSlug, setNewBoardSlug] = useState('')
  const [newBoardName, setNewBoardName] = useState('')

  // new task dialog
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [newTask, setNewTask] = useState<TaskForm>(EMPTY_TASK_FORM)

  // task editor dialog
  const [editing, setEditing] = useState<KanbanTask | null>(null)
  const [editFields, setEditFields] = useState<TaskForm>(EMPTY_TASK_FORM)

  // archive current board confirm
  const [confirmArchive, setConfirmArchive] = useState(false)

  const latestEventIdRef = useRef<number | null>(null)
  useEffect(() => {
    latestEventIdRef.current = board?.latest_event_id ?? null
  }, [board])

  const loadBoards = useCallback(async () => {
    try {
      const res = await listBoards()
      setBoards(res.boards)
      // Only adopt the server-reported active slug on the initial load; an
      // explicit switch/create/archive already set `current` and must not be
      // clobbered by a stale listBoards response.
      setCurrent((prev) => prev ?? res.current)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load boards.')
    }
  }, [])

  useEffect(() => {
    void loadBoards()
  }, [loadBoards])

  const loadBoard = useCallback(async () => {
    if (!current) return
    try {
      const res = await getBoard({
        board: current,
        tenant: tenant || undefined,
        assignee: assignee || undefined,
        include_archived: includeArchived,
        only_mine: onlyMine,
      })
      setBoard(res)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load board.')
    }
  }, [current, tenant, assignee, includeArchived, onlyMine])

  useEffect(() => {
    void loadBoard()
  }, [loadBoard])

  // Live refresh: poll with `since` (cheap no-op when nothing changed). Pause
  // while a dialog is open so edits aren't clobbered by a mid-edit refresh.
  const dialogOpen = editing !== null || newTaskOpen || newBoardOpen
  useEffect(() => {
    if (!current || dialogOpen) return
    const id = setInterval(() => {
      void (async () => {
        try {
          const res = await getBoard({
            board: current,
            tenant: tenant || undefined,
            assignee: assignee || undefined,
            include_archived: includeArchived,
            only_mine: onlyMine,
            since: latestEventIdRef.current ?? undefined,
          })
          if (res.changed) setBoard(res)
        } catch {
          // transient poll error — the next tick retries
        }
      })()
    }, 5000)
    return () => clearInterval(id)
  }, [current, tenant, assignee, includeArchived, onlyMine, dialogOpen])

  const doSwitchBoard = async (slug: string) => {
    if (slug === current) return
    setBusy(true)
    try {
      await switchBoard(slug)
      setCurrent(slug)
      toast.success(`Switched to ${slug}.`)
      await loadBoards()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to switch board.')
    } finally {
      setBusy(false)
    }
  }

  const doCreateBoard = async () => {
    const slug = newBoardSlug.trim()
    if (!slug) {
      toast.error('Enter a board slug first')
      return
    }
    setBusy(true)
    try {
      const res = await createBoard({
        slug,
        name: newBoardName.trim() || undefined,
        switch: true,
      })
      setCurrent(res.current)
      setNewBoardOpen(false)
      setNewBoardSlug('')
      setNewBoardName('')
      toast.success('Board created.')
      await loadBoards()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create board.')
    } finally {
      setBusy(false)
    }
  }

  const doArchiveBoard = async () => {
    if (!current) return
    setBusy(true)
    try {
      const res = await archiveBoard(current)
      setCurrent(res.current)
      setConfirmArchive(false)
      toast.success('Board archived.')
      await loadBoards()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to archive board.')
    } finally {
      setBusy(false)
    }
  }

  const openNewTask = () => {
    setNewTask({ ...EMPTY_TASK_FORM, status: 'triage' })
    setNewTaskOpen(true)
  }

  const doCreateTask = async () => {
    if (!newTask.title.trim()) {
      toast.error('Enter a task title first')
      return
    }
    setBusy(true)
    try {
      await createTask(current ?? undefined, {
        title: newTask.title.trim(),
        body: newTask.body.trim() || undefined,
        assignee: newTask.assignee.trim() || undefined,
        tenant: newTask.tenant.trim() || undefined,
        priority: newTask.priority,
        status: newTask.status,
      })
      setNewTaskOpen(false)
      toast.success('Task created.')
      await loadBoard()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create task.')
    } finally {
      setBusy(false)
    }
  }

  const openEditor = (task: KanbanTask) => {
    setEditing(task)
    setEditFields({
      title: task.title,
      body: task.body ?? '',
      assignee: task.assignee ?? '',
      tenant: task.tenant ?? '',
      priority: task.priority ?? 0,
      status: task.status,
    })
  }

  const doSaveTask = async () => {
    if (!editing) return
    if (!editFields.title.trim()) {
      toast.error('Enter a task title first')
      return
    }
    setBusy(true)
    try {
      await patchTask(current ?? undefined, editing.id, {
        title: editFields.title.trim(),
        body: editFields.body.trim() || undefined,
        assignee: editFields.assignee.trim() || undefined,
        tenant: editFields.tenant.trim() || undefined,
        priority: editFields.priority,
        status: editFields.status,
      })
      setEditing(null)
      toast.success('Task updated.')
      await loadBoard()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update task.')
    } finally {
      setBusy(false)
    }
  }

  const doDeleteTask = async () => {
    if (!editing) return
    const target = editing
    setBusy(true)
    try {
      await deleteTask(current ?? undefined, target.id)
      setEditing(null)
      toast.success('Task deleted.')
      await loadBoard()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete task.')
    } finally {
      setBusy(false)
    }
  }

  if (error && !board) {
    return <p className="px-1 text-sm text-destructive">{error}</p>
  }

  if (!board) {
    return (
      <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" /> Loading board…
      </p>
    )
  }

  const query = search.trim().toLowerCase()
  const visibleColumns = board.columns.filter((c) => c.name !== 'archived' || includeArchived)

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Board switcher + actions */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-1 pb-2">
        <NativeSelect
          aria-label="Board"
          className="h-8 text-xs" containerClassName="w-auto max-w-48"
          value={current ?? ''}
          onChange={(e) => void doSwitchBoard(e.target.value)}
          disabled={busy}
        >
          {(boards ?? []).map((b) => (
            <option key={b.slug} value={b.slug}>
              {boardName(b)}
            </option>
          ))}
        </NativeSelect>
        <Button size="sm" variant="outline" onClick={() => setNewBoardOpen(true)}>
          <PlusIcon /> New board
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmArchive(true)} title="Archive board">
          <ArchiveIcon />
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={openNewTask}>
            <PlusIcon /> New task
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <Input
          aria-label="Search"
          placeholder="Search tasks…"
          className="h-8 w-40 text-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <NativeSelect
          aria-label="Assignee"
          className="h-8 text-xs" containerClassName="w-auto"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <option value="">All assignees</option>
          {board.assignees.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Tenant"
          className="h-8 text-xs" containerClassName="w-auto"
          value={tenant}
          onChange={(e) => setTenant(e.target.value)}
        >
          <option value="">All tenants</option>
          {board.tenants.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Archived
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          Only mine
        </label>
      </div>

      {/* Columns */}
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto px-1 pb-1">
        {visibleColumns.map((col) => {
          const tasks = query
            ? col.tasks.filter(
                (t) => t.title.toLowerCase().includes(query) || t.id.toLowerCase().includes(query),
              )
            : col.tasks
          return (
            <div key={col.name} className="flex w-56 shrink-0 flex-col rounded-lg border border-border/60 bg-muted/20">
              <div className="flex items-center justify-between border-b border-border/60 px-2 py-1.5">
                <span className="text-xs font-medium">{columnLabel(col.name)}</span>
                <Badge variant="secondary" className="shrink-0">
                  {tasks.length}
                </Badge>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-1.5">
                {tasks.length === 0 && (
                  <p className="px-1 py-2 text-[11px] text-muted-foreground">No tasks</p>
                )}
                {tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="rounded-md border border-border bg-background p-2 text-left shadow-sm transition-colors hover:border-border/80 hover:bg-muted/40"
                    onClick={() => openEditor(task)}
                  >
                    <div className="text-xs font-medium leading-snug">{task.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[11px]">
                        {task.assignee || 'Unassigned'}
                      </Badge>
                      {task.priority !== 0 && (
                        <Badge variant="secondary" className="text-[11px]">
                          P{task.priority}
                        </Badge>
                      )}
                      {task.comment_count ? (
                        <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                          <MessageSquareIcon className="size-2.5" />
                          {task.comment_count}
                        </span>
                      ) : null}
                      {humanizeAge(task.age_seconds) && (
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {humanizeAge(task.age_seconds)}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* New board dialog */}
      <Dialog open={newBoardOpen} onOpenChange={(o) => !o && setNewBoardOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New board</DialogTitle>
            <DialogDescription>Create a new kanban board and switch to it.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Input
              aria-label="Board slug"
              placeholder="slug (e.g. experiments)"
              value={newBoardSlug}
              onChange={(e) => setNewBoardSlug(e.target.value)}
            />
            <Input
              aria-label="Board name"
              placeholder="Display name (optional)"
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewBoardOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void doCreateBoard()} disabled={busy || !newBoardSlug.trim()}>
              {busy && <Loader2Icon className="animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New task dialog */}
      <Dialog open={newTaskOpen} onOpenChange={(o) => !o && setNewTaskOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>Add a task to the board.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Input
              aria-label="Title"
              placeholder="Task title"
              value={newTask.title}
              onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
            />
            <Textarea
              aria-label="Body"
              placeholder="Description (optional)"
              className="min-h-16"
              value={newTask.body}
              onChange={(e) => setNewTask({ ...newTask, body: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                aria-label="Assignee"
                placeholder="Assignee (optional)"
                value={newTask.assignee}
                onChange={(e) => setNewTask({ ...newTask, assignee: e.target.value })}
              />
              <Input
                aria-label="Tenant"
                placeholder="Tenant (optional)"
                value={newTask.tenant}
                onChange={(e) => setNewTask({ ...newTask, tenant: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                aria-label="Priority"
                type="number"
                min={0}
                value={newTask.priority}
                onChange={(e) => setNewTask({ ...newTask, priority: Number(e.target.value) || 0 })}
              />
              <NativeSelect
                aria-label="Status"
                className="text-xs" containerClassName="w-auto"
                value={newTask.status}
                onChange={(e) => setNewTask({ ...newTask, status: e.target.value })}
              >
                {MOVE_TARGETS.map((s) => (
                  <option key={s} value={s}>
                    {columnLabel(s)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTaskOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void doCreateTask()} disabled={busy || !newTask.title.trim()}>
              {busy && <Loader2Icon className="animate-spin" />}
              Create task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task editor dialog */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit task</DialogTitle>
            <DialogDescription>{editing ? editing.id : ''}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Input
              aria-label="Title"
              value={editFields.title}
              onChange={(e) => setEditFields({ ...editFields, title: e.target.value })}
            />
            <Textarea
              aria-label="Body"
              className="min-h-16"
              value={editFields.body}
              onChange={(e) => setEditFields({ ...editFields, body: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                aria-label="Assignee"
                value={editFields.assignee}
                onChange={(e) => setEditFields({ ...editFields, assignee: e.target.value })}
              />
              <Input
                aria-label="Tenant"
                value={editFields.tenant}
                onChange={(e) => setEditFields({ ...editFields, tenant: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                aria-label="Priority"
                type="number"
                min={0}
                value={editFields.priority}
                onChange={(e) => setEditFields({ ...editFields, priority: Number(e.target.value) || 0 })}
              />
              <NativeSelect
                aria-label="Move to"
                className="text-xs" containerClassName="w-auto"
                value={editFields.status}
                onChange={(e) => setEditFields({ ...editFields, status: e.target.value })}
              >
                {MOVE_TARGETS.map((s) => (
                  <option key={s} value={s}>
                    {columnLabel(s)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => void doDeleteTask()} disabled={busy}>
              <Trash2Icon /> Delete
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void doSaveTask()} disabled={busy || !editFields.title.trim()}>
              {busy && <Loader2Icon className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive board confirm */}
      <Dialog open={confirmArchive} onOpenChange={(o) => !o && setConfirmArchive(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive board</DialogTitle>
            <DialogDescription>
              Archive “{current}”? It will be hidden from the switcher until archived boards are shown.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmArchive(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void doArchiveBoard()} disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

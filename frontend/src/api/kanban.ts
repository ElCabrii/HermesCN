import { api } from './client'
import type { JsonObject } from './types'

/**
 * Kanban API client: multi-board task board CRUD. Contract verified against
 * `api/kanban_bridge.py` (the `handle_kanban_get/post/patch/delete` dispatch
 * and the `_board_payload` / `_create_task_payload` / `_patch_task_payload`
 * envelopes). The backend is fully ready; this client is the typed surface
 * the React Kanban panel consumes.
 *
 * Board statuses (columns), in order:
 *   triage, todo, ready, running, blocked, done  (+ "archived" when the
 *   board is fetched with include_archived=1).
 */

export const KANBAN_COLUMNS = ['triage', 'todo', 'ready', 'running', 'blocked', 'done'] as const
export type KanbanStatus = (typeof KANBAN_COLUMNS)[number] | 'archived'

/** A single kanban task row (the `_task_dict` shape + computed counts). */
export interface KanbanTask extends JsonObject {
  id: string
  title: string
  body?: string | null
  assignee?: string | null
  status: string
  priority: number
  created_by?: string
  created_at: number
  tenant?: string | null
  age_seconds?: number | null
  progress?: unknown | null
  link_counts?: { parents: number; children: number }
  comment_count?: number
}

export interface KanbanColumn {
  name: string
  tasks: KanbanTask[]
}

export interface BoardFilters {
  tenant: string | null
  assignee: string | null
  include_archived: boolean
  only_mine: boolean
  profile: string | null
}

/** GET /api/kanban/board payload. */
export interface BoardPayload extends JsonObject {
  columns: KanbanColumn[]
  tenants: string[]
  assignees: string[]
  latest_event_id: number
  changed: boolean
  read_only: boolean
  filters: BoardFilters
}

/** A board's display metadata (GET /api/kanban/boards entry). */
export interface BoardMeta extends JsonObject {
  slug: string
  name?: string
  description?: string
  icon?: string
  color?: string
  is_current: boolean
  counts: Record<string, number>
  total: number
}

export interface BoardsResponse extends JsonObject {
  boards: BoardMeta[]
  current: string
  read_only: boolean
}

export interface TaskEnvelope extends JsonObject {
  task: KanbanTask
  read_only: boolean
}

export interface BoardEnvelope extends JsonObject {
  board: BoardMeta
  read_only: boolean
}

export interface SwitchResponse extends JsonObject {
  current: string
  read_only: boolean
}

export interface CreateBoardResponse extends JsonObject {
  board: BoardMeta
  current: string
  read_only: boolean
}

export interface DeleteBoardResponse extends JsonObject {
  result: unknown
  current: string
  read_only: boolean
}

export interface GetBoardParams {
  board?: string
  tenant?: string
  assignee?: string
  include_archived?: boolean
  only_mine?: boolean
  since?: number
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

/** GET /api/kanban/boards — all boards on disk + the active slug. */
export function listBoards(includeArchived = false): Promise<BoardsResponse> {
  return api<BoardsResponse>(`/api/kanban/boards${qs({ include_archived: includeArchived ? 1 : 0 })}`, {
    credentials: 'include',
  })
}

/** POST /api/kanban/boards — create a board (idempotent on slug). */
export function createBoard(payload: {
  slug: string
  name?: string
  description?: string
  icon?: string
  color?: string
  switch?: boolean
}): Promise<CreateBoardResponse> {
  return api<CreateBoardResponse>('/api/kanban/boards', {
    method: 'POST',
    body: JSON.stringify(payload),
    credentials: 'include',
  })
}

/** POST /api/kanban/boards/<slug>/switch — set the active board. */
export function switchBoard(slug: string): Promise<SwitchResponse> {
  return api<SwitchResponse>(`/api/kanban/boards/${encodeURIComponent(slug)}/switch`, {
    method: 'POST',
    credentials: 'include',
  })
}

/** PATCH /api/kanban/boards/<slug> — update board display metadata. */
export function updateBoard(
  slug: string,
  patch: { name?: string; description?: string; icon?: string; color?: string },
): Promise<BoardEnvelope> {
  return api<BoardEnvelope>(`/api/kanban/boards/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    credentials: 'include',
  })
}

/** DELETE /api/kanban/boards/<slug> — archive the board (default). */
export function archiveBoard(slug: string): Promise<DeleteBoardResponse> {
  return api<DeleteBoardResponse>(`/api/kanban/boards/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
}

/**
 * GET /api/kanban/board — the full board payload. Pass `since` for a cheap
 * poll: when `since >= latest_event_id` the response is
 * `{ changed: false, latest_event_id, read_only }`.
 */
export function getBoard(params: GetBoardParams = {}): Promise<BoardPayload> {
  return api<BoardPayload>(
    `/api/kanban/board${qs({
      board: params.board,
      tenant: params.tenant ?? undefined,
      assignee: params.assignee ?? undefined,
      include_archived: params.include_archived ? 1 : undefined,
      only_mine: params.only_mine ? 1 : undefined,
      since: params.since,
    })}`,
    { credentials: 'include' },
  )
}

/** POST /api/kanban/tasks — create a task (title required). */
export function createTask(
  board: string | undefined,
  payload: {
    title: string
    body?: string
    assignee?: string
    tenant?: string
    priority?: number
    status?: string
    created_by?: string
  },
): Promise<TaskEnvelope> {
  return api<TaskEnvelope>(`/api/kanban/tasks${qs({ board })}`, {
    method: 'POST',
    body: JSON.stringify(payload),
    credentials: 'include',
  })
}

/** PATCH /api/kanban/tasks/<id> — partial task update (status, title, ...). */
export function patchTask(
  board: string | undefined,
  taskId: string,
  patch: {
    status?: string
    title?: string
    body?: string
    assignee?: string
    tenant?: string
    priority?: number
  },
): Promise<TaskEnvelope> {
  return api<TaskEnvelope>(`/api/kanban/tasks/${encodeURIComponent(taskId)}${qs({ board })}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    credentials: 'include',
  })
}

/**
 * Remove a task from the board. The kanban bridge has no hard-delete endpoint
 * for tasks; the faithful "delete" action is archiving (PATCH status=archived),
 * which moves the task to the archived column (visible with include_archived).
 */
export function deleteTask(board: string | undefined, taskId: string): Promise<TaskEnvelope> {
  return patchTask(board, taskId, { status: 'archived' })
}

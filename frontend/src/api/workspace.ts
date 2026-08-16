import { api, ApiError } from './client'
import type { JsonObject } from './types'

/**
 * Typed client for the HermesCN workspace API.
 *
 * Endpoints (verified against `api/routes.py` / `api/workspace.py` /
 * `api/workspace_git.py` handlers):
 * - GET  /api/list                    ?session_id=&path= (dir listing + signature)
 * - GET  /api/file                    ?session_id=&path= (text content)
 * - GET  /api/file/raw                ?session_id=&path= (raw bytes, MIME by extension)
 * - POST /api/file/save               { session_id, path, content }
 * - POST /api/file/delete             { session_id, path, recursive? }
 * - POST /api/file/create             { session_id, path, content? }
 * - GET  /api/workspaces              (workspace list + last-used + remote flag)
 * - POST /api/workspaces/add          { path, name?, create? }
 * - POST /api/workspaces/remove       { path }
 * - POST /api/workspaces/rename       { path, name }
 * - POST /api/workspaces/reorder      { paths: string[] }
 * - GET  /api/workspaces/suggest      ?prefix=
 * - GET  /api/git/status|branches|diff ?session_id= (&path=&kind= for diff)
 *
 * All requests send `credentials: 'include'` so the auth cookie is carried.
 */

// ── shared helpers ────────────────────────────────────────────────────────

/** Build a query string from defined params (undefined/null keys are skipped). */
function buildQuery(params: object): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    sp.set(key, String(value))
  }
  // URLSearchParams encodes spaces as '+'; normalize to '%20' so session ids
  // and paths use the canonical query-string form (parse_qs on the backend
  // decodes both, but '%20' round-trips unchanged through proxies).
  const qs = sp.toString().replace(/\+/g, '%20')
  return qs ? `?${qs}` : ''
}

/**
 * Fetch a raw (non-JSON) endpoint, e.g. /api/file/raw for image previews.
 * Returns the Response untouched on success so callers can build a blob URL
 * or feed it straight to `<img src>`; throws `ApiError` (server `error`
 * message preferred) on non-2xx.
 */
async function fetchRaw(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, { ...init, credentials: 'include' })
  if (res.ok) return res
  const body: unknown = await res.json().catch(() => null)
  const message =
    body && typeof body === 'object' && 'error' in body
      ? String((body as JsonObject).error)
      : res.statusText
  throw new ApiError(res.status, message, body)
}

// ── GET /api/list ─────────────────────────────────────────────────────────

/**
 * One directory entry (`api/workspace.py` `list_dir` +
 * `serialize_workspace_entries_for_browser`). `type` is 'dir' | 'file' |
 * 'symlink'; escape-target symlinks are emitted display-only with
 * `target_outside_workspace` (their target is never disclosed).
 */
export interface WorkspaceEntry extends JsonObject {
  name: string
  path: string
  type: 'dir' | 'file' | 'symlink'
  size: number | null
  is_dir?: boolean
  workspace_sort_rank?: number
  target?: string | null
  target_outside_workspace?: boolean
  mtime_ns?: string | null
  birthtime_ns?: string | null
}

/**
 * Response of GET /api/list (`_handle_list_dir`): at most 200 entries, dirs
 * first then files, case-insensitive alpha; `signature` is a dir-signature
 * hash for change detection; `workspace_recovered` is true when the session's
 * stored workspace binding was stale and re-persisted.
 */
export interface ListDirResponse extends JsonObject {
  entries: WorkspaceEntry[]
  signature: string
  path: string
  workspace: string
  workspace_recovered: boolean
}

/** List a workspace directory (defaults to the workspace root). */
export function listDir(sessionId: string, path = '.'): Promise<ListDirResponse> {
  return api<ListDirResponse>(`/api/list${buildQuery({ session_id: sessionId, path })}`, {
    credentials: 'include',
  })
}

// ── GET /api/file ─────────────────────────────────────────────────────────

/**
 * Response of GET /api/file (`api/workspace.py` `read_file_content`):
 * UTF-8 text decoded with replacement, capped at 200KB server-side.
 */
export interface FileContent extends JsonObject {
  path: string
  content: string
  size: number
  lines: number
}

/** Read a text file inside the session workspace. */
export function readFile(sessionId: string, path: string): Promise<FileContent> {
  return api<FileContent>(`/api/file${buildQuery({ session_id: sessionId, path })}`, {
    credentials: 'include',
  })
}

// ── GET /api/file/raw ─────────────────────────────────────────────────────

/** Options for the raw file endpoint. */
export interface FileRawParams {
  /** Force `Content-Disposition: attachment` (download instead of inline). */
  download?: boolean
  /** Serve `text/html` inline (sandboxed preview iframe). */
  inline?: boolean
}

/** Build the /api/file/raw URL for direct use as `<img src>` / fetch. */
export function fileRawUrl(
  sessionId: string,
  path: string,
  opts: FileRawParams = {},
): string {
  const params: Record<string, string> = { session_id: sessionId, path }
  if (opts.download) params.download = '1'
  if (opts.inline) params.inline = '1'
  return `/api/file/raw${buildQuery(params)}`
}

/**
 * Fetch a raw file (no size limit; MIME type by extension). Returns the
 * Response for blob/object-URL or `<img>` use — do NOT json-parse it.
 */
export function fetchFileRaw(
  sessionId: string,
  path: string,
  opts: FileRawParams = {},
): Promise<Response> {
  return fetchRaw(fileRawUrl(sessionId, path, opts))
}

// ── POST /api/file/save | delete | create ─────────────────────────────────

/** Response of POST /api/file/save: saved byte count included. */
export interface FileSaveResponse extends JsonObject {
  ok: true
  path: string
  size: number
}

/** Response of POST /api/file/delete (echoes the requested path). */
export interface FileDeleteResponse extends JsonObject {
  ok: true
  path: string
}

/** Response of POST /api/file/create (path is the resolved relative posix). */
export interface FileCreateResponse extends JsonObject {
  ok: true
  path: string
}

/** Options for POST /api/file/delete. */
export interface DeleteFileParams {
  /** Required to delete directories (server rejects without it). */
  recursive?: boolean
}

/** Save text content into an existing workspace file (UTF-8). */
export function saveFile(
  sessionId: string,
  path: string,
  content: string,
): Promise<FileSaveResponse> {
  return api<FileSaveResponse>('/api/file/save', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, path, content }),
    credentials: 'include',
  })
}

/** Delete a file, or a directory when `recursive` is set. */
export function deleteFile(
  sessionId: string,
  path: string,
  opts: DeleteFileParams = {},
): Promise<FileDeleteResponse> {
  return api<FileDeleteResponse>('/api/file/delete', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      path,
      ...(opts.recursive ? { recursive: true } : {}),
    }),
    credentials: 'include',
  })
}

/** Create a new workspace file (fails with 400 when it already exists). */
export function createFile(
  sessionId: string,
  path: string,
  content?: string,
): Promise<FileCreateResponse> {
  return api<FileCreateResponse>('/api/file/create', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      path,
      ...(content !== undefined ? { content } : {}),
    }),
    credentials: 'include',
  })
}

/** Create a new directory inside the session workspace (fails with 400 when it exists). */
export function createDir(sessionId: string, path: string): Promise<FileCreateResponse> {
  return api<FileCreateResponse>('/api/file/create-dir', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, path }),
    credentials: 'include',
  })
}

/** Response of POST /api/file/rename (old + resolved new relative posix paths). */
export interface FileRenameResponse extends JsonObject {
  ok: true
  old_path: string
  new_path: string
}

/**
 * Rename a workspace file or directory. `newName` is the bare leaf name (no
 * separators); the server rejects names containing `/`, `\`, or `..`.
 */
export function renameFile(
  sessionId: string,
  path: string,
  newName: string,
): Promise<FileRenameResponse> {
  return api<FileRenameResponse>('/api/file/rename', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, path, new_name: newName }),
    credentials: 'include',
  })
}

// ── GET /api/workspaces ───────────────────────────────────────────────────

/** One workspace row (`api/workspace.py` `load_workspaces`). */
export interface WorkspaceRow extends JsonObject {
  path: string
  name?: string
}

/** Response of GET /api/workspaces: rows, last-used path, remote flag. */
export interface WorkspacesResponse extends JsonObject {
  workspaces: WorkspaceRow[]
  last: string
  terminal_remote_backend: boolean
}

/** Fetch the workspace catalog for the workspace switcher. */
export function getWorkspaces(): Promise<WorkspacesResponse> {
  return api<WorkspacesResponse>('/api/workspaces', {
    credentials: 'include',
  })
}

// ── POST /api/workspaces/add | remove | rename | reorder ──────────────────

/** Response of every POST /api/workspaces/* mutation (fresh list included). */
export interface WorkspaceMutationResponse extends JsonObject {
  ok: true
  workspaces: WorkspaceRow[]
}

/** Options for POST /api/workspaces/add. */
export interface AddWorkspaceParams {
  /** Display name (defaults to the directory basename server-side). */
  name?: string
  /** Auto-create the directory if it does not exist yet. */
  create?: boolean
}

/** Add a workspace (400 when the path is invalid or already listed). */
export function addWorkspace(
  path: string,
  opts: AddWorkspaceParams = {},
): Promise<WorkspaceMutationResponse> {
  return api<WorkspaceMutationResponse>('/api/workspaces/add', {
    method: 'POST',
    body: JSON.stringify({
      path,
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.create ? { create: true } : {}),
    }),
    credentials: 'include',
  })
}

/** Remove a workspace from the list (succeeds even if it was absent). */
export function removeWorkspace(path: string): Promise<WorkspaceMutationResponse> {
  return api<WorkspaceMutationResponse>('/api/workspaces/remove', {
    method: 'POST',
    body: JSON.stringify({ path }),
    credentials: 'include',
  })
}

/** Rename a workspace (404 when the path is not in the list). */
export function renameWorkspace(
  path: string,
  name: string,
): Promise<WorkspaceMutationResponse> {
  return api<WorkspaceMutationResponse>('/api/workspaces/rename', {
    method: 'POST',
    body: JSON.stringify({ path, name }),
    credentials: 'include',
  })
}

/** Reorder workspaces by an ordered list of paths (omitted ones append). */
export function reorderWorkspaces(paths: string[]): Promise<WorkspaceMutationResponse> {
  return api<WorkspaceMutationResponse>('/api/workspaces/reorder', {
    method: 'POST',
    body: JSON.stringify({ paths }),
    credentials: 'include',
  })
}

// ── GET /api/workspaces/suggest ───────────────────────────────────────────

/** Response of GET /api/workspaces/suggest: trusted-root path completions. */
export interface WorkspaceSuggestResponse extends JsonObject {
  suggestions: string[]
  prefix: string
}

/** Autocomplete workspace paths under trusted roots (empty prefix = roots). */
export function suggestWorkspaces(prefix = ''): Promise<WorkspaceSuggestResponse> {
  const params = prefix ? { prefix } : {}
  return api<WorkspaceSuggestResponse>(`/api/workspaces/suggest${buildQuery(params)}`, {
    credentials: 'include',
  })
}

// ── GET /api/git/status | branches | diff ─────────────────────────────────

/** Aggregate changed-file counts (`api/workspace_git.py` `_empty_status`). */
export interface GitStatusTotals extends JsonObject {
  changed: number
  staged: number
  unstaged: number
  untracked: number
  conflicts: number
}

/** One file row of `git status --porcelain=v2` (workspace-relative). */
export interface GitStatusFile extends JsonObject {
  path: string
  old_path: string | null
  workspace_path: string
  status: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  ignored: boolean
  conflict: boolean
  additions: number
  deletions: number
  binary: boolean
}

/** Counts of changes filtered out as noise (filemode-only / CRLF-only). */
export interface GitNoiseFiltering extends JsonObject {
  filemode_only: number
  crlf_only: number
  active: boolean
}

/** Git status for a repo-backed workspace. */
export interface GitRepoStatus extends JsonObject {
  is_git: true
  branch: string
  upstream: string
  ahead: number
  behind: number
  totals: GitStatusTotals
  files: GitStatusFile[]
  truncated: boolean
  noise_filtering: GitNoiseFiltering
}

/** Workspace is not a git repository. */
export interface GitNonRepoStatus extends JsonObject {
  is_git: false
}

export type GitStatus = GitRepoStatus | GitNonRepoStatus

/** Response of GET /api/git/status. */
export interface GitStatusResponse extends JsonObject {
  git: GitStatus
}

/**
 * One branch ref (`_for_each_ref`): local/remote branch rows for the
 * workspace panel badge.
 */
export interface GitRefInfo extends JsonObject {
  name: string
  sha: string
  updated: number
  updated_relative: string
  author: string
  subject: string
  upstream: string
  ahead: number
  behind: number
}

/** Response of GET /api/git/branches (non-repo workspaces error instead). */
export interface GitBranches extends JsonObject {
  is_git: true
  current: string
  detached: boolean
  head: string
  local: GitRefInfo[]
  remote: GitRefInfo[]
  upstream: string
  ahead: number
  behind: number
}

export interface GitBranchesResponse extends JsonObject {
  branches: GitBranches
}

/** Which side of the index /api/git/diff compares. */
export type GitDiffKind = 'staged' | 'unstaged'

/** Response of GET /api/git/diff (3-context-line unified diff). */
export interface GitDiff extends JsonObject {
  path: string
  kind: GitDiffKind
  binary: boolean
  too_large: boolean
  additions: number
  deletions: number
  diff: string
}

export interface GitDiffResponse extends JsonObject {
  diff: GitDiff
}

/** Fetch git status for the session workspace (non-repo → `is_git: false`). */
export function getGitStatus(sessionId: string): Promise<GitStatusResponse> {
  return api<GitStatusResponse>(`/api/git/status${buildQuery({ session_id: sessionId })}`, {
    credentials: 'include',
  })
}

/** Fetch local/remote branches for the session workspace. */
export function getGitBranches(sessionId: string): Promise<GitBranchesResponse> {
  return api<GitBranchesResponse>(`/api/git/branches${buildQuery({ session_id: sessionId })}`, {
    credentials: 'include',
  })
}

/** Fetch the unified diff of one workspace file (unstaged by default). */
export function getGitDiff(
  sessionId: string,
  path: string,
  kind: GitDiffKind = 'unstaged',
): Promise<GitDiffResponse> {
  return api<GitDiffResponse>(
    `/api/git/diff${buildQuery({ session_id: sessionId, path, kind })}`,
    { credentials: 'include' },
  )
}

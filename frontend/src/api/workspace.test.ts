import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import {
  addWorkspace,
  createFile,
  deleteFile,
  fetchFileRaw,
  fileRawUrl,
  getGitBranches,
  getGitDiff,
  getGitStatus,
  getWorkspaces,
  listDir,
  readFile,
  removeWorkspace,
  renameWorkspace,
  reorderWorkspaces,
  saveFile,
  suggestWorkspaces,
  type FileContent,
  type GitBranchesResponse,
  type GitDiffResponse,
  type GitStatusResponse,
  type ListDirResponse,
  type WorkspaceMutationResponse,
  type WorkspacesResponse,
  type WorkspaceSuggestResponse,
} from './workspace'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fetchMockResolving(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(jsonResponse(body, status))
  vi.stubGlobal('fetch', fn)
  return fn
}

/**
 * Assert the single fetch call made by a client function. The client passes a
 * `Headers` instance, so headers are normalized instead of deep-compared.
 */
function expectFetchCall(
  fetchMock: ReturnType<typeof vi.fn>,
  url: string,
  opts: { method?: string; body?: unknown; contentType?: string | null } = {},
): void {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [actualUrl, actualInit] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(actualUrl).toBe(url)
  expect(actualInit.credentials).toBe('include')
  if (opts.method) expect(actualInit.method).toBe(opts.method)
  if (opts.body !== undefined) {
    expect(JSON.parse(String(actualInit.body))).toEqual(opts.body)
  }
  if ('contentType' in opts) {
    expect(new Headers(actualInit.headers).get('Content-Type')).toBe(opts.contentType)
  }
}

const SID = 'abc123'
const WS = '/home/gabriel/dev/HermesCN'

const ROWS: WorkspacesResponse['workspaces'] = [
  { path: WS, name: 'HermesCN' },
  { path: '/tmp/other', name: 'Other' },
]

const LIST: ListDirResponse = {
  entries: [
    { name: 'src', path: 'src', type: 'dir', size: null },
    { name: 'README.md', path: 'README.md', type: 'file', size: 42 },
  ],
  signature: 'sha256-sig',
  path: '.',
  workspace: WS,
  workspace_recovered: false,
}

const FILE: FileContent = {
  path: 'README.md',
  content: '# Hi\n',
  size: 5,
  lines: 2,
}

const GIT_STATUS: GitStatusResponse['git'] = {
  is_git: true,
  branch: 'main',
  upstream: 'origin/main',
  ahead: 1,
  behind: 0,
  totals: { changed: 2, staged: 1, unstaged: 1, untracked: 1, conflicts: 0 },
  files: [
    {
      path: 'README.md',
      old_path: null,
      workspace_path: 'README.md',
      status: ' M',
      staged: false,
      unstaged: true,
      untracked: false,
      ignored: false,
      conflict: false,
      additions: 2,
      deletions: 1,
      binary: false,
    },
  ],
  truncated: false,
  noise_filtering: { filemode_only: 0, crlf_only: 0, active: false },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listDir', () => {
  it('lists the workspace root, echoing path=. by default', async () => {
    const fetchMock = fetchMockResolving(LIST)
    await expect(listDir(SID)).resolves.toEqual(LIST)
    expectFetchCall(fetchMock, '/api/list?session_id=abc123&path=.')
  })

  it('passes a custom path through the query string', async () => {
    const fetchMock = fetchMockResolving(LIST)
    await listDir(SID, 'src/components')
    expectFetchCall(fetchMock, '/api/list?session_id=abc123&path=src%2Fcomponents')
  })

  it('surfaces the server error message for a missing session', async () => {
    fetchMockResolving({ error: 'Session not found' }, 404)
    await expect(listDir('nope')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Session not found',
    })
  })
})

describe('readFile', () => {
  it('reads file content with size and line count', async () => {
    const fetchMock = fetchMockResolving(FILE)
    await expect(readFile(SID, 'README.md')).resolves.toEqual(FILE)
    expectFetchCall(fetchMock, '/api/file?session_id=abc123&path=README.md')
  })

  it('throws ApiError when the file is missing', async () => {
    fetchMockResolving({ error: 'Not a file: missing.txt' }, 404)
    await expect(readFile(SID, 'missing.txt')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('fileRawUrl / fetchFileRaw', () => {
  it('builds a raw URL that encodes session_id and path', () => {
    expect(fileRawUrl(SID, 'img/a.png')).toBe(
      '/api/file/raw?session_id=abc123&path=img%2Fa.png',
    )
  })

  it('adds download=1 and inline=1 flags when requested', () => {
    expect(fileRawUrl(SID, 'a.png', { download: true })).toBe(
      '/api/file/raw?session_id=abc123&path=a.png&download=1',
    )
    expect(fileRawUrl(SID, 'a.html', { inline: true })).toBe(
      '/api/file/raw?session_id=abc123&path=a.html&inline=1',
    )
  })

  it('returns the raw Response untouched (no JSON parsing)', async () => {
    const raw = new Response('PNGDATA', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    })
    const fetchMock = vi.fn().mockResolvedValue(raw)
    vi.stubGlobal('fetch', fetchMock)

    const res = await fetchFileRaw(SID, 'img/a.png')
    expect(res).toBe(raw)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expectFetchCall(fetchMock, '/api/file/raw?session_id=abc123&path=img%2Fa.png', {
      contentType: null,
    })
  })

  it('throws ApiError with the JSON error body on a 404 raw fetch', async () => {
    fetchMockResolving({ error: 'not found' }, 404)
    await expect(fetchFileRaw(SID, 'nope.png')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'not found',
    })
  })
})

describe('saveFile', () => {
  it('POSTs content and returns ok/path/size', async () => {
    const fetchMock = fetchMockResolving({ ok: true, path: 'README.md', size: 5 })
    await expect(saveFile(SID, 'README.md', '# Hi\n')).resolves.toEqual({
      ok: true,
      path: 'README.md',
      size: 5,
    })
    expectFetchCall(fetchMock, '/api/file/save', {
      method: 'POST',
      body: { session_id: SID, path: 'README.md', content: '# Hi\n' },
      contentType: 'application/json',
    })
  })

  it('propagates the office-document rejection', async () => {
    fetchMockResolving(
      { error: 'Use /api/file/office-save for Office documents' },
      400,
    )
    await expect(saveFile(SID, 'notes.docx', 'x')).rejects.toMatchObject({
      status: 400,
      message: 'Use /api/file/office-save for Office documents',
    })
  })
})

describe('deleteFile', () => {
  it('deletes a file without recursive', async () => {
    const fetchMock = fetchMockResolving({ ok: true, path: 'old.txt' })
    await expect(deleteFile(SID, 'old.txt')).resolves.toEqual({
      ok: true,
      path: 'old.txt',
    })
    expectFetchCall(fetchMock, '/api/file/delete', {
      method: 'POST',
      body: { session_id: SID, path: 'old.txt' },
      contentType: 'application/json',
    })
  })

  it('sends recursive=true for directories', async () => {
    const fetchMock = fetchMockResolving({ ok: true, path: 'node_modules' })
    await deleteFile(SID, 'node_modules', { recursive: true })
    expectFetchCall(fetchMock, '/api/file/delete', {
      method: 'POST',
      body: { session_id: SID, path: 'node_modules', recursive: true },
      contentType: 'application/json',
    })
  })

  it('throws ApiError when recursive is required', async () => {
    fetchMockResolving({ error: 'Set recursive=true to delete directories' }, 400)
    await expect(deleteFile(SID, 'node_modules')).rejects.toMatchObject({
      status: 400,
    })
  })
})

describe('createFile', () => {
  it('creates a file, omitting content when absent', async () => {
    const fetchMock = fetchMockResolving({ ok: true, path: 'new.txt' })
    await expect(createFile(SID, 'new.txt')).resolves.toEqual({
      ok: true,
      path: 'new.txt',
    })
    expectFetchCall(fetchMock, '/api/file/create', {
      method: 'POST',
      body: { session_id: SID, path: 'new.txt' },
      contentType: 'application/json',
    })
  })

  it('sends content when provided', async () => {
    const fetchMock = fetchMockResolving({ ok: true, path: 'notes/a.md' })
    await createFile(SID, 'notes/a.md', '# Notes')
    expectFetchCall(fetchMock, '/api/file/create', {
      method: 'POST',
      body: { session_id: SID, path: 'notes/a.md', content: '# Notes' },
      contentType: 'application/json',
    })
  })

  it('throws ApiError when the file already exists', async () => {
    fetchMockResolving({ error: 'File already exists' }, 400)
    await expect(createFile(SID, 'README.md')).rejects.toMatchObject({
      status: 400,
      message: 'File already exists',
    })
  })
})

describe('getWorkspaces', () => {
  it('returns workspaces, last-used path, and remote-backend flag', async () => {
    const fetchMock = fetchMockResolving({
      workspaces: ROWS,
      last: WS,
      terminal_remote_backend: false,
    } satisfies WorkspacesResponse)
    await expect(getWorkspaces()).resolves.toEqual({
      workspaces: ROWS,
      last: WS,
      terminal_remote_backend: false,
    })
    expectFetchCall(fetchMock, '/api/workspaces')
  })
})

describe('workspace mutations', () => {
  const MUTATION: WorkspaceMutationResponse = { ok: true, workspaces: ROWS }

  it('addWorkspace POSTs path with optional name/create', async () => {
    const fetchMock = fetchMockResolving(MUTATION)
    await expect(
      addWorkspace('/tmp/new', { name: 'New', create: true }),
    ).resolves.toEqual(MUTATION)
    expectFetchCall(fetchMock, '/api/workspaces/add', {
      method: 'POST',
      body: { path: '/tmp/new', name: 'New', create: true },
      contentType: 'application/json',
    })
  })

  it('addWorkspace omits name/create when not given', async () => {
    const fetchMock = fetchMockResolving(MUTATION)
    await addWorkspace('/tmp/new')
    expectFetchCall(fetchMock, '/api/workspaces/add', {
      method: 'POST',
      body: { path: '/tmp/new' },
      contentType: 'application/json',
    })
  })

  it('addWorkspace surfaces duplicate rejection', async () => {
    fetchMockResolving({ error: 'Workspace already in list' }, 400)
    await expect(addWorkspace(WS)).rejects.toMatchObject({
      status: 400,
      message: 'Workspace already in list',
    })
  })

  it('removeWorkspace POSTs the path', async () => {
    const fetchMock = fetchMockResolving(MUTATION)
    await expect(removeWorkspace('/tmp/other')).resolves.toEqual(MUTATION)
    expectFetchCall(fetchMock, '/api/workspaces/remove', {
      method: 'POST',
      body: { path: '/tmp/other' },
      contentType: 'application/json',
    })
  })

  it('renameWorkspace POSTs path and name', async () => {
    const fetchMock = fetchMockResolving(MUTATION)
    await renameWorkspace(WS, 'Renamed')
    expectFetchCall(fetchMock, '/api/workspaces/rename', {
      method: 'POST',
      body: { path: WS, name: 'Renamed' },
      contentType: 'application/json',
    })
  })

  it('renameWorkspace throws ApiError for unknown workspaces', async () => {
    fetchMockResolving({ error: 'Workspace not found' }, 404)
    await expect(renameWorkspace('/nope', 'x')).rejects.toMatchObject({
      status: 404,
      message: 'Workspace not found',
    })
  })

  it('reorderWorkspaces POSTs the ordered path list', async () => {
    const fetchMock = fetchMockResolving(MUTATION)
    await expect(
      reorderWorkspaces(['/tmp/other', WS]),
    ).resolves.toEqual(MUTATION)
    expectFetchCall(fetchMock, '/api/workspaces/reorder', {
      method: 'POST',
      body: { paths: ['/tmp/other', WS] },
      contentType: 'application/json',
    })
  })
})

describe('suggestWorkspaces', () => {
  it('fetches suggestions for a prefix', async () => {
    const body: WorkspaceSuggestResponse = {
      suggestions: [`${WS}/sub`],
      prefix: '/home/gabriel/dev',
    }
    const fetchMock = fetchMockResolving(body)
    await expect(suggestWorkspaces('/home/gabriel/dev')).resolves.toEqual(body)
    expectFetchCall(
      fetchMock,
      '/api/workspaces/suggest?prefix=%2Fhome%2Fgabriel%2Fdev',
    )
  })

  it('omits the query string when prefix is empty', async () => {
    const fetchMock = fetchMockResolving({ suggestions: [], prefix: '' })
    await suggestWorkspaces()
    expectFetchCall(fetchMock, '/api/workspaces/suggest')
  })
})

describe('git endpoints', () => {
  it('getGitStatus returns the repo status payload', async () => {
    const body: GitStatusResponse = { git: GIT_STATUS }
    const fetchMock = fetchMockResolving(body)
    await expect(getGitStatus(SID)).resolves.toEqual(body)
    expectFetchCall(fetchMock, '/api/git/status?session_id=abc123')
  })

  it('getGitStatus accepts the non-repo shape', async () => {
    const body: GitStatusResponse = { git: { is_git: false } }
    fetchMockResolving(body)
    await expect(getGitStatus(SID)).resolves.toEqual(body)
  })

  it('getGitBranches returns branch lists', async () => {
    const body: GitBranchesResponse = {
      branches: {
        is_git: true,
        current: 'main',
        detached: false,
        head: 'abc1234',
        local: [
          {
            name: 'main',
            sha: 'abc1234',
            updated: 1755300000,
            updated_relative: '2 days ago',
            author: 'Ada',
            subject: 'work',
            upstream: 'origin/main',
            ahead: 1,
            behind: 0,
          },
        ],
        remote: [],
        upstream: 'origin/main',
        ahead: 1,
        behind: 0,
      },
    }
    const fetchMock = fetchMockResolving(body)
    await expect(getGitBranches(SID)).resolves.toEqual(body)
    expectFetchCall(fetchMock, '/api/git/branches?session_id=abc123')
  })

  it('getGitDiff requests unstaged by default', async () => {
    const body: GitDiffResponse = {
      diff: {
        path: 'README.md',
        kind: 'unstaged',
        binary: false,
        too_large: false,
        additions: 2,
        deletions: 1,
        diff: '--- a/README.md\n+++ b/README.md\n',
      },
    }
    const fetchMock = fetchMockResolving(body)
    await expect(getGitDiff(SID, 'README.md')).resolves.toEqual(body)
    expectFetchCall(
      fetchMock,
      '/api/git/diff?session_id=abc123&path=README.md&kind=unstaged',
    )
  })

  it('getGitDiff supports the staged kind', async () => {
    const fetchMock = fetchMockResolving({ diff: { kind: 'staged' } })
    await getGitDiff(SID, 'README.md', 'staged')
    expectFetchCall(
      fetchMock,
      '/api/git/diff?session_id=abc123&path=README.md&kind=staged',
    )
  })
})

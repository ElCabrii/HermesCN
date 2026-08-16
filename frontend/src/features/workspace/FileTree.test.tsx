import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listDir, type ListDirResponse, type WorkspaceEntry } from '@/api/workspace'
import { FileTree } from './FileTree'

vi.mock('@/api/workspace', () => ({
  listDir: vi.fn(),
  readFile: vi.fn(),
  saveFile: vi.fn(),
  deleteFile: vi.fn(),
  createFile: vi.fn(),
  createDir: vi.fn(),
  renameFile: vi.fn(),
  getWorkspaces: vi.fn(),
  getGitStatus: vi.fn(),
  fileRawUrl: vi.fn(),
  fetchFileRaw: vi.fn(),
}))

const listDirMock = vi.mocked(listDir)

function entry(name: string, type: WorkspaceEntry['type'], size: number | null = null, path?: string): WorkspaceEntry {
  return { name, path: path ?? name, type, size }
}

function listResponse(entries: WorkspaceEntry[]): ListDirResponse {
  return { entries, signature: 'sig', path: '.', workspace: '/tmp/ws', workspace_recovered: false }
}

const ROOT = listResponse([
  entry('b.txt', 'file', 4),
  entry('src', 'dir'),
  entry('A.txt', 'file', 2),
  entry('assets', 'dir'),
])

beforeEach(() => {
  vi.clearAllMocks()
  listDirMock.mockResolvedValue(ROOT)
})

function renderTree(props: Partial<React.ComponentProps<typeof FileTree>> = {}) {
  const onOpenFile = vi.fn()
  const onRename = vi.fn()
  const onDelete = vi.fn()
  const utils = render(
    <FileTree
      sessionId="s1"
      onOpenFile={onOpenFile}
      onRename={onRename}
      onDelete={onDelete}
      {...props}
    />,
  )
  return { ...utils, onOpenFile, onRename, onDelete }
}

describe('FileTree', () => {
  it('renders directories first (server order preserved within groups)', async () => {
    renderTree()
    const rows = await screen.findAllByTestId(/^tree-row-/)
    expect(rows.map((r) => r.getAttribute('data-path'))).toEqual([
      'src',
      'assets',
      'b.txt',
      'A.txt',
    ])
    expect(listDirMock).toHaveBeenCalledWith('s1')
  })

  it('fetches and renders a subdirectory on expand', async () => {
    listDirMock
      .mockResolvedValueOnce(ROOT)
      .mockResolvedValueOnce(listResponse([entry('app.py', 'file', 10, 'src/app.py')]))
    renderTree()

    const dirRow = await screen.findByTestId('tree-row-src')
    expect(dirRow).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(dirRow)

    expect(listDirMock).toHaveBeenLastCalledWith('s1', 'src')
    await screen.findByTestId('tree-row-src/app.py')
    expect(dirRow).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not refetch an already-expanded directory', async () => {
    listDirMock
      .mockResolvedValueOnce(ROOT)
      .mockResolvedValueOnce(listResponse([entry('app.py', 'file', 10, 'src/app.py')]))
    renderTree()

    const dirRow = await screen.findByTestId('tree-row-src')
    await userEvent.click(dirRow)
    await screen.findByTestId('tree-row-src/app.py')
    await userEvent.click(dirRow) // collapse
    await userEvent.click(dirRow) // re-expand (cached)

    expect(listDirMock).toHaveBeenCalledTimes(2)
  })

  it('calls onOpenFile when a file row is clicked', async () => {
    const { onOpenFile } = renderTree()
    await userEvent.click(await screen.findByTestId('tree-row-A.txt'))
    expect(onOpenFile).toHaveBeenCalledWith('A.txt')
  })

  it('exposes rename and delete actions per row', async () => {
    const { onRename, onDelete } = renderTree()
    await screen.findByTestId('tree-row-b.txt')

    await userEvent.click(screen.getByRole('button', { name: 'Rename b.txt' }))
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ name: 'b.txt', type: 'file' }))

    await userEvent.click(screen.getByRole('button', { name: 'Delete b.txt' }))
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ name: 'b.txt', type: 'file' }))
  })

  it('shows a loading state, then an error state on failure', async () => {
    listDirMock.mockRejectedValueOnce(new Error('boom'))
    renderTree()
    expect(await screen.findByText('Could not load workspace files')).toBeInTheDocument()
  })

  it('shows an empty state when the folder has no entries', async () => {
    listDirMock.mockResolvedValueOnce(listResponse([]))
    renderTree()
    expect(await screen.findByText('Empty folder')).toBeInTheDocument()
  })

  it('refetches the root when treeVersion changes', async () => {
    const { rerender } = renderTree()
    await screen.findByTestId('tree-row-b.txt')
    listDirMock.mockResolvedValueOnce(listResponse([entry('new.txt', 'file', 1)]))
    rerender(
      <FileTree sessionId="s1" onOpenFile={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} treeVersion={1} />,
    )
    await waitFor(() => expect(listDirMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByTestId('tree-row-new.txt')).toBeInTheDocument()
  })
})

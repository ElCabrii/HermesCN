import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDir,
  createFile,
  deleteFile,
  getGitStatus,
  getWorkspaces,
  listDir,
  readFile,
  renameFile,
  saveFile,
  type ListDirResponse,
  type WorkspaceEntry,
} from '@/api/workspace'
import { updateSession } from '@/api/sessions'
import {
  workspacePanelModeAtom,
  workspaceStore,
} from './workspaceStore'
import { WorkspacePanel, type WorkspacePanelProps } from './WorkspacePanel'

vi.mock('@/api/workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workspace')>()
  return {
    ...actual,
    listDir: vi.fn(),
    readFile: vi.fn(),
    saveFile: vi.fn(),
    deleteFile: vi.fn(),
    createFile: vi.fn(),
    createDir: vi.fn(),
    renameFile: vi.fn(),
    getWorkspaces: vi.fn(),
    getGitStatus: vi.fn(),
  }
})
vi.mock('@/api/sessions', () => ({ updateSession: vi.fn() }))
vi.mock('@/features/chat/Markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const listDirMock = vi.mocked(listDir)
const readFileMock = vi.mocked(readFile)
const saveFileMock = vi.mocked(saveFile)
const deleteFileMock = vi.mocked(deleteFile)
const createFileMock = vi.mocked(createFile)
const createDirMock = vi.mocked(createDir)
const renameFileMock = vi.mocked(renameFile)
const getWorkspacesMock = vi.mocked(getWorkspaces)
const getGitStatusMock = vi.mocked(getGitStatus)
const updateSessionMock = vi.mocked(updateSession)

function entry(name: string, type: WorkspaceEntry['type'], size: number | null = null): WorkspaceEntry {
  return { name, path: name, type, size }
}

const ROOT: ListDirResponse = {
  entries: [
    entry('src', 'dir'),
    entry('README.md', 'file', 12),
    entry('notes.txt', 'file', 5),
  ],
  signature: 'sig',
  path: '.',
  workspace: '/tmp/ws',
  workspace_recovered: false,
}

beforeEach(() => {
  localStorage.clear()
  workspaceStore.set(workspacePanelModeAtom, 'closed')
  vi.clearAllMocks()
  listDirMock.mockResolvedValue(ROOT)
  readFileMock.mockImplementation((_sid, path) =>
    Promise.resolve({ path, content: path === 'notes.txt' ? 'hello' : '# Readme', size: 5, lines: 1 }),
  )
  saveFileMock.mockResolvedValue({ ok: true, path: 'notes.txt', size: 11 })
  deleteFileMock.mockResolvedValue({ ok: true, path: 'x' })
  createFileMock.mockResolvedValue({ ok: true, path: 'new.txt' })
  createDirMock.mockResolvedValue({ ok: true, path: 'assets' })
  renameFileMock.mockResolvedValue({ ok: true, old_path: 'README.md', new_path: 'README2.md' })
  getWorkspacesMock.mockResolvedValue({
    workspaces: [
      { path: '/tmp/ws', name: 'ws' },
      { path: '/tmp/other', name: 'other' },
    ],
    last: '/tmp/ws',
    terminal_remote_backend: false,
  })
  getGitStatusMock.mockResolvedValue({ git: { is_git: false } })
  updateSessionMock.mockResolvedValue({ ok: true } as never)
})

function renderPanel(props: Partial<WorkspacePanelProps> = {}) {
  const onWorkspaceChange = vi.fn()
  const utils = render(
    <WorkspacePanel sessionId="s1" workspace="/tmp/ws" onWorkspaceChange={onWorkspaceChange} {...props} />,
  )
  return { ...utils, onWorkspaceChange }
}

async function openBrowse() {
  workspaceStore.set(workspacePanelModeAtom, 'browse')
  renderPanel()
  await screen.findByTestId('tree-row-README.md')
  return screen.getByTestId('workspace-panel')
}

describe('WorkspacePanel — demand-driven open/close', () => {
  it('renders nothing while closed and never fetches', () => {
    renderPanel()
    expect(screen.queryByTestId('workspace-panel')).not.toBeInTheDocument()
    expect(listDirMock).not.toHaveBeenCalled()
    expect(getGitStatusMock).not.toHaveBeenCalled()
  })

  it('opens in browse mode and lists the workspace files', async () => {
    await openBrowse()
    expect(listDirMock).toHaveBeenCalledWith('s1')
    expect(screen.getByTestId('tree-row-README.md')).toBeInTheDocument()
    expect(screen.getByTestId('tree-row-notes.txt')).toBeInTheDocument()
  })

  it('closes the panel and persists the closed mode', async () => {
    await openBrowse()
    await userEvent.click(screen.getByRole('button', { name: 'Close workspace panel' }))
    expect(workspaceStore.get(workspacePanelModeAtom)).toBe('closed')
    expect(localStorage.getItem('hermescn:workspace-panel-mode')).toBe('closed')
    expect(screen.queryByTestId('workspace-panel')).not.toBeInTheDocument()
  })

  it('shows a no-workspace placeholder when the session has no workspace', async () => {
    workspaceStore.set(workspacePanelModeAtom, 'browse')
    renderPanel({ workspace: null })
    expect(await screen.findByText('No workspace selected')).toBeInTheDocument()
    expect(listDirMock).not.toHaveBeenCalled()
  })
})

describe('WorkspacePanel — browse → preview flow', () => {
  it('opens a file in preview mode and returns to the list via Back', async () => {
    await openBrowse()
    await userEvent.click(screen.getByTestId('tree-row-notes.txt'))
    expect(workspaceStore.get(workspacePanelModeAtom)).toBe('preview')
    expect(await screen.findByTestId('preview-code')).toHaveTextContent('hello')

    await userEvent.click(screen.getByRole('button', { name: 'Back to files' }))
    expect(workspaceStore.get(workspacePanelModeAtom)).toBe('browse')
    expect(screen.getByTestId('tree-row-README.md')).toBeInTheDocument()
  })

  it('shows the relative path in the preview path bar', async () => {
    await openBrowse()
    await userEvent.click(screen.getByTestId('tree-row-notes.txt'))
    expect(await screen.findByTestId('preview-path-bar')).toHaveTextContent('notes.txt')
  })
})

describe('WorkspacePanel — delete', () => {
  it('asks for confirmation before deleting a file', async () => {
    await openBrowse()
    await screen.findByTestId('tree-row-notes.txt')
    await userEvent.click(screen.getByRole('button', { name: 'Delete notes.txt' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Delete notes.txt')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(deleteFileMock).toHaveBeenCalledWith('s1', 'notes.txt', {}),
    )
    // Tree refetches after the mutation.
    await waitFor(() => expect(listDirMock).toHaveBeenCalledTimes(2))
  })

  it('deletes directories with recursive=true', async () => {
    await openBrowse()
    await screen.findByTestId('tree-row-src')
    await userEvent.click(screen.getByRole('button', { name: 'Delete src' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(deleteFileMock).toHaveBeenCalledWith('s1', 'src', { recursive: true }),
    )
  })

  it('cancelling the dialog does not delete', async () => {
    await openBrowse()
    await screen.findByTestId('tree-row-notes.txt')
    await userEvent.click(screen.getByRole('button', { name: 'Delete notes.txt' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(deleteFileMock).not.toHaveBeenCalled()
  })
})

describe('WorkspacePanel — create', () => {
  it('creates a file and opens it in preview', async () => {
    await openBrowse()
    await userEvent.click(screen.getByRole('button', { name: 'New file' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByPlaceholderText('filename.txt'), 'new.txt')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createFileMock).toHaveBeenCalledWith('s1', 'new.txt'))
    // The new file opens in preview (tree unmounts, so no refetch is needed).
    expect(workspaceStore.get(workspacePanelModeAtom)).toBe('preview')
    await waitFor(() => expect(readFileMock).toHaveBeenCalledWith('s1', 'new.txt'))
  })

  it('creates a folder without leaving browse mode', async () => {
    await openBrowse()
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByPlaceholderText('folder-name'), 'assets')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createDirMock).toHaveBeenCalledWith('s1', 'assets'))
    await waitFor(() => expect(listDirMock).toHaveBeenCalledTimes(2))
    expect(workspaceStore.get(workspacePanelModeAtom)).toBe('browse')
  })
})

describe('WorkspacePanel — rename', () => {
  it('renames via dialog and refreshes the tree', async () => {
    await openBrowse()
    await screen.findByTestId('tree-row-README.md')
    await userEvent.click(screen.getByRole('button', { name: 'Rename README.md' }))

    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByDisplayValue('README.md')
    await userEvent.clear(input)
    await userEvent.type(input, 'README2.md')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }))

    await waitFor(() =>
      expect(renameFileMock).toHaveBeenCalledWith('s1', 'README.md', 'README2.md'),
    )
    await waitFor(() => expect(listDirMock).toHaveBeenCalledTimes(2))
  })
})

describe('WorkspacePanel — workspace switcher', () => {
  it('lists workspaces and switches the session binding', async () => {
    await openBrowse()
    await userEvent.click(screen.getByTestId('workspace-switcher'))

    const option = await screen.findByTestId('workspace-option-/tmp/other')
    expect(screen.getByTestId('workspace-option-/tmp/ws')).toBeInTheDocument()
    await userEvent.click(option)

    await waitFor(() =>
      expect(updateSessionMock).toHaveBeenCalledWith({
        session_id: 's1',
        workspace: '/tmp/other',
      }),
    )
    expect(screen.getByTestId('workspace-switcher')).toHaveTextContent('other')
  })
})

describe('WorkspacePanel — git badge', () => {
  it('shows branch and change counts for git workspaces', async () => {
    getGitStatusMock.mockResolvedValue({
      git: {
        is_git: true,
        branch: 'main',
        upstream: 'origin/main',
        ahead: 0,
        behind: 0,
        totals: { changed: 3, staged: 1, unstaged: 2, untracked: 0, conflicts: 0 },
        files: [],
        truncated: false,
        noise_filtering: { filemode_only: 0, crlf_only: 0, active: false },
      },
    })
    await openBrowse()
    const badge = await screen.findByTestId('git-badge')
    expect(badge).toHaveTextContent('main')
    expect(badge).toHaveTextContent('3')
  })

  it('hides the badge for non-git workspaces', async () => {
    await openBrowse()
    await waitFor(() => expect(getGitStatusMock).toHaveBeenCalledWith('s1'))
    expect(screen.queryByTestId('git-badge')).not.toBeInTheDocument()
  })
})

describe('WorkspacePanel — inline editor', () => {
  async function openEditor() {
    await openBrowse()
    await userEvent.click(screen.getByTestId('tree-row-notes.txt'))
    await screen.findByTestId('preview-code')
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    return screen.findByRole('textbox')
  }

  it('saves edits via saveFile and returns to preview', async () => {
    const textarea = await openEditor()
    await userEvent.type(textarea, ' world')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(saveFileMock).toHaveBeenCalledWith('s1', 'notes.txt', 'hello world'),
    )
    // Editor closes back to the preview.
    await screen.findByTestId('preview-code')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('cancels edits on Escape without saving', async () => {
    const textarea = await openEditor()
    await userEvent.type(textarea, ' world')
    await userEvent.keyboard('{Escape}')
    expect(saveFileMock).not.toHaveBeenCalled()
    await screen.findByTestId('preview-code')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('guards against discarding dirty edits when navigating back', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const textarea = await openEditor()
    await userEvent.type(textarea, ' world')
    await userEvent.click(screen.getByRole('button', { name: 'Back to files' }))
    expect(confirmSpy).toHaveBeenCalled()
    // Declined → still editing.
    expect(screen.getByRole('textbox')).toBeInTheDocument()

    confirmSpy.mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Back to files' }))
    await waitFor(() =>
      expect(workspaceStore.get(workspacePanelModeAtom)).toBe('browse'),
    )
    confirmSpy.mockRestore()
  })
})

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addWorkspace,
  getWorkspaces,
  removeWorkspace,
  renameWorkspace,
  reorderWorkspaces,
  suggestWorkspaces,
  type WorkspacesResponse,
} from '@/api/workspace'
import { WorkspacesPanel } from './WorkspacesPanel'

vi.mock('@/api/workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workspace')>()
  return {
    ...actual,
    getWorkspaces: vi.fn(),
    addWorkspace: vi.fn(),
    removeWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    reorderWorkspaces: vi.fn(),
    suggestWorkspaces: vi.fn(),
  }
})
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const getWorkspacesMock = vi.mocked(getWorkspaces)
const addWorkspaceMock = vi.mocked(addWorkspace)
const removeWorkspaceMock = vi.mocked(removeWorkspace)
const renameWorkspaceMock = vi.mocked(renameWorkspace)
const reorderWorkspacesMock = vi.mocked(reorderWorkspaces)
const suggestWorkspacesMock = vi.mocked(suggestWorkspaces)

const RESPONSE: WorkspacesResponse = {
  workspaces: [
    { path: '/home/u/ws-a', name: 'Alpha' },
    { path: '/home/u/ws-b', name: 'Beta' },
  ],
  last: '/home/u/ws-a',
  terminal_remote_backend: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  getWorkspacesMock.mockResolvedValue(RESPONSE)
  addWorkspaceMock.mockResolvedValue({ ok: true, workspaces: RESPONSE.workspaces })
  removeWorkspaceMock.mockResolvedValue({ ok: true, workspaces: RESPONSE.workspaces })
  renameWorkspaceMock.mockResolvedValue({ ok: true, workspaces: RESPONSE.workspaces })
  reorderWorkspacesMock.mockResolvedValue({ ok: true, workspaces: RESPONSE.workspaces })
  suggestWorkspacesMock.mockResolvedValue({ suggestions: ['/home/u/ws-c'], prefix: '' })
})

describe('WorkspacesPanel', () => {
  it('renders the workspace list with the active workspace marked', async () => {
    render(<WorkspacesPanel />)

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('/home/u/ws-a')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('switches a workspace by reordering it to the top', async () => {
    const user = userEvent.setup()
    render(<WorkspacesPanel />)

    await screen.findByText('Beta')
    await user.click(screen.getByRole('button', { name: 'Switch to Beta' }))

    await waitFor(() =>
      expect(reorderWorkspacesMock).toHaveBeenCalledWith(['/home/u/ws-b', '/home/u/ws-a']),
    )
  })

  it('adds a workspace through the client and reloads', async () => {
    const user = userEvent.setup()
    render(<WorkspacesPanel />)

    await screen.findByText('Alpha')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.type(screen.getByPlaceholderText('/path/to/workspace'), '/home/u/ws-c')
    await user.click(screen.getByRole('button', { name: 'Add workspace' }))

    await waitFor(() =>
      expect(addWorkspaceMock).toHaveBeenCalledWith(
        '/home/u/ws-c',
        expect.objectContaining({ create: true }),
      ),
    )
    await waitFor(() => expect(getWorkspacesMock).toHaveBeenCalledTimes(2))
  })

  it('renames a workspace through the client', async () => {
    const user = userEvent.setup()
    render(<WorkspacesPanel />)

    await screen.findByText('Alpha')
    await user.click(screen.getByRole('button', { name: 'Rename Alpha' }))
    const input = screen.getByDisplayValue('Alpha')
    await user.clear(input)
    await user.type(input, 'Alpha2')
    await user.click(screen.getByRole('button', { name: 'Confirm rename' }))

    await waitFor(() => expect(renameWorkspaceMock).toHaveBeenCalledWith('/home/u/ws-a', 'Alpha2'))
  })

  it('removes a workspace after confirmation', async () => {
    const user = userEvent.setup()
    render(<WorkspacesPanel />)

    await screen.findByText('Alpha')
    await user.click(screen.getByRole('button', { name: 'Remove Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Confirm remove' }))

    await waitFor(() => expect(removeWorkspaceMock).toHaveBeenCalledWith('/home/u/ws-a'))
  })

  it('shows an error state when loading fails', async () => {
    getWorkspacesMock.mockRejectedValue(new Error('boom'))
    render(<WorkspacesPanel />)

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})

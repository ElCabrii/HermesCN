import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readMemory, writeMemory, type MemoryData } from '@/api/panels'
import { MemoryPanel } from './MemoryPanel'

vi.mock('@/api/panels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/panels')>()
  return {
    ...actual,
    readMemory: vi.fn(),
    writeMemory: vi.fn(),
  }
})
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const readMemoryMock = vi.mocked(readMemory)
const writeMemoryMock = vi.mocked(writeMemory)

const MEMORY: MemoryData = {
  memory: '# Memory\n\nBase notes.',
  user: '# User\n\nPreferences.',
  soul: '# Soul\n\nDirectives.',
  project_context: '',
  memory_path: '/home/u/.hermes/memories/MEMORY.md',
  user_path: '/home/u/.hermes/memories/USER.md',
  soul_path: '/home/u/.hermes/memories/SOUL.md',
  project_context_path: '',
  project_context_name: '',
  project_context_workspace: '',
  memory_mtime: 1720000000,
  user_mtime: null,
  soul_mtime: 1720000060,
  project_context_mtime: null,
  project_context_shadowed: false,
  external_notes_enabled: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  readMemoryMock.mockResolvedValue(MEMORY)
  writeMemoryMock.mockResolvedValue({ ok: true, section: 'memory', path: MEMORY.memory_path })
})

describe('MemoryPanel', () => {
  it('renders the three editable panes with content, paths, and mtimes', async () => {
    render(<MemoryPanel />)

    expect(await screen.findByLabelText('MEMORY.md')).toHaveValue('# Memory\n\nBase notes.')
    expect(screen.getByLabelText('USER.md')).toHaveValue('# User\n\nPreferences.')
    expect(screen.getByLabelText('SOUL.md')).toHaveValue('# Soul\n\nDirectives.')

    // paths are shown as quiet metadata
    expect(screen.getByText(MEMORY.memory_path)).toBeInTheDocument()
    expect(screen.getByText(MEMORY.user_path)).toBeInTheDocument()

    // mtimes: unix seconds → locale string; null → "never"
    expect(screen.getByText(new Date(1720000000 * 1000).toLocaleString())).toBeInTheDocument()
    expect(screen.getByText('never')).toBeInTheDocument()
  })

  it('saves an edited section via writeMemory with the section name', async () => {
    const user = userEvent.setup()
    render(<MemoryPanel />)

    const editor = await screen.findByLabelText('MEMORY.md')
    const saveButton = screen.getByRole('button', { name: 'Save MEMORY.md' })
    // untouched sections start clean — nothing to save
    expect(saveButton).toBeDisabled()

    await user.clear(editor)
    await user.type(editor, '# Memory\n\nUpdated notes.')
    expect(saveButton).toBeEnabled()

    await user.click(saveButton)
    await waitFor(() =>
      expect(writeMemoryMock).toHaveBeenCalledWith('memory', '# Memory\n\nUpdated notes.'),
    )
  })

  it('sends the right section name for user and soul panes', async () => {
    const user = userEvent.setup()
    render(<MemoryPanel />)

    const userEditor = await screen.findByLabelText('USER.md')
    await user.clear(userEditor)
    await user.type(userEditor, 'New user prefs')
    await user.click(screen.getByRole('button', { name: 'Save USER.md' }))
    await waitFor(() => expect(writeMemoryMock).toHaveBeenCalledWith('user', 'New user prefs'))

    const soulEditor = screen.getByLabelText('SOUL.md')
    await user.clear(soulEditor)
    await user.type(soulEditor, 'New soul directive')
    await user.click(screen.getByRole('button', { name: 'Save SOUL.md' }))
    await waitFor(() => expect(writeMemoryMock).toHaveBeenCalledWith('soul', 'New soul directive'))
  })

  it('reports an error when memory cannot be loaded', async () => {
    readMemoryMock.mockRejectedValue(new Error('boom'))
    render(<MemoryPanel />)

    expect(await screen.findByText(/failed to load memory/i)).toBeInTheDocument()
  })
})

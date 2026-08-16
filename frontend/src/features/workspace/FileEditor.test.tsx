import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, saveFile } from '@/api/workspace'
import { FileEditor } from './FileEditor'

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

const readFileMock = vi.mocked(readFile)
const saveFileMock = vi.mocked(saveFile)

beforeEach(() => {
  vi.clearAllMocks()
  readFileMock.mockResolvedValue({ path: 'notes.txt', content: 'hello', size: 5, lines: 1 })
  saveFileMock.mockResolvedValue({ ok: true, path: 'notes.txt', size: 11 })
})

function renderEditor(props: Partial<React.ComponentProps<typeof FileEditor>> = {}) {
  const onCancel = vi.fn()
  const onSaved = vi.fn()
  const onDirtyChange = vi.fn()
  const utils = render(
    <FileEditor
      sessionId="s1"
      path="notes.txt"
      onCancel={onCancel}
      onSaved={onSaved}
      onDirtyChange={onDirtyChange}
      {...props}
    />,
  )
  return { ...utils, onCancel, onSaved, onDirtyChange }
}

describe('FileEditor', () => {
  it('loads the file content into a textarea', async () => {
    renderEditor()
    const textarea = await screen.findByRole('textbox')
    expect(textarea).toHaveValue('hello')
    expect(readFileMock).toHaveBeenCalledWith('s1', 'notes.txt')
  })

  it('keeps Save disabled until the content is dirty', async () => {
    renderEditor()
    const save = await screen.findByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    const textarea = screen.getByRole('textbox')
    await userEvent.type(textarea, ' world')
    expect(save).toBeEnabled()
  })

  it('saves via saveFile and reports the saved path', async () => {
    const { onSaved } = renderEditor()
    const textarea = await screen.findByRole('textbox')
    await userEvent.type(textarea, ' world')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(saveFileMock).toHaveBeenCalledWith('s1', 'notes.txt', 'hello world'),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('notes.txt'))
  })

  it('cancels on Escape without saving', async () => {
    const { onCancel } = renderEditor()
    const textarea = await screen.findByRole('textbox')
    await userEvent.type(textarea, ' world')
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(saveFileMock).not.toHaveBeenCalled()
  })

  it('reports dirty state changes to the parent', async () => {
    const { onDirtyChange } = renderEditor()
    const textarea = await screen.findByRole('textbox')
    await userEvent.type(textarea, '!')
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true))
  })

  it('shows an error state when the file cannot be read', async () => {
    readFileMock.mockRejectedValueOnce(new Error('boom'))
    renderEditor()
    expect(await screen.findByText('Could not load file')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

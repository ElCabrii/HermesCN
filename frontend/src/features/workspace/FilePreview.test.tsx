import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from '@/api/workspace'
import { FilePreview } from './FilePreview'

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

vi.mock('@/features/chat/Markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

const readFileMock = vi.mocked(readFile)

beforeEach(() => {
  vi.clearAllMocks()
  readFileMock.mockResolvedValue({ path: 'README.md', content: '# Hi', size: 5, lines: 1 })
})

function renderPreview(path: string) {
  return render(<FilePreview sessionId="s1" path={path} />)
}

describe('FilePreview', () => {
  it('renders images via the raw file URL without fetching text', () => {
    renderPreview('img/hero.png')
    const img = screen.getByTestId('preview-image')
    expect(img).toHaveAttribute('src', '/api/file/raw?session_id=s1&path=img%2Fhero.png')
    expect(img).toHaveAttribute('alt', 'img/hero.png')
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('renders markdown content through the Markdown component', async () => {
    readFileMock.mockResolvedValue({
      path: 'README.md',
      content: '# Hello **world**',
      size: 18,
      lines: 1,
    })
    renderPreview('README.md')
    expect(readFileMock).toHaveBeenCalledWith('s1', 'README.md')
    expect(await screen.findByTestId('markdown')).toHaveTextContent('# Hello **world**')
  })

  it('renders plain text and code files in a monospace block', async () => {
    readFileMock.mockResolvedValue({ path: 'src/app.py', content: 'print("hi")', size: 12, lines: 1 })
    renderPreview('src/app.py')
    const code = await screen.findByTestId('preview-code')
    expect(code).toHaveTextContent('print("hi")')
  })

  it('shows a binary-file note for unknown/binary extensions', () => {
    renderPreview('docs/report.pdf')
    expect(screen.getByTestId('preview-binary')).toHaveTextContent('Binary file')
    expect(screen.getByTestId('preview-binary')).toHaveTextContent('docs/report.pdf')
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('shows an error state when the text fetch fails', async () => {
    readFileMock.mockRejectedValueOnce(new Error('boom'))
    renderPreview('README.md')
    expect(await screen.findByText('Could not load file')).toBeInTheDocument()
  })
})

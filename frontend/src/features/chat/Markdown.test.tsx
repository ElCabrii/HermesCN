import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './Markdown'

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}))
vi.mock('mermaid', () => ({
  default: { initialize: mermaidMock.initialize, render: mermaidMock.render },
}))

const workspaceLinkMock = vi.hoisted(() => ({ requestOpenWorkspaceFile: vi.fn() }))
vi.mock('@/features/workspace/workspaceStore', async (importActual) => ({
  ...(await importActual<typeof import('@/features/workspace/workspaceStore')>()),
  requestOpenWorkspaceFile: workspaceLinkMock.requestOpenWorkspaceFile,
}))

describe('Markdown', () => {
  beforeEach(() => {
    mermaidMock.initialize.mockClear()
    mermaidMock.render.mockClear()
  })

  it('keeps conversation prose on the UI sans stack, not an editorial serif', () => {
    // docs/UIUX-GUIDE.md: "Conversation prose must remain the system sans by
    // default. Do not introduce a global conversation serif ... without
    // explicit design approval plus code and test evidence." This is that
    // evidence — the prose container shipped `font-serif` for a while.
    const { container } = render(<Markdown content="a settled answer" prose />)
    const prose = container.querySelector('[data-prose="true"]') as HTMLElement
    expect(prose).not.toBeNull()
    expect(prose.className).not.toMatch(/font-serif/)
  })

  it('offers a copy control on fenced code blocks', () => {
    render(<Markdown content={'```sh\nhermes config set terminal.backend local\n```'} prose />)
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
  })

  it('renders bold and italic text', () => {
    render(<Markdown content="**bold** and *italic*" />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('italic').tagName).toBe('EM')
  })

  it('renders inline code and fenced code blocks', () => {
    render(<Markdown content={'run `pnpm test`\n\n```ts\nconst x = 1\n```'} />)
    expect(screen.getByText('pnpm test').tagName).toBe('CODE')
    expect(screen.getByText('const x = 1')).toBeInTheDocument()
  })

  it('renders GFM tables', () => {
    render(<Markdown content={'| a | b |\n| - | - |\n| 1 | 2 |'} />)
    const table = document.querySelector('table')
    expect(table).not.toBeNull()
    expect(table?.querySelector('thead th')?.textContent).toBe('a')
    expect(table?.querySelector('tbody td')?.textContent).toBe('1')
  })

  it('renders headings at the right levels', () => {
    render(<Markdown content={'# Title\n\n## Sub'} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Sub' })).toBeInTheDocument()
  })

  it('opens external links in a new tab with noopener', () => {
    render(<Markdown content="[docs](https://example.com/docs)" />)
    const link = screen.getByRole('link', { name: 'docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('intercepts workspace:// links and requests a preview open instead of navigating', () => {
    workspaceLinkMock.requestOpenWorkspaceFile.mockClear()
    render(<Markdown content="[report](workspace://docs/report.md)" />)
    const link = screen.getByRole('link', { name: 'report' })
    // Internal deep-link: must NOT open a new tab.
    expect(link).not.toHaveAttribute('target', '_blank')
    fireEvent.click(link)
    expect(workspaceLinkMock.requestOpenWorkspaceFile).toHaveBeenCalledWith('docs/report.md')
  })

  it('strips ~​/ and ./ prefixes from workspace:// paths', () => {
    workspaceLinkMock.requestOpenWorkspaceFile.mockClear()
    render(<Markdown content="[f](workspace://~/src/a.ts)" />)
    fireEvent.click(screen.getByRole('link', { name: 'f' }))
    expect(workspaceLinkMock.requestOpenWorkspaceFile).toHaveBeenCalledWith('src/a.ts')
  })

  it('fails closed on raw script HTML — no script tag, no script text', () => {
    render(<Markdown content={'<script>alert(1)</script>after'} />)
    expect(document.querySelector('script')).toBeNull()
    expect(document.body.textContent).not.toContain('alert(1)')
  })

  it('strips dangerous attributes from allowed inline HTML', () => {
    render(<Markdown content={'before <strong onclick="alert(2)">bold</strong> after'} />)
    expect(document.querySelector('[onclick]')).toBeNull()
    expect(document.body.textContent).not.toContain('alert(2)')
    expect(screen.getByText(/before/)).toBeInTheDocument()
    expect(screen.getByText(/after/)).toBeInTheDocument()
  })

  it('renders KaTeX math', () => {
    render(<Markdown content="Inline $x^2$ math" />)
    expect(document.querySelector('.katex')).not.toBeNull()
  })

  it('does not load mermaid when there is no mermaid block', async () => {
    render(<Markdown content="plain **text**" />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mermaidMock.initialize).not.toHaveBeenCalled()
  })

  it('lazy-loads mermaid on the first mermaid block and renders the diagram', async () => {
    mermaidMock.render.mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"></svg>' })
    render(<Markdown content={'```mermaid\ngraph TD\n  A-->B\n```'} />)
    const svg = await screen.findByTestId('mermaid-svg')
    expect(svg).toBeInTheDocument()
    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({ startOnLoad: false }))
  })

  it('renders a plain fallback when mermaid rendering fails', async () => {
    mermaidMock.render.mockRejectedValueOnce(new Error('diagram failed'))
    render(<Markdown content={'```mermaid\ngraph TD\n  A-->B\n```'} />)
    expect(await screen.findByText(/A-->B/)).toBeInTheDocument()
  })
})

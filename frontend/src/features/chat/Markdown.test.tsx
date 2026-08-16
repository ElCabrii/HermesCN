import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './Markdown'

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}))
vi.mock('mermaid', () => ({
  default: { initialize: mermaidMock.initialize, render: mermaidMock.render },
}))

describe('Markdown', () => {
  beforeEach(() => {
    mermaidMock.initialize.mockClear()
    mermaidMock.render.mockClear()
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

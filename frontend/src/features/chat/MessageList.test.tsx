import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Message } from './chatStore'
import { MessageList, type LiveToolCall } from './MessageList'

function msg(overrides: Partial<Message> & { role: string; content: string }): Message {
  const { role, content, ...rest } = overrides
  return { role, content, ...rest }
}

describe('MessageList', () => {
  it('renders user messages as right-aligned bubbles with data-role=user', () => {
    render(<MessageList messages={[msg({ role: 'user', content: 'hello there' })]} />)
    const row = screen.getByText('hello there').closest('[data-role="user"]')
    expect(row).not.toBeNull()
    expect(row).toHaveClass('justify-end')
  })

  it('renders assistant messages as prose with data-role=assistant', () => {
    render(<MessageList messages={[msg({ role: 'assistant', content: '**bold** answer' })]} />)
    const row = screen.getByText('bold').closest('[data-role="assistant"]')
    expect(row).not.toBeNull()
    expect(row?.querySelector('[data-prose="true"]')).not.toBeNull()
  })

  it('renders attachment chips on user messages', () => {
    render(
      <MessageList
        messages={[
          msg({
            role: 'user',
            content: 'see file',
            attachments: [{ name: 'notes.txt', path: '/tmp/notes.txt', mime: 'text/plain' }],
          }),
        ]}
      />,
    )
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
  })

  it('shows a collapsed thinking disclosure for assistant reasoning', async () => {
    const user = userEvent.setup()
    render(<MessageList messages={[msg({ role: 'assistant', content: 'answer', reasoning: 'thinking hard' })]} />)
    const summary = screen.getByRole('button', { name: 'Thinking' })
    const group = summary.closest('[data-role="thinking"]')
    expect(group).not.toBeNull()
    expect(group).toHaveAttribute('data-collapsed', 'true')
    expect(screen.queryByText('thinking hard')).not.toBeInTheDocument()
    await user.click(summary)
    expect(screen.getByText('thinking hard')).toBeInTheDocument()
  })

  it('groups tool calls into one collapsed Activity disclosure per assistant turn', async () => {
    const user = userEvent.setup()
    render(
      <MessageList
        messages={[
          msg({ role: 'user', content: 'go' }),
          msg({
            role: 'assistant',
            content: 'working',
            tool_calls: [
              { name: 'search', done: true },
              { name: 'read', done: true },
            ],
          }),
        ]}
      />,
    )
    const summary = screen.getByRole('button', { name: 'Activity: 2 tools' })
    const group = summary.closest('[data-role="tool"]')
    expect(group).not.toBeNull()
    expect(group).toHaveAttribute('data-collapsed', 'true')
    expect(screen.queryByText('search')).not.toBeInTheDocument()

    await user.click(summary)
    const searchRow = screen.getByText('search').closest('[data-tool-name="search"]')
    expect(searchRow).not.toBeNull()
    expect(searchRow).toHaveAttribute('data-collapsed', 'true')
    expect(searchRow).toHaveAttribute('data-tool-status', 'done')
  })

  it('expands a tool row to reveal its arguments', async () => {
    const user = userEvent.setup()
    render(
      <MessageList
        messages={[
          msg({
            role: 'assistant',
            content: 'ok',
            tool_calls: [{ name: 'search', args: { query: 'hermes', limit: 5 }, done: true }],
          }),
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Activity: 1 tool' }))
    const row = screen.getByText('search').closest('[data-tool-name="search"]')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).queryByText(/"query"/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'search details' }))
    expect(row).toHaveAttribute('data-collapsed', 'false')
    expect(within(row as HTMLElement).getByText(/"query"/)).toBeInTheDocument()
  })

  it('shows a running status for live tool calls grouped into the last turn', async () => {
    const user = userEvent.setup()
    const live: LiveToolCall[] = [{ name: 'search', preview: 'docs', done: false }]
    render(<MessageList messages={[msg({ role: 'assistant', content: '' })]} liveToolCalls={live} />)
    const summary = screen.getByRole('button', { name: 'Activity: 1 tool' })
    await user.click(summary)
    const row = screen.getByText('search').closest('[data-tool-name="search"]')
    expect(row).not.toBeNull()
    expect(row).toHaveAttribute('data-tool-status', 'running')
    expect(within(row as HTMLElement).getByText('docs')).toBeInTheDocument()
  })

  it('marks failed tool calls with an error status', async () => {
    const user = userEvent.setup()
    render(
      <MessageList
        messages={[
          msg({
            role: 'assistant',
            content: '',
            tool_calls: [{ name: 'search', done: true, is_error: true }],
          }),
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Activity: 1 tool' }))
    const row = screen.getByText('search').closest('[data-tool-name="search"]')
    expect(row).toHaveAttribute('data-tool-status', 'error')
  })

  it('truncates long results behind a show more toggle', async () => {
    const user = userEvent.setup()
    const longResult = 'x'.repeat(600)
    render(
      <MessageList
        messages={[
          msg({
            role: 'assistant',
            content: '',
            tool_calls: [{ name: 'calc', result: longResult, done: true }],
          }),
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Activity: 1 tool' }))
    await user.click(screen.getByRole('button', { name: 'calc details' }))
    const row = screen.getByText('calc').closest('[data-tool-name="calc"]') as HTMLElement
    expect(within(row).getByText(/x{400}/)).toBeInTheDocument()
    expect(within(row).queryByText(/x{600}/)).not.toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: /show more/i }))
    expect(within(row).getByText(/x{600}/)).toBeInTheDocument()
  })

  it('folds tool result messages into the owning turn activity disclosure', async () => {
    // docs/UIUX-GUIDE.md: internal events must not each become a first-class
    // chat card. A settled `role: "tool"` entry belongs to the assistant turn
    // that produced it, behind that turn's one Activity disclosure.
    const user = userEvent.setup()
    render(
      <MessageList
        messages={[
          msg({ role: 'assistant', content: 'let me check' }),
          msg({ role: 'tool', content: '42', name: 'calc' }),
        ]}
      />,
    )
    expect(screen.queryByText('calc')).not.toBeInTheDocument()

    const summary = screen.getByRole('button', { name: 'Activity: 1 tool' })
    expect(summary.closest('[data-role="tool"]')).toHaveAttribute('data-collapsed', 'true')
    await user.click(summary)

    const row = screen.getByText('calc').closest('[data-tool-name="calc"]')
    expect(row).not.toBeNull()
    expect(row).toHaveAttribute('data-tool-status', 'done')
  })

  it('keeps orphan tool results reachable when no assistant turn owns them', async () => {
    const user = userEvent.setup()
    render(<MessageList messages={[msg({ role: 'tool', content: '42', name: 'calc' })]} />)
    await user.click(screen.getByRole('button', { name: 'Activity: 1 tool' }))
    expect(screen.getByText('calc').closest('[data-tool-name="calc"]')).not.toBeNull()
  })

  it('renders the live compression divider centered and non-interactive', () => {
    const { rerender } = render(<MessageList messages={[]} liveCompression="running" />)
    const running = screen.getByText('Compressing context')
    const divider = running.closest('[data-role="compression"]')
    expect(divider).not.toBeNull()
    expect(within(divider as HTMLElement).queryByRole('button')).toBeNull()

    rerender(<MessageList messages={[]} liveCompression="done" />)
    expect(screen.getByText('Context auto-compressed')).toBeInTheDocument()
  })
})

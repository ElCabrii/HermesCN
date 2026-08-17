import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharePage } from './SharePage'

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubShareFetch(share: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(okJson(share, status))
  vi.stubGlobal('fetch', fn)
  return fn
}

const TRANSCRIPT = {
  title: 'Debugging the proxy',
  messages: [
    { role: 'user', content: 'What changed?', timestamp: 1720000000 },
    { role: 'assistant', content: 'The proxy timeout was **raised** to 60s.', timestamp: 1720000005 },
  ],
  message_count: 2,
  created_at: 1720000000,
  updated_at: 1720000100,
}

describe('SharePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a loading state while the transcript loads', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))

    render(<SharePage token="abc123" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders the title, message count meta, and snapshot timestamp', async () => {
    stubShareFetch({ share: TRANSCRIPT })

    render(<SharePage token="abc123" />)

    expect(
      await screen.findByRole('heading', { name: 'Debugging the proxy' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('share-count')).toHaveTextContent(
      '2 messages · public read-only snapshot',
    )
    expect(screen.getByTestId('share-timestamp')).toHaveTextContent(
      new Date(1720000100 * 1000).toLocaleString(),
    )
  })

  it('fetches the public snapshot for the given token', async () => {
    const fn = stubShareFetch({ share: TRANSCRIPT })

    render(<SharePage token="abc def" />)

    await screen.findByRole('heading', { name: 'Debugging the proxy' })
    const [input, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(input).toBe('/api/share/abc%20def')
    expect(init.method ?? 'GET').toBe('GET')
  })

  it('renders user messages in a right-aligned bubble', async () => {
    stubShareFetch({ share: TRANSCRIPT })

    render(<SharePage token="abc123" />)

    const userText = await screen.findByText('What changed?')
    expect(userText.closest('[data-role="user"]')).not.toBeNull()
    expect(userText.closest('.bg-secondary')).not.toBeNull()
  })

  it('renders assistant prose through the shared Markdown component', async () => {
    stubShareFetch({ share: TRANSCRIPT })

    render(<SharePage token="abc123" />)

    const bold = await screen.findByText('raised')
    expect(bold.tagName).toBe('STRONG')
    expect(bold.closest('[data-role="assistant"]')).not.toBeNull()
  })

  it('renders user message markdown through the shared Markdown component too', async () => {
    stubShareFetch({
      share: {
        title: 'T',
        messages: [{ role: 'user', content: 'Use `pnpm test` please' }],
        message_count: 1,
      },
    })

    render(<SharePage token="abc123" />)

    const code = await screen.findByText('pnpm test')
    expect(code.tagName).toBe('CODE')
    expect(code.closest('.bg-secondary')).not.toBeNull()
  })

  it('keeps tool and system traces out of the transcript view', async () => {
    stubShareFetch({
      share: {
        title: 'T',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
          { role: 'tool', content: 'tool result noise' },
          { role: 'system', content: 'system note' },
        ],
        message_count: 4,
      },
    })

    render(<SharePage token="abc123" />)

    await screen.findByText('hello')
    expect(screen.queryByText('tool result noise')).not.toBeInTheDocument()
    expect(screen.queryByText('system note')).not.toBeInTheDocument()
    expect(screen.getByTestId('share-count')).toHaveTextContent(
      '4 messages · public read-only snapshot',
    )
  })

  it('shows the legacy empty note when the snapshot has no messages', async () => {
    stubShareFetch({ share: { title: 'T', messages: [], message_count: 0 } })

    render(<SharePage token="abc123" />)

    expect(
      await screen.findByText('This shared conversation has no visible messages.'),
    ).toBeInTheDocument()
  })

  it('shows the not-found state for a 404 snapshot', async () => {
    stubShareFetch({ error: 'Shared conversation not found' }, 404)

    render(<SharePage token="gone" />)

    // A stranger following a dead link gets an explanation and a way onward,
    // not a bare "not found" line.
    expect(await screen.findByTestId('share-not-found')).toBeInTheDocument()
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /HermesCN/i })).toHaveAttribute('href', '/')
  })

  it('shows the server error message for other failures', async () => {
    stubShareFetch({ error: 'boom' }, 500)

    render(<SharePage token="abc123" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })
})

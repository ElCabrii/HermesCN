import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  chatStore,
  compressingAtom,
  messagesAtom,
  pendingApprovalAtom,
  pendingClarifyAtom,
  reconnectAtom,
  sessionAtom,
  terminalOpenAtom,
  type Session,
} from './chatStore'
import { ChatPage } from './ChatPage'
import { api } from '@/api/client'
import { openChatStream } from '@/api/sse'
import { getModels } from '@/api/models'
import { listSessions } from '@/api/sessions'
import { getProjects } from '@/api/projects'
import { closeTerminal, openTerminalOutput, startTerminal } from '@/api/terminal'

vi.mock('@/api/panels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/panels')>()
  return { ...actual, getSettings: vi.fn().mockResolvedValue({}), updateSettings: vi.fn().mockResolvedValue({}) }
})

vi.mock('@/api/client', () => ({ api: vi.fn() }))
vi.mock('@/api/chat', () => ({
  startChat: vi.fn(),
  uploadFile: vi.fn(),
  cancelStream: vi.fn(),
  getApprovalPending: vi.fn(),
  respondApproval: vi.fn(),
  respondClarify: vi.fn(),
  getStreamStatus: vi.fn(),
}))
vi.mock('@/api/sse', () => ({ openChatStream: vi.fn() }))
vi.mock('@/api/models', () => ({ getModels: vi.fn() }))
vi.mock('sonner', () => ({ toast: vi.fn() }))
// ChatPage now composes the session sidebar (boot + list + project chips).
vi.mock('@/api/sessions', () => ({
  listSessions: vi.fn(),
  searchSessions: vi.fn(),
  pinSession: vi.fn(),
  archiveSession: vi.fn(),
  duplicateSession: vi.fn(),
  renameSession: vi.fn(),
}))
vi.mock('@/api/projects', () => ({ getProjects: vi.fn() }))

// Minimal xterm stand-ins so the embedded TerminalPanel can mount in jsdom.
const { FakeTerminal, FakeFitAddon } = vi.hoisted(() => {
  class FakeTerminal {
    loadAddon(): void {}
    open(): void {}
    dispose(): void {}
    write(): void {}
    writeln(): void {}
    onData(): { dispose(): void } {
      return { dispose: () => {} }
    }
    onResize(): { dispose(): void } {
      return { dispose: () => {} }
    }
  }
  class FakeFitAddon {
    fit(): void {}
  }
  return { FakeTerminal, FakeFitAddon }
})
vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))
vi.mock('@/api/terminal', () => ({
  startTerminal: vi.fn(),
  sendTerminalInput: vi.fn(),
  resizeTerminal: vi.fn(),
  closeTerminal: vi.fn(),
  openTerminalOutput: vi.fn(),
}))

const sessionA: Session = { session_id: 'a', title: 'Session A', model: 'test-model', messages: [] }

beforeEach(() => {
  vi.clearAllMocks()
  chatStore.set(sessionAtom, sessionA)
  chatStore.set(messagesAtom, [])
  chatStore.set(pendingApprovalAtom, null)
  chatStore.set(pendingClarifyAtom, null)
  chatStore.set(reconnectAtom, null)
  chatStore.set(compressingAtom, null)
  chatStore.set(terminalOpenAtom, false)
  vi.mocked(openChatStream).mockReturnValue(vi.fn())
  vi.mocked(getModels).mockResolvedValue({
    active_provider: 'openrouter',
    default_model: 'default-model',
    groups: [],
  })
  // Sidebar boot: no sessions yet, no projects.
  vi.mocked(listSessions).mockResolvedValue({
    sessions: [],
    sidebar_reference_sessions: [],
    cli_count: 0,
    archived_count: 0,
    archived_webui_count: 0,
    archived_cli_count: 0,
    include_archived: false,
    all_profiles: false,
    active_profile: 'default',
    other_profile_count: 0,
    server_time: 0,
    server_tz: '+0000',
  })
  vi.mocked(getProjects).mockResolvedValue({
    projects: [],
    all_profiles: false,
    active_profile: 'default',
    other_profile_count: 0,
  })
  // TerminalPanel promise seams.
  vi.mocked(startTerminal).mockResolvedValue({ ok: true, session_id: 'a', workspace: '', running: true })
  vi.mocked(closeTerminal).mockResolvedValue({ ok: true, closed: true })
  vi.mocked(openTerminalOutput).mockReturnValue(() => {})
})

/**
 * jsdom performs no layout, so scroll geometry has to be supplied by hand.
 * `scrollTop` stays writable (the hook sets it) while the two read-only
 * metrics are stubbed to describe an overflowing viewport.
 */
function fakeScrollGeometry(
  el: HTMLElement,
  { scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  el.scrollTop = scrollTop
}

describe('ChatPage — transcript scrolling', () => {
  it('offers a jump control once the reader scrolls away from the newest turn', () => {
    chatStore.set(messagesAtom, [{ role: 'assistant', content: 'a long conversation' }])
    render(<ChatPage />)
    const viewport = screen.getByTestId('chat-scroll')

    // Parked at the bottom: nothing should cover the transcript.
    fakeScrollGeometry(viewport, { scrollHeight: 2000, clientHeight: 500, scrollTop: 1500 })
    fireEvent.scroll(viewport)
    expect(screen.queryByTestId('jump-to-latest')).not.toBeInTheDocument()

    // Scrolled up to read history: the way back must be one click away.
    fakeScrollGeometry(viewport, { scrollHeight: 2000, clientHeight: 500, scrollTop: 200 })
    fireEvent.scroll(viewport)
    expect(screen.getByTestId('jump-to-latest')).toBeInTheDocument()
  })

  it('returns to the newest turn when the jump control is clicked', () => {
    chatStore.set(messagesAtom, [{ role: 'assistant', content: 'a long conversation' }])
    render(<ChatPage />)
    const viewport = screen.getByTestId('chat-scroll')
    fakeScrollGeometry(viewport, { scrollHeight: 2000, clientHeight: 500, scrollTop: 200 })
    fireEvent.scroll(viewport)

    // jsdom does not implement Element.scrollTo; the hook falls back to
    // assigning scrollTop, which is exactly the path being asserted here.
    fireEvent.click(screen.getByTestId('jump-to-latest'))
    expect(viewport.scrollTop).toBe(2000)
  })

  it('does not offer the jump control when the transcript fits on screen', () => {
    chatStore.set(messagesAtom, [{ role: 'assistant', content: 'short' }])
    render(<ChatPage />)
    const viewport = screen.getByTestId('chat-scroll')
    fakeScrollGeometry(viewport, { scrollHeight: 400, clientHeight: 500, scrollTop: 0 })
    fireEvent.scroll(viewport)
    expect(screen.queryByTestId('jump-to-latest')).not.toBeInTheDocument()
  })
})

describe('ChatPage', () => {
  it('composes the transcript, the composer, and the page heading', () => {
    chatStore.set(messagesAtom, [{ role: 'assistant', content: 'Hello from the agent' }])
    render(<ChatPage />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('HermesCN')
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
    expect(screen.getByTestId('composer')).toBeInTheDocument()
    expect(screen.getByText('Hello from the agent')).toBeInTheDocument()
  })

  it('loads the deep-linked session when given an initialSessionId', async () => {
    const deepSession: Session = {
      session_id: 'abc123',
      title: 'Deep linked',
      messages: [{ role: 'assistant', content: 'Deep content' }],
    }
    vi.mocked(api).mockResolvedValue({ session: deepSession })
    render(<ChatPage initialSessionId="abc123" />)

    expect(await screen.findByText('Deep content')).toBeInTheDocument()
    expect(vi.mocked(api)).toHaveBeenCalledWith(
      expect.stringContaining('/api/session?session_id=abc123'),
      expect.anything(),
    )
  })

  it('reflects the active session title in the document title', async () => {
    vi.mocked(api).mockResolvedValue({
      session: { session_id: 't1', title: 'My Session', messages: [] },
    })
    render(<ChatPage initialSessionId="t1" />)
    await waitFor(() => expect(document.title).toBe('My Session — HermesCN'))
  })

  it('renders the reconnect banner while the single retry is in flight and hides it once cleared', () => {
    render(<ChatPage />)
    expect(screen.queryByTestId('reconnect-banner')).not.toBeInTheDocument()

    act(() => {
      chatStore.set(reconnectAtom, { stream_id: 'stream-1', message: 'Connection lost — reconnecting…' })
    })
    expect(screen.getByTestId('reconnect-banner')).toHaveTextContent('Connection lost — reconnecting…')

    act(() => {
      chatStore.set(reconnectAtom, null)
    })
    expect(screen.queryByTestId('reconnect-banner')).not.toBeInTheDocument()
  })

  it('renders the compression divider while a compression event is active', () => {
    render(<ChatPage />)
    expect(screen.queryByText('Compressing context')).not.toBeInTheDocument()

    act(() => {
      chatStore.set(compressingAtom, 'Compressing context')
    })
    expect(screen.getByText('Compressing context')).toBeInTheDocument()

    act(() => {
      chatStore.set(compressingAtom, null)
    })
    expect(screen.queryByText('Compressing context')).not.toBeInTheDocument()
  })

  it('surfaces the approval card and clarify dialog from the store atoms', async () => {
    render(<ChatPage />)
    expect(screen.queryByTestId('approval-card')).not.toBeInTheDocument()

    chatStore.set(pendingApprovalAtom, { approval_id: 'ap1', command: 'rm -rf /tmp/x', description: 'Delete' })
    await waitFor(() => expect(screen.getByTestId('approval-card')).toBeInTheDocument())

    chatStore.set(pendingApprovalAtom, null)
    await waitFor(() => expect(screen.queryByTestId('approval-card')).not.toBeInTheDocument())

    chatStore.set(pendingClarifyAtom, { clarify_id: 'c1', question: 'Which file?' })
    await waitFor(() => expect(screen.getByText('Clarification needed')).toBeInTheDocument())
    chatStore.set(pendingClarifyAtom, null)
    await waitFor(() => expect(screen.queryByText('Clarification needed')).not.toBeInTheDocument())
  })

  it('mounts the terminal dock while terminalOpenAtom is set and unmounts it on close', async () => {
    render(<ChatPage />)
    expect(screen.queryByTestId('terminal-panel')).not.toBeInTheDocument()

    // /terminal sets the atom — the dock appears above the composer.
    act(() => {
      chatStore.set(terminalOpenAtom, true)
    })
    await waitFor(() => expect(screen.getByTestId('terminal-panel')).toBeInTheDocument())

    // Closing the panel resets the atom and tears the dock down.
    act(() => {
      chatStore.set(terminalOpenAtom, false)
    })
    await waitFor(() => expect(screen.queryByTestId('terminal-panel')).not.toBeInTheDocument())
  })
})

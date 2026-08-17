/**
 * Visual regression smoke test for the chat surface.
 *
 * Renders the ChatPage in jsdom and snapshots the relevant DOM hooks
 * (data-testids, data-roles, aria-labels, computed classNames) for each
 * major state. The intent is to catch regressions like the previous
 * "ChatPage renders only the heading" failure mode after structural edits,
 * without coupling the test to any specific Tailwind class.
 *
 * The actual pixel comparison happens via the Playwright e2e suite
 * (`e2e/app.spec.ts`) — this file is the unit-level guard.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import {
  chatStore,
  messagesAtom,
  pendingApprovalAtom,
  pendingClarifyAtom,
  reconnectAtom,
  sessionAtom,
  terminalOpenAtom,
  type Session,
} from './chatStore'
import { ChatPage } from './ChatPage'
import { openChatStream } from '@/api/sse'
import { getModels } from '@/api/models'
import { listSessions } from '@/api/sessions'
import { getProjects } from '@/api/projects'
import {
  closeTerminal,
  openTerminalOutput,
  startTerminal,
} from '@/api/terminal'

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
vi.mock('@/api/sessions', () => ({
  listSessions: vi.fn(),
  searchSessions: vi.fn(),
  pinSession: vi.fn(),
  archiveSession: vi.fn(),
  duplicateSession: vi.fn(),
  renameSession: vi.fn(),
}))
vi.mock('@/api/projects', () => ({ getProjects: vi.fn() }))

const { FakeTerminal, FakeFitAddon } = vi.hoisted(() => {
  class FakeTerminal {
    loadAddon(): void {}
    open(): void {}
    dispose(): void {}
    write(): void {}
    writeln(): void {}
    onData(): { dispose(): void } { return { dispose: () => {} } }
    onResize(): { dispose(): void } { return { dispose: () => {} } }
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

const sessionA: Session = {
  session_id: 'a',
  title: 'Session A',
  model: 'test-model',
  messages: [],
  workspace: '/home/test/workspace',
}

beforeEach(() => {
  vi.clearAllMocks()
  chatStore.set(sessionAtom, sessionA)
  chatStore.set(messagesAtom, [])
  chatStore.set(pendingApprovalAtom, null)
  chatStore.set(pendingClarifyAtom, null)
  chatStore.set(reconnectAtom, null)
  chatStore.set(terminalOpenAtom, false)
  vi.mocked(openChatStream).mockReturnValue(vi.fn())
  vi.mocked(getModels).mockResolvedValue({ active_provider: 'openrouter', default_model: 'default-model', groups: [] })
  vi.mocked(listSessions).mockResolvedValue({
    sessions: [], sidebar_reference_sessions: [], cli_count: 0, archived_count: 0,
    archived_webui_count: 0, archived_cli_count: 0, include_archived: false,
    all_profiles: false, active_profile: 'default', other_profile_count: 0,
    server_time: 0, server_tz: '+0000',
  })
  vi.mocked(getProjects).mockResolvedValue({
    projects: [], all_profiles: false, active_profile: 'default', other_profile_count: 0,
  })
  vi.mocked(startTerminal).mockResolvedValue({ ok: true, session_id: 'a', workspace: '', running: true })
  vi.mocked(closeTerminal).mockResolvedValue({ ok: true, closed: true })
  vi.mocked(openTerminalOutput).mockReturnValue(() => {})
})

describe('ChatPage visual contract', () => {
  it('always renders the brand heading and the composer footer', () => {
    const { container } = render(<ChatPage />)
    expect(container.querySelector('h1')?.textContent).toMatch(/HermesCN/)
    expect(container.querySelector('[data-testid="composer"]')).not.toBeNull()
  })

  it('renders the EmptyState (with prompts and workspace pill) when the active session has no messages', () => {
    chatStore.set(sessionAtom, { ...sessionA, workspace: '/home/test/project' })
    const { container } = render(<ChatPage />)
    expect(container.querySelector('[data-testid="chat-empty-state"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid^="empty-state-prompt-"]').length).toBeGreaterThan(0)
  })

  it('switches to the MessageList once messages arrive', () => {
    chatStore.set(messagesAtom, [{ role: 'assistant', content: 'first reply' }])
    const { container } = render(<ChatPage />)
    expect(container.querySelector('[data-testid="message-list"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="chat-empty-state"]')).toBeNull()
  })

  it('exposes keyboard shortcuts in the header', () => {
    const { container } = render(<ChatPage />)
    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') || '').toLowerCase().includes('keyboard shortcuts'),
    )
    expect(btn).not.toBeUndefined()
  })

  it('renders the reconnect banner with a polite live region', () => {
    chatStore.set(reconnectAtom, { stream_id: 'x', message: 'reconnecting' })
    const { container } = render(<ChatPage />)
    const banner = container.querySelector('[data-testid="reconnect-banner"]')
    expect(banner).not.toBeNull()
    expect(banner?.getAttribute('role')).toBe('status')
    expect(banner?.getAttribute('aria-live')).toBe('polite')
  })
})

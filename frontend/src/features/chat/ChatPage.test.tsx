import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import {
  chatStore,
  compressingAtom,
  messagesAtom,
  pendingApprovalAtom,
  pendingClarifyAtom,
  reconnectAtom,
  sessionAtom,
  type Session,
} from './chatStore'
import { ChatPage } from './ChatPage'
import { openChatStream } from '@/api/sse'
import { getModels } from '@/api/models'

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

const sessionA: Session = { session_id: 'a', title: 'Session A', model: 'test-model', messages: [] }

beforeEach(() => {
  vi.clearAllMocks()
  chatStore.set(sessionAtom, sessionA)
  chatStore.set(messagesAtom, [])
  chatStore.set(pendingApprovalAtom, null)
  chatStore.set(pendingClarifyAtom, null)
  chatStore.set(reconnectAtom, null)
  chatStore.set(compressingAtom, null)
  vi.mocked(openChatStream).mockReturnValue(vi.fn())
  vi.mocked(getModels).mockResolvedValue({
    active_provider: 'openrouter',
    default_model: 'default-model',
    groups: [],
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
})

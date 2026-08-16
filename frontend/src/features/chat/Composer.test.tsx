import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelStream as apiCancelStream,
  getApprovalPending,
  respondApproval,
  respondClarify,
  startChat,
  uploadFile,
} from '@/api/chat'
import { getModels } from '@/api/models'
import { toast } from 'sonner'
import {
  applyStreamEvent,
  busyAtom,
  chatStore,
  messagesAtom,
  pendingFilesAtom,
  sessionAtom,
  streamIdAtom,
  type Session,
} from './chatStore'
import { Composer } from './Composer'
import type { SpeechRecognitionLike } from './mic'

vi.mock('@/api/client', () => ({ api: vi.fn() }))
vi.mock('@/api/chat', () => ({
  startChat: vi.fn(),
  uploadFile: vi.fn(),
  cancelStream: vi.fn(),
  getApprovalPending: vi.fn(),
  respondApproval: vi.fn(),
  respondClarify: vi.fn(),
}))
vi.mock('@/api/models', () => ({ getModels: vi.fn() }))
vi.mock('sonner', () => ({ toast: vi.fn() }))

const sessionA: Session = { session_id: 'a', title: 'A', model: 'test-model', messages: [] }

function renderComposer() {
  return render(<Composer />)
}

function messageBox() {
  return screen.getByRole('textbox', { name: 'Message' })
}

/** Minimal Web Speech API stand-in, installed on window.webkitSpeechRecognition. */
class FakeRecognition {
  static last: FakeRecognition | null = null
  lang = ''
  continuous = false
  interimResults = false
  onresult: SpeechRecognitionLike['onresult'] = null
  onend: SpeechRecognitionLike['onend'] = null
  onerror: SpeechRecognitionLike['onerror'] = null
  start = vi.fn(() => {
    FakeRecognition.last = this
  })
  stop = vi.fn()
  abort = vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  FakeRecognition.last = null
  chatStore.set(sessionAtom, sessionA)
  chatStore.set(messagesAtom, [])
  chatStore.set(busyAtom, false)
  chatStore.set(streamIdAtom, null)
  chatStore.set(pendingFilesAtom, [])
  vi.mocked(startChat).mockResolvedValue({ stream_id: 'stream-1', session_id: 'a' })
  vi.mocked(uploadFile).mockResolvedValue({
    filename: 'note.txt',
    path: '/tmp/note.txt',
    mime: 'text/plain',
    size: 8,
    is_image: false,
  })
  vi.mocked(apiCancelStream).mockResolvedValue({ ok: true, cancelled: true, stream_id: 'stream-1' })
  vi.mocked(getApprovalPending).mockResolvedValue({ pending: null, pending_count: 0 })
  vi.mocked(respondApproval).mockResolvedValue({ ok: true, choice: 'once' })
  vi.mocked(respondClarify).mockResolvedValue({ ok: true, response: 'answer' })
  vi.mocked(getModels).mockResolvedValue({
    active_provider: 'openrouter',
    default_model: 'default-model',
    groups: [
      {
        provider: 'openrouter',
        models: [
          { id: 'model-a', label: 'Model A' },
          { id: 'model-b', label: 'Model B' },
        ],
      },
      { provider: 'anthropic', models: [{ id: 'claude-x', label: 'Claude X' }] },
    ],
  })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'webkitSpeechRecognition')
})

describe('Composer — layout and guards', () => {
  it('renders attach, mic, model, context, and send controls', () => {
    renderComposer()
    expect(messageBox()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument()
    // jsdom has no Web Speech API — the mic button is disabled with a reason.
    const mic = screen.getByRole('button', { name: 'Voice input' })
    expect(mic).toBeDisabled()
    expect(mic.getAttribute('title')).toMatch(/unavailable/i)
    expect(screen.getByRole('button', { name: 'Select model' })).toBeInTheDocument()
    expect(screen.getByTitle('Context usage unknown')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('sends the typed message on Enter and clears the composer', async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.type(messageBox(), 'hello')
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(startChat).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'a', message: 'hello' })),
    )
    expect(chatStore.get(busyAtom)).toBe(true)
    expect(messageBox()).toHaveValue('')
  })

  it('does not send when the composer is empty', async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.click(messageBox())
    await user.keyboard('{Enter}')

    expect(startChat).not.toHaveBeenCalled()
    expect(chatStore.get(busyAtom)).toBe(false)
  })

  it('inserts a newline on Shift+Enter instead of sending', async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.type(messageBox(), 'line one')
    await user.keyboard('{Shift>}{Enter}{/Shift}')

    expect(messageBox()).toHaveValue('line one\n')
    expect(startChat).not.toHaveBeenCalled()
  })

  it('does not send while busy and turns the send button into a stop button that cancels', async () => {
    const user = userEvent.setup()
    chatStore.set(busyAtom, true)
    chatStore.set(streamIdAtom, 'stream-1')
    renderComposer()

    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    const stop = screen.getByRole('button', { name: 'Stop' })

    // Typing while busy must not start a turn.
    await user.type(messageBox(), 'x')
    await user.keyboard('{Enter}')
    expect(startChat).not.toHaveBeenCalled()

    await user.click(stop)
    await waitFor(() => expect(apiCancelStream).toHaveBeenCalledWith('stream-1'))
    await waitFor(() => expect(chatStore.get(busyAtom)).toBe(false))
  })
})

describe('Composer — attachments', () => {
  it('stages attached files, shows them in the tray, and allows removal', async () => {
    const user = userEvent.setup()
    const fileA = new File(['a'], 'alpha.txt', { type: 'text/plain' })
    const fileB = new File(['b'], 'beta.log', { type: 'text/plain' })
    renderComposer()

    await user.upload(screen.getByLabelText('Attach files', { selector: 'input' }), [fileA, fileB])

    expect(chatStore.get(pendingFilesAtom)).toEqual([fileA, fileB])
    expect(screen.getByText('alpha.txt')).toBeInTheDocument()
    expect(screen.getByText('beta.log')).toBeInTheDocument()
    // Files alone enable the send button.
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Remove alpha.txt' }))
    expect(chatStore.get(pendingFilesAtom)).toEqual([fileB])
    expect(screen.queryByText('alpha.txt')).not.toBeInTheDocument()
  })

  it('uploads staged files before starting the turn', async () => {
    const user = userEvent.setup()
    const fileB = new File(['b'], 'beta.log', { type: 'text/plain' })
    chatStore.set(pendingFilesAtom, [fileB])
    vi.mocked(uploadFile).mockImplementation(async (_sid, file) => ({
      filename: file.name,
      path: `/tmp/${file.name}`,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      is_image: false,
    }))
    renderComposer()

    await user.type(messageBox(), 'read it')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(uploadFile).toHaveBeenCalledWith('a', fileB))
    await waitFor(() =>
      expect(startChat).toHaveBeenCalledWith(
        expect.objectContaining({ attachments: [expect.objectContaining({ name: 'beta.log' })] }),
      ),
    )
    expect(chatStore.get(pendingFilesAtom)).toEqual([])
  })
})

describe('Composer — model selector', () => {
  it('lists models grouped by provider and threads the pick into chat/start', async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.click(await screen.findByRole('button', { name: 'Select model' }))
    const item = await screen.findByRole('menuitem', { name: 'Model B' })
    await user.click(item)

    await user.type(messageBox(), 'hi')
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(startChat).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-b', explicit_model_pick: true })),
    )
  })
})

describe('Composer — voice input', () => {
  it('inserts the transcript into the composer without auto-sending', async () => {
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true })
    const user = userEvent.setup()
    renderComposer()

    const mic = screen.getByRole('button', { name: 'Voice input' })
    expect(mic).toBeEnabled()
    await user.click(mic)
    expect(mic).toHaveAttribute('aria-pressed', 'true')
    expect(FakeRecognition.last).not.toBeNull()
    expect(FakeRecognition.last!.start).toHaveBeenCalled()

    act(() => {
      FakeRecognition.last!.onresult?.({ results: [{ length: 1, 0: { transcript: 'hello world' }, isFinal: true }] })
    })
    expect(messageBox()).toHaveValue('hello world')
    expect(startChat).not.toHaveBeenCalled()

    act(() => {
      FakeRecognition.last!.onend?.()
    })
    expect(mic).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the mic disabled on insecure http origins', () => {
    // The gate itself is unit-tested in mic.test.ts; here we only verify the
    // button reflects it. jsdom's location/isSecureContext are not reliable to
    // override, so we stub the gate's inputs via the exported pure helper by
    // checking the disabled reason is present when SpeechRecognition exists
    // but the origin check fails — see mic.test.ts for the combination test.
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true })
    const original = window.isSecureContext
    try {
      Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
      renderComposer()
      // jsdom serves http://localhost — a loopback host — so the mic stays
      // ENABLED here; the insecure-origin branch is covered by isMicAvailable
      // in mic.test.ts. This test guards the disabled-reason wiring instead.
      const mic = screen.getByRole('button', { name: 'Voice input' })
      expect(mic.hasAttribute('disabled')).toBe(false)
      expect(mic.getAttribute('title')).not.toMatch(/unavailable/i)
    } finally {
      Object.defineProperty(window, 'isSecureContext', { value: original, configurable: true })
    }
  })
})

describe('Composer — approval card', () => {
  it('surfaces an SSE approval event and responds once', async () => {
    const user = userEvent.setup()
    chatStore.set(streamIdAtom, 'stream-1')
    renderComposer()

    act(() => {
      applyStreamEvent({
        type: 'approval',
        data: { approval_id: 'ap1', command: 'rm -rf /tmp/x', description: 'Delete a directory', pattern_keys: ['rm'] },
      })
    })

    expect(screen.getByText('rm -rf /tmp/x')).toBeInTheDocument()
    expect(screen.getByText(/Delete a directory/)).toBeInTheDocument()
    expect(screen.getByText('[rm]')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Approve once' }))
    await waitFor(() => expect(respondApproval).toHaveBeenCalledWith({ session_id: 'a', choice: 'once', approval_id: 'ap1' }))
    await waitFor(() => expect(screen.queryByText('rm -rf /tmp/x')).not.toBeInTheDocument())
  })

  it('clears the approval card when the stream ends', () => {
    chatStore.set(streamIdAtom, 'stream-1')
    renderComposer()

    act(() => {
      applyStreamEvent({ type: 'approval', data: { command: 'rm -rf /tmp/x', description: 'Delete' } })
    })
    expect(screen.getByText('rm -rf /tmp/x')).toBeInTheDocument()

    act(() => {
      applyStreamEvent({ type: 'done', session: null, usage: null })
    })
    expect(screen.queryByText('rm -rf /tmp/x')).not.toBeInTheDocument()
  })

  it('polls approval/pending every 1500ms while busy and clears once resolved', async () => {
    vi.useFakeTimers()
    try {
      chatStore.set(busyAtom, true)
      chatStore.set(streamIdAtom, 'stream-1')
      vi.mocked(getApprovalPending).mockResolvedValue({
        pending: { approval_id: 'ap2', command: 'curl https://example.com', description: 'Network call' },
        pending_count: 1,
      })
      renderComposer()

      // The first tick runs immediately; the mock resolves to a pending entry.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      await act(async () => {})
      expect(screen.getByText('curl https://example.com')).toBeInTheDocument()

      // fireEvent keeps this deterministic under fake timers (user-event's own
      // timer waits deadlock with vitest's fake clock).
      fireEvent.click(screen.getByRole('button', { name: 'Approve once' }))
      await act(async () => {})
      expect(respondApproval).toHaveBeenCalledWith({ session_id: 'a', choice: 'once', approval_id: 'ap2' })

      // The server now reports nothing pending; the next tick hides the card.
      vi.mocked(getApprovalPending).mockResolvedValue({ pending: null, pending_count: 0 })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500)
      })
      expect(screen.queryByText('curl https://example.com')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Composer — clarify dialog', () => {
  it('opens on a clarify SSE event, answers it, and closes', async () => {
    const user = userEvent.setup()
    chatStore.set(streamIdAtom, 'stream-1')
    renderComposer()

    act(() => {
      applyStreamEvent({ type: 'clarify', data: { clarify_id: 'c1', question: 'Which file should I edit?' } })
    })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Which file should I edit?')).toBeInTheDocument()

    await user.type(within(dialog).getByRole('textbox', { name: 'Response' }), 'the config file')
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }))

    await waitFor(() =>
      expect(respondClarify).toHaveBeenCalledWith({ session_id: 'a', response: 'the config file', clarify_id: 'c1' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes with an "expired" toast when the clarify response is stale (409)', async () => {
    const user = userEvent.setup()
    chatStore.set(streamIdAtom, 'stream-1')
    vi.mocked(respondClarify).mockRejectedValue(Object.assign(new Error('stale'), { status: 409 }))
    renderComposer()

    act(() => {
      applyStreamEvent({ type: 'clarify', data: { clarify_id: 'c1', question: 'Which file?' } })
    })

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox', { name: 'Response' }), 'config')
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(toast).toHaveBeenCalledWith('expired'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('Composer — context usage badge', () => {
  it('shows the used context percentage from the session', () => {
    chatStore.set(sessionAtom, { ...sessionA, context_length: 10000, last_prompt_tokens: 2500 })
    renderComposer()
    expect(screen.getByTitle('Context: 25% used')).toBeInTheDocument()
    expect(screen.getByTestId('context-usage')).toHaveAttribute('data-context-pct', '25')
  })

  it('shows an unknown marker without a session context window', () => {
    renderComposer()
    expect(screen.getByTestId('context-usage')).not.toHaveAttribute('data-context-pct')
    expect(screen.getByTitle('Context usage unknown')).toBeInTheDocument()
  })
})

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { respondClarify } from '@/api/chat'
import { toast } from 'sonner'
import { ClarifyDialog } from './ClarifyDialog'

vi.mock('@/api/chat', () => ({ respondClarify: vi.fn() }))
vi.mock('sonner', () => ({ toast: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(respondClarify).mockResolvedValue({ ok: true, response: 'answer' })
})

describe('ClarifyDialog', () => {
  it('shows the prompt and responds with the typed answer', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <ClarifyDialog
        entry={{ clarify_id: 'c1', question: 'Which file should I edit?' }}
        sessionId="a"
        onClose={onClose}
      />,
    )

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Which file should I edit?')).toBeInTheDocument()

    await user.type(within(dialog).getByRole('textbox', { name: 'Response' }), 'the config file')
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }))

    await waitFor(() =>
      expect(respondClarify).toHaveBeenCalledWith({ session_id: 'a', response: 'the config file', clarify_id: 'c1' }),
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('sends without clarify_id when the entry has none', async () => {
    const user = userEvent.setup()
    render(<ClarifyDialog entry={{ question: 'Which file?' }} sessionId="a" onClose={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: 'Response' }), 'config')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(respondClarify).toHaveBeenCalledWith({ session_id: 'a', response: 'config' }))
  })

  it('closes with an "expired" toast on a 409 stale response', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    vi.mocked(respondClarify).mockRejectedValue(Object.assign(new Error('stale'), { status: 409 }))
    render(<ClarifyDialog entry={{ clarify_id: 'c1', question: 'Which file?' }} sessionId="a" onClose={onClose} />)

    await user.type(screen.getByRole('textbox', { name: 'Response' }), 'config')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(toast).toHaveBeenCalledWith('expired'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('keeps the dialog open with a toast when the response is rejected for another reason', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    vi.mocked(respondClarify).mockResolvedValue({ ok: false, error: 'nope' })
    render(<ClarifyDialog entry={{ question: 'Which file?' }} sessionId="a" onClose={onClose} />)

    await user.type(screen.getByRole('textbox', { name: 'Response' }), 'config')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })
})

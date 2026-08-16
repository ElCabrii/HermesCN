import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { respondApproval } from '@/api/chat'
import { toast } from 'sonner'
import { ApprovalCard } from './ApprovalCard'

vi.mock('@/api/chat', () => ({ respondApproval: vi.fn() }))
vi.mock('sonner', () => ({ toast: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(respondApproval).mockResolvedValue({ ok: true, choice: 'once' })
})

describe('ApprovalCard', () => {
  it('renders the command, description, and pattern keys', () => {
    render(
      <ApprovalCard
        entry={{
          approval_id: 'ap1',
          command: 'rm -rf /tmp/x',
          description: 'Delete a directory',
          pattern_keys: ['rm', 'rmdir'],
        }}
        sessionId="a"
        onResolved={vi.fn()}
      />,
    )
    expect(screen.getByText('rm -rf /tmp/x')).toBeInTheDocument()
    expect(screen.getByText(/Delete a directory/)).toBeInTheDocument()
    expect(screen.getByText('[rm, rmdir]')).toBeInTheDocument()
  })

  it('maps the four buttons to once|session|always|deny choices with the approval_id', async () => {
    const user = userEvent.setup()
    render(
      <ApprovalCard
        entry={{ approval_id: 'ap1', command: 'git push --force', description: 'Push' }}
        sessionId="a"
        onResolved={vi.fn()}
      />,
    )
    for (const name of ['Approve once', 'Approve session', 'Always', 'Deny']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }

    await user.click(screen.getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(respondApproval).toHaveBeenCalledWith({ session_id: 'a', choice: 'deny', approval_id: 'ap1' }))
  })

  it('sends without approval_id when the entry has none', async () => {
    const user = userEvent.setup()
    render(<ApprovalCard entry={{ command: 'ls' }} sessionId="a" onResolved={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Approve once' }))
    await waitFor(() => expect(respondApproval).toHaveBeenCalledWith({ session_id: 'a', choice: 'once' }))
  })

  it('calls onResolved when the response is accepted', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    render(<ApprovalCard entry={{ approval_id: 'ap1', command: 'ls' }} sessionId="a" onResolved={onResolved} />)

    await user.click(screen.getByRole('button', { name: 'Approve once' }))
    await waitFor(() => expect(onResolved).toHaveBeenCalled())
  })

  it('shows a toast and keeps the card on a failed response', async () => {
    const user = userEvent.setup()
    vi.mocked(respondApproval).mockRejectedValue(new Error('network down'))
    const onResolved = vi.fn()
    render(<ApprovalCard entry={{ command: 'ls' }} sessionId="a" onResolved={onResolved} />)

    await user.click(screen.getByRole('button', { name: 'Approve once' }))
    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(onResolved).not.toHaveBeenCalled()
  })
})

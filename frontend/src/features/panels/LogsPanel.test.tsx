import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLogs } from '@/api/logs'
import { LogsPanel } from './LogsPanel'

vi.mock('@/api/logs', () => ({
  getLogs: vi.fn(),
  LOG_FILE_KEYS: ['agent', 'errors', 'gateway'],
  LOG_TAIL_VALUES: [100, 200, 500, 1000],
}))

const getLogsMock = vi.mocked(getLogs)

const BASE = {
  file: 'agent',
  tail: 200,
  lines: ['line one', 'line two'],
  truncated: false,
  total_bytes: 100,
  mtime: 1700000000,
  hint: '',
}

beforeEach(() => {
  vi.clearAllMocks()
  getLogsMock.mockResolvedValue({ ...BASE })
})

describe('LogsPanel', () => {
  it('renders log lines from a mocked getLogs', async () => {
    render(<LogsPanel />)
    expect(await screen.findByText(/line one/)).toBeInTheDocument()
    expect(screen.getByText(/line two/)).toBeInTheDocument()
    expect(getLogsMock).toHaveBeenCalledWith('agent', 200)
  })

  it('re-fetches with the new file key when the selector changes', async () => {
    const user = userEvent.setup()
    getLogsMock.mockResolvedValueOnce({ ...BASE })
    getLogsMock.mockResolvedValue({ ...BASE, file: 'errors', lines: ['err line'] })
    render(<LogsPanel />)
    await screen.findByText(/line one/)
    await user.selectOptions(screen.getByLabelText('Log file'), 'errors')
    await waitFor(() => expect(getLogsMock).toHaveBeenCalledWith('errors', 200))
    expect(await screen.findByText(/err line/)).toBeInTheDocument()
  })

  it('shows a truncated badge when truncated is true', async () => {
    getLogsMock.mockResolvedValue({ ...BASE, truncated: true })
    render(<LogsPanel />)
    expect(await screen.findByText('Truncated')).toBeInTheDocument()
  })

  it('shows an error state on fetch failure', async () => {
    getLogsMock.mockRejectedValue(new Error('boom'))
    render(<LogsPanel />)
    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})

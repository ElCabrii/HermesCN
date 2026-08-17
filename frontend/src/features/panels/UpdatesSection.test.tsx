import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUpdate, checkUpdates, clearUpdateLock } from '@/api/updates'
import { UpdatesSection } from './UpdatesSection'

vi.mock('@/api/updates', () => ({
  checkUpdates: vi.fn(),
  applyUpdate: vi.fn(),
  clearUpdateLock: vi.fn(),
  getUpdatesSummary: vi.fn(),
  forceUpdateCheck: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const checkUpdatesMock = vi.mocked(checkUpdates)
const applyUpdateMock = vi.mocked(applyUpdate)
const clearUpdateLockMock = vi.mocked(clearUpdateLock)

const UP_TO_DATE = {
  webui: {
    name: 'webui',
    behind: 0,
    current_sha: 'abc1234',
    latest_sha: 'abc1234',
    branch: 'master',
    repo_url: 'https://github.com/nesquena/hermes-webui',
    current_version: 'v0.52.0',
    latest_version: 'v0.52.0',
  },
  agent: { name: 'agent', behind: 0, current_sha: 'aaa0001', latest_sha: 'aaa0001' },
  checked_at: 0,
  include_agent: true,
  channel: 'stable',
  cached: true,
}

const UPDATE_AVAILABLE = {
  ...UP_TO_DATE,
  webui: {
    ...UP_TO_DATE.webui,
    behind: 3,
    latest_sha: 'def5678',
    latest_version: 'v0.52.3',
  },
}

const baseSettings = { update_channel: 'stable' }

beforeEach(() => {
  vi.clearAllMocks()
  checkUpdatesMock.mockResolvedValue(UP_TO_DATE)
})

describe('UpdatesSection', () => {
  it('renders the current version from the update check', async () => {
    render(<UpdatesSection settings={baseSettings} onChange={vi.fn()} />)
    expect(await screen.findByText('v0.52.0')).toBeInTheDocument()
    expect(screen.getByText('You are up to date.')).toBeInTheDocument()
  })

  it('shows an update-available indicator and an Apply button when behind', async () => {
    checkUpdatesMock.mockResolvedValue(UPDATE_AVAILABLE)
    render(<UpdatesSection settings={baseSettings} onChange={vi.fn()} />)
    expect(await screen.findByText('Update available')).toBeInTheDocument()
    expect(screen.getByText('v0.52.3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply update' })).toBeInTheDocument()
  })

  it('Check now calls checkUpdates(true) and reloads the status', async () => {
    const user = userEvent.setup()
    checkUpdatesMock.mockResolvedValueOnce(UP_TO_DATE).mockResolvedValueOnce(UPDATE_AVAILABLE)
    render(<UpdatesSection settings={baseSettings} onChange={vi.fn()} />)
    await screen.findByText('v0.52.0')

    await user.click(screen.getByRole('button', { name: 'Check now' }))

    await waitFor(() => expect(checkUpdatesMock).toHaveBeenCalledWith(true))
    expect(await screen.findByText('Update available')).toBeInTheDocument()
  })

  it('channel selector change calls onChange with the new update_channel', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<UpdatesSection settings={baseSettings} onChange={onChange} />)
    await screen.findByText('v0.52.0')

    await user.selectOptions(screen.getByLabelText('Update channel'), 'experimental')

    expect(onChange).toHaveBeenCalledWith({ update_channel: 'experimental' })
  })

  it('Apply update calls applyUpdate with the webui target and current channel', async () => {
    const user = userEvent.setup()
    applyUpdateMock.mockResolvedValue({ ok: true, message: 'Updated', restart_scheduled: true })
    checkUpdatesMock.mockResolvedValue(UPDATE_AVAILABLE)
    render(<UpdatesSection settings={baseSettings} onChange={vi.fn()} />)
    await screen.findByText('Update available')

    await user.click(screen.getByRole('button', { name: 'Apply update' }))

    await waitFor(() => expect(applyUpdateMock).toHaveBeenCalledWith('webui', 'stable'))
  })

  it('shows a Clear lock action after an apply reports a lock conflict', async () => {
    const user = userEvent.setup()
    applyUpdateMock.mockResolvedValue({
      ok: false,
      message: 'Fetch failed due to a repository lock',
      lock_conflict: true,
    })
    checkUpdatesMock.mockResolvedValue(UPDATE_AVAILABLE)
    render(<UpdatesSection settings={baseSettings} onChange={vi.fn()} />)
    await screen.findByText('Update available')

    await user.click(screen.getByRole('button', { name: 'Apply update' }))
    expect(await screen.findByText('Update lock detected')).toBeInTheDocument()

    clearUpdateLockMock.mockResolvedValue({ ok: true, message: 'Lock cleared.' })
    await user.click(screen.getByRole('button', { name: 'Clear lock' }))
    await waitFor(() => expect(clearUpdateLockMock).toHaveBeenCalledWith('webui'))
  })
})

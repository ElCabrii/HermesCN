import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getProfiles, switchProfile, type ProfilesResponse } from '@/api/panels'
import { ProfilesPanel } from './ProfilesPanel'

vi.mock('@/api/panels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/panels')>()
  return {
    ...actual,
    getProfiles: vi.fn(),
    switchProfile: vi.fn(),
  }
})
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const getProfilesMock = vi.mocked(getProfiles)
const switchProfileMock = vi.mocked(switchProfile)

const RESPONSE: ProfilesResponse = {
  active: 'default',
  single_profile_mode: false,
  profiles: [
    {
      name: 'default',
      path: '/home/u/.hermes',
      is_default: true,
      is_active: true,
      gateway_running: true,
      model: 'gpt-4o',
      provider: 'openai',
      has_env: true,
      visible: true,
      skill_count: 5,
      enabled_skills: 3,
      total_skills: 7,
    },
    {
      name: 'work',
      path: '/home/u/.hermes-work',
      is_default: false,
      is_active: false,
      gateway_running: false,
      model: 'claude-3-5',
      provider: 'anthropic',
      has_env: true,
      visible: true,
      skill_count: 2,
      enabled_skills: 1,
      total_skills: 4,
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  getProfilesMock.mockResolvedValue(RESPONSE)
  switchProfileMock.mockResolvedValue({
    ...RESPONSE,
    active: 'work',
    profiles: RESPONSE.profiles.map((p) => ({ ...p, is_active: p.name === 'work' })),
  })
})

describe('ProfilesPanel', () => {
  it('renders the profile list with the active profile marked', async () => {
    render(<ProfilesPanel />)

    expect(await screen.findByText('default')).toBeInTheDocument()
    expect(screen.getByText('work')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    // model / skill metadata is shown quietly
    expect(screen.getByText(/gpt-4o/)).toBeInTheDocument()
    expect(screen.getByText('3/7 skills')).toBeInTheDocument()
  })

  it('switches profile through the client and updates the active marker', async () => {
    const user = userEvent.setup()
    render(<ProfilesPanel />)

    await screen.findByText('work')
    await user.click(screen.getByRole('button', { name: 'Switch to work' }))

    await waitFor(() => expect(switchProfileMock).toHaveBeenCalledWith('work'))
    // after the switch the response drives the UI
    await waitFor(() => expect(screen.getByText('work').closest('li')).toHaveTextContent('Active'))
  })

  it('hides the switcher in single-profile mode', async () => {
    getProfilesMock.mockResolvedValue({
      ...RESPONSE,
      single_profile_mode: true,
      profiles: RESPONSE.profiles.slice(0, 1),
    })
    render(<ProfilesPanel />)

    expect(await screen.findByText(/single-profile mode/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /switch to/i })).not.toBeInTheDocument()
  })
})

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCrons, getProfiles, getProviderQuota, getProviders, getSettings, readMemory, getSkills } from '@/api/panels'
import { getModels } from '@/api/models'
import { getWorkspaces } from '@/api/workspace'
import { ControlCenter } from './ControlCenter'

vi.mock('@/api/panels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/panels')>()
  return {
    ...actual,
    getCrons: vi.fn(),
    getCronOutput: vi.fn(),
    getSkills: vi.fn(),
    getSkillContent: vi.fn(),
    readMemory: vi.fn(),
    getProfiles: vi.fn(),
    getSettings: vi.fn(),
    getProviders: vi.fn(),
    getProviderQuota: vi.fn(),
  }
})
vi.mock('@/api/models', () => ({ getModels: vi.fn() }))
vi.mock('@/api/workspace', () => ({ getWorkspaces: vi.fn() }))
vi.mock('@/features/chat/Markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const getCronsMock = vi.mocked(getCrons)
const getSkillsMock = vi.mocked(getSkills)
const readMemoryMock = vi.mocked(readMemory)
const getProfilesMock = vi.mocked(getProfiles)
const getSettingsMock = vi.mocked(getSettings)
const getProvidersMock = vi.mocked(getProviders)
const getProviderQuotaMock = vi.mocked(getProviderQuota)
const getModelsMock = vi.mocked(getModels)
const getWorkspacesMock = vi.mocked(getWorkspaces)

beforeEach(() => {
  vi.clearAllMocks()
  getCronsMock.mockResolvedValue({ jobs: [] })
  getSkillsMock.mockResolvedValue({ skills: [] })
  readMemoryMock.mockResolvedValue({
    memory: '# Memory',
    user: '# User',
    soul: '# Soul',
    project_context: '',
    memory_path: '/m/MEMORY.md',
    user_path: '/m/USER.md',
    soul_path: '/m/SOUL.md',
    project_context_path: '',
    project_context_name: '',
    project_context_workspace: '',
    memory_mtime: null,
    user_mtime: null,
    soul_mtime: null,
    project_context_mtime: null,
    project_context_shadowed: false,
    external_notes_enabled: false,
  })
  getProfilesMock.mockResolvedValue({
    active: 'default',
    single_profile_mode: false,
    profiles: [
      {
        name: 'default',
        path: '/p',
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
    ],
  })
  getSettingsMock.mockResolvedValue({ default_model: 'gpt-4o', send_key: 'enter', language: 'en' })
  getModelsMock.mockResolvedValue({ active_provider: 'openai', default_model: 'gpt-4o', groups: [] })
  getWorkspacesMock.mockResolvedValue({ workspaces: [], last: '', terminal_remote_backend: false })
  getProvidersMock.mockResolvedValue({ providers: [], active_provider: null })
  getProviderQuotaMock.mockResolvedValue({
    ok: false,
    provider: null,
    supported: false,
    status: 'unavailable',
    quota: null,
    message: 'No active provider is configured.',
  })
})

describe('ControlCenter', () => {
  it('launches the tabbed modal from its trigger button', async () => {
    const user = userEvent.setup()
    render(<ControlCenter />)

    // trigger button in the sidebar footer style
    const trigger = screen.getByRole('button', { name: /control center/i })
    expect(trigger).toBeInTheDocument()

    await user.click(trigger)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Control Center' })).toBeInTheDocument()
    // the default tab (Tasks) mounts and loads crons
    await waitFor(() => expect(getCronsMock).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument()
  })

  it('switches between all six tabs', async () => {
    const user = userEvent.setup()
    render(<ControlCenter />)

    await user.click(screen.getByRole('button', { name: /control center/i }))
    await screen.findByRole('dialog')

    const tabs = ['Tasks', 'Skills', 'Memory', 'Profiles', 'Providers', 'Todo', 'Settings']
    for (const tab of tabs) {
      await user.click(screen.getByRole('tab', { name: tab }))
    }

    // every panel mounted and loaded its data
    await waitFor(() => expect(getCronsMock).toHaveBeenCalled())
    await waitFor(() => expect(getSkillsMock).toHaveBeenCalled())
    await waitFor(() => expect(readMemoryMock).toHaveBeenCalled())
    await waitFor(() => expect(getProfilesMock).toHaveBeenCalled())
    await waitFor(() => expect(getProvidersMock).toHaveBeenCalled())
    await waitFor(() => expect(getProviderQuotaMock).toHaveBeenCalled())
    await waitFor(() => expect(getSettingsMock).toHaveBeenCalled())
    await waitFor(() => expect(getModelsMock).toHaveBeenCalled())
    await waitFor(() => expect(getWorkspacesMock).toHaveBeenCalled())

    // the settings tab content is visible at the end
    expect(screen.getByLabelText('Default model')).toBeInTheDocument()
    // todo tab shows its derived-from-transcript empty state
    await user.click(screen.getByRole('tab', { name: 'Todo' }))
    expect(screen.getByText(/no todos/i)).toBeInTheDocument()
  })

  it('closes the modal via the close button', async () => {
    const user = userEvent.setup()
    render(<ControlCenter />)

    await user.click(screen.getByRole('button', { name: /control center/i }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

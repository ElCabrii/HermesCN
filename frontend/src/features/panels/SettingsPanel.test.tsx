import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getModels } from '@/api/models'
import { getSettings, updateSettings, type Settings } from '@/api/panels'
import { getWorkspaces } from '@/api/workspace'
import { SettingsPanel } from './SettingsPanel'

vi.mock('@/api/panels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/panels')>()
  return {
    ...actual,
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  }
})
vi.mock('@/api/models', () => ({ getModels: vi.fn() }))
vi.mock('@/api/workspace', () => ({ getWorkspaces: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const getSettingsMock = vi.mocked(getSettings)
const updateSettingsMock = vi.mocked(updateSettings)
const getModelsMock = vi.mocked(getModels)
const getWorkspacesMock = vi.mocked(getWorkspaces)

const SETTINGS: Settings = {
  default_model: 'gpt-4o',
  default_workspace: '/home/u/proj',
  send_key: 'enter',
  language: 'en',
}

beforeEach(() => {
  vi.clearAllMocks()
  getSettingsMock.mockResolvedValue(SETTINGS)
  getModelsMock.mockResolvedValue({
    active_provider: 'openai',
    default_model: 'gpt-4o',
    groups: [
      {
        provider: 'openai',
        models: [
          { id: 'gpt-4o', label: 'GPT-4o' },
          { id: 'claude-3-5', label: 'Claude 3.5' },
        ],
      },
    ],
  })
  getWorkspacesMock.mockResolvedValue({
    workspaces: [
      { path: '/home/u/proj', name: 'proj' },
      { path: '/tmp/other', name: 'other' },
    ],
    last: '/home/u/proj',
    terminal_remote_backend: false,
  })
  updateSettingsMock.mockResolvedValue({ ...SETTINGS })
})

describe('SettingsPanel', () => {
  it('renders the settings form with current values', async () => {
    render(<SettingsPanel />)

    const model = await screen.findByLabelText('Default model')
    expect(model).toHaveValue('gpt-4o')
    expect(screen.getByLabelText('Default workspace')).toHaveValue('/home/u/proj')
    expect(screen.getByLabelText('Send key')).toHaveValue('enter')
    expect(screen.getByLabelText('Language')).toHaveValue('en')
  })

  it('pops model options from the catalog and workspace options from the workspace list', async () => {
    render(<SettingsPanel />)

    const model = await screen.findByLabelText('Default model')
    expect(withinOptions(model)).toEqual(expect.arrayContaining(['gpt-4o', 'claude-3-5']))
    const workspace = screen.getByLabelText('Default workspace')
    expect(withinOptions(workspace)).toEqual(expect.arrayContaining(['/home/u/proj', '/tmp/other']))
    // send key options match the legacy settings tab (static/index.html)
    const sendKey = screen.getByLabelText('Send key')
    expect(withinOptions(sendKey)).toEqual(['enter', 'ctrl+enter', 'shift+enter'])
  })

  it('saves a partial update with the four safe keys', async () => {
    const user = userEvent.setup()
    render(<SettingsPanel />)

    await screen.findByLabelText('Default model')
    await user.selectOptions(screen.getByLabelText('Default model'), 'claude-3-5')
    await user.selectOptions(screen.getByLabelText('Send key'), 'ctrl+enter')
    await user.selectOptions(screen.getByLabelText('Language'), 'de')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith({
        default_model: 'claude-3-5',
        default_workspace: '/home/u/proj',
        send_key: 'ctrl+enter',
        language: 'de',
      }),
    )
  })

  it('reports an error when settings cannot be loaded', async () => {
    getSettingsMock.mockRejectedValue(new Error('boom'))
    render(<SettingsPanel />)

    expect(await screen.findByText(/failed to load settings/i)).toBeInTheDocument()
  })
})

function withinOptions(select: HTMLElement): string[] {
  return Array.from((select as HTMLSelectElement).options).map((o) => o.value)
}

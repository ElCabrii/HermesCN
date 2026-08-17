import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getExtensionRegistry,
  getExtensionStatus,
  installExtension,
  toggleExtension,
  uninstallExtension,
} from '@/api/extensions'
import { ExtensionsPanel } from './ExtensionsPanel'

vi.mock('@/api/extensions', () => ({
  getExtensionStatus: vi.fn(),
  getExtensionRegistry: vi.fn(),
  toggleExtension: vi.fn(),
  installExtension: vi.fn(),
  uninstallExtension: vi.fn(),
}))

const getStatusMock = vi.mocked(getExtensionStatus)
const getRegistryMock = vi.mocked(getExtensionRegistry)
const toggleMock = vi.mocked(toggleExtension)
const installMock = vi.mocked(installExtension)
const uninstallMock = vi.mocked(uninstallExtension)

const STATUS = {
  enabled: true,
  extension_dir_configured: true,
  extension_dir_valid: true,
  script_urls: [],
  stylesheet_urls: [],
  sidecars: [],
  counts: { script_urls: 0, stylesheet_urls: 0, sidecars: 0, manifest_extensions: 1, user_disabled: 0 },
  manifest: {},
  extensions: [
    {
      id: 'alpha',
      name: 'Alpha',
      manifest_enabled: true,
      user_enabled: true,
      user_disabled: false,
      effective_enabled: true,
      can_toggle: true,
      reload_required: true,
      storage_owned: false,
      settings_schema: null,
      status: 'enabled',
    },
  ],
  gallery_installed: { alpha: { version: '1.0.0', files: ['manifest.json'], installed_at: '2024-01-01T00:00:00Z' } },
  warnings: [],
}

const REGISTRY = [
  {
    id: 'beta',
    name: 'Beta',
    author: 'acme',
    version: '2.0.0',
    description: 'A beta extension',
    capabilities: ['chat'],
    download_url: 'https://hermes-webui.github.io/beta.zip',
    sha256: 'a'.repeat(64),
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  getStatusMock.mockResolvedValue({ ...STATUS })
  getRegistryMock.mockResolvedValue({ entries: [...REGISTRY] })
})

describe('ExtensionsPanel', () => {
  it('renders installed extensions and gallery entries', async () => {
    render(<ExtensionsPanel />)
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(await screen.findByText('Beta')).toBeInTheDocument()
    expect(getStatusMock).toHaveBeenCalled()
    expect(getRegistryMock).toHaveBeenCalled()
  })

  it('toggles an extension with the right id and next enabled state, then reloads', async () => {
    const user = userEvent.setup()
    toggleMock.mockResolvedValue({ ...STATUS })
    render(<ExtensionsPanel />)
    await screen.findByText('Alpha')
    await user.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() => expect(toggleMock).toHaveBeenCalledWith('alpha', false))
    // reloads status + registry after the mutation
    await waitFor(() => expect(getStatusMock.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('installs a gallery extension then reloads', async () => {
    const user = userEvent.setup()
    installMock.mockResolvedValue({ installed: true, id: 'beta', version: '2.0.0' })
    render(<ExtensionsPanel />)
    await screen.findByText('Beta')
    await user.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() =>
      expect(installMock).toHaveBeenCalledWith(
        'beta',
        'https://hermes-webui.github.io/beta.zip',
        'a'.repeat(64),
      ),
    )
    await waitFor(() => expect(getStatusMock.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('uninstalls an installed extension', async () => {
    const user = userEvent.setup()
    uninstallMock.mockResolvedValue({ uninstalled: true, id: 'alpha' })
    render(<ExtensionsPanel />)
    await screen.findByText('Alpha')
    await user.click(screen.getByRole('button', { name: 'Uninstall Alpha' }))
    await waitFor(() => expect(uninstallMock).toHaveBeenCalledWith('alpha'))
  })

  it('shows an error state on fetch failure', async () => {
    getStatusMock.mockRejectedValue(new Error('boom'))
    render(<ExtensionsPanel />)
    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})

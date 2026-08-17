import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteProviderKey,
  getProviderCostHistory,
  getProviderQuota,
  getProviders,
  setProviderKey,
} from '@/api/panels'
import { probeProviderEndpoint } from '@/api/onboarding'
import { ProvidersPanel } from './ProvidersPanel'

vi.mock('@/api/panels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/panels')>()
  return {
    ...actual,
    getProviders: vi.fn(),
    getProviderQuota: vi.fn(),
    getProviderCostHistory: vi.fn(),
    setProviderKey: vi.fn(),
    deleteProviderKey: vi.fn(),
    refreshProviderModels: vi.fn(),
    setProviderCostBudget: vi.fn(),
    setupSelfHostedProvider: vi.fn(),
  }
})
vi.mock('@/api/onboarding', () => ({
  probeProviderEndpoint: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const getProvidersMock = vi.mocked(getProviders)
const getProviderQuotaMock = vi.mocked(getProviderQuota)
const getProviderCostHistoryMock = vi.mocked(getProviderCostHistory)
const setProviderKeyMock = vi.mocked(setProviderKey)
const deleteProviderKeyMock = vi.mocked(deleteProviderKey)
const probeProviderEndpointMock = vi.mocked(probeProviderEndpoint)

const OPENROUTER = {
  id: 'openrouter',
  display_name: 'OpenRouter',
  has_key: false,
  configurable: true,
  key_source: 'none',
  models: [{ id: 'openai/gpt-4o', label: 'GPT-4o' }],
  models_total: 1,
}
const COPILOT = {
  id: 'copilot',
  display_name: 'GitHub Copilot',
  has_key: true,
  is_oauth: true,
  key_source: 'oauth',
  models: [{ id: 'gpt-5.4', label: 'GPT-5.4' }],
  models_total: 1,
}
const OLLAMA = {
  id: 'ollama',
  display_name: 'Ollama',
  has_key: false,
  is_self_hosted: true,
  key_source: 'none',
  models: [],
  models_total: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  getProvidersMock.mockResolvedValue({ providers: [OPENROUTER, COPILOT, OLLAMA], active_provider: null })
  getProviderQuotaMock.mockResolvedValue({
    ok: false,
    provider: null,
    supported: false,
    status: 'unavailable',
    quota: null,
    message: 'No active provider is configured.',
  })
  getProviderCostHistoryMock.mockRejectedValue(new Error('no key'))
})

describe('ProvidersPanel', () => {
  it('lists configurable providers with their status', async () => {
    render(<ProvidersPanel />)
    expect(await screen.findByText('OpenRouter')).toBeInTheDocument()
    expect(screen.getByText('GitHub Copilot')).toBeInTheDocument()
    expect(screen.getByText('Ollama')).toBeInTheDocument()
    // OAuth provider shows the Configured badge; API-key one doesn't
    expect(screen.getByText('Configured')).toBeInTheDocument()
  })

  it('expands a card and saves an API key', async () => {
    const user = userEvent.setup()
    setProviderKeyMock.mockResolvedValue({ ok: true, provider: 'openrouter', action: 'updated' })
    render(<ProvidersPanel />)

    await screen.findByText('OpenRouter')
    await user.click(screen.getByText('OpenRouter'))
    await user.type(screen.getByPlaceholderText('Enter API key'), 'sk-test-key-1234')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setProviderKeyMock).toHaveBeenCalledWith('openrouter', 'sk-test-key-1234'))
    // list reloads after a mutation
    await waitFor(() => expect(getProvidersMock).toHaveBeenCalledTimes(2))
  })

  it('removes a configured key', async () => {
    const user = userEvent.setup()
    deleteProviderKeyMock.mockResolvedValue({ ok: true, provider: 'openrouter', action: 'removed' })
    getProvidersMock.mockResolvedValue({
      providers: [{ ...OPENROUTER, has_key: true, key_source: 'env_file' }],
      active_provider: null,
    })
    render(<ProvidersPanel />)

    await screen.findByText('OpenRouter')
    await user.click(screen.getByText('OpenRouter'))
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(deleteProviderKeyMock).toHaveBeenCalledWith('openrouter'))
  })

  it('shows a quota card for the active provider', async () => {
    getProviderQuotaMock.mockResolvedValue({
      ok: true,
      provider: 'openrouter',
      display_name: 'OpenRouter',
      supported: true,
      status: 'available',
      quota: { limit_remaining: 12.34, usage: 1.23, limit: 13.57 },
      message: 'loaded',
    })
    render(<ProvidersPanel />)

    expect(await screen.findByText('Provider quota')).toBeInTheDocument()
    expect(screen.getByText('$12.34')).toBeInTheDocument()
  })

  it('tests a self-hosted connection', async () => {
    const user = userEvent.setup()
    probeProviderEndpointMock.mockResolvedValue({
      ok: true,
      models: [{ id: 'llama3.1', label: 'llama3.1' }],
    })
    render(<ProvidersPanel />)

    await screen.findByText('Ollama')
    await user.click(screen.getByText('Ollama'))
    // default base URL prefilled for ollama
    await user.clear(screen.getByPlaceholderText('http://localhost:11434/v1'))
    await user.type(screen.getByPlaceholderText('http://localhost:11434/v1'), 'http://localhost:11434/v1')
    await user.click(screen.getByRole('button', { name: 'Test connection' }))

    await waitFor(() =>
      expect(probeProviderEndpointMock).toHaveBeenCalledWith({
        provider: 'ollama',
        base_url: 'http://localhost:11434/v1',
        api_key: undefined,
      }),
    )
    expect(await screen.findByText(/Connected\. 1 model available\./)).toBeInTheDocument()
  })
})

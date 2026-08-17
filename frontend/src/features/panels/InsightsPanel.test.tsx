import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getInsights } from '@/api/insights'
import { InsightsPanel } from './InsightsPanel'

vi.mock('@/api/insights', () => ({
  getInsights: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const getInsightsMock = vi.mocked(getInsights)

const RESPONSE = {
  period_days: 30,
  total_sessions: 12,
  total_messages: 340,
  total_input_tokens: 1000,
  total_output_tokens: 500,
  total_cache_read_tokens: 200,
  total_cache_hit_percent: 16.6,
  total_tokens: 1500,
  total_cost: 1.25,
  models: [
    {
      model: 'gpt-4o',
      sessions: 8,
      input_tokens: 800,
      output_tokens: 400,
      cache_read_tokens: 100,
      cache_hit_percent: 11,
      total_tokens: 1200,
      cost: 1.0,
      session_share: 66,
      token_share: 80,
      cost_share: 80,
    },
    {
      model: 'claude-3.5',
      sessions: 4,
      input_tokens: 200,
      output_tokens: 100,
      cache_read_tokens: 100,
      cache_hit_percent: 33,
      total_tokens: 300,
      cost: 0.25,
      session_share: 33,
      token_share: 20,
      cost_share: 20,
    },
  ],
  daily_tokens: [
    { date: '2025-01-01', input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, sessions: 2, cost: 0.1 },
    { date: '2025-01-02', input_tokens: 200, output_tokens: 100, cache_read_tokens: 0, sessions: 3, cost: 0.2 },
  ],
  activity_by_day: [{ day: 'Mon', sessions: 5 }],
  activity_by_hour: [{ hour: 9, sessions: 4 }],
}

beforeEach(() => {
  vi.clearAllMocks()
  getInsightsMock.mockResolvedValue(RESPONSE)
})

describe('InsightsPanel', () => {
  it('renders summary stats from the mocked response', async () => {
    render(<InsightsPanel />)
    expect(await screen.findByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('340')).toBeInTheDocument()
    expect(screen.getByText('1,500')).toBeInTheDocument()
    expect(screen.getByText('$1.25')).toBeInTheDocument()
    expect(screen.getByText('17%')).toBeInTheDocument()
  })

  it('calls getInsights with the new days when the period changes', async () => {
    const user = userEvent.setup()
    render(<InsightsPanel />)
    await screen.findByText('Sessions')
    expect(getInsightsMock).toHaveBeenCalledWith(30)
    await user.click(screen.getByRole('button', { name: '7d' }))
    await waitFor(() => expect(getInsightsMock).toHaveBeenCalledWith(7))
  })

  it('renders the per-model breakdown', async () => {
    render(<InsightsPanel />)
    expect(await screen.findByText('By model')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('claude-3.5')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
  })

  it('shows an error state when the request fails', async () => {
    getInsightsMock.mockRejectedValue(new Error('boom'))
    render(<InsightsPanel />)
    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})

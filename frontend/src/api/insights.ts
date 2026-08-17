import { api } from './client'
import type { JsonObject } from './types'

/**
 * Insights API client: usage analytics from local WebUI session data.
 *
 * Contract verified against `api/routes.py` `_handle_insights` (GET
 * /api/insights). The backend aggregates WebUI + CLI sessions over a
 * calendar window (`days`, 1-365, default 30) and returns summary stats,
 * a per-model breakdown, a daily token series, and activity by day/hour.
 */

/** One model row in the `models` breakdown. */
export interface InsightsModel extends JsonObject {
  model: string
  sessions: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_hit_percent: number | null
  total_tokens: number
  cost: number
  session_share: number
  token_share: number
  cost_share: number
}

/** One day in the `daily_tokens` series (calendar-aligned, zero-filled). */
export interface InsightsDailyToken extends JsonObject {
  date: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  sessions: number
  cost: number
}

/** One day-of-week activity bucket (Mon..Sun). */
export interface InsightsActivityDay extends JsonObject {
  day: string
  sessions: number
}

/** One hour-of-day activity bucket (0-23). */
export interface InsightsActivityHour extends JsonObject {
  hour: number
  sessions: number
}

/** GET /api/insights response. */
export interface InsightsResponse extends JsonObject {
  period_days: number
  total_sessions: number
  total_messages: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read_tokens: number
  total_cache_hit_percent: number | null
  total_tokens: number
  total_cost: number
  models: InsightsModel[]
  daily_tokens: InsightsDailyToken[]
  activity_by_day: InsightsActivityDay[]
  activity_by_hour: InsightsActivityHour[]
}

/** Fetch usage analytics over a calendar window (`days` 1-365, default 30). */
export function getInsights(days = 30): Promise<InsightsResponse> {
  return api<InsightsResponse>(`/api/insights?days=${days}`, { credentials: 'include' })
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

describe('api()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses JSON and returns the body on 2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    await expect(api<{ ok: boolean }>('/api/health')).resolves.toEqual({ ok: true })
  })

  it('throws ApiError with status and body on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Session not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const err = await api('/api/session?session_id=x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Session not found',
      body: { error: 'Session not found' },
    })
  })
})

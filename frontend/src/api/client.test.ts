import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './client'

describe('api()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws ApiError with server message on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 }),
      ),
    )
    await expect(api('/api/session?session_id=x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Session not found',
    })
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

  it('defaults Content-Type to application/json when the caller did not set one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await api('/api/session', { method: 'POST' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  })

  it('keeps a caller-provided Content-Type instead of overwriting it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await api('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('Content-Type')).toBe('multipart/form-data')
  })

  it('carries the parsed body on ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 }),
      ),
    )
    const err = await api('/api/session?session_id=x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ body: { error: 'Session not found' } })
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createShare, getSharedTranscript, revokeShare } from './share'
import type { ShareInfo, SharedTranscript } from './share'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fetchMockResolving(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(jsonResponse(body, status))
  vi.stubGlobal('fetch', fn)
  return fn
}

const SHARE_INFO: ShareInfo = {
  token: 'abc123',
  url: '/share/abc123',
  title: 'Debugging the proxy',
  message_count: 3,
  created_at: 1720000000,
  updated_at: 1720000100,
}

const TRANSCRIPT: SharedTranscript = {
  title: 'Debugging the proxy',
  messages: [
    { role: 'user', content: 'What changed?', timestamp: 1720000000 },
    { role: 'assistant', content: 'The proxy timeout was **raised**.', timestamp: 1720000005 },
  ],
  message_count: 2,
  created_at: 1720000000,
  updated_at: 1720000100,
}

describe('share API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('createShare posts the session id and resolves the share result', async () => {
    const fn = fetchMockResolving({
      ok: true,
      share: SHARE_INFO,
      session: { session_id: 's1', messages: [] },
    })

    const result = await createShare('s1')

    expect(result.ok).toBe(true)
    expect(result.share).toEqual(SHARE_INFO)
    const [input, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(input).toBe('/api/share/create')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 's1' })
  })

  it('createShare surfaces the server error when the session has nothing shareable', async () => {
    fetchMockResolving({ error: 'This conversation has no shareable messages yet.' }, 400)

    await expect(createShare('s1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'This conversation has no shareable messages yet.',
    })
  })

  it('revokeShare posts the session id and resolves ok', async () => {
    const fn = fetchMockResolving({ ok: true, session: { session_id: 's1', messages: [] } })

    const result = await revokeShare('s1')

    expect(result.ok).toBe(true)
    const [input, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(input).toBe('/api/share/revoke')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 's1' })
  })

  it('getSharedTranscript fetches the public snapshot for the token', async () => {
    const fn = fetchMockResolving({ share: TRANSCRIPT })

    const result = await getSharedTranscript('abc123')

    expect(result.share).toEqual(TRANSCRIPT)
    const [input, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(input).toBe('/api/share/abc123')
    expect(init.method ?? 'GET').toBe('GET')
    expect(init.credentials).toBe('include')
  })

  it('getSharedTranscript encodes the token into the path', async () => {
    const fn = fetchMockResolving({ share: TRANSCRIPT })

    await getSharedTranscript('a b/c')

    const [input] = fn.mock.calls[0] as [string]
    expect(input).toBe('/api/share/a%20b%2Fc')
  })

  it('getSharedTranscript rejects with a 404 ApiError for a revoked snapshot', async () => {
    fetchMockResolving({ error: 'Shared conversation not found' }, 404)

    await expect(getSharedTranscript('gone')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Shared conversation not found',
    })
  })
})

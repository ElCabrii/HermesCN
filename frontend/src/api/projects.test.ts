import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProjects, type ProjectsResponse } from './projects'

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

const PAYLOAD: ProjectsResponse = {
  projects: [
    { project_id: 'p1', name: 'Alpha', color: '#ff0000', profile: 'default' },
    { project_id: 'p2', name: 'Beta' },
  ],
  all_profiles: false,
  active_profile: 'default',
  other_profile_count: 0,
}

describe('getProjects()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /api/projects and parses the catalog with profile metadata', async () => {
    const fetchMock = fetchMockResolving(PAYLOAD)
    await expect(getProjects()).resolves.toEqual(PAYLOAD)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/projects')
    expect(init.credentials).toBe('include')
  })

  it('returns an empty list when no projects exist', async () => {
    fetchMockResolving({ projects: [], all_profiles: false, active_profile: 'default', other_profile_count: 0 })
    await expect(getProjects()).resolves.toMatchObject({ projects: [] })
  })
})

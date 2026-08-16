import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import {
  branchSession,
  clearSession,
  deleteSession,
  downloadSessionExport,
  duplicateSession,
  getSession,
  getSessionLineageReport,
  getSessionStatus,
  getSessionUsage,
  listSessions,
  newSession,
  renameSession,
  retryLast,
  searchSessions,
  sessionExportUrl,
  setSessionToolsets,
  truncateSession,
  undoLast,
  updateSession,
  type SessionDetail,
  type SessionLineageReport,
  type SessionListResponse,
  type SessionStatus,
  type SessionUsage,
  type SidebarSessionRow,
} from './sessions'

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

const ROW: SidebarSessionRow = {
  session_id: 'abc123',
  title: 'Build the thing',
  display_title: 'Build the thing',
  _state_db_title: null,
  workspace: '/home/gabriel/dev/HermesCN',
  model: 'deepseek-v4-flash',
  model_provider: 'deepseek',
  message_count: 12,
  user_message_count: 4,
  created_at: 1755300000,
  updated_at: 1755400000,
  last_message_at: 1755399999,
  pinned: false,
  archived: false,
  project_id: null,
  profile: 'default',
  input_tokens: 1200,
  output_tokens: 3400,
  estimated_cost: 0.42,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  cache_hit_percent: 0,
  personality: null,
  context_length: 128000,
  config_context_length: 128000,
  window_usage_percent: 12.5,
  source_tag: 'webui',
  raw_source: 'webui',
  session_source: 'webui',
  source_label: 'WebUI',
  is_cli_session: false,
  is_messaging_session: false,
  is_streaming: false,
  cron_running: false,
  active_stream_id: null,
  has_pending_user_message: false,
  pending_started_at: null,
  default_hidden: false,
  worktree_path: null,
  worktree_branch: null,
  parent_session_id: null,
  parent_title: null,
  parent_source: null,
  relationship_type: null,
  pre_compression_snapshot: false,
  read_only: false,
  is_read_only: false,
  gateway_routing: null,
  attention: null,
}

const SESSION: SessionDetail = {
  session_id: 'abc123',
  title: 'Build the thing',
  workspace: '/home/gabriel/dev/HermesCN',
  model: 'deepseek-v4-flash',
  model_provider: 'deepseek',
  message_count: 12,
  created_at: 1755300000,
  updated_at: 1755400000,
  last_message_at: 1755399999,
  pinned: false,
  archived: false,
  project_id: null,
  profile: 'default',
  input_tokens: 1200,
  output_tokens: 3400,
  estimated_cost: 0.42,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  cache_hit_percent: 0,
  personality: null,
  compression_anchor_visible_idx: null,
  compression_anchor_message_key: null,
  compression_anchor_summary: null,
  pre_compression_snapshot: false,
  context_engine: null,
  compression_anchor_engine: null,
  compression_anchor_mode: null,
  compression_anchor_details: null,
  context_engine_state: {},
  context_length: 128000,
  threshold_tokens: 0,
  last_prompt_tokens: 0,
  post_compression_context_tokens_estimate: null,
  compression_recovery: false,
  recommended_recovery_action: null,
  gateway_routing: null,
  gateway_routing_history: [],
  manual_title: false,
  created_workspace: '/home/gabriel/dev/HermesCN',
  user_message_count: 4,
  active_stream_id: null,
  pending_user_message: null,
  has_pending_user_message: false,
  is_cli_session: false,
  source_tag: 'webui',
  raw_source: 'webui',
  session_source: 'webui',
  source_label: 'WebUI',
  read_only: false,
  enabled_toolsets: [],
  composer_draft: {},
  process_wakeup_pause: {},
  share_token: null,
  share_created_at: null,
  is_streaming: false,
}

describe('listSessions()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /api/sessions with credentials and parses the sidebar payload', async () => {
    const payload: SessionListResponse = {
      sessions: [ROW],
      sidebar_reference_sessions: [{ ...ROW, session_id: 'ref1', _sidebar_reference_only: true }],
      cli_count: 3,
      archived_count: 2,
      archived_webui_count: 1,
      archived_cli_count: 1,
      include_archived: false,
      all_profiles: false,
      active_profile: 'default',
      other_profile_count: 0,
      server_time: 1755400000.5,
      server_tz: '+0000',
      webui_session_count: 5,
      cli_session_count: 3,
    }
    const fetchMock = fetchMockResolving(payload)
    await expect(listSessions()).resolves.toEqual(payload)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/sessions')
    expect(init.credentials).toBe('include')
  })

  it('serializes every supported query parameter', async () => {
    const fetchMock = fetchMockResolving({ sessions: [], sidebar_reference_sessions: [], cli_count: 0, archived_count: 0, archived_webui_count: 0, archived_cli_count: 0, include_archived: true, all_profiles: true, active_profile: 'work', other_profile_count: 1, server_time: 0, server_tz: '+0000' })
    await listSessions({
      include_archived: true,
      exclude_hidden: true,
      archived_limit: 50,
      archived_offset: 100,
      all_profiles: true,
      sidebar_source: 'cli',
    })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe(
      '/api/sessions?include_archived=true&exclude_hidden=true&archived_limit=50&archived_offset=100&all_profiles=true&sidebar_source=cli',
    )
  })

  it('omits unset params instead of sending empty values', async () => {
    const fetchMock = fetchMockResolving({ sessions: [], sidebar_reference_sessions: [], cli_count: 0, archived_count: 0, archived_webui_count: 0, archived_cli_count: 0, include_archived: false, all_profiles: false, active_profile: 'default', other_profile_count: 0, server_time: 0, server_tz: '+0000' })
    await listSessions({ include_archived: undefined, archived_limit: undefined, sidebar_source: undefined })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('/api/sessions')
  })
})

describe('getSession()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /api/session?session_id= and parses { session }', async () => {
    const fetchMock = fetchMockResolving({ session: SESSION })
    await expect(getSession('abc123')).resolves.toEqual({ session: SESSION })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/session?session_id=abc123')
    expect(init.credentials).toBe('include')
  })

  it('encodes the session id in the query string', async () => {
    const fetchMock = fetchMockResolving({ session: SESSION })
    await getSession('has space')
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('/api/session?session_id=has%20space')
  })

  it('serializes messages/resolve_model/msg_limit/msg_before paging params', async () => {
    const fetchMock = fetchMockResolving({ session: SESSION })
    await getSession('abc123', { messages: 0, resolve_model: 1, msg_limit: 100, msg_before: 250 })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('/api/session?session_id=abc123&messages=0&resolve_model=1&msg_limit=100&msg_before=250')
  })

  it('throws ApiError with the profile-mismatch detail on 409', async () => {
    fetchMockResolving(
      { error: 'Session belongs to another profile', code: 'session_profile_mismatch', session_id: 'abc123', profile: 'work' },
      409,
    )
    const err = await getSession('abc123').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      status: 409,
      message: 'Session belongs to another profile',
      body: { code: 'session_profile_mismatch', profile: 'work' },
    })
  })
})

describe('newSession()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs /api/session/new and parses { session }', async () => {
    const fetchMock = fetchMockResolving({ session: SESSION })
    await expect(newSession({ workspace: '/tmp/w', worktree: true, model: 'gpt-5', model_provider: 'openai', enabled_toolsets: ['browser'], prev_session_id: 'old1', profile: 'default' })).resolves.toEqual({ session: SESSION })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/session/new')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(String(init.body))).toEqual({
      workspace: '/tmp/w',
      worktree: true,
      model: 'gpt-5',
      model_provider: 'openai',
      enabled_toolsets: ['browser'],
      prev_session_id: 'old1',
      profile: 'default',
    })
  })

  it('sends an empty body when called without options', async () => {
    const fetchMock = fetchMockResolving({ session: SESSION })
    await newSession()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({})
  })

  it('surfaces worktree_skipped when the config-default worktree was skipped', async () => {
    fetchMockResolving({ session: SESSION, worktree_skipped: true })
    await expect(newSession({ worktree: true })).resolves.toEqual({ session: SESSION, worktree_skipped: true })
  })
})

describe('updateSession()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the mutable fields to /api/session/update', async () => {
    const fetchMock = fetchMockResolving({ session: SESSION })
    await expect(updateSession({ session_id: 'abc123', workspace: '/tmp/w', model: 'gpt-5', model_provider: 'openai' })).resolves.toEqual({ session: SESSION })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/session/update')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'abc123', workspace: '/tmp/w', model: 'gpt-5', model_provider: 'openai' })
  })
})

describe('deleteSession()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { session_id } and resolves { ok: true }', async () => {
    const fetchMock = fetchMockResolving({ ok: true, state_db_cleanup_failed: false })
    await expect(deleteSession('abc123')).resolves.toEqual({ ok: true, state_db_cleanup_failed: false })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/session/delete')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'abc123' })
  })

  it('passes through the worktree-retained metadata when present', async () => {
    fetchMockResolving({ ok: true, state_db_cleanup_failed: false, worktree_retained: true, worktree_path: '/tmp/wt' })
    await expect(deleteSession('abc123')).resolves.toMatchObject({ ok: true, worktree_retained: true, worktree_path: '/tmp/wt' })
  })
})

describe('renameSession()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { session_id, title } and parses { session }', async () => {
    fetchMockResolving({ session: { ...SESSION, title: 'New name' } })
    await expect(renameSession('abc123', 'New name')).resolves.toEqual({ session: { ...SESSION, title: 'New name' } })
    const [, init] = (vi.mocked(fetch).mock.calls[0] ?? []) as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'abc123', title: 'New name' })
  })
})

describe('duplicateSession()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs /api/session/duplicate and parses { session }', async () => {
    fetchMockResolving({ session: { ...SESSION, title: 'Build the thing (copy)' } })
    await expect(duplicateSession('abc123')).resolves.toEqual({ session: { ...SESSION, title: 'Build the thing (copy)' } })
    const [url, init] = (vi.mocked(fetch).mock.calls[0] ?? []) as [string, RequestInit]
    expect(url).toBe('/api/session/duplicate')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'abc123' })
  })
})

describe('clearSession()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs /api/session/clear and parses { ok, session }', async () => {
    const fetchMock = fetchMockResolving({ ok: true, session: { ...SESSION, message_count: 0 } })
    await expect(clearSession('abc123')).resolves.toEqual({ ok: true, session: { ...SESSION, message_count: 0 } })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'abc123' })
  })
})

describe('truncateSession()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { session_id, keep_count } to /api/session/truncate', async () => {
    const fetchMock = fetchMockResolving({ ok: true, session: SESSION })
    await expect(truncateSession('abc123', 5)).resolves.toEqual({ ok: true, session: SESSION })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/session/truncate')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'abc123', keep_count: 5 })
  })
})

describe('branchSession()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { session_id } and parses the fork metadata', async () => {
    const fetchMock = fetchMockResolving({ session_id: 'fork9', title: 'Build the thing (fork)', parent_session_id: 'abc123' })
    await expect(branchSession('abc123')).resolves.toEqual({ session_id: 'fork9', title: 'Build the thing (fork)', parent_session_id: 'abc123' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'abc123' })
  })

  it('forwards keep_count and title when provided', async () => {
    const fetchMock = fetchMockResolving({ session_id: 'fork9', title: 'Fork title', parent_session_id: 'abc123' })
    await branchSession('abc123', { keep_count: 3, title: 'Fork title' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'abc123', keep_count: 3, title: 'Fork title' })
  })
})

describe('retryLast() / undoLast()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs /api/session/retry and parses { ok, last_user_text, removed_count }', async () => {
    const fetchMock = fetchMockResolving({ ok: true, last_user_text: 'Do it again', removed_count: 2 })
    await expect(retryLast('abc123')).resolves.toEqual({ ok: true, last_user_text: 'Do it again', removed_count: 2 })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/session/retry')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'abc123' })
  })

  it('POSTs /api/session/undo and parses { ok, removed_count, removed_preview }', async () => {
    const fetchMock = fetchMockResolving({ ok: true, removed_count: 1, removed_preview: 'My message' })
    await expect(undoLast('abc123')).resolves.toEqual({ ok: true, removed_count: 1, removed_preview: 'My message' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/session/undo')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'abc123' })
  })
})

describe('setSessionToolsets()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { session_id, toolsets } and parses the enabled list', async () => {
    const fetchMock = fetchMockResolving({ ok: true, enabled_toolsets: ['browser', 'shell'] })
    await expect(setSessionToolsets('abc123', ['browser', 'shell'])).resolves.toEqual({ ok: true, enabled_toolsets: ['browser', 'shell'] })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/session/toolsets')
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'abc123', toolsets: ['browser', 'shell'] })
  })

  it('accepts null to clear the toolset override (inherit config)', async () => {
    const fetchMock = fetchMockResolving({ ok: true, enabled_toolsets: null })
    await expect(setSessionToolsets('abc123', null)).resolves.toEqual({ ok: true, enabled_toolsets: null })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'abc123', toolsets: null })
  })
})

describe('searchSessions()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /api/sessions/search?q= and parses { sessions, query, count }', async () => {
    const payload = { sessions: [{ ...ROW, match_type: 'title' }], query: 'build', count: 1, all_profiles: false, active_profile: 'default' }
    const fetchMock = fetchMockResolving(payload)
    await expect(searchSessions('build')).resolves.toEqual(payload)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/sessions/search?q=build')
    expect(init.credentials).toBe('include')
  })

  it('encodes the query and forwards content/depth/all_profiles options', async () => {
    const fetchMock = fetchMockResolving({ sessions: [], all_profiles: true, active_profile: 'default' })
    await searchSessions('two words', { content: false, depth: 10, all_profiles: true })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('/api/sessions/search?q=two%20words&content=false&depth=10&all_profiles=true')
  })
})

describe('session/export', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sessionExportUrl builds the JSON export URL with the encoded session id', () => {
    expect(sessionExportUrl('abc123')).toBe('/api/session/export?session_id=abc123')
    expect(sessionExportUrl('a b', { format: 'html', theme: 'light', palette: 'e30=' })).toBe(
      '/api/session/export?session_id=a%20b&format=html&theme=light&palette=e30%3D',
    )
  })

  it('downloadSessionExport fetches with credentials and triggers a blob download', async () => {
    const createObjectURL = vi.fn((_blob: unknown) => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign({}, globalThis.URL, { createObjectURL, revokeObjectURL }))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => document.createElement('div'))
    const body = JSON.stringify({ session_id: 'abc123' })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="hermes-abc123.json"',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await downloadSessionExport('abc123')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/session/export?session_id=abc123')
    expect(init.credentials).toBe('include')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    const anchor = appendSpy.mock.calls[0][0] as HTMLAnchorElement
    expect(anchor.href).toBe('blob:mock')
    expect(anchor.download).toBe('hermes-abc123.json')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    // The blob crosses realms (Node undici Blob vs jsdom Blob global), so
    // assert on shape rather than instanceof.
    expect(createObjectURL.mock.calls[0][0]).toMatchObject({ size: body.length, type: 'application/json;charset=utf-8' })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('downloadSessionExport throws ApiError with the server message on failure', async () => {
    vi.stubGlobal('URL', Object.assign({}, globalThis.URL, { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 })),
    )
    const err = await downloadSessionExport('missing').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 404, message: 'Session not found' })
  })
})

describe('getSessionStatus()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /api/session/status?session_id= and parses the snapshot', async () => {
    const status: SessionStatus = {
      session_id: 'abc123',
      title: 'Build the thing',
      model: 'deepseek-v4-flash',
      profile: 'default',
      hermes_home: '/home/gabriel/.hermes',
      workspace: '/home/gabriel/dev/HermesCN',
      personality: null,
      message_count: 12,
      created_at: 1755300000,
      updated_at: 1755400000,
      agent_running: false,
      active_stream_id: null,
      input_tokens: 1200,
      output_tokens: 3400,
      total_tokens: 4600,
      estimated_cost: 0.42,
    }
    const fetchMock = fetchMockResolving(status)
    await expect(getSessionStatus('abc123')).resolves.toEqual(status)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/session/status?session_id=abc123')
    expect(init.credentials).toBe('include')
  })
})

describe('getSessionUsage()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /api/session/usage?session_id= and parses the counters', async () => {
    const usage: SessionUsage = { input_tokens: 1200, output_tokens: 3400, total_tokens: 4600, estimated_cost: 0.42, model: 'deepseek-v4-flash' }
    const fetchMock = fetchMockResolving(usage)
    await expect(getSessionUsage('abc123')).resolves.toEqual(usage)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('/api/session/usage?session_id=abc123')
  })
})

describe('getSessionLineageReport()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /api/session/lineage/report?session_id= and parses the report', async () => {
    const report: SessionLineageReport = {
      mutation: false,
      found: true,
      session_id: 'abc123',
      lineage_key: 'root1',
      tip_session_id: 'abc123',
      total_segments: 2,
      materialized_segments: 2,
      segments: [
        { session_id: 'abc123', role: 'tip', title: 'Build the thing', source: 'webui', started_at: 1755300000, updated_at: 1755400000, end_reason: null, active: true, archived: false },
        { session_id: 'root1', role: 'hidden_segment', title: 'Build the thing', source: 'webui', started_at: 1755200000, updated_at: 1755299999, end_reason: 'compression', active: false, archived: false },
      ],
      children: [],
      manual_review: false,
    }
    const fetchMock = fetchMockResolving(report)
    await expect(getSessionLineageReport('abc123')).resolves.toEqual(report)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/session/lineage/report?session_id=abc123')
    expect(init.credentials).toBe('include')
  })

  it('throws ApiError on 404 (unknown session)', async () => {
    fetchMockResolving({ error: 'Session not found' }, 404)
    await expect(getSessionLineageReport('nope')).rejects.toMatchObject({ status: 404, message: 'Session not found' })
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import {
  createCron,
  deleteCron,
  deleteSkill,
  getActiveProfile,
  getCronDeliveryOptions,
  getCronHistory,
  getCronOutput,
  getCronRecent,
  getCronRunDetail,
  getCronStatus,
  getCrons,
  getProfiles,
  getSettings,
  getSkillContent,
  getSkillFile,
  getSkills,
  getSkillUsage,
  pauseCron,
  readMemory,
  resumeCron,
  runCron,
  saveSkill,
  switchProfile,
  updateCron,
  updateSettings,
  writeMemory,
  type CronJob,
  type CronRun,
  type MemoryData,
  type ProfileRow,
  type Settings,
  type SkillSummary,
} from './panels'

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

/**
 * Assert the single fetch call made by a client function. The client passes a
 * `Headers` instance, so headers are normalized instead of deep-compared.
 */
function expectFetchCall(
  fetchMock: ReturnType<typeof vi.fn>,
  url: string,
  opts: { method?: string; body?: unknown } = {},
): void {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [actualUrl, actualInit] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(actualUrl).toBe(url)
  expect(actualInit.credentials).toBe('include')
  if (opts.method) expect(actualInit.method).toBe(opts.method)
  if (opts.body !== undefined) {
    expect(JSON.parse(String(actualInit.body))).toEqual(opts.body)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const JOB: CronJob = {
  id: 'a1b2c3d4e5f6',
  name: 'Morning digest',
  schedule: { kind: 'cron', expression: '0 9 * * *' },
  schedule_display: '0 9 * * *',
  enabled: true,
  next_run_at: '2026-08-17T09:00:00Z',
  last_run_at: '2026-08-16T09:00:00Z',
  last_status: 'completed',
  deliver: 'local',
  skills: ['web-search'],
  prompt: 'Summarize the news',
  model: 'deepseek-v4-flash',
  provider: 'deepseek',
  profile: null,
  toast_notifications: true,
}

const RUN: CronRun = {
  filename: '2026-08-16_090000.md',
  size: 2048,
  modified: 1723802400.5,
  usage: { model: 'deepseek-v4-flash', total_tokens: 1234 },
}

describe('crons', () => {
  it('lists cron jobs without profile expansion by default', async () => {
    const fetchMock = fetchMockResolving({ jobs: [JOB], all_profiles: false, active_profile: 'default', other_profile_count: 0 })
    const data = await getCrons()
    expectFetchCall(fetchMock, '/api/crons')
    expect(data.jobs).toEqual([JOB])
    expect(data.active_profile).toBe('default')
  })

  it('requests cross-profile expansion when allProfiles is set', async () => {
    const fetchMock = fetchMockResolving({ jobs: [JOB], all_profiles: true, active_profile: 'default', other_profile_count: 2 })
    await getCrons({ allProfiles: true })
    expectFetchCall(fetchMock, '/api/crons?all_profiles=1')
  })

  it('surfaces cron_unavailable in split-container deployments', async () => {
    const fetchMock = fetchMockResolving({ jobs: [], cron_unavailable: true })
    const data = await getCrons()
    expectFetchCall(fetchMock, '/api/crons')
    expect(data.cron_unavailable).toBe(true)
    expect(data.jobs).toEqual([])
  })

  it('lists cron output files with content windows', async () => {
    const fetchMock = fetchMockResolving({
      job_id: JOB.id,
      outputs: [{ filename: '2026-08-16_090000.md', content: '## Response\nsummary' }],
    })
    const data = await getCronOutput(JOB.id, 10)
    expectFetchCall(fetchMock, `/api/crons/output?job_id=${JOB.id}&limit=10`)
    expect(data.outputs[0].content).toContain('summary')
  })

  it('defaults the output limit to 5', async () => {
    const fetchMock = fetchMockResolving({ job_id: JOB.id, outputs: [] })
    await getCronOutput(JOB.id)
    expectFetchCall(fetchMock, `/api/crons/output?job_id=${JOB.id}&limit=5`)
  })

  it('lists cron run history with metadata but no content', async () => {
    const fetchMock = fetchMockResolving({ job_id: JOB.id, runs: [RUN], total: 1, offset: 0 })
    const data = await getCronHistory(JOB.id, { limit: 20, offset: 0 })
    expectFetchCall(fetchMock, `/api/crons/history?job_id=${JOB.id}&limit=20&offset=0`)
    expect(data.runs[0].usage.total_tokens).toBe(1234)
    expect(data.total).toBe(1)
  })

  it('fetches a single run detail with full content and snippet', async () => {
    const fetchMock = fetchMockResolving({
      job_id: JOB.id,
      filename: RUN.filename,
      content: 'full body',
      snippet: 'preview',
      usage: { model: 'deepseek-v4-flash' },
    })
    const data = await getCronRunDetail(JOB.id, RUN.filename)
    expectFetchCall(fetchMock, `/api/crons/run?job_id=${JOB.id}&filename=${RUN.filename}`)
    expect(data.snippet).toBe('preview')
    expect(data.content).toBe('full body')
  })

  it('reports running status for a single job', async () => {
    const fetchMock = fetchMockResolving({ job_id: JOB.id, running: true, elapsed: 42.5 })
    const data = await getCronStatus(JOB.id)
    expectFetchCall(fetchMock, `/api/crons/status?job_id=${JOB.id}`)
    expect(data.running).toBe(true)
  })

  it('reports running status for all jobs when no id is given', async () => {
    const fetchMock = fetchMockResolving({ running: { [JOB.id]: 12.3 } })
    const data = await getCronStatus()
    expectFetchCall(fetchMock, '/api/crons/status')
    expect(data.running).toEqual({ [JOB.id]: 12.3 })
  })

  it('lists delivery platforms', async () => {
    const fetchMock = fetchMockResolving({
      platforms: [
        { value: 'local', label: 'Local (save output only)' },
        { value: 'telegram', label: 'Telegram' },
      ],
    })
    const data = await getCronDeliveryOptions()
    expectFetchCall(fetchMock, '/api/crons/delivery-options')
    expect(data.platforms.map((p) => p.value)).toEqual(['local', 'telegram'])
  })

  it('lists completed runs since a timestamp', async () => {
    const since = 1723800000
    const fetchMock = fetchMockResolving({
      completions: [
        { job_id: JOB.id, name: 'Morning digest', status: 'completed', completed_at: 1723802400, toast_notifications: true, session_id: 'sess-1', message_count: 3 },
      ],
      since,
    })
    const data = await getCronRecent(since)
    expectFetchCall(fetchMock, `/api/crons/recent?since=${since}`)
    expect(data.completions[0].session_id).toBe('sess-1')
  })

  it('creates a cron job with optional fields', async () => {
    const fetchMock = fetchMockResolving({ ok: true, job: JOB })
    const data = await createCron({
      prompt: 'Summarize the news',
      schedule: '0 9 * * *',
      name: 'Morning digest',
      deliver: 'local',
      skills: ['web-search'],
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
      toast_notifications: true,
    })
    expectFetchCall(fetchMock, '/api/crons/create', {
      method: 'POST',
      body: {
        prompt: 'Summarize the news',
        schedule: '0 9 * * *',
        name: 'Morning digest',
        deliver: 'local',
        skills: ['web-search'],
        model: 'deepseek-v4-flash',
        provider: 'deepseek',
        toast_notifications: true,
      },
    })
    expect(data.job.id).toBe(JOB.id)
  })

  it('omits undefined create fields from the request body', async () => {
    const fetchMock = fetchMockResolving({ ok: true, job: JOB })
    await createCron({ prompt: 'Hi', schedule: '0 9 * * *' })
    expectFetchCall(fetchMock, '/api/crons/create', {
      method: 'POST',
      body: { prompt: 'Hi', schedule: '0 9 * * *' },
    })
  })

  it('updates a cron job with partial fields', async () => {
    const fetchMock = fetchMockResolving({ ok: true, job: { ...JOB, enabled: false } })
    const data = await updateCron({ job_id: JOB.id, name: 'Renamed', enabled: false })
    expectFetchCall(fetchMock, '/api/crons/update', {
      method: 'POST',
      body: { job_id: JOB.id, name: 'Renamed', enabled: false },
    })
    expect(data.job.enabled).toBe(false)
  })

  it('deletes a cron job', async () => {
    const fetchMock = fetchMockResolving({ ok: true, job_id: JOB.id })
    const data = await deleteCron(JOB.id)
    expectFetchCall(fetchMock, '/api/crons/delete', { method: 'POST', body: { job_id: JOB.id } })
    expect(data.job_id).toBe(JOB.id)
  })

  it('runs a cron job', async () => {
    const fetchMock = fetchMockResolving({ ok: true, job_id: JOB.id, status: 'running' })
    const data = await runCron(JOB.id)
    expectFetchCall(fetchMock, '/api/crons/run', { method: 'POST', body: { job_id: JOB.id } })
    expect(data.status).toBe('running')
  })

  it('pauses a cron job', async () => {
    const fetchMock = fetchMockResolving({ ok: true, job: { ...JOB, enabled: false } })
    const data = await pauseCron(JOB.id)
    expectFetchCall(fetchMock, '/api/crons/pause', { method: 'POST', body: { job_id: JOB.id } })
    expect(data.ok).toBe(true)
  })

  it('resumes a cron job', async () => {
    const fetchMock = fetchMockResolving({ ok: true, job: { ...JOB, enabled: true } })
    const data = await resumeCron(JOB.id)
    expectFetchCall(fetchMock, '/api/crons/resume', { method: 'POST', body: { job_id: JOB.id } })
    expect(data.job.enabled).toBe(true)
  })

  it('throws ApiError with the server error message on failure', async () => {
    fetchMockResolving({ error: 'job_id required' }, 400)
    await expect(getCronHistory('')).rejects.toMatchObject({ status: 400, message: 'job_id required' })
    expect(ApiError).toBeDefined()
  })
})

describe('skills', () => {
  const SKILL: SkillSummary = { name: 'web-search', description: 'Search the web', category: 'web', disabled: false }

  it('lists skills', async () => {
    const fetchMock = fetchMockResolving({ skills: [SKILL] })
    const data = await getSkills()
    expectFetchCall(fetchMock, '/api/skills')
    expect(data.skills[0].name).toBe('web-search')
  })

  it('filters skills by category', async () => {
    const fetchMock = fetchMockResolving({ skills: [SKILL] })
    await getSkills('web')
    expectFetchCall(fetchMock, '/api/skills?category=web')
  })

  it('returns skill usage statistics', async () => {
    const fetchMock = fetchMockResolving({
      usage: { 'web-search': { use_count: 3, view_count: 2, patch_count: 0, last_used_at: '2026-08-16T09:00:00Z' } },
      skill_names: ['web-search'],
      total_invocations: 5,
      unique_skills_used: 1,
    })
    const data = await getSkillUsage()
    expectFetchCall(fetchMock, '/api/skills/usage')
    expect(data.usage['web-search'].use_count).toBe(3)
    expect(data.total_invocations).toBe(5)
    expect(data.unique_skills_used).toBe(1)
  })

  it('fetches full skill content with linked files', async () => {
    const fetchMock = fetchMockResolving({
      success: true,
      name: 'web-search',
      description: 'Search the web',
      tags: ['web'],
      related_skills: [],
      content: '# Web Search\n',
      path: 'web-search/SKILL.md',
      skill_dir: '/home/gabriel/.hermes/skills/web-search',
      linked_files: { references: ['references/api.md'] },
    })
    const data = await getSkillContent('web-search')
    expectFetchCall(fetchMock, '/api/skills/content?name=web-search')
    if (!data.success) throw new Error('expected a successful skill view')
    expect(data.linked_files.references).toEqual(['references/api.md'])
  })

  it('fetches a linked skill file', async () => {
    const fetchMock = fetchMockResolving({ content: '# API docs\n', path: 'references/api.md' })
    const data = await getSkillFile('web-search', 'references/api.md')
    expectFetchCall(fetchMock, '/api/skills/content?name=web-search&file=references%2Fapi.md')
    expect(data.content).toContain('API docs')
  })

  it('saves a skill', async () => {
    const fetchMock = fetchMockResolving({ ok: true, name: 'web-search', path: '/home/gabriel/.hermes/skills/web-search/SKILL.md' })
    const data = await saveSkill({ name: 'web-search', content: '# Web Search\n', category: 'web' })
    expectFetchCall(fetchMock, '/api/skills/save', {
      method: 'POST',
      body: { name: 'web-search', content: '# Web Search\n', category: 'web' },
    })
    expect(data.path).toContain('SKILL.md')
  })

  it('deletes a skill', async () => {
    const fetchMock = fetchMockResolving({ ok: true, name: 'web-search' })
    const data = await deleteSkill('web-search')
    expectFetchCall(fetchMock, '/api/skills/delete', { method: 'POST', body: { name: 'web-search' } })
    expect(data.ok).toBe(true)
  })
})

describe('memory', () => {
  const MEMORY: MemoryData = {
    memory: '# Memory\n',
    user: '# User\n',
    soul: '# Soul\n',
    project_context: '# Project\n',
    memory_path: '/home/gabriel/.hermes/memories/MEMORY.md',
    user_path: '/home/gabriel/.hermes/memories/USER.md',
    soul_path: '/home/gabriel/.hermes/SOUL.md',
    project_context_path: '/home/gabriel/dev/HermesCN/.hermes.md',
    project_context_name: 'HermesCN',
    project_context_workspace: '/home/gabriel/dev/HermesCN',
    memory_mtime: 1723802400.0,
    user_mtime: null,
    soul_mtime: 1723802400.0,
    project_context_mtime: 1723802400.0,
    project_context_shadowed: false,
    external_notes_enabled: false,
  }

  it('reads memory sections', async () => {
    const fetchMock = fetchMockResolving(MEMORY)
    const data = await readMemory()
    expectFetchCall(fetchMock, '/api/memory')
    expect(data.memory).toContain('Memory')
    expect(data.project_context_workspace).toBe('/home/gabriel/dev/HermesCN')
  })

  it('writes a memory section', async () => {
    const fetchMock = fetchMockResolving({ ok: true, section: 'memory', path: '/home/gabriel/.hermes/memories/MEMORY.md' })
    const data = await writeMemory('memory', '# Memory\n')
    expectFetchCall(fetchMock, '/api/memory/write', {
      method: 'POST',
      body: { section: 'memory', content: '# Memory\n' },
    })
    expect(data.section).toBe('memory')
  })
})

describe('profiles', () => {
  const ROW: ProfileRow = {
    name: 'work',
    path: '/home/gabriel/.hermes/profiles/work',
    is_default: false,
    is_active: true,
    gateway_running: false,
    model: null,
    provider: null,
    has_env: false,
    visible: true,
    skill_count: 2,
    enabled_skills: 2,
    total_skills: 3,
  }

  it('lists profiles with active profile and mode flag', async () => {
    const fetchMock = fetchMockResolving({ profiles: [ROW], active: 'work', single_profile_mode: false })
    const data = await getProfiles()
    expectFetchCall(fetchMock, '/api/profiles')
    expect(data.active).toBe('work')
    expect(data.single_profile_mode).toBe(false)
    expect(data.profiles[0].enabled_skills).toBe(2)
  })

  it('returns the active profile with its default workspace', async () => {
    const fetchMock = fetchMockResolving({ name: 'default', path: '/home/gabriel/.hermes', is_default: true, default_workspace: '/home/gabriel/dev/HermesCN' })
    const data = await getActiveProfile()
    expectFetchCall(fetchMock, '/api/profile/active')
    expect(data.is_default).toBe(true)
    expect(data.default_workspace).toBe('/home/gabriel/dev/HermesCN')
  })

  it('switches the active profile', async () => {
    const fetchMock = fetchMockResolving({ profiles: [ROW], active: 'work' })
    const data = await switchProfile('work')
    expectFetchCall(fetchMock, '/api/profile/switch', { method: 'POST', body: { name: 'work' } })
    expect(data.active).toBe('work')
  })
})

describe('settings', () => {
  const SETTINGS: Settings = {
    bot_name: 'Hermes',
    theme: 'dark',
    persisted_speech_keys: ['edge'],
    auth_enabled: false,
    webui_version: '0.1.0',
  }

  it('reads settings', async () => {
    const fetchMock = fetchMockResolving(SETTINGS)
    const data = await getSettings()
    expectFetchCall(fetchMock, '/api/settings')
    expect(data.bot_name).toBe('Hermes')
    expect(data.persisted_speech_keys).toEqual(['edge'])
  })

  it('updates settings with partial fields', async () => {
    const fetchMock = fetchMockResolving({ ...SETTINGS, bot_name: 'Renamed' })
    const data = await updateSettings({ bot_name: 'Renamed' })
    expectFetchCall(fetchMock, '/api/settings', { method: 'POST', body: { bot_name: 'Renamed' } })
    expect(data.bot_name).toBe('Renamed')
  })
})

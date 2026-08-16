import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { getModels } from '@/api/models'
import { branchSession, renameSession, retryLast, undoLast, updateSession } from '@/api/sessions'
import { steerChat } from '@/api/chat'
import { getSkillContent, getSkills, updateSettings } from '@/api/panels'
import { getWorkspaces } from '@/api/workspace'
import { t } from '@/i18n'
import {
  COMMANDS,
  activeSlashOffset,
  getCommand,
  getSlashAutocompleteMatches,
  parseCommand,
  runSlashCommand,
  type SlashCommandContext,
} from './slashCommands'
import { getQueuedSessionCount, shiftQueuedSessionMessage } from './queue'
import type { SessionDetailResponse } from '@/api/sessions'

/**
 * Slash command registry tests (plan Task 8.7).
 *
 * Contract under test mirrors static/commands.js:
 *  - COMMANDS is the authoritative 28-entry dispatch table (name/desc/arg/
 *    subArgs/noEcho), with noEcho:true = action-only (no user echo to chat).
 *  - parseCommand() returns {name, args} for '/'-prefixed text, else null.
 *  - runSlashCommand() returns true when the command handled the text and
 *    false when the caller must fall through to the normal send path.
 *  - getSlashAutocompleteMatches() ports the legacy dropdown contract:
 *    prefix-matched commands, then sub-arg completion for model/personality/
 *    skill/goal/reasoning from the live catalogs.
 */

vi.mock('@/api/client', () => ({ api: vi.fn() }))
vi.mock('@/api/models', () => ({ getModels: vi.fn() }))
vi.mock('@/api/sessions', () => ({
  retryLast: vi.fn(),
  undoLast: vi.fn(),
  branchSession: vi.fn(),
  updateSession: vi.fn(),
  renameSession: vi.fn(),
}))
vi.mock('@/api/chat', () => ({ steerChat: vi.fn() }))
vi.mock('@/api/panels', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getSkills: vi.fn(),
  getSkillContent: vi.fn(),
}))
vi.mock('@/api/workspace', () => ({ getWorkspaces: vi.fn() }))

const session = {
  session_id: 's1',
  title: 'Session A',
  model: 'gpt-4o',
  model_provider: 'openrouter',
  workspace: '/home/user/proj',
  profile: 'default',
  created_at: 1700000000,
  updated_at: 1700000100,
  message_count: 2,
  input_tokens: 10,
  output_tokens: 5,
}

function makeCtx(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return {
    session,
    busy: false,
    streamId: null,
    messages: [{ role: 'user', content: 'hello' }],
    sessionId: 's1',
    appendAssistant: vi.fn(),
    replaceMessages: vi.fn(),
    setSession: vi.fn(),
    setBusy: vi.fn(),
    setStreamId: vi.fn(),
    setDraft: vi.fn(),
    newSession: vi.fn(async () => null),
    loadSession: vi.fn(async () => null),
    sendAsUser: vi.fn(async () => {}),
    cancelStream: vi.fn(async () => {}),
    attachStream: vi.fn(),
    getTheme: vi.fn(() => ({ theme: 'dark' as const, skin: 'default' })),
    setTheme: vi.fn(),
    setSkin: vi.fn(),
    openTerminal: vi.fn(),
    micAvailable: true,
    toggleMic: vi.fn(),
    toast: vi.fn(),
    toastError: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  vi.mocked(getModels).mockResolvedValue({
    active_provider: 'openrouter',
    default_model: 'gpt-4o',
    aliases: { haiku: 'anthropic/claude-3-5-haiku' },
    groups: [
      {
        provider: 'OpenRouter',
        provider_id: 'openrouter',
        models: [{ id: 'gpt-4o', label: 'GPT-4o' }],
        extra_models: [{ id: 'anthropic/claude-3-5-haiku', label: 'Claude 3.5 Haiku' }],
      },
    ],
  })
  vi.mocked(getWorkspaces).mockResolvedValue({
    workspaces: [
      { path: '/home/user/proj', name: 'proj' },
      { path: '/home/user/other', name: 'other' },
    ],
    last: '/home/user/proj',
    terminal_remote_backend: false,
  })
  vi.mocked(retryLast).mockResolvedValue({ ok: true, last_user_text: 'hello', removed_count: 2 })
  vi.mocked(undoLast).mockResolvedValue({ ok: true, removed_count: 2 })
  vi.mocked(branchSession).mockResolvedValue({ session_id: 'fork-1', title: 'Session A (fork)', parent_session_id: 's1' })
  vi.mocked(updateSession).mockResolvedValue({ session } as SessionDetailResponse)
  vi.mocked(renameSession).mockResolvedValue({ session: { ...session, title: 'New Title' } } as SessionDetailResponse)
  vi.mocked(steerChat).mockResolvedValue({ accepted: true, fallback: null, stream_id: 'st-1' })
  vi.mocked(updateSettings).mockResolvedValue({})
  vi.mocked(getSkills).mockResolvedValue({
    skills: [
      { name: 'debugging', description: 'Fix bugs', category: 'Engineering', disabled: false },
      { name: 'planning', description: 'Write plans', category: 'Management', disabled: false },
    ],
  })
  vi.mocked(getSkillContent).mockResolvedValue({
    success: true,
    name: 'debugging',
    description: 'Fix bugs',
    tags: [],
    related_skills: [],
    content: '# Debugging\nDo it step by step.',
    path: '/skills/debugging',
    skill_dir: null,
    linked_files: {},
  })
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path.startsWith('/api/personalities')) {
      return { personalities: [{ name: 'witty', description: 'Witty' }] }
    }
    if (path.startsWith('/api/session/yolo')) return { yolo_enabled: false }
    if (path.startsWith('/api/reasoning')) return { show_reasoning: true, reasoning_effort: 'medium' }
    if (path === '/api/goal') return { message: 'Goal set (5-turn budget): fix bugs', message_key: 'goal_set', message_args: [5, 'fix bugs'] }
    if (path === '/api/btw') return { stream_id: 'btw-1', parent_session_id: 's1' }
    if (path === '/api/background') return { task_id: 'bg-1' }
    if (path.startsWith('/api/session/compress/start')) return { status: 'done', session: { session_id: 's1', messages: [] } }
    if (path.startsWith('/api/session/compress/status')) return { status: 'done', session: { session_id: 's1', messages: [] } }
    if (path === '/api/personality/set') return { ok: true }
    throw new Error(`unexpected api call: ${path}`)
  })
})

describe('parseCommand', () => {
  it('returns null for non-slash text', () => {
    expect(parseCommand('hello')).toBeNull()
    expect(parseCommand('')).toBeNull()
    expect(parseCommand('a/b')).toBeNull()
  })

  it('parses name (lowercased) and trimmed args', () => {
    expect(parseCommand('/help')).toEqual({ name: 'help', args: '' })
    expect(parseCommand('/model gpt-4o')).toEqual({ name: 'model', args: 'gpt-4o' })
    expect(parseCommand('/MODEL   gpt-4o  ')).toEqual({ name: 'model', args: 'gpt-4o' })
    expect(parseCommand('/clear  ')).toEqual({ name: 'clear', args: '' })
  })
})

describe('COMMANDS registry', () => {
  const EXPECTED_NAMES = [
    'help', 'clear', 'compress', 'compact', 'model', 'workspace', 'terminal', 'new',
    'usage', 'theme', 'personality', 'skills', 'use', 'stop', 'goal', 'queue',
    'interrupt', 'steer', 'title', 'retry', 'undo', 'btw', 'background', 'status',
    'voice', 'reasoning', 'yolo', 'branch',
  ]

  it('registers exactly the 28 legacy commands in legacy order', () => {
    expect(COMMANDS.map((c) => c.name)).toEqual(EXPECTED_NAMES)
  })

  it('ports the legacy noEcho flags (#840 echo contract)', () => {
    const noEcho = new Set([
      'clear', 'compress', 'compact', 'model', 'workspace', 'terminal', 'new', 'usage',
      'theme', 'use', 'stop', 'queue', 'interrupt', 'steer', 'retry', 'undo', 'btw',
      'background', 'voice', 'reasoning', 'yolo', 'branch',
    ])
    for (const cmd of COMMANDS) {
      expect(cmd.noEcho === true, `${cmd.name} noEcho`).toBe(noEcho.has(cmd.name))
    }
  })

  it('ports arg placeholders and subArgs sources', () => {
    expect(getCommand('model')).toMatchObject({ arg: 'model_name', subArgs: 'models', noEcho: true })
    expect(getCommand('personality')).toMatchObject({ arg: 'name', subArgs: 'personalities' })
    expect(getCommand('use')).toMatchObject({ arg: 'skill-name', subArgs: 'skills' })
    expect(getCommand('goal')).toMatchObject({ subArgs: ['status', 'pause', 'resume', 'clear'] })
    expect(getCommand('reasoning')).toMatchObject({
      subArgs: ['show', 'hide', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    })
    expect(getCommand('compress')).toMatchObject({ arg: '[focus topic]' })
    expect(getCommand('branch')).toMatchObject({ arg: '[name]' })
  })

  it('resolves every desc through the en catalog (cmd_* keys present)', () => {
    for (const cmd of COMMANDS) {
      expect(cmd.desc, `${cmd.name} desc`).not.toBe(`cmd_${cmd.name}`)
      expect(cmd.desc.length).toBeGreaterThan(0)
    }
    expect(t('available_commands')).toBe('Available commands:')
    expect(t('type_slash')).toBe('Type / to see commands')
  })

  it('getCommand finds by exact name and returns undefined otherwise', () => {
    expect(getCommand('help')?.name).toBe('help')
    expect(getCommand('HELP')).toBeUndefined()
    expect(getCommand('nope')).toBeUndefined()
  })
})

describe('runSlashCommand', () => {
  it('returns false for an unknown command (caller falls through to send)', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('nope')!, '', ctx)).resolves.toBe(false)
  })

  it('/help lists every command with usage and arg decoration', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('help')!, '', ctx)).resolves.toBe(true)
    const content = vi.mocked(ctx.appendAssistant).mock.calls[0][0] as string
    expect(content).toContain('Available commands:')
    for (const cmd of COMMANDS) {
      expect(content).toContain(`/${cmd.name}`)
    }
    expect(content).toContain(' /model <model_name>')
    expect(content).toContain(' /compress [focus topic]')
    expect(vi.mocked(ctx.toast).mock.calls[0][0]).toBe(t('type_slash'))
  })

  it('/clear clears the transcript and toasts (noEcho)', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('clear')!, '', ctx)).resolves.toBe(true)
    expect(ctx.replaceMessages).toHaveBeenCalledWith([])
    expect(ctx.toast).toHaveBeenCalledWith(t('conversation_cleared'))
    expect(ctx.appendAssistant).not.toHaveBeenCalled()
  })

  it('/new creates a session and toasts', async () => {
    const ctx = makeCtx({ newSession: vi.fn(async () => ({ ...session, session_id: 's2' })) })
    await expect(runSlashCommand(getCommand('new')!, '', ctx)).resolves.toBe(true)
    expect(ctx.newSession).toHaveBeenCalled()
    expect(ctx.toast).toHaveBeenCalledWith(t('new_session'))
  })

  it('/stop cancels the active stream and toasts', async () => {
    const ctx = makeCtx({ busy: true, streamId: 'st-1' })
    await expect(runSlashCommand(getCommand('stop')!, '', ctx)).resolves.toBe(true)
    expect(ctx.cancelStream).toHaveBeenCalled()
    expect(ctx.toast).toHaveBeenCalledWith(t('stream_stopped'))
  })

  it('/stop with no active stream toasts no_active_task', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('stop')!, '', ctx)).resolves.toBe(true)
    expect(ctx.cancelStream).not.toHaveBeenCalled()
    expect(ctx.toast).toHaveBeenCalledWith(t('no_active_task'))
  })

  it('/model resolves an exact catalog match and persists via updateSession', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('model')!, 'gpt-4o', ctx)).resolves.toBe(true)
    expect(updateSession).toHaveBeenCalledWith({ session_id: 's1', model: 'gpt-4o' })
    expect(ctx.toast).toHaveBeenCalledWith(t('switched_to') + 'gpt-4o')
  })

  it('/model resolves an alias from the catalog aliases map', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('model')!, 'haiku', ctx)).resolves.toBe(true)
    expect(updateSession).toHaveBeenCalledWith({ session_id: 's1', model: 'anthropic/claude-3-5-haiku' })
  })

  it('/model with a provider-qualified id persists model_provider', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('model')!, 'foo/bar-model', ctx)).resolves.toBe(true)
    expect(updateSession).toHaveBeenCalledWith({
      session_id: 's1',
      model: 'foo/bar-model',
      model_provider: 'foo',
    })
  })

  it('/model with no match toasts no_model_match and a suggestion', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('model')!, 'mimo-v2.5', ctx)).resolves.toBe(true)
    expect(updateSession).not.toHaveBeenCalled()
    const msg = vi.mocked(ctx.toast).mock.calls[0][0] as string
    expect(msg).toContain(t('no_model_match'))
    expect(msg).toContain('"mimo-v2.5"')
  })

  it('/model with no args toasts usage', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('model')!, '', ctx)).resolves.toBe(true)
    expect(ctx.toast).toHaveBeenCalledWith(t('model_usage'))
  })

  it('/workspace switches via updateSession and toasts', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('workspace')!, 'other', ctx)).resolves.toBe(true)
    expect(updateSession).toHaveBeenCalledWith({ session_id: 's1', workspace: '/home/user/other' })
    expect(ctx.toast).toHaveBeenCalledWith(t('switched_workspace') + 'other')
  })

  it('/workspace with no match toasts', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('workspace')!, 'nope', ctx)).resolves.toBe(true)
    expect(updateSession).not.toHaveBeenCalled()
    expect(vi.mocked(ctx.toast).mock.calls[0][0]).toContain(t('no_workspace_match'))
  })

  it('/workspace refuses to switch while busy', async () => {
    const ctx = makeCtx({ busy: true })
    await expect(runSlashCommand(getCommand('workspace')!, 'other', ctx)).resolves.toBe(true)
    expect(updateSession).not.toHaveBeenCalled()
    expect(ctx.toast).toHaveBeenCalledWith(t('workspace_busy_switch'))
  })

  it('/terminal refuses a remote terminal backend with a warning toast', async () => {
    vi.mocked(getWorkspaces).mockResolvedValue({
      workspaces: [],
      last: '',
      terminal_remote_backend: true,
    })
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('terminal')!, '', ctx)).resolves.toBe(true)
    expect(ctx.openTerminal).not.toHaveBeenCalled()
    expect(ctx.toast).toHaveBeenCalledWith(t('terminal_remote_backend_unsupported'))
  })

  it('/terminal opens the terminal panel for a local backend', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('terminal')!, '', ctx)).resolves.toBe(true)
    expect(ctx.openTerminal).toHaveBeenCalled()
  })

  it('/terminal auto-creates a session when none is active', async () => {
    const ctx = makeCtx({ session: null, sessionId: null, newSession: vi.fn(async () => session) })
    await expect(runSlashCommand(getCommand('terminal')!, '', ctx)).resolves.toBe(true)
    expect(ctx.newSession).toHaveBeenCalled()
    expect(ctx.openTerminal).toHaveBeenCalled()
  })

  it('/terminal warns when the session has no workspace', async () => {
    const ctx = makeCtx({ session: { ...session, workspace: '' } })
    await expect(runSlashCommand(getCommand('terminal')!, '', ctx)).resolves.toBe(true)
    expect(ctx.openTerminal).not.toHaveBeenCalled()
    expect(ctx.toast).toHaveBeenCalledWith(t('terminal_no_workspace_title'))
  })

  it('/usage toggles show_token_usage and persists via settings', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('usage')!, '', ctx)).resolves.toBe(true)
    expect(updateSettings).toHaveBeenCalledWith({ show_token_usage: true })
    expect(ctx.toast).toHaveBeenCalledWith(t('token_usage_on'))
    // second call toggles back off
    await expect(runSlashCommand(getCommand('usage')!, '', ctx)).resolves.toBe(true)
    expect(updateSettings).toHaveBeenLastCalledWith({ show_token_usage: false })
    expect(ctx.toast).toHaveBeenLastCalledWith(t('token_usage_off'))
  })

  it('/theme dark applies theme and persists', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('theme')!, 'dark', ctx)).resolves.toBe(true)
    expect(ctx.setTheme).toHaveBeenCalledWith('dark')
    expect(ctx.setSkin).toHaveBeenCalledWith('default')
    expect(ctx.toast).toHaveBeenCalledWith(t('theme_set') + 'dark')
  })

  it('/theme ares applies a skin', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('theme')!, 'ares', ctx)).resolves.toBe(true)
    expect(ctx.setSkin).toHaveBeenCalledWith('ares')
    expect(ctx.toast).toHaveBeenCalledWith(t('theme_set') + 'ares')
  })

  it('/theme oled migrates a legacy theme name', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('theme')!, 'oled', ctx)).resolves.toBe(true)
    expect(ctx.setTheme).toHaveBeenCalledWith('dark')
    expect(ctx.setSkin).toHaveBeenCalledWith('default')
    expect(vi.mocked(ctx.toast).mock.calls[0][0]).toBe('Theme: dark + default')
  })

  it('/theme with an unknown value toasts usage', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('theme')!, 'blah', ctx)).resolves.toBe(true)
    expect(ctx.setTheme).not.toHaveBeenCalled()
    expect(vi.mocked(ctx.toast).mock.calls[0][0]).toContain(t('theme_usage'))
  })

  it('/personality none clears via personality/set', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('personality')!, 'none', ctx)).resolves.toBe(true)
    expect(api).toHaveBeenCalledWith('/api/personality/set', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ session_id: 's1', name: '' }),
    }))
    expect(ctx.toast).toHaveBeenCalledWith(t('personality_cleared'))
  })

  it('/personality <name> sets and echoes an assistant message', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('personality')!, 'witty', ctx)).resolves.toBe(true)
    expect(api).toHaveBeenCalledWith('/api/personality/set', expect.objectContaining({
      body: JSON.stringify({ session_id: 's1', name: 'witty' }),
    }))
    const content = vi.mocked(ctx.appendAssistant).mock.calls[0][0] as string
    expect(content).toContain(t('personality_set'))
    expect(content).toContain('witty')
  })

  it('/personality with no args lists available personalities', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('personality')!, '', ctx)).resolves.toBe(true)
    const content = vi.mocked(ctx.appendAssistant).mock.calls[0][0] as string
    expect(content).toContain(t('available_personalities'))
    expect(content).toContain('witty')
  })

  it('/skills lists skills grouped by category', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('skills')!, '', ctx)).resolves.toBe(true)
    const content = vi.mocked(ctx.appendAssistant).mock.calls[0][0] as string
    expect(content).toContain('debugging')
    expect(content).toContain('planning')
    expect(content).toContain('Engineering')
  })

  it('/skills filters by query', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('skills')!, 'debug', ctx)).resolves.toBe(true)
    const content = vi.mocked(ctx.appendAssistant).mock.calls[0][0] as string
    expect(content).toContain('debugging')
    expect(content).not.toContain('planning')
  })

  it('/use arms a forced-skill directive and toasts', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('use')!, 'debugging', ctx)).resolves.toBe(true)
    expect(getSkillContent).toHaveBeenCalledWith('debugging')
    const content = vi.mocked(ctx.appendAssistant).mock.calls[0][0] as string
    expect(content).toContain('debugging')
    expect(vi.mocked(ctx.toast).mock.calls[0][0]).toContain('debugging')
  })

  it('/use with an unknown skill reports it', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('use')!, 'nope', ctx)).resolves.toBe(true)
    const content = vi.mocked(ctx.appendAssistant).mock.calls[0][0] as string
    expect(content).toContain('nope')
  })

  it('/title with no args shows the current title', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('title')!, '', ctx)).resolves.toBe(true)
    const content = vi.mocked(ctx.appendAssistant).mock.calls[0][0] as string
    expect(content).toContain(t('title_current'))
    expect(content).toContain('Session A')
  })

  it('/title <name> renames the session', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('title')!, 'New Title', ctx)).resolves.toBe(true)
    expect(renameSession).toHaveBeenCalledWith('s1', 'New Title')
    expect(ctx.toast).toHaveBeenCalledWith(`${t('title_set')} "New Title"`)
    const content = vi.mocked(ctx.appendAssistant).mock.calls[0][0] as string
    expect(content).toContain(t('title_set'))
  })

  it('/retry re-runs the last user message', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('retry')!, '', ctx)).resolves.toBe(true)
    expect(retryLast).toHaveBeenCalledWith('s1')
    expect(ctx.loadSession).toHaveBeenCalledWith('s1')
    expect(ctx.sendAsUser).toHaveBeenCalledWith('hello')
  })

  it('/undo removes the last exchange and toasts the count', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('undo')!, '', ctx)).resolves.toBe(true)
    expect(undoLast).toHaveBeenCalledWith('s1')
    expect(ctx.loadSession).toHaveBeenCalledWith('s1')
    expect(vi.mocked(ctx.toast).mock.calls[0][0]).toContain(t('undid_n_messages'))
    expect(vi.mocked(ctx.toast).mock.calls[0][0]).toContain('2')
  })

  it('/queue with no message toasts usage', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('queue')!, '', ctx)).resolves.toBe(true)
    expect(ctx.toast).toHaveBeenCalledWith(t('cmd_queue_no_msg'))
  })

  it('/queue while idle sends like a normal message', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('queue')!, 'do the thing', ctx)).resolves.toBe(true)
    expect(ctx.sendAsUser).toHaveBeenCalledWith('do the thing')
  })

  it('/queue while busy persists to the session queue', async () => {
    const ctx = makeCtx({ busy: true, streamId: 'st-1' })
    await expect(runSlashCommand(getCommand('queue')!, 'do the thing', ctx)).resolves.toBe(true)
    expect(ctx.sendAsUser).not.toHaveBeenCalled()
    expect(getQueuedSessionCount('s1')).toBe(1)
    expect(shiftQueuedSessionMessage('s1')).toMatchObject({ text: 'do the thing' })
    expect(ctx.toast).toHaveBeenCalledWith(t('cmd_queue_confirm'))
  })

  it('/interrupt while idle sends like a normal message', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('interrupt')!, 'new msg', ctx)).resolves.toBe(true)
    expect(ctx.sendAsUser).toHaveBeenCalledWith('new msg')
    expect(ctx.cancelStream).not.toHaveBeenCalled()
  })

  it('/interrupt while busy queues then cancels', async () => {
    const ctx = makeCtx({ busy: true, streamId: 'st-1' })
    await expect(runSlashCommand(getCommand('interrupt')!, 'new msg', ctx)).resolves.toBe(true)
    expect(getQueuedSessionCount('s1')).toBe(1)
    expect(shiftQueuedSessionMessage('s1')).toMatchObject({ text: 'new msg' })
    expect(ctx.cancelStream).toHaveBeenCalled()
    expect(ctx.toast).toHaveBeenCalledWith(t('cmd_interrupt_confirm'))
  })

  it('/steer while idle sends like a normal message', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('steer')!, 'careful now', ctx)).resolves.toBe(true)
    expect(ctx.sendAsUser).toHaveBeenCalledWith('careful now')
    expect(steerChat).not.toHaveBeenCalled()
  })

  it('/steer while busy delivers via the steer endpoint', async () => {
    const ctx = makeCtx({ busy: true, streamId: 'st-1' })
    await expect(runSlashCommand(getCommand('steer')!, 'careful now', ctx)).resolves.toBe(true)
    expect(steerChat).toHaveBeenCalledWith('s1', 'careful now')
    expect(ctx.toast).toHaveBeenCalledWith(t('cmd_steer_delivered'))
  })

  it('/steer failure restores the draft and toasts the fallback', async () => {
    vi.mocked(steerChat).mockResolvedValue({ accepted: false, fallback: 'agent_lacks_steer', stream_id: null })
    const ctx = makeCtx({ busy: true, streamId: 'st-1' })
    await expect(runSlashCommand(getCommand('steer')!, 'careful now', ctx)).resolves.toBe(true)
    expect(ctx.setDraft).toHaveBeenCalledWith('/steer careful now')
    expect(ctx.toast).toHaveBeenCalledWith(t('steer_fail_agent_lacks_steer'))
  })

  it('/steer with no message toasts usage', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('steer')!, '', ctx)).resolves.toBe(true)
    expect(ctx.toast).toHaveBeenCalledWith(t('cmd_steer_no_msg'))
  })

  it('/btw asks a side question via the api', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('btw')!, 'what time is it?', ctx)).resolves.toBe(true)
    expect(api).toHaveBeenCalledWith('/api/btw', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ session_id: 's1', question: 'what time is it?' }),
    }))
    expect(ctx.toast).toHaveBeenCalledWith(t('btw_asking'))
  })

  it('/background starts a background task via the api', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('background')!, 'run the tests', ctx)).resolves.toBe(true)
    expect(api).toHaveBeenCalledWith('/api/background', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ session_id: 's1', prompt: 'run the tests' }),
    }))
    expect(ctx.toast).toHaveBeenCalledWith(t('bg_running'))
  })

  it('/status appends a session status message', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('status')!, '', ctx)).resolves.toBe(true)
    const content = vi.mocked(ctx.appendAssistant).mock.calls[0][0] as string
    expect(content).toContain(t('status_heading'))
    expect(content).toContain('s1')
    expect(content).toContain('gpt-4o')
  })

  it('/voice toggles the mic when available', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('voice')!, '', ctx)).resolves.toBe(true)
    expect(ctx.toggleMic).toHaveBeenCalled()
  })

  it('/voice falls back to a hint toast when mic is unavailable', async () => {
    const ctx = makeCtx({ micAvailable: false })
    await expect(runSlashCommand(getCommand('voice')!, '', ctx)).resolves.toBe(true)
    expect(ctx.toggleMic).not.toHaveBeenCalled()
    expect(ctx.toast).toHaveBeenCalledWith(t('cmd_voice_use_mic'))
  })

  it('/reasoning with no args shows the current status', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('reasoning')!, '', ctx)).resolves.toBe(true)
    expect(api).toHaveBeenCalledWith('/api/reasoning', expect.objectContaining({ credentials: 'include' }))
    expect(vi.mocked(ctx.toast).mock.calls[0][0]).toContain('medium')
  })

  it('/reasoning show persists display via /api/reasoning and settings', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('reasoning')!, 'show', ctx)).resolves.toBe(true)
    expect(api).toHaveBeenCalledWith('/api/reasoning', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ display: 'show' }),
    }))
    expect(updateSettings).toHaveBeenCalledWith({ show_thinking: true })
  })

  it('/reasoning high persists the effort', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('reasoning')!, 'high', ctx)).resolves.toBe(true)
    expect(api).toHaveBeenCalledWith('/api/reasoning', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ effort: 'high' }),
    }))
  })

  it('/yolo toggles session yolo state', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('yolo')!, '', ctx)).resolves.toBe(true)
    expect(api).toHaveBeenCalledWith('/api/session/yolo?session_id=s1', expect.objectContaining({ credentials: 'include' }))
    expect(api).toHaveBeenCalledWith('/api/session/yolo', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ session_id: 's1', enabled: true }),
    }))
    expect(ctx.toast).toHaveBeenCalledWith(t('yolo_enabled'))
  })

  it('/branch forks the session and loads the fork', async () => {
    const ctx = makeCtx({ loadSession: vi.fn(async () => ({ ...session, session_id: 'fork-1' })) })
    await expect(runSlashCommand(getCommand('branch')!, 'My Fork', ctx)).resolves.toBe(true)
    expect(branchSession).toHaveBeenCalledWith('s1', { title: 'My Fork' })
    expect(ctx.loadSession).toHaveBeenCalledWith('fork-1')
    expect(ctx.toast).toHaveBeenCalledWith(t('branch_forked'))
  })

  it('/compress starts a manual compression and reloads the session', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('compress')!, 'focus topic', ctx)).resolves.toBe(true)
    expect(api).toHaveBeenCalledWith('/api/session/compress/start', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ session_id: 's1', focus_topic: 'focus topic' }),
    }))
    expect(ctx.loadSession).toHaveBeenCalledWith('s1')
  })

  it('/compact is an alias for /compress', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('compact')!, '', ctx)).resolves.toBe(true)
    expect(api).toHaveBeenCalledWith('/api/session/compress/start', expect.objectContaining({
      body: JSON.stringify({ session_id: 's1' }),
    }))
  })

  it('/goal posts to /api/goal and surfaces the translated message', async () => {
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('goal')!, 'fix bugs', ctx)).resolves.toBe(true)
    expect(api).toHaveBeenCalledWith('/api/goal', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"args":"fix bugs"'),
    }))
    const content = vi.mocked(ctx.appendAssistant).mock.calls[0][0] as string
    expect(content).toContain('Goal set')
    expect(content).toContain('fix bugs')
  })

  it('/goal kickoff attaches the returned stream', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/api/goal') {
        return { message: 'Goal set', message_key: 'goal_set', message_args: [5, 'g'], stream_id: 'goal-1', pending_started_at: 1 }
      }
      throw new Error(`unexpected api call: ${path}`)
    })
    const ctx = makeCtx()
    await expect(runSlashCommand(getCommand('goal')!, 'fix bugs', ctx)).resolves.toBe(true)
    expect(ctx.attachStream).toHaveBeenCalledWith('s1', 'goal-1')
    expect(ctx.setBusy).toHaveBeenCalledWith(true)
  })
})

describe('activeSlashOffset', () => {
  it('finds a slash at the start of the text', () => {
    expect(activeSlashOffset('/help')).toBe(0)
  })

  it('finds a slash after whitespace (token-initial)', () => {
    expect(activeSlashOffset('hello /help')).toBe(6)
  })

  it('rejects multi-line text and ~/ paths', () => {
    expect(activeSlashOffset('line1\n/help')).toBe(-1)
    expect(activeSlashOffset('~/path')).toBe(-1)
  })

  it('rejects mid-word slashes (URLs, model ids)', () => {
    expect(activeSlashOffset('openrouter/deepseek')).toBe(-1)
  })
})

describe('getSlashAutocompleteMatches', () => {
  it('returns prefix-matched commands for a partial name', async () => {
    const matches = await getSlashAutocompleteMatches('/mo')
    const names = matches.map((m) => (m.kind === 'command' ? m.name : m.value))
    expect(names).toContain('model')
    expect(names).toContain('model')
    expect(matches.filter((m) => m.kind === 'command').every((m) => m.kind === 'command')).toBe(true)
  })

  it('returns no matches for text without an active slash', async () => {
    expect(await getSlashAutocompleteMatches('hello')).toEqual([])
  })

  it('returns subarg options after a space for model', async () => {
    const matches = await getSlashAutocompleteMatches('/model gpt')
    expect(matches).toEqual([
      { kind: 'subarg', parent: 'model', value: 'gpt-4o', desc: expect.any(String) },
    ])
  })

  it('returns subarg options for personality including the none sentinel', async () => {
    const matches = await getSlashAutocompleteMatches('/personality ')
    const values = matches.map((m) => (m.kind === 'subarg' ? m.value : ''))
    expect(values).toContain('none')
    expect(values).toContain('witty')
  })

  it('returns literal subargs for goal and reasoning', async () => {
    const goal = await getSlashAutocompleteMatches('/goal pa')
    expect(goal.map((m) => (m.kind === 'subarg' ? m.value : ''))).toEqual(['pause'])
    const reasoning = await getSlashAutocompleteMatches('/reasoning h')
    expect(reasoning.map((m) => (m.kind === 'subarg' ? m.value : ''))).toEqual(['hide', 'high'])
  })

  it('returns skill names for /use', async () => {
    const matches = await getSlashAutocompleteMatches('/use debug')
    expect(matches.map((m) => (m.kind === 'subarg' ? m.value : ''))).toEqual(['debugging'])
  })

  it('keeps the leading prefix for completion (mid-line slash)', async () => {
    const matches = await getSlashAutocompleteMatches('hi there /mod')
    expect(matches.filter((m) => m.kind === 'command').map((m) => (m.kind === 'command' ? m.name : ''))).toContain('model')
  })
})

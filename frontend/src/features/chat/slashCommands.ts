import { api } from '@/api/client'
import { steerChat } from '@/api/chat'
import { getModels, type ModelsCatalog } from '@/api/models'
import { getSkillContent, getSkills, updateSettings, type SkillSummary } from '@/api/panels'
import { branchSession, renameSession, retryLast, undoLast, updateSession } from '@/api/sessions'
import { getWorkspaces } from '@/api/workspace'
import { t } from '@/i18n'
import { LEGACY_THEME_MAP, SKINS, THEME_MODES, normalizeAppearance, type ThemeMode } from '@/theme/skins'
import type { Message, Session } from './chatStore'
import { queueSessionMessage } from './queue'

/**
 * Slash command registry (plan Task 8.7).
 *
 * Ports the legacy `static/commands.js` contract verbatim:
 *  - `COMMANDS` is the authoritative 28-entry dispatch table. `noEcho:true`
 *    commands are action-only — the composer must NOT echo them as a user
 *    message (#840); commands without `noEcho` DO get a user echo.
 *  - `parseCommand()` returns `{name, args}` for '/'-prefixed text, else null.
 *  - `runSlashCommand()` resolves `false` when the handler opts out (the
 *    caller falls through to the normal send path), `true` when handled.
 *  - Autocomplete (`getSlashAutocompleteMatches`) ports the legacy dropdown:
 *    prefix-matched commands first, then sub-arg completion from the live
 *    model/personality/skill catalogs and the literal sub-arg lists.
 *
 * Command bodies map onto the existing React clients and store seams:
 * chatStore (loadSession/newSession/sendMessage/cancelStream), @/api/sessions
 * (retryLast/undoLast/branchSession/renameSession/updateSession), @/api/chat
 * (steerChat), @/api/models (catalog), @/api/panels (skills/settings),
 * @/api/workspace (workspace catalog), plus context seams supplied by the
 * Composer (theme, terminal, mic, queue, stream attach, toasts).
 */

// ── Types ───────────────────────────────────────────────────────────────────

/** One autocomplete row. */
export type SlashMatch =
  | { kind: 'command'; name: string; desc: string; arg?: string }
  | { kind: 'subarg'; parent: string; value: string; desc: string }

/** Runtime seams the command handlers need (supplied by the Composer). */
export interface SlashCommandContext {
  session: Session | null
  busy: boolean
  streamId: string | null
  messages: Message[]
  sessionId: string | null

  /** Append an assistant message to the transcript (no echo semantics handled by the caller). */
  appendAssistant(content: string): void
  /** Replace the whole transcript (e.g. /clear). */
  replaceMessages(messages: Message[]): void
  setSession(session: Session | null): void
  setBusy(busy: boolean): void
  setStreamId(streamId: string | null): void
  /** Restore the composer draft (steer failure recovery). */
  setDraft(text: string): void
  newSession(): Promise<Session | null>
  loadSession(sid: string): Promise<Session | null>
  /** Send a message through the normal chat path (queue/interrupt/steer idle fallbacks, /retry). */
  sendAsUser(text: string): Promise<void>
  cancelStream(): Promise<void>
  /** Attach an SSE stream to a session (goal kickoff, btw). */
  attachStream(sid: string, streamId: string): void
  getTheme(): { theme: ThemeMode; skin: string }
  setTheme(theme: ThemeMode): void
  setSkin(skin: string): void
  openTerminal(): void
  micAvailable: boolean
  toggleMic(): void
  toast(message: string): void
  toastError(message: string): void
}

export interface SlashCommand {
  name: string
  desc: string
  arg?: string
  subArgs?: string | string[]
  noEcho?: boolean
  run: (args: string, ctx: SlashCommandContext) => boolean | Promise<boolean>
}

// ── parse ───────────────────────────────────────────────────────────────────

/** Port of static/commands.js `parseCommand`. */
export function parseCommand(text: string): { name: string; args: string } | null {
  if (!text.startsWith('/')) return null
  const parts = text.slice(1).split(/\s+/)
  const name = parts[0].toLowerCase()
  const args = parts.slice(1).join(' ').trim()
  return { name, args }
}

/** Find the offset of the slash that begins the active command token. */
export function activeSlashOffset(text: string): number {
  if (!text || text.indexOf('\n') !== -1) return -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '/') {
      if (i === 0) return i
      if (/\s/.test(text[i - 1])) {
        if (i + 1 < text.length && text[i + 1] === '~') continue
        return i
      }
    }
  }
  return -1
}

// ── helpers ─────────────────────────────────────────────────────────────────

function errorMessage(e: unknown): string {
  return e && typeof e === 'object' && 'message' in e
    ? String((e as { message: unknown }).message)
    : String(e ?? 'unknown error')
}

/** Resolve a translated goal/steer message from a server message_key payload. */
function translateServerMessage(
  raw: string | undefined,
  key: string | undefined,
  args: unknown[] | undefined,
): string {
  const fallback = String(raw ?? '').trim()
  if (fallback.includes('\n')) return fallback
  if (key) {
    const translated = String(t(key, ...(args ?? []).map((a) => String(a))))
    if (translated && translated !== key) return translated
  }
  return fallback
}

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const REASONING_DISPLAY = ['show', 'hide', 'on', 'off']

// ── /model resolution (ported from static/commands.js #3368) ────────────────

function looksLikeVersionedModel(query: string): boolean {
  return /\d$/.test(String(query || ''))
}

function buildModelCandidates(catalog: ModelsCatalog | null): { value: string; textContent: string }[] {
  const options: { value: string; textContent: string }[] = []
  for (const group of catalog?.groups ?? []) {
    const push = (m: { id: string; label?: string } | undefined) => {
      if (!m || !m.id) return
      options.push({ value: m.id, textContent: m.label || m.id })
    }
    for (const m of group.models ?? []) push(m)
    for (const m of group.extra_models ?? []) push(m)
  }
  return options
}

function bestModelMatch(options: { value: string; textContent: string }[], query: string): string | null {
  let best: string | null = null
  const versioned = looksLikeVersionedModel(query)
  for (const opt of options) {
    const value = opt.value.toLowerCase()
    const text = opt.textContent.toLowerCase()
    if (value === query || text === query) return opt.value
    if (value.includes(query) || text.includes(query)) {
      if (versioned) {
        const idx = value.indexOf(query)
        const after = idx >= 0 ? value.charAt(idx + query.length) : ''
        if (after && after !== '.' && !/\d/.test(after)) continue
      }
      if (best === null || opt.value.length < best.length) best = opt.value
    }
  }
  return best
}

function nearestModelSuggestion(options: { value: string; textContent: string }[], query: string): string {
  let suggestion = ''
  for (const opt of options) {
    if (opt.value.toLowerCase().includes(query)) {
      if (!suggestion || opt.value.length < suggestion.length) suggestion = opt.value
    }
  }
  return suggestion
}

let modelsCatalogCache: ModelsCatalog | null = null
let modelsCatalogPromise: Promise<ModelsCatalog | null> | null = null

async function loadModelsCatalog(): Promise<ModelsCatalog | null> {
  if (modelsCatalogCache) return modelsCatalogCache
  if (modelsCatalogPromise) return modelsCatalogPromise
  modelsCatalogPromise = getModels()
    .then((c) => {
      modelsCatalogCache = c
      return c
    })
    .catch(() => null)
    .finally(() => {
      modelsCatalogPromise = null
    })
  return modelsCatalogPromise
}

/** Invalidate the model catalog cache (provider list changed in settings). */
export function invalidateSlashModelCache(): void {
  modelsCatalogCache = null
}

// ── sub-arg option loaders (legacy `_getSlashSubArgOptions`) ────────────────

let personalityOptionsCache: string[] | null = null
let personalityOptionsPromise: Promise<string[]> | null = null

async function loadPersonalityOptions(): Promise<string[]> {
  if (personalityOptionsCache) return personalityOptionsCache
  if (personalityOptionsPromise) return personalityOptionsPromise
  personalityOptionsPromise = (async () => {
    try {
      const data = await api<{ personalities?: { name?: string }[] }>('/api/personalities', {
        credentials: 'include',
      })
      const values = ['none']
      for (const p of data?.personalities ?? []) {
        const name = String(p?.name ?? '').trim()
        if (name) values.push(name)
      }
      const deduped = Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
      personalityOptionsCache = deduped
      return deduped
    } catch {
      personalityOptionsCache = ['none']
      return ['none']
    } finally {
      personalityOptionsPromise = null
    }
  })()
  return personalityOptionsPromise
}

let skillOptionsCache: string[] | null = null
let skillOptionsPromise: Promise<string[]> | null = null

async function loadSkillOptions(): Promise<string[]> {
  if (skillOptionsCache) return skillOptionsCache
  if (skillOptionsPromise) return skillOptionsPromise
  skillOptionsPromise = (async () => {
    try {
      const data = await getSkills()
      const values = (data?.skills ?? []).map((s) => s.name)
      const deduped = Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
      skillOptionsCache = deduped
      return deduped
    } catch {
      skillOptionsCache = []
      return []
    } finally {
      skillOptionsPromise = null
    }
  })()
  return skillOptionsPromise
}

async function getSubArgOptions(spec: string | string[] | undefined): Promise<string[]> {
  if (Array.isArray(spec)) return spec.slice()
  if (spec === 'models') {
    const catalog = await loadModelsCatalog()
    return buildModelCandidates(catalog).map((o) => o.value)
  }
  if (spec === 'personalities') return loadPersonalityOptions()
  if (spec === 'skills') return loadSkillOptions()
  return []
}

// ── /use forced-skill directive (legacy `_forcedSkillDirectivePending`) ─────

export interface ForcedSkillDirective {
  name: string
  directive: string
  content: string
}

let forcedSkillPending: { sessionId: string | null; promise: Promise<ForcedSkillDirective | null> } | null = null

/**
 * Consume (and clear) a pending forced-skill directive for the session that
 * is about to send. The composer calls this before `sendMessage()` so the
 * directive text is prepended to the user turn — mirroring the legacy send()
 * `_forcedSkillDirectivePending` await.
 */
export function consumeForcedSkillDirective(sessionId: string): Promise<ForcedSkillDirective | null> {
  const pending = forcedSkillPending
  if (!pending) return Promise.resolve(null)
  if (pending.sessionId && pending.sessionId !== sessionId) return Promise.resolve(null)
  forcedSkillPending = null
  return pending.promise
}

// ── command handlers (ported from static/commands.js) ───────────────────────

function cmdHelp(_args: string, ctx: SlashCommandContext): boolean {
  const lines = COMMANDS.map((c) => {
    const usage = c.arg
      ? String(c.arg).startsWith('[')
        ? ` ${c.arg}`
        : ` <${c.arg}>`
      : ''
    return `  /${c.name}${usage} — ${c.desc}`
  })
  ctx.appendAssistant(`${t('available_commands')}\n${lines.join('\n')}`)
  ctx.toast(t('type_slash'))
  return true
}

function cmdClear(_args: string, ctx: SlashCommandContext): boolean {
  if (!ctx.session) return true
  ctx.replaceMessages([])
  ctx.toast(t('conversation_cleared'))
  return true
}

async function runManualCompression(ctx: SlashCommandContext, focusTopic: string): Promise<boolean> {
  const sid = ctx.sessionId
  if (!sid) {
    ctx.toast(t('no_active_session'))
    return true
  }
  ctx.toast(t('compressing'))
  try {
    const body: Record<string, string> = { session_id: sid }
    if (focusTopic) body.focus_topic = focusTopic
    const started = await api<{ status?: string; error?: string; session?: Session | null }>(
      '/api/session/compress/start',
      { method: 'POST', credentials: 'include', body: JSON.stringify(body) },
    )
    if (started && started.status === 'error') {
      throw new Error(started.error || 'Compression failed')
    }
    let data = started
    if (!data || data.status !== 'done') {
      // Poll the compression job (legacy `_pollManualCompressionResult`).
      let delay = 700
      for (;;) {
        const status = await api<{ status?: string; error?: string; session?: Session | null }>(
          `/api/session/compress/status?session_id=${encodeURIComponent(sid)}`,
          { credentials: 'include' },
        )
        if (status && status.status === 'done') {
          data = status
          break
        }
        if (status && status.status === 'error') throw new Error(status.error || 'Compression failed')
        if (status && status.status === 'idle') throw new Error('Compression job is no longer available')
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay = Math.min(2000, delay + 300)
      }
    }
    await ctx.loadSession(sid)
  } catch (e) {
    ctx.toast(`Compression failed: ${errorMessage(e)}`)
  }
  return true
}

function cmdCompress(args: string, ctx: SlashCommandContext): Promise<boolean> {
  return runManualCompression(ctx, (args || '').trim())
}

function cmdCompact(args: string, ctx: SlashCommandContext): Promise<boolean> {
  return runManualCompression(ctx, (args || '').trim())
}

async function cmdModel(args: string, ctx: SlashCommandContext): Promise<boolean> {
  if (!args) {
    ctx.toast(t('model_usage'))
    return true
  }
  const sid = ctx.sessionId
  let q = args.toLowerCase()
  const catalog = await loadModelsCatalog()
  // Resolve aliases from config.yaml model.aliases first (legacy #3368).
  const aliases = catalog?.aliases ?? {}
  for (const [alias, modelId] of Object.entries(aliases)) {
    if (alias.toLowerCase() === q) {
      q = String(modelId).toLowerCase()
      break
    }
  }
  const candidates = buildModelCandidates(catalog)
  // Exact/shortest fuzzy match across the FULL catalog (featured + extras).
  let match = bestModelMatch(candidates, q)
  // Provider-qualified id ("provider/model"): try the bare model name, then
  // the cross-provider direct-update path when nothing near it exists.
  if (!match && q.includes('/')) {
    const bare = q.slice(q.lastIndexOf('/') + 1)
    match = bestModelMatch(candidates, bare)
    const nearSuggestion = nearestModelSuggestion(candidates, q) || nearestModelSuggestion(candidates, bare)
    const versionedNoSnap = looksLikeVersionedModel(bare) && nearSuggestion !== ''
    if (!match && !versionedNoSnap && sid) {
      const provider = q.slice(0, q.indexOf('/'))
      try {
        await updateSession({ session_id: sid, model: q, model_provider: provider })
        ctx.toast(t('switched_to') + q)
        return true
      } catch {
        // fall through to "no model match"
      }
    }
  }
  if (!match) {
    let msg = t('no_model_match') + `${args}"`
    const suggestion = nearestModelSuggestion(candidates, q)
    if (suggestion) msg += t('model_did_you_mean', suggestion)
    ctx.toast(msg)
    return true
  }
  if (sid) {
    try {
      await updateSession({ session_id: sid, model: match })
    } catch (e) {
      ctx.toastError(t('failed_colon') + errorMessage(e))
      return true
    }
  }
  ctx.toast(t('switched_to') + match)
  return true
}

async function cmdWorkspace(args: string, ctx: SlashCommandContext): Promise<boolean> {
  if (!args) {
    ctx.toast(t('workspace_usage'))
    return true
  }
  if (ctx.busy) {
    ctx.toast(t('workspace_busy_switch'))
    return true
  }
  const sid = ctx.sessionId
  try {
    const data = await getWorkspaces()
    const q = args.toLowerCase()
    const ws = (data?.workspaces ?? []).find(
      (w) =>
        (w.name ?? '').toLowerCase().includes(q) ||
        (w.path ?? '').toLowerCase().includes(q),
    )
    if (!ws) {
      ctx.toast(`${t('no_workspace_match')}"${args}"`)
      return true
    }
    if (sid) {
      await updateSession({ session_id: sid, workspace: ws.path })
      if (ctx.session) ctx.setSession({ ...ctx.session, workspace: ws.path })
    }
    ctx.toast(t('switched_workspace') + (ws.name || ws.path))
  } catch (e) {
    ctx.toast(t('workspace_switch_failed') + errorMessage(e))
  }
  return true
}

async function cmdTerminal(_args: string, ctx: SlashCommandContext): Promise<boolean> {
  let data = null
  try {
    data = await getWorkspaces()
    if (data && data.terminal_remote_backend) {
      ctx.toast(t('terminal_remote_backend_unsupported'))
      return true
    }
  } catch {
    // fall through: local backend assumed
  }
  let session = ctx.session
  if (!session) {
    session = await ctx.newSession()
    if (!session) return true
  }
  if (!session.workspace) {
    ctx.toast(t('terminal_no_workspace_title'))
    return true
  }
  ctx.openTerminal()
  return true
}

async function cmdNew(_args: string, ctx: SlashCommandContext): Promise<boolean> {
  const session = await ctx.newSession()
  if (session) ctx.toast(t('new_session'))
  return true
}

/** /usage toggle state — ported from legacy `window._showTokenUsage`. */
let showTokenUsage = false

async function cmdUsage(_args: string, ctx: SlashCommandContext): Promise<boolean> {
  const next = !showTokenUsage
  showTokenUsage = next
  try {
    await updateSettings({ show_token_usage: next })
  } catch {
    // non-critical, mirror legacy
  }
  ctx.toast(next ? t('token_usage_on') : t('token_usage_off'))
  return true
}

async function cmdTheme(args: string, ctx: SlashCommandContext): Promise<boolean> {
  const themes = [...THEME_MODES]
  const skins = SKINS.map((s) => s.id)
  const legacyThemes = Object.keys(LEGACY_THEME_MAP)
  const val = (args || '').toLowerCase().trim()
  if ((themes as readonly string[]).includes(val) || legacyThemes.includes(val)) {
    const current = ctx.getTheme()
    const appearance = normalizeAppearance(val, legacyThemes.includes(val) ? null : current.skin)
    ctx.setTheme(appearance.theme)
    ctx.setSkin(appearance.skin)
    ctx.toast(t('theme_set') + appearance.theme + (legacyThemes.includes(val) ? ` + ${appearance.skin}` : ''))
    return true
  }
  if (skins.includes(val)) {
    const current = ctx.getTheme()
    const appearance = normalizeAppearance(current.theme, val)
    ctx.setTheme(appearance.theme)
    ctx.setSkin(appearance.skin)
    ctx.toast(t('theme_set') + appearance.skin)
    return true
  }
  ctx.toast(t('theme_usage') + themes.join('|') + ' | ' + skins.join('|') + ' | legacy:' + legacyThemes.join('|'))
  return true
}

async function cmdPersonality(args: string, ctx: SlashCommandContext): Promise<boolean> {
  const sid = ctx.sessionId
  if (!sid) {
    ctx.toast(t('no_active_session'))
    return true
  }
  if (!args) {
    try {
      const data = await api<{ personalities?: { name?: string; description?: string }[] }>('/api/personalities', {
        credentials: 'include',
      })
      const list = (data?.personalities ?? [])
        .map((p) => `  **${p.name ?? ''}**${p.description ? ' — ' + p.description : ''}`)
        .join('\n')
      if (!list) {
        ctx.toast(t('no_personalities'))
        return true
      }
      ctx.appendAssistant(`${t('available_personalities')}\n\n${list}${t('personality_switch_hint')}`)
    } catch {
      ctx.toast(t('personalities_load_failed'))
    }
    return true
  }
  const name = args.trim()
  if (['none', 'default', 'clear'].includes(name.toLowerCase())) {
    try {
      await api('/api/personality/set', {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ session_id: sid, name: '' }),
      })
      ctx.toast(t('personality_cleared'))
    } catch (e) {
      ctx.toast(t('failed_colon') + errorMessage(e))
    }
    return true
  }
  try {
    await api('/api/personality/set', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ session_id: sid, name }),
    })
    ctx.appendAssistant(t('personality_set') + `**${name}**`)
    ctx.toast(t('personality_set') + name)
  } catch (e) {
    ctx.toast(t('failed_colon') + errorMessage(e))
  }
  return true
}

function formatSkillList(skills: SkillSummary[], args: string): string {
  let filtered = skills
  if (args) {
    const q = args.toLowerCase()
    filtered = skills.filter(
      (s) =>
        (s.name ?? '').toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (s.category ?? '').toLowerCase().includes(q),
    )
  }
  if (filtered.length === 0) {
    return args ? `No skills matching "${args}".` : 'No skills found.'
  }
  const byCategory = new Map<string, SkillSummary[]>()
  for (const s of filtered) {
    const cat = s.category || 'General'
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), s])
  }
  const lines: string[] = []
  for (const [cat, items] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`**${cat}**`)
    for (const s of items) {
      const desc = s.description
        ? ` — ${s.description.slice(0, 80)}${s.description.length > 80 ? '...' : ''}`
        : ''
      lines.push(`  \`${s.name}\`${desc}`)
    }
    lines.push('')
  }
  const header = args
    ? `Skills matching "${args}" (${filtered.length}):\n\n`
    : `Available skills (${filtered.length}):\n\n`
  return header + lines.join('\n')
}

async function cmdSkills(args: string, ctx: SlashCommandContext): Promise<boolean> {
  try {
    const data = await getSkills()
    ctx.appendAssistant(formatSkillList(data?.skills ?? [], args))
    ctx.toast(t('type_slash'))
  } catch (e) {
    ctx.toast('Failed to load skills: ' + errorMessage(e))
  }
  return true
}

async function cmdUse(args: string, ctx: SlashCommandContext): Promise<boolean> {
  if (!args) {
    ctx.appendAssistant('Usage: `/use <skill-name>` — forces the agent to consult that skill before its next response.')
    return true
  }
  const pending = { sessionId: ctx.sessionId, promise: null as unknown as Promise<ForcedSkillDirective | null> }
  pending.promise = new Promise<ForcedSkillDirective | null>((resolve) => {
    void (async () => {
      try {
        const data = await getSkills()
        const skills = data?.skills ?? []
        const match = skills.find((s) => (s.name ?? '').toLowerCase() === args.toLowerCase())
        if (!match) {
          resolve(null)
          ctx.appendAssistant(`No skill named \`${args}\`. Use \`/skills\` to see available skills.`)
          return
        }
        const detail = await getSkillContent(match.name)
        const skillContent =
          detail && typeof detail === 'object' && 'content' in detail && typeof detail.content === 'string'
            ? detail.content.trim()
            : ''
        if (!skillContent) throw new Error(`Skill \`${match.name}\` has no readable content.`)
        const directive = `[USER OVERRIDE] You MUST follow the skill '${match.name}' content provided below before responding to the next message.`
        resolve({ name: match.name, directive, content: skillContent })
        ctx.appendAssistant(`Next turn: skill \`${match.name}\` will be forced.`)
        ctx.toast(`Skill \`${match.name}\` will be used for next turn.`)
      } catch (e) {
        resolve(null)
        ctx.toast('Failed to load skills: ' + errorMessage(e))
      }
    })()
  })
  forcedSkillPending = pending
  return true
}

async function cmdStop(_args: string, ctx: SlashCommandContext): Promise<boolean> {
  if (!ctx.session) {
    ctx.toast(t('no_active_session'))
    return true
  }
  if (!ctx.streamId) {
    ctx.toast(t('no_active_task'))
    return true
  }
  try {
    await ctx.cancelStream()
    ctx.toast(t('stream_stopped'))
  } catch {
    ctx.toast(t('cancel_failed'))
  }
  return true
}

async function cmdGoal(args: string, ctx: SlashCommandContext): Promise<boolean> {
  const sid = ctx.sessionId
  if (!sid) {
    ctx.toast(t('no_active_session'))
    return true
  }
  try {
    const body: Record<string, unknown> = {
      session_id: sid,
      args: args || '',
      workspace: ctx.session?.workspace ?? '',
      model: ctx.session?.model ?? '',
      model_provider: ctx.session?.model_provider ?? null,
      profile: ctx.session?.profile ?? 'default',
    }
    const r = await api<{
      message?: string
      message_key?: string
      message_args?: unknown[]
      stream_id?: string
      pending_started_at?: number
      effective_model?: string
      effective_model_provider?: string
    }>('/api/goal', { method: 'POST', credentials: 'include', body: JSON.stringify(body) })
    const msg = translateServerMessage(r?.message, r?.message_key, r?.message_args)
    if (msg) {
      ctx.appendAssistant(msg)
      ctx.toast(msg.split('\n')[0])
    }
    if (!r || !r.stream_id) return true
    ctx.setBusy(true)
    ctx.setStreamId(r.stream_id)
    if (ctx.session) {
      const next = { ...ctx.session }
      if (typeof r.pending_started_at === 'number') next.pending_started_at = r.pending_started_at
      if (r.effective_model) next.model = r.effective_model
      if (r.effective_model_provider) next.model_provider = r.effective_model_provider
      ctx.setSession(next)
    }
    ctx.attachStream(sid, r.stream_id)
    ctx.toast(t('goal_working_toward'))
  } catch (e) {
    const err = String((e && typeof e === 'object' && 'message' in e ? e.message : e) ?? 'Goal command failed')
    ctx.appendAssistant(`**Goal command failed:** ${err}`)
    ctx.toast(err)
  }
  return true
}

async function cmdQueue(args: string, ctx: SlashCommandContext): Promise<boolean> {
  const msg = (args || '').trim()
  if (!msg) {
    ctx.toast(t('cmd_queue_no_msg'))
    return true
  }
  // If nothing is running, /queue <msg> just sends like a normal message.
  if (!ctx.busy) {
    await ctx.sendAsUser(msg)
    return true
  }
  const sid = ctx.sessionId
  if (!sid) {
    ctx.toast(t('no_active_session'))
    return true
  }
  queueSessionMessage(sid, {
    text: msg,
    model: ctx.session?.model ?? '',
    model_provider: ctx.session?.model_provider ?? '',
    profile: ctx.session?.profile ?? 'default',
  })
  ctx.toast(t('cmd_queue_confirm'))
  return true
}

async function cmdInterrupt(args: string, ctx: SlashCommandContext): Promise<boolean> {
  const msg = (args || '').trim()
  if (!msg) {
    ctx.toast(t('cmd_interrupt_no_msg'))
    return true
  }
  // If nothing is running, /interrupt <msg> just sends like a normal message.
  if (!ctx.busy || !ctx.streamId) {
    await ctx.sendAsUser(msg)
    return true
  }
  const sid = ctx.sessionId
  if (!sid) {
    ctx.toast(t('no_active_session'))
    return true
  }
  queueSessionMessage(sid, {
    text: msg,
    model: ctx.session?.model ?? '',
    model_provider: ctx.session?.model_provider ?? '',
    profile: ctx.session?.profile ?? 'default',
  })
  try {
    await ctx.cancelStream()
    ctx.toast(t('cmd_interrupt_confirm'))
  } catch {
    ctx.toast(t('cancel_failed'))
  }
  return true
}

function steerFailureKey(fallback: string | null | undefined): string {
  if (fallback === 'gateway_steer_queued') return 'steer_fail_no_cached_agent'
  const key = `steer_fail_${fallback || 'unknown'}`
  const known = [
    'steer_fail_no_cached_agent',
    'steer_fail_agent_lacks_steer',
    'steer_fail_session_not_found',
    'steer_fail_not_running',
    'steer_fail_stream_dead',
    'steer_fail_steer_error',
    'steer_fail_network_error',
    'steer_fail_unknown',
  ]
  return known.includes(key) ? key : 'steer_fail_unknown'
}

async function cmdSteer(args: string, ctx: SlashCommandContext): Promise<boolean> {
  const msg = (args || '').trim()
  if (!msg) {
    ctx.toast(t('cmd_steer_no_msg'))
    return true
  }
  // If nothing is running, /steer <msg> just sends like a normal message.
  if (!ctx.busy || !ctx.streamId) {
    await ctx.sendAsUser(msg)
    return true
  }
  const sid = ctx.sessionId
  if (!sid) {
    ctx.toast(t('no_active_session'))
    return true
  }
  let result: { accepted: boolean; fallback: string | null; stream_id: string | null }
  try {
    result = await steerChat(sid, msg)
  } catch {
    result = { accepted: false, fallback: 'network_error', stream_id: null }
  }
  if (result.accepted) {
    ctx.toast(t('cmd_steer_delivered'))
    return true
  }
  if (result.fallback === 'gateway_steer_queued') {
    queueSessionMessage(sid, {
      text: msg,
      model: ctx.session?.model ?? '',
      model_provider: ctx.session?.model_provider ?? '',
      profile: ctx.session?.profile ?? 'default',
    })
    ctx.toast(t('steer_leftover_queued'))
    return true
  }
  // Steer failure is not permission to cancel the active run: restore the
  // draft so the user can explicitly Queue or Interrupt next.
  ctx.setDraft(`/steer ${msg}`)
  ctx.toast(t(steerFailureKey(result.fallback)))
  return true
}

async function cmdTitle(args: string, ctx: SlashCommandContext): Promise<boolean> {
  const sid = ctx.sessionId
  if (!sid) {
    ctx.toast(t('no_active_session'))
    return true
  }
  const name = (args || '').trim()
  if (!name) {
    ctx.appendAssistant(
      `${t('title_current')}: **${ctx.session?.title || t('untitled')}**\n\n${t('title_change_hint')}`,
    )
    return true
  }
  try {
    const r = await renameSession(sid, name)
    const newTitle = (r?.session && (r.session as { title?: string }).title) || name
    if (ctx.session) ctx.setSession({ ...ctx.session, title: newTitle })
    ctx.toast(`${t('title_set')} "${newTitle}"`)
    ctx.appendAssistant(`${t('title_set')} **${newTitle}**`)
  } catch (e) {
    ctx.toast(t('failed_colon') + errorMessage(e))
  }
  return true
}

async function cmdRetry(_args: string, ctx: SlashCommandContext): Promise<boolean> {
  const sid = ctx.sessionId
  if (!sid) {
    ctx.toast(t('no_active_session'))
    return true
  }
  try {
    const r = await retryLast(sid)
    if (r && 'error' in r && r.error) {
      ctx.toast(String(r.error))
      return true
    }
    await ctx.loadSession(sid)
    const lastUserText = (r as { last_user_text?: string }).last_user_text
    if (lastUserText) await ctx.sendAsUser(lastUserText)
  } catch (e) {
    ctx.toast(t('retry_failed') + errorMessage(e))
  }
  return true
}

async function cmdUndo(_args: string, ctx: SlashCommandContext): Promise<boolean> {
  const sid = ctx.sessionId
  if (!sid) {
    ctx.toast(t('no_active_session'))
    return true
  }
  try {
    const r = await undoLast(sid)
    if (r && 'error' in r && r.error) {
      ctx.toast(String(r.error))
      return true
    }
    await ctx.loadSession(sid)
    const removed = (r as { removed_count?: number }).removed_count ?? 0
    ctx.toast(`↩ ${t('undid_n_messages')} ${removed} ${t('undid_messages_suffix')}`)
  } catch (e) {
    ctx.toast(t('undo_failed') + errorMessage(e))
  }
  return true
}

async function cmdBtw(args: string, ctx: SlashCommandContext): Promise<boolean> {
  const sid = ctx.sessionId
  if (!sid) {
    ctx.toast(t('no_active_session'))
    return true
  }
  const question = (args || '').trim()
  if (!question) {
    ctx.toast(t('cmd_btw_usage'))
    return true
  }
  ctx.toast(t('btw_asking'))
  try {
    const r = await api<{ stream_id?: string; parent_session_id?: string; error?: string }>('/api/btw', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ session_id: sid, question }),
    })
    if (r && r.error) {
      ctx.toast(r.error)
      return true
    }
    if (r && r.stream_id && r.parent_session_id) {
      ctx.attachStream(r.parent_session_id, r.stream_id)
    }
  } catch (e) {
    ctx.toast(t('btw_failed') + errorMessage(e))
  }
  return true
}

async function cmdBackground(args: string, ctx: SlashCommandContext): Promise<boolean> {
  const sid = ctx.sessionId
  if (!sid) {
    ctx.toast(t('no_active_session'))
    return true
  }
  const prompt = (args || '').trim()
  if (!prompt) {
    ctx.toast(t('cmd_background_usage'))
    return true
  }
  ctx.toast(t('bg_running'))
  try {
    const r = await api<{ task_id?: string; error?: string }>('/api/background', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ session_id: sid, prompt }),
    })
    if (r && r.error) {
      ctx.toast(r.error)
      return true
    }
    if (r && r.task_id) {
      // Background results surface via /api/background/status polling; the
      // badge/polling UI is owned by the host surface (Composer), which can
      // hook the task id when it becomes available.
      ctx.toast(t('bg_running'))
    }
  } catch (e) {
    ctx.toast(t('bg_failed') + errorMessage(e))
  }
  return true
}

function formatStatusTimestamp(value: unknown): string {
  if (value === undefined || value === null || value === '') return t('status_unknown')
  let date: Date
  if (typeof value === 'number') date = new Date(value < 1000000000000 ? value * 1000 : value)
  else date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return t('status_unknown')
  return date.toLocaleString()
}

function formatStatusTokens(s: Session): string {
  const input = Number(s.input_tokens ?? 0) || 0
  const output = Number(s.output_tokens ?? 0) || 0
  const total = Number(s.total_tokens ?? (input + output)) || 0
  const cost = Number(s.estimated_cost ?? 0) || 0
  if (!total && !cost) return t('status_no_tokens')
  const fmtNum = (n: number) => Number(n || 0).toLocaleString()
  return `${fmtNum(input)} in / ${fmtNum(output)} out${cost ? ` (~$${cost.toFixed(4)})` : ''}`
}

function cmdStatus(_args: string, ctx: SlashCommandContext): boolean {
  const s = ctx.session
  if (!s) {
    ctx.toast(t('no_active_session'))
    return true
  }
  const provider = s.model_provider ?? (String(s.model ?? '').includes('/') ? String(s.model).split('/')[0] : '')
  const model = s.model || t('usage_default_model')
  const running = Boolean(ctx.busy || ctx.streamId || s.active_stream_id)
  const rows = [
    [t('status_session_id'), s.session_id || t('status_unknown')],
    [t('status_title'), s.title || t('untitled')],
    [t('status_model'), model],
    [t('status_provider'), provider || t('status_unknown')],
    [t('status_profile'), s.profile || 'default'],
    [t('status_workspace'), s.workspace || t('status_unknown')],
    [t('status_personality'), s.personality || t('usage_personality_none')],
    [t('status_started'), formatStatusTimestamp(s.created_at)],
    [t('status_updated'), formatStatusTimestamp(s.updated_at ?? s.last_message_at)],
    [t('status_tokens'), formatStatusTokens(s)],
    [t('status_messages'), String(s.message_count ?? ctx.messages.filter((m) => m && m.role && m.role !== 'tool').length)],
    [t('status_agent_running'), running ? t('status_yes') : t('status_no')],
  ]
  const lines = rows.map(([label, value]) => `- **${label}**: ${value}`)
  ctx.appendAssistant(`${t('status_heading')}\n\n${lines.join('\n')}`)
  return true
}

function cmdVoice(_args: string, ctx: SlashCommandContext): boolean {
  if (ctx.micAvailable) {
    ctx.toggleMic()
    return true
  }
  ctx.toast(t('cmd_voice_use_mic'))
  return true
}

function reasoningStatusText(st: { show_reasoning?: unknown; reasoning_effort?: unknown }): string {
  const vis = st && st.show_reasoning === false ? 'off' : 'on'
  const eff = (st && st.reasoning_effort) || 'default'
  return `🧠 Reasoning effort: ${eff} · display: ${vis}  |  /reasoning show|hide|none|minimal|low|medium|high|xhigh|max`
}

async function cmdReasoning(args: string, ctx: SlashCommandContext): Promise<boolean> {
  const arg = (args || '').trim().toLowerCase()
  if (!arg) {
    try {
      const st = await api<{ show_reasoning?: boolean; reasoning_effort?: string }>('/api/reasoning', {
        credentials: 'include',
      })
      ctx.toast(reasoningStatusText(st ?? {}))
    } catch {
      ctx.toast('🧠 /reasoning — status unavailable')
    }
    return true
  }
  if (REASONING_DISPLAY.includes(arg)) {
    const on = arg === 'show' || arg === 'on'
    // Persist via /api/reasoning → config.yaml display.show_reasoning and
    // mirror into WebUI settings.json show_thinking (legacy behavior).
    api('/api/reasoning', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ display: arg }),
    }).catch(() => {})
    updateSettings({ show_thinking: on }).catch(() => {})
    ctx.toast(`🧠 Thinking blocks: ${on ? 'on' : 'off'} (saved)`)
    return true
  }
  if (REASONING_EFFORTS.includes(arg)) {
    try {
      const st = await api<{ reasoning_effort?: string }>('/api/reasoning', {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ effort: arg }),
      })
      const eff = (st && st.reasoning_effort) || arg
      ctx.toast(`🧠 Reasoning effort: ${eff} (saved; applies to next turn)`)
    } catch (e) {
      ctx.toast(`🧠 Failed to set effort: ${errorMessage(e)}`)
    }
    return true
  }
  ctx.toast(`Unknown argument: ${arg} — use show|hide|${REASONING_EFFORTS.join('|')}`)
  return true
}

async function cmdYolo(_args: string, ctx: SlashCommandContext): Promise<boolean> {
  const sid = ctx.sessionId
  if (!sid) {
    ctx.toast(t('yolo_no_session'))
    return true
  }
  try {
    const status = await api<{ yolo_enabled?: boolean }>(
      `/api/session/yolo?session_id=${encodeURIComponent(sid)}`,
      { credentials: 'include' },
    )
    const enable = !status?.yolo_enabled
    await api('/api/session/yolo', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ session_id: sid, enabled: enable }),
    })
    ctx.toast(enable ? t('yolo_enabled') : t('yolo_disabled'))
  } catch (e) {
    ctx.toast('YOLO: ' + errorMessage(e))
  }
  return true
}

async function cmdBranch(args: string, ctx: SlashCommandContext): Promise<boolean> {
  const sid = ctx.sessionId
  if (!sid) {
    ctx.toast(t('no_active_session'))
    return true
  }
  const customTitle = (args || '').trim() || undefined
  try {
    const data = await branchSession(sid, customTitle ? { title: customTitle } : {})
    if (data && data.session_id) {
      await ctx.loadSession(data.session_id)
      ctx.toast(t('branch_forked'))
    }
  } catch (e) {
    ctx.toast(t('branch_failed') + errorMessage(e))
  }
  return true
}

// ── registry (legacy COMMANDS table, order preserved) ───────────────────────

export const COMMANDS: SlashCommand[] = [
  { name: 'help', desc: t('cmd_help'), run: cmdHelp },
  { name: 'clear', desc: t('cmd_clear'), run: cmdClear, noEcho: true },
  { name: 'compress', desc: t('cmd_compress'), run: cmdCompress, arg: '[focus topic]', noEcho: true },
  { name: 'compact', desc: t('cmd_compact_alias'), run: cmdCompact, noEcho: true },
  { name: 'model', desc: t('cmd_model'), run: cmdModel, arg: 'model_name', subArgs: 'models', noEcho: true },
  { name: 'workspace', desc: t('cmd_workspace'), run: cmdWorkspace, arg: 'name', noEcho: true },
  { name: 'terminal', desc: t('cmd_terminal'), run: cmdTerminal, noEcho: true },
  { name: 'new', desc: t('cmd_new'), run: cmdNew, noEcho: true },
  { name: 'usage', desc: t('cmd_usage'), run: cmdUsage, noEcho: true },
  { name: 'theme', desc: t('cmd_theme'), run: cmdTheme, arg: 'name', noEcho: true },
  { name: 'personality', desc: t('cmd_personality'), run: cmdPersonality, arg: 'name', subArgs: 'personalities' },
  { name: 'skills', desc: t('cmd_skills'), run: cmdSkills, arg: 'query' },
  { name: 'use', desc: t('cmd_use'), run: cmdUse, arg: 'skill-name', subArgs: 'skills', noEcho: true },
  { name: 'stop', desc: t('cmd_stop'), run: cmdStop, noEcho: true },
  { name: 'goal', desc: t('cmd_goal'), run: cmdGoal, arg: '[status|pause|resume|clear|text]', subArgs: ['status', 'pause', 'resume', 'clear'] },
  { name: 'queue', desc: t('cmd_queue'), run: cmdQueue, arg: 'message', noEcho: true },
  { name: 'interrupt', desc: t('cmd_interrupt'), run: cmdInterrupt, arg: 'message', noEcho: true },
  { name: 'steer', desc: t('cmd_steer'), run: cmdSteer, arg: 'message', noEcho: true },
  { name: 'title', desc: t('cmd_title'), run: cmdTitle, arg: '[title]' },
  { name: 'retry', desc: t('cmd_retry'), run: cmdRetry, noEcho: true },
  { name: 'undo', desc: t('cmd_undo'), run: cmdUndo, noEcho: true },
  { name: 'btw', desc: t('cmd_btw'), run: cmdBtw, arg: 'question', noEcho: true },
  { name: 'background', desc: t('cmd_background'), run: cmdBackground, arg: 'prompt', noEcho: true },
  { name: 'status', desc: t('cmd_status'), run: cmdStatus },
  { name: 'voice', desc: t('cmd_voice'), run: cmdVoice, noEcho: true },
  { name: 'reasoning', desc: t('cmd_reasoning'), run: cmdReasoning, arg: 'show|hide|none|minimal|low|medium|high|xhigh|max', subArgs: ['show', 'hide', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], noEcho: true },
  { name: 'yolo', desc: t('cmd_yolo'), run: cmdYolo, noEcho: true },
  { name: 'branch', desc: t('cmd_branch'), run: cmdBranch, arg: '[name]', noEcho: true },
]

/** Find a command by exact name (legacy `COMMANDS.find`). */
export function getCommand(name: string): SlashCommand | undefined {
  return COMMANDS.find((c) => c.name === name)
}

/**
 * Run a command with parsed args. Returns true when the command handled the
 * text (the composer must NOT send it), false when the handler opted out (or
 * the command is unknown) and the caller must fall through to the normal send
 * path (legacy `executeCommand` returns null for unknown commands).
 */
export async function runSlashCommand(
  cmd: SlashCommand | undefined,
  args: string,
  ctx: SlashCommandContext,
): Promise<boolean> {
  if (!cmd) return false
  const result = await cmd.run(args, ctx)
  return result !== false
}

// ── autocomplete (legacy `getSlashAutocompleteMatches`) ─────────────────────

function getMatchingCommands(prefix: string): SlashMatch[] {
  const q = prefix.toLowerCase()
  return COMMANDS.filter((c) => c.name.startsWith(q)).map((c) => ({
    kind: 'command',
    name: c.name,
    desc: c.desc,
    ...(c.arg ? { arg: c.arg } : {}),
  }))
}

function parseSlashAutocomplete(text: string): { kind: 'commands'; query: string } | { kind: 'subargs'; command: SlashCommand; query: string } | null {
  const slashIdx = activeSlashOffset(text)
  if (slashIdx < 0) return null
  const raw = text.slice(slashIdx + 1)
  const hasSpace = /\s/.test(raw)
  const parts = raw.split(/\s+/)
  const cmdName = (parts[0] || '').toLowerCase()
  const command = getCommand(cmdName)
  if (!command) return { kind: 'commands', query: raw }
  if (!hasSpace || !command.subArgs) {
    return { kind: 'commands', query: raw }
  }
  const argText = raw.slice(cmdName.length).replace(/^\s+/, '')
  return { kind: 'subargs', command, query: argText.toLowerCase() }
}

/** Autocomplete matches for the textarea content (legacy dropdown contract). */
export async function getSlashAutocompleteMatches(text: string): Promise<SlashMatch[]> {
  const parsed = parseSlashAutocomplete(text)
  if (!parsed) return []
  if (parsed.kind === 'commands') return getMatchingCommands(parsed.query)
  const options = await getSubArgOptions(parsed.command.subArgs)
  return options
    .filter((opt) => String(opt).toLowerCase().startsWith(parsed.query))
    .map((opt) => ({
      kind: 'subarg' as const,
      parent: parsed.command.name,
      value: String(opt),
      desc: parsed.command.desc,
    }))
}

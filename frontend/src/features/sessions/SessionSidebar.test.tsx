import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import {
  archiveSession,
  duplicateSession,
  listSessions,
  pinSession,
  renameSession,
  searchSessions,
  type SidebarSessionRow,
} from '@/api/sessions'
import { getProjects } from '@/api/projects'
import { chatStore, messagesAtom, sessionAtom, type Session } from '@/features/chat/chatStore'
import { toast } from 'sonner'
import { SessionSidebar } from './SessionSidebar'

vi.mock('@/api/client', () => ({ api: vi.fn() }))
vi.mock('@/api/sessions', () => ({
  listSessions: vi.fn(),
  searchSessions: vi.fn(),
  renameSession: vi.fn(),
  duplicateSession: vi.fn(),
  pinSession: vi.fn(),
  archiveSession: vi.fn(),
}))
vi.mock('@/api/projects', () => ({ getProjects: vi.fn() }))
vi.mock('@/api/chat', () => ({
  startChat: vi.fn(),
  uploadFile: vi.fn(),
  cancelStream: vi.fn(),
  getStreamStatus: vi.fn(),
}))
vi.mock('@/api/sse', () => ({ openChatStream: vi.fn() }))
vi.mock('sonner', () => ({ toast: vi.fn() }))

/**
 * Fixed "server now" (epoch seconds). Bucketing is deterministic because rows
 * are expressed relative to it: updated_at === SERVER_TIME is always "today",
 * -3d is always inside "Last 7 days", and -30d is always "Older", no matter
 * which timezone the test runner is in.
 */
const SERVER_TIME = Math.floor(Date.UTC(2026, 7, 16, 12, 0, 0) / 1000)
const DAY = 86_400

/** Single source of truth shared by the listSessions mock and the api router. */
const serverSessions = new Map<string, SidebarSessionRow & { messages?: Session['messages'] }>()

function makeRow(id: string, overrides: Partial<SidebarSessionRow> = {}): SidebarSessionRow & { messages?: Session['messages'] } {
  return {
    session_id: id,
    title: `Session ${id}`,
    display_title: `Session ${id}`,
    _state_db_title: null,
    workspace: '/tmp',
    model: 'test-model',
    model_provider: null,
    message_count: 0,
    user_message_count: 0,
    created_at: SERVER_TIME - DAY,
    updated_at: SERVER_TIME,
    last_message_at: null,
    pinned: false,
    archived: false,
    project_id: null,
    profile: 'default',
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cache_hit_percent: null,
    personality: null,
    context_length: 0,
    config_context_length: 0,
    window_usage_percent: null,
    source_tag: 'webui',
    raw_source: 'webui',
    session_source: 'webui',
    source_label: null,
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
    _sidebar_reference_only: false,
    messages: [],
    ...overrides,
  }
}

function seed(...rows: Array<SidebarSessionRow & { messages?: Session['messages'] }>): void {
  serverSessions.clear()
  for (const row of rows) serverSessions.set(row.session_id, row)
}

function sortedRows(): Array<SidebarSessionRow & { messages?: Session['messages'] }> {
  return [...serverSessions.values()].sort((a, b) => b.updated_at - a.updated_at)
}

function mockListSessions(): void {
  vi.mocked(listSessions).mockImplementation(async () => ({
    sessions: sortedRows(),
    sidebar_reference_sessions: [],
    cli_count: 0,
    archived_count: 0,
    archived_webui_count: 0,
    archived_cli_count: 0,
    include_archived: true,
    all_profiles: false,
    active_profile: 'default',
    other_profile_count: 0,
    server_time: SERVER_TIME,
    server_tz: '+0000',
  }))
}

/** Minimal in-memory backend for the real chatStore (deleteSession / loadSession). */
function mockApiRouter(): void {
  vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/api/session?')) {
      const sid = new URL(path, 'http://localhost').searchParams.get('session_id') ?? ''
      return { session: serverSessions.get(sid) ?? null }
    }
    if (path === '/api/sessions') {
      return { sessions: sortedRows() }
    }
    if (path === '/api/session/delete') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { session_id?: string }
      if (body.session_id) serverSessions.delete(body.session_id)
      return { ok: true, state_db_cleanup_failed: false }
    }
    if (path === '/api/session/new') {
      throw new Error('deleteSession must NEVER call newSession (§5.6 rule 1)')
    }
    throw new Error(`unexpected api call: ${path}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  serverSessions.clear()
  chatStore.set(sessionAtom, null)
  chatStore.set(messagesAtom, [])
  mockListSessions()
  mockApiRouter()
  vi.mocked(getProjects).mockResolvedValue({
    projects: [{ project_id: 'p1', name: 'Alpha' }],
    all_profiles: false,
    active_profile: 'default',
    other_profile_count: 0,
  })
})

function renderSidebar(onSelect: (sid: string) => void = vi.fn()) {
  return render(<SessionSidebar onSelect={onSelect} />)
}

function group(id: string): HTMLElement {
  return screen.getByTestId(`group-${id}`)
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole('button', { name: `Actions for ${title}` }))
}

describe('SessionSidebar — groups and rows', () => {
  it('renders collapsible time groups with server-ordered rows', async () => {
    seed(
      makeRow('old', { updated_at: SERVER_TIME - 30 * DAY }),
      makeRow('week', { updated_at: SERVER_TIME - 3 * DAY }),
      makeRow('today', { updated_at: SERVER_TIME }),
      makeRow('pin', { pinned: true, updated_at: SERVER_TIME - 10 * DAY }),
    )
    renderSidebar()

    expect(await screen.findByTestId('group-pinned')).toBeInTheDocument()
    expect(group('pinned')).toHaveTextContent('Pinned')
    expect(within(group('pinned')).getByText('Session pin')).toBeInTheDocument()
    expect(within(group('today')).getByText('Session today')).toBeInTheDocument()
    expect(within(group('week')).getByText('Session week')).toBeInTheDocument()
    expect(within(group('older')).getByText('Session old')).toBeInTheDocument()
  })

  it('collapses and expands a group from its header', async () => {
    const user = userEvent.setup()
    seed(makeRow('today', { updated_at: SERVER_TIME }))
    renderSidebar()

    const header = await screen.findByRole('button', { name: /Today/ })
    expect(screen.getByTestId('session-row-today')).toBeInTheDocument()

    await user.click(header)
    expect(screen.queryByTestId('session-row-today')).not.toBeInTheDocument()

    await user.click(header)
    expect(screen.getByTestId('session-row-today')).toBeInTheDocument()
  })

  it('hides archived sessions behind a collapsed group by default', async () => {
    const user = userEvent.setup()
    seed(makeRow('arch', { archived: true, updated_at: SERVER_TIME - DAY }))
    renderSidebar()

    const header = await screen.findByRole('button', { name: /Archived/ })
    expect(screen.queryByTestId('session-row-arch')).not.toBeInTheDocument()

    await user.click(header)
    expect(screen.getByTestId('session-row-arch')).toBeInTheDocument()
  })

  it('emits onSelect with the session id when a row is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    seed(makeRow('a', { updated_at: SERVER_TIME }))
    renderSidebar(onSelect)

    const row = await screen.findByTestId('session-row-a')
    await user.click(within(row).getByRole('button', { name: 'Session a' }))
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('highlights the active session row', async () => {
    seed(makeRow('a', { updated_at: SERVER_TIME }), makeRow('b', { updated_at: SERVER_TIME - DAY }))
    chatStore.set(sessionAtom, { session_id: 'b', title: 'Session b', model: 'test-model', messages: [] })
    renderSidebar()

    const activeRow = await screen.findByTestId('session-row-b')
    expect(activeRow).toHaveAttribute('data-active', 'true')
    expect(within(activeRow).getByRole('button', { name: 'Session b' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByTestId('session-row-a')).not.toHaveAttribute('data-active')
  })

  it('shows a live indicator on streaming rows', async () => {
    seed(
      makeRow('stream', { is_streaming: true, updated_at: SERVER_TIME }),
      makeRow('stream2', { active_stream_id: 's2', updated_at: SERVER_TIME - DAY }),
      makeRow('idle', { updated_at: SERVER_TIME - 2 * DAY }),
    )
    renderSidebar()

    expect(await screen.findByTestId('streaming-indicator-stream')).toBeInTheDocument()
    expect(screen.getByTestId('streaming-indicator-stream2')).toBeInTheDocument()
    expect(screen.queryByTestId('streaming-indicator-idle')).not.toBeInTheDocument()
  })

  it('renders project chips from the projects catalog', async () => {
    seed(makeRow('a', { project_id: 'p1', updated_at: SERVER_TIME }))
    renderSidebar()

    const row = await screen.findByTestId('session-row-a')
    expect(await within(row).findByText('Alpha')).toBeInTheDocument()
  })

  it('shows an empty state when there are no sessions', async () => {
    renderSidebar()
    expect(await screen.findByTestId('sidebar-empty')).toHaveTextContent('No conversations yet')
  })
})

describe('SessionSidebar — search', () => {
  it('calls the search endpoint after a debounce and shows results', async () => {
    const user = userEvent.setup()
    seed(makeRow('a', { title: 'Alpha plan', updated_at: SERVER_TIME }), makeRow('b', { title: 'Beta notes', updated_at: SERVER_TIME - DAY }))
    vi.mocked(searchSessions).mockImplementation(async (q: string) => ({
      sessions: sortedRows().filter((r) => (r.title ?? '').toLowerCase().includes(q.toLowerCase())),
    }) as never)
    renderSidebar()

    await user.type(await screen.findByLabelText('Search conversations'), 'beta')

    await waitFor(() => expect(searchSessions).toHaveBeenCalledWith('beta'))
    expect(await screen.findByTestId('session-row-b')).toBeInTheDocument()
    expect(screen.queryByTestId('session-row-a')).not.toBeInTheDocument()
  })

  it('restores the full list when the search is cleared', async () => {
    const user = userEvent.setup()
    seed(makeRow('a', { title: 'Alpha plan', updated_at: SERVER_TIME }), makeRow('b', { title: 'Beta notes', updated_at: SERVER_TIME - DAY }))
    vi.mocked(searchSessions).mockImplementation(async (q: string) => ({
      sessions: sortedRows().filter((r) => (r.title ?? '').toLowerCase().includes(q.toLowerCase())),
    }) as never)
    renderSidebar()

    const input = await screen.findByLabelText('Search conversations')
    await user.type(input, 'beta')
    await waitFor(() => expect(searchSessions).toHaveBeenCalledWith('beta'))
    await user.clear(input)

    await waitFor(() => expect(screen.getByTestId('session-row-a')).toBeInTheDocument())
    expect(screen.getByTestId('session-row-b')).toBeInTheDocument()
  })
})

describe('SessionSidebar — row actions', () => {
  it('pins and unpins a session', async () => {
    const user = userEvent.setup()
    seed(makeRow('a', { updated_at: SERVER_TIME }))
    vi.mocked(pinSession).mockImplementation(async (sid: string, pinned: boolean) => {
      const row = serverSessions.get(sid)
      if (row) {
        row.pinned = pinned
        serverSessions.set(sid, { ...row })
      }
      return { ok: true, session: row ?? null } as never
    })
    renderSidebar()

    await openRowMenu(user, 'Session a')
    await user.click(await screen.findByRole('menuitem', { name: 'Pin' }))

    await waitFor(() => expect(pinSession).toHaveBeenCalledWith('a', true))
    await waitFor(() => expect(within(group('pinned')).getByText('Session a')).toBeInTheDocument())

    await openRowMenu(user, 'Session a')
    await user.click(await screen.findByRole('menuitem', { name: 'Unpin' }))
    await waitFor(() => expect(pinSession).toHaveBeenCalledWith('a', false))
  })

  it('archives and unarchives a session', async () => {
    const user = userEvent.setup()
    seed(makeRow('a', { updated_at: SERVER_TIME }), makeRow('arch', { archived: true, updated_at: SERVER_TIME - DAY }))
    vi.mocked(archiveSession).mockImplementation(async (sid: string, archived: boolean) => {
      const row = serverSessions.get(sid)
      if (row) {
        row.archived = archived
        serverSessions.set(sid, { ...row })
      }
      return { ok: true, session: row ?? null } as never
    })
    renderSidebar()

    await openRowMenu(user, 'Session a')
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    await waitFor(() => expect(archiveSession).toHaveBeenCalledWith('a', true))

    // The archived group is collapsed by default; expand it to see the row.
    const header = await screen.findByRole('button', { name: /Archived/ })
    await user.click(header)
    await waitFor(() => expect(within(group('archived')).getByText('Session a')).toBeInTheDocument())

    // Unarchive the previously archived row.
    await openRowMenu(user, 'Session arch')
    await user.click(await screen.findByRole('menuitem', { name: 'Unarchive' }))
    await waitFor(() => expect(archiveSession).toHaveBeenCalledWith('arch', false))
  })

  it('duplicates a session and refreshes the list', async () => {
    const user = userEvent.setup()
    seed(makeRow('a', { updated_at: SERVER_TIME }))
    vi.mocked(duplicateSession).mockImplementation(async (sid: string) => {
      const row = serverSessions.get(sid)
      const copy = makeRow(`copy-${sid}`, {
        title: `${row?.title ?? 'Session'} (copy)`,
        updated_at: SERVER_TIME,
      })
      serverSessions.set(copy.session_id, copy)
      return { session: copy } as never
    })
    renderSidebar()

    await openRowMenu(user, 'Session a')
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))

    await waitFor(() => expect(duplicateSession).toHaveBeenCalledWith('a'))
    expect(await screen.findByTestId('session-row-copy-a')).toBeInTheDocument()
  })

  it('renames a session inline on Enter and cancels on Escape', async () => {
    const user = userEvent.setup()
    seed(makeRow('a', { updated_at: SERVER_TIME }))
    vi.mocked(renameSession).mockImplementation(async (sid: string, title: string) => {
      const row = serverSessions.get(sid)
      if (row) {
        row.title = title
        row.display_title = title
        serverSessions.set(sid, { ...row })
      }
      return { session: row ?? null } as never
    })
    renderSidebar()

    await openRowMenu(user, 'Session a')
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const input = await screen.findByLabelText('Rename session')
    expect(input).toHaveValue('Session a')

    await user.clear(input)
    await user.type(input, 'New name{Enter}')
    await waitFor(() => expect(renameSession).toHaveBeenCalledWith('a', 'New name'))
    expect(await screen.findByText('New name')).toBeInTheDocument()

    // Escape cancels without calling the endpoint.
    await openRowMenu(user, 'New name')
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByLabelText('Rename session')).not.toBeInTheDocument())
    expect(renameSession).toHaveBeenCalledTimes(1)
  })
})

describe('SessionSidebar — read-only CLI rows', () => {
  it('shows the source label and disables destructive actions', async () => {
    const user = userEvent.setup()
    seed(
      makeRow('cli', {
        is_cli_session: true,
        source_label: 'Terminal',
        updated_at: SERVER_TIME,
      }),
    )
    renderSidebar()

    const row = await screen.findByTestId('session-row-cli')
    expect(within(row).getByText('Terminal')).toBeInTheDocument()

    await openRowMenu(user, 'Session cli')
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('menuitem', { name: 'Pin' })).toHaveAttribute('aria-disabled', 'true')
    // Duplicate is non-destructive and stays available.
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).not.toHaveAttribute(
      'aria-disabled',
    )

    // A disabled Delete never opens the confirm dialog.
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('treats messaging and reference-only rows as read-only too', async () => {
    const user = userEvent.setup()
    seed(
      makeRow('msg', { is_messaging_session: true, source_label: 'WhatsApp', updated_at: SERVER_TIME }),
      makeRow('ref', { _sidebar_reference_only: true, source_label: 'Archived parent', updated_at: SERVER_TIME - DAY }),
    )
    renderSidebar()

    await openRowMenu(user, 'Session msg')
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    await openRowMenu(user, 'Session ref')
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('SessionSidebar — §5.6 delete rules', () => {
  it('deleting the active session loads the most recent remaining session and NEVER creates', async () => {
    const user = userEvent.setup()
    seed(
      makeRow('a', { updated_at: SERVER_TIME }),
      makeRow('b', { updated_at: SERVER_TIME - 2 * DAY }),
      makeRow('c', { updated_at: SERVER_TIME - 10 * DAY }),
    )
    chatStore.set(sessionAtom, { session_id: 'a', title: 'Session a', model: 'test-model', messages: [] })
    renderSidebar()

    await openRowMenu(user, 'Session a')
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    // Rule 2: sessions[0] (most recent) becomes the active session.
    await waitFor(() => expect(chatStore.get(sessionAtom)?.session_id).toBe('b'))
    await waitFor(() => expect(screen.getByTestId('session-row-b')).toHaveAttribute('data-active', 'true'))
    expect(screen.queryByTestId('session-row-a')).not.toBeInTheDocument()
    // Rule 1: deleting never creates.
    expect(api).not.toHaveBeenCalledWith('/api/session/new', expect.anything())
    // Rule 5: always toast.
    expect(toast).toHaveBeenCalledWith('Conversation deleted')
  })

  it('deleting the last session shows the empty state and NEVER creates', async () => {
    const user = userEvent.setup()
    seed(makeRow('a', { updated_at: SERVER_TIME }))
    chatStore.set(sessionAtom, { session_id: 'a', title: 'Session a', model: 'test-model', messages: [] })
    renderSidebar()

    await openRowMenu(user, 'Session a')
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    // Rule 3: empty state — no selection, no create.
    await waitFor(() => expect(chatStore.get(sessionAtom)).toBeNull())
    expect(await screen.findByTestId('sidebar-empty')).toHaveTextContent('No conversations yet')
    expect(api).not.toHaveBeenCalledWith('/api/session/new', expect.anything())
    expect(toast).toHaveBeenCalledWith('Conversation deleted')
  })

  it('deleting an inactive session just re-renders the list', async () => {
    const user = userEvent.setup()
    seed(
      makeRow('a', { updated_at: SERVER_TIME }),
      makeRow('b', { updated_at: SERVER_TIME - 2 * DAY }),
    )
    chatStore.set(sessionAtom, { session_id: 'a', title: 'Session a', model: 'test-model', messages: [] })
    renderSidebar()

    await openRowMenu(user, 'Session b')
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    // Rule 4: active session untouched, list re-rendered.
    await waitFor(() => expect(screen.queryByTestId('session-row-b')).not.toBeInTheDocument())
    expect(chatStore.get(sessionAtom)?.session_id).toBe('a')
    expect(screen.getByTestId('session-row-a')).toBeInTheDocument()
    expect(api).not.toHaveBeenCalledWith('/api/session/new', expect.anything())
    expect(toast).toHaveBeenCalledWith('Conversation deleted')
  })

  it('cancelling the confirm dialog deletes nothing', async () => {
    const user = userEvent.setup()
    seed(makeRow('a', { updated_at: SERVER_TIME }))
    renderSidebar()

    await openRowMenu(user, 'Session a')
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.getByTestId('session-row-a')).toBeInTheDocument()
    expect(api).not.toHaveBeenCalledWith('/api/session/delete', expect.anything())
    expect(toast).not.toHaveBeenCalledWith('Conversation deleted')
  })
})

import { useCallback, useEffect, useState, lazy, Suspense } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  busyAtom,
  chatStore,
  compressingAtom,
  liveToolCallsAtom,
  loadSession,
  messagesAtom,
  newSession as storeNewSession,
  reconnectAtom,
  sessionAtom,
  sessionLoadingAtom,
  terminalOpenAtom,
} from './chatStore'
import { Composer } from './Composer'
import { EmptyState } from './EmptyState'
import { MessageList } from './MessageList'
import { TranscriptSkeleton } from './TranscriptSkeleton'
import { useStickToBottom } from './useStickToBottom'
import { SessionSidebar } from '@/features/sessions/SessionSidebar'
import { listSessions } from '@/api/sessions'
import { WorkspacePanel } from '@/features/workspace/WorkspacePanel'
import {
  workspacePanelModeAtom,
  workspaceStore,
} from '@/features/workspace/workspaceStore'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ArrowDownIcon,
  KeyboardIcon,
  MenuIcon,
  MessageSquarePlusIcon,
  PanelLeftIcon,
  PanelRightIcon,
  TerminalIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'

// Lazy-load the infrequent surfaces (Control Center modal, embedded terminal)
// so they do not inflate the initial bundle. Each mounts only when opened.
const ControlCenter = lazy(() =>
  import('@/features/panels/ControlCenter').then((m) => ({ default: m.ControlCenter })),
)
const TerminalPanel = lazy(() =>
  import('@/features/terminal/TerminalPanel').then((m) => ({ default: m.TerminalPanel })),
)

/**
 * Chat surface (DESIGN.md / docs/UIUX-GUIDE.md): the three-panel workbench —
 * sessions sidebar | transcript + composer | workspace file panel.
 *
 * Approval card and clarify dialog compose via the Composer, which reads the
 * store atoms (`pendingApprovalAtom` / `pendingClarifyAtom`) fed by the SSE
 * stream. The reconnect banner appears while the single-retry re-attach is in
 * flight after a transport-level EventSource error.
 *
 * The Control Center (settings, profiles, model defaults, skills, memory,
 * tasks, todo) is launched from a sidebar-footer trigger button, matching the
 * legacy main-view panels (static/panels.js). The embedded terminal dock
 * mounts through `terminalOpenAtom` (opened by `/terminal`) and unmounts when
 * closed, which also tears the PTY down.
 *
 * Responsive: the sidebar and workspace panel collapse under the md
 * breakpoint. Below that, each becomes a full-height overlay drawer toggled
 * from the header; on wide screens they are persistent columns.
 *
 * Keyboard shortcuts (opened via ⌘/Ctrl-/, listed in KeyboardShortcutsDialog):
 *   ⌘/Ctrl-\        toggle sidebar
 *   ⌘/Ctrl-Shift-\  toggle workspace panel
 *   �/Ctrl-/        keyboard shortcuts
 *   ⌘/Ctrl-Enter    focus the composer (unless already focused)
 *   Esc             close any open dialog
 */

const SIDEBAR_WIDTH_PX = 280

export function ChatPage({ initialSessionId }: { initialSessionId?: string }) {
  const session = useAtomValue(sessionAtom, { store: chatStore })
  const messages = useAtomValue(messagesAtom, { store: chatStore })
  const liveToolCalls = useAtomValue(liveToolCallsAtom, { store: chatStore })
  const compressing = useAtomValue(compressingAtom, { store: chatStore })
  const reconnect = useAtomValue(reconnectAtom, { store: chatStore })
  const terminalOpen = useAtomValue(terminalOpenAtom, { store: chatStore })
  const busy = useAtomValue(busyAtom, { store: chatStore })
  const sessionLoading = useAtomValue(sessionLoadingAtom, { store: chatStore })

  // Sidebar open/close. On wide screens the sidebar is a persistent column;
  // on narrow screens it is an overlay drawer (mobile-first per UIUX-GUIDE.md).
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // Mobile drawer state — only used below the md breakpoint.
  const [mobileSidebar, setMobileSidebar] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const workspaceMode = useAtomValue(workspacePanelModeAtom, { store: workspaceStore })
  const setWorkspaceMode = useSetAtom(workspacePanelModeAtom, { store: workspaceStore })

  // Boot the chat surface. With a deep link (/session/:id) load that exact
  // session; otherwise load the most recent session, mirroring the legacy boot
  // path (static/boot.js) which resolved the active session on load. The
  // sidebar fetches its own list; here we only seed the chat column so the
  // user lands on a transcript instead of an empty column.
  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        if (initialSessionId) {
          await loadSession(initialSessionId)
          return
        }
        const res = await listSessions({ exclude_hidden: true })
        if (cancelled) return
        const first = res.sessions?.[0]
        if (first) await loadSession(first.session_id)
      } catch {
        // No sessions yet — the empty-state composer handles creation.
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [initialSessionId])

  // Global keyboard shortcuts (skip when the user is typing in an input).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const inField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      // Esc closes any open dialog or overlay drawer regardless of focus.
      if (event.key === 'Escape') {
        if (shortcutsOpen) {
          event.preventDefault()
          setShortcutsOpen(false)
          return
        }
        if (mobileSidebar) {
          event.preventDefault()
          setMobileSidebar(false)
          return
        }
      }
      // ⌘/Ctrl-/ opens shortcuts.
      if ((event.metaKey || event.ctrlKey) && event.key === '/') {
        event.preventDefault()
        setShortcutsOpen((v) => !v)
        return
      }
      // ⌘/Ctrl-\ toggles sidebar (skip when the user is typing).
      if ((event.metaKey || event.ctrlKey) && event.key === '\\') {
        if (inField) return
        event.preventDefault()
        setSidebarOpen((v) => !v)
        return
      }
      // ⌘/Ctrl-Shift-\ toggles workspace panel.
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === '\\') {
        if (inField) return
        event.preventDefault()
        setWorkspaceMode(workspaceMode === 'closed' ? 'browse' : 'closed')
        return
      }
      // ⌘/Ctrl-Shift-O starts a new conversation. Shift-qualified because the
      // unmodified ⌘N/⌘T belong to the browser and cannot be taken.
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === 'O' || event.key === 'o')) {
        event.preventDefault()
        void storeNewSession()
        setMobileSidebar(false)
        return
      }
      // ⌘/Ctrl-K focuses conversation search — the sidebar opens first if the
      // shortcut would otherwise focus a field the user cannot see.
      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault()
        const wide = window.matchMedia?.('(min-width: 768px)').matches ?? true
        if (wide) setSidebarOpen(true)
        else setMobileSidebar(true)
        window.setTimeout(() => {
          document
            .querySelector<HTMLInputElement>('[data-testid="session-sidebar"] input[type="search"]')
            ?.focus()
        }, 0)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcutsOpen, mobileSidebar, workspaceMode, setWorkspaceMode])

  const handleSelectSession = useCallback((sessionId: string) => {
    void loadSession(sessionId)
    setMobileSidebar(false)
  }, [])

  const handleNewSession = useCallback(() => {
    void storeNewSession()
    setMobileSidebar(false)
  }, [])

  const toggleWorkspacePanel = useCallback(() => {
    setWorkspaceMode(workspaceMode === 'closed' ? 'browse' : 'closed')
  }, [workspaceMode, setWorkspaceMode])

  // Keep the session atom in sync after a workspace switch so the terminal
  // dock and subsequent turns bind to the newly selected workspace.
  const handleWorkspaceChange = useCallback((path: string) => {
    const current = chatStore.get(sessionAtom)
    if (current) chatStore.set(sessionAtom, { ...current, workspace: path })
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((v) => !v)
  }, [])

  const sessionId = session?.session_id ?? null
  const workspacePath = session?.workspace ?? null

  // Reflect the active session title in the document title (deep links and
  // tab labels), falling back to the app name when no session is active.
  useEffect(() => {
    document.title = session?.title ? `${session.title} — HermesCN` : 'HermesCN'
  }, [session?.title])

  const isEmpty = messages.length === 0 && liveToolCalls.length === 0 && !compressing && !busy
  const sidebarVisible = sidebarOpen

  // Transcript scroll: follow new content while the user is at the bottom,
  // stand still while they are reading history, jump on session switch.
  const { scrollRef, contentRef, atBottom, scrollable, scrollToBottom } = useStickToBottom<
    HTMLDivElement,
    HTMLDivElement
  >([messages, liveToolCalls, compressing, busy], sessionId)
  const showJumpToLatest = scrollable && !atBottom && !isEmpty

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* Top bar — title, mobile drawers, panel toggles. */}
      <header
        className={cn(
          'flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        )}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={sidebarVisible ? 'Hide conversations' : 'Show conversations'}
                className="hidden md:inline-flex"
                onClick={toggleSidebar}
              />
            }
          >
            {sidebarVisible ? <PanelLeftIcon /> : <MenuIcon />}
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {sidebarVisible ? 'Hide conversations' : 'Show conversations'}
            <span className="ml-2 font-mono text-[11px] opacity-70">⌘\</span>
          </TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Show conversations"
          className="md:hidden"
          onClick={() => setMobileSidebar(true)}
        >
          <MenuIcon />
        </Button>

        {/* Brand + active session title. */}
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="font-heading text-[15px] font-semibold tracking-tight text-foreground">
            HermesCN
          </h1>
          {session?.title && (
            <>
              <span aria-hidden="true" className="text-xs text-muted-foreground/60">
                /
              </span>
              <span className="truncate text-xs text-muted-foreground">{session.title}</span>
            </>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="New conversation"
                  onClick={handleNewSession}
                />
              }
            >
              <MessageSquarePlusIcon />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              New conversation
              <span className="ml-2 font-mono text-[11px] opacity-70">⌘⇧O</span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Keyboard shortcuts"
                  onClick={() => setShortcutsOpen(true)}
                />
              }
            >
              <KeyboardIcon />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Keyboard shortcuts <span className="ml-1 font-mono text-[11px] opacity-70">⌘/</span>
            </TooltipContent>
          </Tooltip>
          {terminalOpen && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close terminal"
                    onClick={() => chatStore.set(terminalOpenAtom, false)}
                  />
                }
              >
                <TerminalIcon />
              </TooltipTrigger>
              <TooltipContent side="bottom">Close terminal</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={
                    workspaceMode === 'closed' ? 'Open workspace panel' : 'Close workspace panel'
                  }
                  onClick={toggleWorkspacePanel}
                />
              }
            >
              <PanelRightIcon />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {workspaceMode === 'closed' ? 'Open workspace' : 'Close workspace'}
              <span className="ml-2 font-mono text-[11px] opacity-70">⌘⇧\</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Sessions sidebar — persistent column on md+, hidden below. */}
        <aside
          className={cn(
            'hidden shrink-0 border-r border-border bg-sidebar text-sidebar-foreground md:block',
            !sidebarVisible && 'md:hidden',
          )}
          style={{ width: SIDEBAR_WIDTH_PX }}
          data-testid="chat-sidebar"
        >
          <SidebarBody
            onSelect={handleSelectSession}
            onNewSession={handleNewSession}
            activeSessionId={sessionId}
          />
        </aside>

        {/* Mobile sidebar drawer. */}
        {mobileSidebar && (
          <div
            className="absolute inset-y-0 left-0 z-40 flex md:hidden"
            data-testid="chat-sidebar-mobile"
          >
            <div
              className="flex h-full flex-col border-r border-border bg-sidebar text-sidebar-foreground"
              style={{ width: 'min(82vw, 320px)' }}
            >
              <SidebarBody
                onSelect={handleSelectSession}
                onNewSession={handleNewSession}
                activeSessionId={sessionId}
                onClose={() => setMobileSidebar(false)}
              />
            </div>
            <button
              type="button"
              aria-label="Close conversations"
              className="flex-1 bg-black/40 backdrop-blur-sm transition-opacity"
              onClick={() => setMobileSidebar(false)}
            />
          </div>
        )}

        {/* Center column — transcript + composer + terminal dock. */}
        <main className="flex min-h-0 flex-1 flex-col">
          {/* The scroll viewport and its floating controls share this box, so
              the jump control anchors to the transcript, not to the composer. */}
          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              className="absolute inset-0 overflow-y-auto overscroll-contain"
              data-testid="chat-scroll"
            >
              {/* role=log + polite live region: a screen reader announces new
                  turns as they settle instead of leaving the transcript silent. */}
              <div ref={contentRef} role="log" aria-live="polite" aria-relevant="additions text">
                {sessionLoading && messages.length === 0 ? (
                  <TranscriptSkeleton className="mx-auto w-full max-w-3xl px-4 py-6" />
                ) : isEmpty ? (
                  <EmptyState />
                ) : (
                  <MessageList
                    messages={messages}
                    liveToolCalls={liveToolCalls}
                    liveCompression={compressing ? 'running' : null}
                    streaming={busy}
                    className="mx-auto w-full max-w-3xl px-4 py-6"
                  />
                )}
              </div>
            </div>

            {/* Jump to latest — only while the user has scrolled away from the
                tail, so it never covers a conversation they are reading. */}
            {showJumpToLatest && (
              <button
                type="button"
                data-testid="jump-to-latest"
                onClick={() => scrollToBottom()}
                aria-label="Jump to latest message"
                className={cn(
                  'absolute bottom-3 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5',
                  'rounded-full border border-border bg-popover px-3 py-1.5 text-xs font-medium text-popover-foreground',
                  'shadow-md transition-colors hover:bg-muted',
                )}
              >
                <ArrowDownIcon className="size-3.5" />
                Jump to latest
              </button>
            )}
          </div>
          {reconnect && (
            <div
              data-testid="reconnect-banner"
              role="status"
              aria-live="polite"
              className="border-t border-border bg-warning/10 px-4 py-2 text-center text-xs text-warning"
            >
              {reconnect.message}
            </div>
          )}
          {terminalOpen && sessionId && (
            <Suspense fallback={null}>
              <TerminalPanel
                sessionId={sessionId}
                workspace={workspacePath ?? ''}
                onClose={() => chatStore.set(terminalOpenAtom, false)}
              />
            </Suspense>
          )}
          <Composer />
        </main>

        {/* Workspace panel — right column. Conditionally mounted via its own
            mode atom (closed → null). One responsive instance: a slide-over
            below md, a persistent column at md+. */}
        {workspaceMode !== 'closed' && sessionId && (
          <div
            className={cn(
              'absolute inset-y-0 right-0 z-40 w-[min(92vw,520px)] border-l border-border bg-background md:static md:z-auto md:w-auto md:border-l-0',
            )}
          >
            <WorkspacePanel
              sessionId={sessionId}
              workspace={workspacePath}
              onWorkspaceChange={handleWorkspaceChange}
            />
          </div>
        )}
      </div>

      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}

/** Sidebar body shared by the persistent column and the mobile drawer. */
function SidebarBody({
  onSelect,
  onNewSession,
  activeSessionId,
  onClose,
}: {
  onSelect: (sessionId: string) => void
  onNewSession: () => void
  activeSessionId: string | null
  onClose?: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-sidebar-border px-2.5 py-1.5">
        {/* flex-1, not w-full: with a close button beside it a full-width
            primary pushed the close control off the edge of the mobile drawer,
            leaving the scrim as the only way out. */}
        <Button
          variant="default"
          size="sm"
          className="min-w-0 flex-1 justify-center gap-1.5"
          onClick={onNewSession}
        >
          <MessageSquarePlusIcon className="size-3.5" />
          New conversation
        </Button>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close conversations"
            className="shrink-0"
            onClick={onClose}
          >
            <PanelLeftIcon />
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 px-1.5">
        <SessionSidebar
          onSelect={onSelect}
          activeSessionId={activeSessionId}
          className="h-full"
        />
      </div>
      <div className="shrink-0 border-t border-sidebar-border p-2">
        <Suspense fallback={null}>
          <ControlCenter />
        </Suspense>
      </div>
    </div>
  )
}

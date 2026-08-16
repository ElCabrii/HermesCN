import { useAtomValue } from 'jotai'
import {
  chatStore,
  compressingAtom,
  liveToolCallsAtom,
  messagesAtom,
  reconnectAtom,
  sessionAtom,
  terminalOpenAtom,
} from './chatStore'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { TerminalPanel } from '@/features/terminal/TerminalPanel'

/**
 * Chat surface (DESIGN.md): transcript + composer + reconnect banner.
 *
 * Approval card and clarify dialog compose via the Composer, which reads the
 * store atoms (`pendingApprovalAtom` / `pendingClarifyAtom`) fed by the SSE
 * stream (Task 3.5). The reconnect banner appears while the single-retry
 * re-attach is in flight after a transport-level EventSource error.
 *
 * The embedded terminal dock mounts through `terminalOpenAtom` (opened by
 * `/terminal` or the legacy terminal toggle) and unmounts when closed, which
 * also tears the PTY down (TerminalPanel's unmount cleanup).
 */
export function ChatPage() {
  const session = useAtomValue(sessionAtom, { store: chatStore })
  const messages = useAtomValue(messagesAtom, { store: chatStore })
  const liveToolCalls = useAtomValue(liveToolCallsAtom, { store: chatStore })
  const compressing = useAtomValue(compressingAtom, { store: chatStore })
  const reconnect = useAtomValue(reconnectAtom, { store: chatStore })
  const terminalOpen = useAtomValue(terminalOpenAtom, { store: chatStore })

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <h1 className="text-sm font-semibold">HermesCN</h1>
        {session?.title && <span className="truncate text-xs text-muted-foreground">{session.title}</span>}
      </header>
      <main className="flex-1 overflow-y-auto" data-testid="chat-scroll">
        <MessageList
          messages={messages}
          liveToolCalls={liveToolCalls}
          liveCompression={compressing ? 'running' : null}
          className="mx-auto w-full max-w-3xl px-4 py-4"
        />
      </main>
      {reconnect && (
        <div
          data-testid="reconnect-banner"
          role="status"
          className="border-t border-border bg-warning/10 px-4 py-1.5 text-center text-xs text-warning"
        >
          {reconnect.message}
        </div>
      )}
      {terminalOpen && session?.session_id && (
        <TerminalPanel
          sessionId={session.session_id}
          workspace={session.workspace ?? ''}
          onClose={() => chatStore.set(terminalOpenAtom, false)}
        />
      )}
      <Composer />
    </div>
  )
}

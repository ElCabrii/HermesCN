import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  closeTerminal,
  openTerminalOutput,
  resizeTerminal,
  sendTerminalInput,
  startTerminal,
  type TerminalOutputEvent,
} from '@/api/terminal'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ClipboardIcon,
  EraserIcon,
  RotateCwIcon,
  SquareXIcon,
  TerminalSquareIcon,
} from 'lucide-react'
import { toast } from 'sonner'

/**
 * Embedded workspace terminal panel (plan Task 8.6).
 *
 * Ports the legacy static/terminal.js composer terminal UX onto the React
 * stack: an xterm.js surface (fit addon), a collapsible dock, and the same
 * PTY lifecycle — POST /api/terminal/start on open/restart, SSE output via
 * /api/terminal/output, keystrokes via /api/terminal/input, fit-driven
 * /api/terminal/resize, and close semantics matching the legacy panel:
 *
 *   - `exit`/`quit`/`logout`/`close` typed at the prompt closes the panel
 *     (the command is NOT forwarded to the PTY).
 *   - A server `terminal_closed` frame (shell already exited) writes a notice
 *     and skips the close POST.
 *   - Transport-level SSE errors write a disconnected notice; the browser
 *     auto-reconnects a merely CONNECTING source.
 *   - Unmount (session switch, page leave) closes the PTY and the stream.
 *
 * Theme/font follow the legacy mapping from CSS variables so the terminal
 * tracks the app skin: background ← --code-bg (--background fallback),
 * foreground ← --pre-text (--foreground), cursor/accent ← --accent, error/
 * success/warning/info ← --destructive/--success/--warning/--ring.
 */

/** Height bounds for the panel (legacy TERMINAL_HEIGHT_* constants). */
export const TERMINAL_HEIGHT_DEFAULT = 260
export const TERMINAL_HEIGHT_MIN = 180
export const TERMINAL_HEIGHT_MAX = 520

/** Commands that close the panel instead of reaching the PTY (legacy set). */
const CLOSE_COMMANDS = new Set(['exit', 'quit', 'logout', 'close'])

/** Track the command the user is typing so `exit` can be intercepted. */
function trackTypedCommand(previous: string, data: string): { line: string; command: string | null } {
  if (data === '\r' || data === '\n') {
    return { line: '', command: previous }
  }
  if (data === '\u0003') {
    // Ctrl-C cancels the line.
    return { line: '', command: null }
  }
  if (data === '\u007f' || data === '\b') {
    return { line: previous.slice(0, -1), command: null }
  }
  if ((data.length === 1 && data >= ' ') || (data.length > 1 && /^[\x20-\x7e]+$/.test(data))) {
    return { line: previous + data, command: null }
  }
  return { line: previous, command: null }
}

/** Read a CSS variable with a fallback (legacy `_terminalCssVar`). */
function cssVar(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** xterm theme mapped from the app CSS variables (legacy `_terminalTheme`). */
function terminalTheme(): Record<string, string> {
  const isDark = document.documentElement.classList.contains('dark')
  const background = cssVar('--code-bg', isDark ? '#1A1A2E' : '#F5F0E5')
  const foreground = cssVar('--pre-text', isDark ? '#E2E8F0' : '#1A1610')
  const muted = cssVar('--muted', isDark ? '#C0C0C0' : '#5C5344')
  const accent = cssVar('--accent-text', isDark ? '#FFD700' : '#8B6508')
  const error = cssVar('--error', isDark ? '#EF5350' : '#C62828')
  const success = cssVar('--success', isDark ? '#4CAF50' : '#3D8B40')
  const warning = cssVar('--warning', isDark ? '#FFA726' : '#E68A00')
  const info = cssVar('--info', isDark ? '#4DD0E1' : '#0288A8')
  return {
    background,
    foreground,
    cursor: accent,
    selectionBackground: cssVar('--accent-bg-strong', isDark ? 'rgba(255,215,0,.18)' : 'rgba(184,134,11,.18)'),
    black: isDark ? '#0D0D1A' : '#1A1610',
    red: error,
    green: success,
    yellow: warning,
    blue: info,
    magenta: accent,
    cyan: info,
    white: foreground,
    brightBlack: muted,
    brightRed: error,
    brightGreen: success,
    brightYellow: accent,
    brightBlue: info,
    brightMagenta: accent,
    brightCyan: info,
    brightWhite: isDark ? '#FFFFFF' : '#0F0D08',
  }
}

/** Mono font stack from the app CSS (legacy `_terminalMonoFont`). */
function terminalFontFamily(): string {
  return cssVar(
    '--font-mono',
    'ui-monospace,"SFMono-Regular","SF Mono",Menlo,Consolas,"Liberation Mono",monospace',
  )
}

/** Full buffer text (legacy `_terminalBufferText`). */
function terminalBufferText(term: Terminal): string {
  const buffer = term.buffer?.active
  if (!buffer) return ''
  const lines: string[] = []
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i)
    if (line) lines.push(line.translateToString(true))
  }
  return lines.join('\n').trim()
}

export interface TerminalPanelProps {
  /** Active session id — the PTY is bound to the session's workspace. */
  sessionId: string
  /** Session workspace path; shown in the panel header. */
  workspace: string
  /** Optional host hook fired when the panel closes itself (close button or
   *  `exit` at the prompt) so the host can unmount it (terminalOpenAtom). */
  onClose?: () => void
}

export function TerminalPanel({ sessionId, workspace, onClose }: TerminalPanelProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const closeOutputRef = useRef<(() => void) | null>(null)
  const disposedRef = useRef(false)
  const typedLineRef = useRef('')
  const [collapsed, setCollapsed] = useState(false)
  const [closed, setClosed] = useState(false)

  /** Close the panel: close the PTY, the stream, and dispose the terminal. */
  const close = () => {
    disposedRef.current = true
    typedLineRef.current = ''
    closeOutputRef.current?.()
    closeOutputRef.current = null
    void closeTerminal(sessionId).catch(() => {
      // Best-effort; the server reaps unwatched terminals anyway.
    })
    termRef.current?.dispose()
    termRef.current = null
    setCollapsed(false)
    setClosed(true)
    onClose?.()
  }

  // Start the PTY and attach the SSE output stream once per mount/restart.
  const start = (restart = false) => {
    void (async () => {
      try {
        await startTerminal({
          session_id: sessionId,
          rows: termRef.current?.rows ?? 24,
          cols: termRef.current?.cols ?? 80,
          restart,
        })
      } catch (error) {
        toast.error(
          t('terminal_start_failed') + (error instanceof Error ? error.message : String(error)),
        )
        return
      }
      if (disposedRef.current) return
      closeOutputRef.current?.()
      closeOutputRef.current = openTerminalOutput(sessionId, {
        onEvent: (event: TerminalOutputEvent) => {
          const term = termRef.current
          if (!term) return
          switch (event.type) {
            case 'output':
              term.write(event.text)
              break
            case 'terminal_closed':
              // The shell already exited — no close POST needed.
              term.writeln('\r\n[terminal closed]\r\n')
              closeOutputRef.current?.()
              closeOutputRef.current = null
              break
            case 'terminal_error':
              term.writeln(`\r\n[terminal error] ${event.error}\r\n`)
              closeOutputRef.current?.()
              closeOutputRef.current = null
              break
          }
        },
        onError: () => {
          termRef.current?.writeln('\r\n[terminal disconnected]\r\n')
        },
      })
    })()
  }

  // Mount the xterm surface once; the PTY starts when the panel mounts.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: terminalFontFamily(),
      scrollback: 1000,
      convertEol: false,
      theme: terminalTheme(),
    })
    termRef.current = term
    disposedRef.current = false

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(container)
    fitAddon.fit()

    term.onData((data: string) => {
      const { line, command } = trackTypedCommand(typedLineRef.current, data)
      typedLineRef.current = line
      if (command !== null && CLOSE_COMMANDS.has(command)) {
        // `exit` closes the panel (legacy: never forwarded to the PTY).
        close()
        return
      }
      void sendTerminalInput(sessionId, data).catch((error: unknown) => {
        toast.error(
          t('terminal_input_failed') + (error instanceof Error ? error.message : String(error)),
        )
      })
    })

    // Fit-driven resize: when xterm recomputes its grid (container size
    // change, font load), push the new dims to the PTY.
    term.onResize(({ cols, rows }) => {
      void resizeTerminal(sessionId, rows, cols).catch(() => {
        // Resize is best-effort (legacy swallowed resize failures).
      })
    })

    start(false)

    return () => {
      disposedRef.current = true
      closeOutputRef.current?.()
      closeOutputRef.current = null
      void closeTerminal(sessionId).catch(() => {
        // Best-effort; the server reaps unwatched terminals anyway.
      })
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  /** Restart the PTY in place: reset the screen, then start with restart:true. */
  const restart = () => {
    if (!termRef.current) return
    termRef.current.reset()
    start(true)
  }

  const copyOutput = () => {
    const term = termRef.current
    if (!term) return
    const selection = term.getSelection()
    const text = selection || terminalBufferText(term)
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success(t('copied')))
      .catch((error: unknown) => {
        toast.error(
          t('terminal_copy_failed') + (error instanceof Error ? error.message : String(error)),
        )
      })
  }

  const clear = () => {
    termRef.current?.clear()
  }

  if (closed) return null

  return (
    <div data-testid="terminal-panel" className="relative">
      <div
        data-testid="terminal-viewport"
        className="overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        style={{ height: collapsed ? undefined : TERMINAL_HEIGHT_DEFAULT }}
      >
        {!collapsed && (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border bg-card/60 px-3 py-1.5">
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
                <TerminalSquareIcon className="size-3.5 text-muted-foreground" />
                {t('terminal_title')}
                <span className="truncate text-muted-foreground">{workspace}</span>
              </span>
              <span className="flex shrink-0 items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('terminal_clear')}
                  title={t('terminal_clear')}
                  onClick={clear}
                >
                  <EraserIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('terminal_copy_output')}
                  title={t('terminal_copy_output')}
                  onClick={copyOutput}
                >
                  <ClipboardIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('terminal_restart')}
                  title={t('terminal_restart')}
                  onClick={restart}
                >
                  <RotateCwIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('terminal_collapse')}
                  title={t('terminal_collapse')}
                  onClick={() => setCollapsed(true)}
                >
                  <ChevronsDownUpIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('terminal_close')}
                  title={t('terminal_close')}
                  onClick={close}
                >
                  <SquareXIcon />
                </Button>
              </span>
            </div>
            <div ref={containerRef} className="h-full cursor-text px-2.5 py-2" />
          </>
        )}
      </div>

      {collapsed && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
            <TerminalSquareIcon className="size-3.5 text-muted-foreground" />
            <span className="truncate text-muted-foreground">{workspace}</span>
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('terminal_expand')}
            title={t('terminal_expand')}
            onClick={() => setCollapsed(false)}
          >
            <ChevronsUpDownIcon />
          </Button>
        </div>
      )}
    </div>
  )
}

export default TerminalPanel

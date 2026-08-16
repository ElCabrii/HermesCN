import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeTerminal,
  openTerminalOutput,
  resizeTerminal,
  sendTerminalInput,
  startTerminal,
} from '@/api/terminal'
import { toast } from 'sonner'
import { TerminalPanel } from './TerminalPanel'

/**
 * TerminalPanel tests (plan Task 8.6).
 *
 * The real xterm (@xterm/xterm) is replaced with a FakeTerminal class that
 * records construction options, open()/dispose()/write()/reset()/clear()/
 * focus() calls and lets tests fire onData / onResize callbacks — the seams
 * the panel actually uses. The FitAddon is mocked the same way. SSE handlers
 * are captured from the component's openTerminalOutput() call so tests can
 * emit output / terminal_closed / terminal_error frames and transport errors.
 */
const { FakeTerminal, FakeFitAddon } = vi.hoisted(() => {
  /** Records construction options and open()/dispose()/write() calls; lets tests fire onData/onResize. */
  class FakeTerminal {
    static instances: FakeTerminal[] = []
    static lastOptions: Record<string, unknown> | null = null

    options: Record<string, unknown>
    cols = 80
    rows = 24
    disposed = false
    opened = false
    cleared = false
    resetCalled = false
    focused = false
    written: string[] = []
    writelnCalls: string[] = []
    private dataListeners = new Set<(data: string) => void>()
    private disposedListeners = new Set<() => void>()
    private resizeListeners = new Set<(dims: { cols: number; rows: number }) => void>()

    constructor(options: Record<string, unknown>) {
      this.options = options
      FakeTerminal.lastOptions = options
      FakeTerminal.instances.push(this)
    }

    loadAddon(): void {}
    open(): void {
      this.opened = true
    }
    dispose(): void {
      this.disposed = true
      for (const listener of this.disposedListeners) listener()
    }
    write(text: string): void {
      this.written.push(text)
    }
    writeln(text: string): void {
      this.writelnCalls.push(text)
    }
    reset(): void {
      this.resetCalled = true
    }
    clear(): void {
      this.cleared = true
    }
    focus(): void {
      this.focused = true
    }
    getSelection(): string {
      return ''
    }
    onData(listener: (data: string) => void): { dispose(): void } {
      this.dataListeners.add(listener)
      return { dispose: () => this.dataListeners.delete(listener) }
    }
    onResize(listener: (dims: { cols: number; rows: number }) => void): { dispose(): void } {
      this.resizeListeners.add(listener)
      return { dispose: () => this.resizeListeners.delete(listener) }
    }
    onDispose(listener: () => void): { dispose(): void } {
      this.disposedListeners.add(listener)
      return { dispose: () => this.disposedListeners.delete(listener) }
    }
    emitData(data: string): void {
      for (const listener of this.dataListeners) listener(data)
    }
    emitResize(dims: { cols: number; rows: number } = { cols: this.cols, rows: this.rows }): void {
      this.cols = dims.cols
      this.rows = dims.rows
      for (const listener of this.resizeListeners) listener(dims)
    }
  }

  /** Records fit() calls; the panel never needs a real layout pass in tests. */
  class FakeFitAddon {
    static instances: FakeFitAddon[] = []
    fitCalls = 0
    constructor() {
      FakeFitAddon.instances.push(this)
    }
    fit(): void {
      this.fitCalls += 1
    }
    activate(): void {}
    dispose(): void {}
  }

  return { FakeTerminal, FakeFitAddon }
})

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))
vi.mock('@/api/terminal', () => ({
  startTerminal: vi.fn(),
  sendTerminalInput: vi.fn(),
  resizeTerminal: vi.fn(),
  closeTerminal: vi.fn(),
  openTerminalOutput: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const SID = 'sess-1'
const WS = '/home/gabriel/dev/HermesCN'

/** SSE handler bag captured from the component's openTerminalOutput() call. */
interface CapturedHandlers {
  onEvent?: (event: { type?: string; text?: string; error?: string; exit_code?: number }) => void
  onError?: (error: unknown) => void
  onOpen?: () => void
}

let capturedHandlers: CapturedHandlers = {}
let closeOutput: () => void

function lastTerminal(): InstanceType<typeof FakeTerminal> {
  expect(FakeTerminal.instances.length).toBeGreaterThan(0)
  return FakeTerminal.instances[FakeTerminal.instances.length - 1]
}

beforeEach(() => {
  vi.clearAllMocks()
  FakeTerminal.instances = []
  FakeTerminal.lastOptions = null
  FakeFitAddon.instances = []
  capturedHandlers = {}
  closeOutput = vi.fn<() => void>()
  vi.mocked(openTerminalOutput).mockImplementation((_sid, handlers) => {
    capturedHandlers = handlers as CapturedHandlers
    return closeOutput
  })
  vi.mocked(startTerminal).mockResolvedValue({
    ok: true,
    session_id: SID,
    workspace: WS,
    running: true,
  })
  vi.mocked(sendTerminalInput).mockResolvedValue({ ok: true })
  vi.mocked(resizeTerminal).mockResolvedValue({ ok: true })
  vi.mocked(closeTerminal).mockResolvedValue({ ok: true, closed: true })
})

afterEach(() => {
  vi.clearAllMocks()
  FakeTerminal.instances = []
  FakeFitAddon.instances = []
})

describe('TerminalPanel', () => {
  it('renders the panel with translated chrome and the xterm surface', async () => {
    render(<TerminalPanel sessionId={SID} workspace={WS} />)

    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))
    expect(screen.getByText('Terminal')).toBeInTheDocument()
    expect(screen.getByText(WS)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy output' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('opens the xterm terminal with blink cursor, theme and font, and starts the PTY', async () => {
    render(<TerminalPanel sessionId={SID} workspace={WS} />)

    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))
    const term = lastTerminal()
    expect(term.opened).toBe(true)
    expect(FakeTerminal.lastOptions).toMatchObject({
      cursorBlink: true,
      fontSize: 13,
      scrollback: 1000,
    })
    expect(typeof FakeTerminal.lastOptions?.theme).toBe('object')
    expect(startTerminal).toHaveBeenCalledWith({ session_id: SID, rows: 24, cols: 80, restart: false })
    expect(openTerminalOutput).toHaveBeenCalledWith(SID, expect.any(Object))
  })

  it('sends keystrokes to the PTY via /api/terminal/input', async () => {
    render(<TerminalPanel sessionId={SID} workspace={WS} />)
    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))

    act(() => {
      lastTerminal().emitData('echo hi\r')
    })

    await waitFor(() => expect(sendTerminalInput).toHaveBeenCalledWith(SID, 'echo hi\r'))
  })

  it('closes the panel when the user types a close command like exit', async () => {
    render(<TerminalPanel sessionId={SID} workspace={WS} />)
    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))

    // Real xterm delivers keystrokes one at a time: each letter is forwarded
    // to the PTY (xterm echoes it), but the Enter that completes `exit` is
    // intercepted and closes the panel instead of reaching the PTY.
    act(() => {
      for (const ch of 'exit') lastTerminal().emitData(ch)
      lastTerminal().emitData('\r')
    })

    await waitFor(() => expect(closeTerminal).toHaveBeenCalledWith(SID))
    expect(sendTerminalInput).toHaveBeenCalledTimes(4)
    expect(sendTerminalInput).not.toHaveBeenCalledWith(SID, '\r')
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument()
  })

  it('writes SSE output frames into the terminal', async () => {
    render(<TerminalPanel sessionId={SID} workspace={WS} />)
    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))

    act(() => {
      capturedHandlers.onEvent?.({ type: 'output', text: 'hello\x1b[0m' })
    })

    expect(lastTerminal().written).toContain('hello\x1b[0m')
  })

  it('renders a closed notice and closes the SSE stream when terminal_closed arrives', async () => {
    render(<TerminalPanel sessionId={SID} workspace={WS} />)
    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))

    act(() => {
      capturedHandlers.onEvent?.({ type: 'terminal_closed', exit_code: 0 })
    })

    expect(lastTerminal().writelnCalls.some((line: string) => line.includes('[terminal closed]'))).toBe(true)
    expect(closeOutput).toHaveBeenCalled()
    // The shell already exited — no close POST (legacy skipApi semantics).
    expect(closeTerminal).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument()
  })

  it('renders a terminal error notice when terminal_error arrives', async () => {
    render(<TerminalPanel sessionId={SID} workspace={WS} />)
    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))

    act(() => {
      capturedHandlers.onEvent?.({ type: 'terminal_error', error: 'PTY exploded' })
    })

    expect(lastTerminal().writelnCalls.some((line: string) => line.includes('PTY exploded'))).toBe(true)
  })

  it('marks the terminal disconnected on a transport-level SSE error', async () => {
    render(<TerminalPanel sessionId={SID} workspace={WS} />)
    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))

    act(() => {
      capturedHandlers.onError?.(new Event('error'))
    })

    expect(
      lastTerminal().writelnCalls.some((line: string) => line.includes('[terminal disconnected]')),
    ).toBe(true)
  })

  it('sends the fitted size to /api/terminal/resize when the terminal reports new dimensions', async () => {
    render(<TerminalPanel sessionId={SID} workspace={WS} />)
    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))

    act(() => {
      lastTerminal().emitResize({ cols: 120, rows: 40 })
    })

    await waitFor(() => expect(resizeTerminal).toHaveBeenCalledWith(SID, 40, 120))
  })

  it('clear wipes the terminal buffer', async () => {
    render(<TerminalPanel sessionId={SID} workspace={WS} />)
    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(lastTerminal().cleared).toBe(true)
  })

  it('copy writes the terminal selection to the clipboard and toasts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<TerminalPanel sessionId={SID} workspace={WS} />)
    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))

    const term = lastTerminal()
    term.getSelection = () => 'selected text'
    fireEvent.click(screen.getByRole('button', { name: 'Copy output' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('selected text'))
    expect(toast.success).toHaveBeenCalled()
  })

  it('toasts a start failure and keeps the panel open for retry', async () => {
    vi.mocked(startTerminal).mockRejectedValue(new Error('PTY spawn failed'))
    render(<TerminalPanel sessionId={SID} workspace={WS} />)

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument()
  })

  it('restart resets the terminal and starts a fresh PTY', async () => {
    render(<TerminalPanel sessionId={SID} workspace={WS} />)
    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))
    expect(startTerminal).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))

    await waitFor(() => expect(startTerminal).toHaveBeenCalledTimes(2))
    expect(startTerminal).toHaveBeenLastCalledWith({
      session_id: SID,
      rows: 24,
      cols: 80,
      restart: true,
    })
    expect(lastTerminal().resetCalled).toBe(true)
  })

  it('close closes the PTY, the SSE stream, and disposes the terminal', async () => {
    render(<TerminalPanel sessionId={SID} workspace={WS} />)
    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))
    const term = lastTerminal()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(closeTerminal).toHaveBeenCalledWith(SID))
    expect(closeOutput).toHaveBeenCalled()
    expect(term.disposed).toBe(true)
  })

  it('collapses to a dock and expands back with the terminal preserved', async () => {
    render(<TerminalPanel sessionId={SID} workspace={WS} />)
    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument()
    expect(FakeTerminal.instances.length).toBe(1)
  })

  it('cleans up on unmount: closes the PTY, the SSE stream, and disposes the terminal', async () => {
    const { unmount } = render(<TerminalPanel sessionId={SID} workspace={WS} />)
    await waitFor(() => expect(FakeTerminal.instances.length).toBe(1))
    const term = lastTerminal()

    unmount()

    expect(closeTerminal).toHaveBeenCalledWith(SID)
    expect(closeOutput).toHaveBeenCalled()
    expect(term.disposed).toBe(true)
  })
})

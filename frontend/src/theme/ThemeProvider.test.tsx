import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSettings, updateSettings } from '@/api/panels'
import { ThemeProvider, useTheme } from './ThemeProvider'
import { SKINS } from './skins'

vi.mock('@/api/panels', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}))

const mockedGetSettings = vi.mocked(getSettings)
const mockedUpdateSettings = vi.mocked(updateSettings)

/** Deferred promise so tests control when the settings round-trip resolves. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** matchMedia stub with a dispatchable change handler. */
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const mq = {
    matches: initial,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((_type: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.add(cb)
    }),
    removeEventListener: vi.fn((_type: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.delete(cb)
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    dispatch(matches: boolean) {
      mq.matches = matches
      listeners.forEach((cb) => cb({ matches } as MediaQueryListEvent))
    },
  }
  vi.stubGlobal('matchMedia', vi.fn(() => mq))
  return mq
}

function Probe() {
  const { theme, skin, setTheme, setSkin } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="skin">{skin}</span>
      <button onClick={() => setTheme('light')}>theme-light</button>
      <button onClick={() => setTheme('dark')}>theme-dark</button>
      <button onClick={() => setTheme('system')}>theme-system</button>
      <button onClick={() => setSkin('poseidon')}>skin-poseidon</button>
      <button onClick={() => setSkin('default')}>skin-default</button>
    </div>
  )
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  )
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.skin
    document.documentElement.classList.remove('dark')
    mockedGetSettings.mockReset()
    mockedGetSettings.mockResolvedValue({})
    mockedUpdateSettings.mockReset()
    mockedUpdateSettings.mockResolvedValue({})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    delete document.documentElement.dataset.skin
    document.documentElement.classList.remove('dark')
  })

  it('renders children', () => {
    render(
      <ThemeProvider>
        <div>hello</div>
      </ThemeProvider>,
    )
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('defaults to the documented system theme and default skin when nothing is stored', () => {
    mockedGetSettings.mockResolvedValue({})
    renderProvider()
    expect(screen.getByTestId('theme')).toHaveTextContent('system')
    expect(screen.getByTestId('skin')).toHaveTextContent('default')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset.skin).toBeUndefined()
  })

  it('bootstraps from localStorage on first paint, then reconciles with the server', async () => {
    const settings = deferred<{ theme: string; skin: string }>()
    mockedGetSettings.mockReturnValue(settings.promise)
    localStorage.setItem('hermes-theme', 'light')
    localStorage.setItem('hermes-skin', 'sienna')

    renderProvider()

    // First paint: localStorage wins — no flash of the server value.
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    expect(screen.getByTestId('skin')).toHaveTextContent('sienna')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset.skin).toBe('sienna')

    // Server round-trip resolves: persisted settings win afterwards.
    await act(async () => {
      settings.resolve({ theme: 'dark', skin: 'default' })
    })
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
    expect(screen.getByTestId('skin')).toHaveTextContent('default')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.skin).toBeUndefined()
    // The server value is mirrored into localStorage for the next reload.
    expect(localStorage.getItem('hermes-theme')).toBe('dark')
    expect(localStorage.getItem('hermes-skin')).toBe('default')
  })

  it('keeps the localStorage choice when the settings fetch fails', async () => {
    mockedGetSettings.mockRejectedValue(new TypeError('fetch failed'))
    localStorage.setItem('hermes-theme', 'light')
    localStorage.setItem('hermes-skin', 'ares')

    renderProvider()

    await act(async () => {})
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    expect(screen.getByTestId('skin')).toHaveTextContent('ares')
    expect(document.documentElement.dataset.skin).toBe('ares')
  })

  it('setTheme updates state, applies the .dark class, and persists to localStorage + settings', async () => {
    const user = userEvent.setup()
    mockedGetSettings.mockResolvedValue({})
    localStorage.setItem('hermes-theme', 'dark')
    renderProvider()

    await user.click(screen.getByText('theme-light'))

    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('hermes-theme')).toBe('light')
    expect(mockedUpdateSettings).toHaveBeenCalledWith({ theme: 'light', skin: 'default' })

    await user.click(screen.getByText('theme-dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(mockedUpdateSettings).toHaveBeenLastCalledWith({ theme: 'dark', skin: 'default' })
  })

  it('system theme follows the OS prefers-color-scheme preference live', async () => {
    const user = userEvent.setup()
    const mq = stubMatchMedia(true)
    mockedGetSettings.mockResolvedValue({})
    localStorage.setItem('hermes-theme', 'light')
    renderProvider()

    await user.click(screen.getByText('theme-system'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    act(() => {
      mq.dispatch(false)
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => {
      mq.dispatch(true)
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('setSkin applies data-skin on <html> and persists to localStorage + settings; default clears it', async () => {
    const user = userEvent.setup()
    mockedGetSettings.mockResolvedValue({})
    localStorage.setItem('hermes-theme', 'dark')
    localStorage.setItem('hermes-skin', 'ares')
    renderProvider()

    expect(document.documentElement.dataset.skin).toBe('ares')

    await user.click(screen.getByText('skin-poseidon'))
    expect(document.documentElement.dataset.skin).toBe('poseidon')
    expect(localStorage.getItem('hermes-skin')).toBe('poseidon')
    expect(mockedUpdateSettings).toHaveBeenCalledWith({ theme: 'dark', skin: 'poseidon' })

    await user.click(screen.getByText('skin-default'))
    expect(document.documentElement.dataset.skin).toBeUndefined()
    expect(localStorage.getItem('hermes-skin')).toBe('default')
    expect(mockedUpdateSettings).toHaveBeenLastCalledWith({ theme: 'dark', skin: 'default' })
  })

  it('migrates legacy theme names via the legacy theme map', () => {
    mockedGetSettings.mockResolvedValue({})
    localStorage.setItem('hermes-theme', 'monokai')
    renderProvider()
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
    expect(screen.getByTestId('skin')).toHaveTextContent('sisyphus')
    expect(document.documentElement.dataset.skin).toBe('sisyphus')

    // oled → (dark, default): attribute is cleared, not left stale.
    localStorage.setItem('hermes-theme', 'oled')
    localStorage.setItem('hermes-skin', 'default')
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getAllByTestId('theme')[1]).toHaveTextContent('dark')
    expect(document.documentElement.dataset.skin).toBeUndefined()
  })

  it('falls back to the default skin for unknown stored skin ids', () => {
    mockedGetSettings.mockResolvedValue({})
    localStorage.setItem('hermes-theme', 'dark')
    localStorage.setItem('hermes-skin', 'graphite')
    renderProvider()
    expect(screen.getByTestId('skin')).toHaveTextContent('default')
    expect(document.documentElement.dataset.skin).toBeUndefined()
  })

  it('does not POST anything during bootstrap', () => {
    mockedGetSettings.mockResolvedValue({ theme: 'light', skin: 'sienna' })
    renderProvider()
    expect(mockedUpdateSettings).not.toHaveBeenCalled()
  })

  it('registers the documented legacy skin set in the registry', () => {
    const ids = SKINS.map((s) => s.id)
    expect(ids[0]).toBe('default')
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ['ares', 'mono', 'slate', 'poseidon', 'sisyphus', 'charizard', 'sienna', 'catppuccin', 'nous', 'geist-contrast', 'zeus']) {
      expect(ids).toContain(id)
    }
  })
})

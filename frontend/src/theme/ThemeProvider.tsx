/**
 * Theme + skin provider (Task 8.2).
 *
 * Appearance contract (THEMES.md, static/boot.js, api/config.py):
 *  - theme: 'light' | 'dark' | 'system'. Applied as the `.dark` class on
 *    `<html>`; system mode tracks `prefers-color-scheme` live.
 *  - skin: accent palette id from the skins registry. Applied as
 *    `data-skin="<id>"` on `<html>`; 'default' clears the attribute.
 *  - Persistence: localStorage (`hermes-theme` / `hermes-skin`, the legacy
 *    keys) writes synchronously so a reload is flicker-free before the API
 *    round-trip, then `theme` / `skin` are saved to settings.json via
 *    `updateSettings` (POST /api/settings). On mount the provider bootstraps
 *    from localStorage (first paint) and reconciles with GET /api/settings,
 *    adopting server values when they differ and mirroring them back into
 *    localStorage.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { getSettings, updateSettings } from '@/api/panels'
import { DEFAULT_SKIN, DEFAULT_THEME, STORAGE_KEYS, normalizeAppearance } from './skins'
import type { Skin, ThemeMode } from './skins'

export interface ThemeContextValue {
  theme: ThemeMode
  skin: string
  setTheme: (theme: ThemeMode) => void
  setSkin: (skin: string) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
function readLocalValue(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocalValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage may be unavailable (private mode, quota); settings.json still covers us.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const stored = readLocalValue(STORAGE_KEYS.theme)
    const storedSkin = readLocalValue(STORAGE_KEYS.skin)
    if (stored == null && storedSkin == null) return DEFAULT_THEME
    return normalizeAppearance(stored, storedSkin).theme
  })
  const [skin, setSkinState] = useState<string>(() => {
    const stored = readLocalValue(STORAGE_KEYS.theme)
    const storedSkin = readLocalValue(STORAGE_KEYS.skin)
    if (stored == null && storedSkin == null) return DEFAULT_SKIN
    return normalizeAppearance(stored, storedSkin).skin
  })

  // Apply the theme as the `.dark` class on <html> (light = no class).
  // System mode follows prefers-color-scheme live.
  useEffect(() => {
    const root = document.documentElement
    if (theme !== 'system') {
      root.classList.toggle('dark', theme === 'dark')
      return
    }
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) {
      root.classList.remove('dark')
      return
    }
    const apply = () => root.classList.toggle('dark', mq.matches)
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [theme])

  // Apply the skin as data-skin on <html>; 'default' clears the attribute.
  useEffect(() => {
    const root = document.documentElement
    if (skin === DEFAULT_SKIN) delete root.dataset.skin
    else root.dataset.skin = skin
  }, [skin])

  // Reconcile with server-persisted appearance after the localStorage bootstrap.
  useEffect(() => {
    let cancelled = false
    getSettings()
      .then((settings) => {
        if (cancelled) return
        const { theme: storedTheme, skin: storedSkin } = settings ?? {}
        if (typeof storedTheme !== 'string' && typeof storedSkin !== 'string') return
        const next = normalizeAppearance(
          typeof storedTheme === 'string' ? storedTheme : undefined,
          typeof storedSkin === 'string' ? storedSkin : undefined,
        )
        setThemeState(next.theme)
        setSkinState(next.skin)
        writeLocalValue(STORAGE_KEYS.theme, next.theme)
        writeLocalValue(STORAGE_KEYS.skin, next.skin)
      })
      .catch(() => {
        // Settings unreachable: keep the localStorage bootstrap.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const persist = useCallback((nextTheme: ThemeMode, nextSkin: string) => {
    writeLocalValue(STORAGE_KEYS.theme, nextTheme)
    writeLocalValue(STORAGE_KEYS.skin, nextSkin)
    void updateSettings({ theme: nextTheme, skin: nextSkin }).catch(() => {
      // Fire-and-forget: localStorage already captured the choice.
    })
  }, [])

  const setTheme = useCallback(
    (next: ThemeMode) => {
      setThemeState(next)
      persist(next, skin)
    },
    [persist, skin],
  )

  const setSkin = useCallback(
    (next: string) => {
      const normalized = normalizeAppearance(theme, next)
      setSkinState(normalized.skin)
      persist(normalized.theme, normalized.skin)
    },
    [persist, theme],
  )

  const value = useMemo(
    () => ({ theme, skin, setTheme, setSkin }),
    [theme, skin, setTheme, setSkin],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// oxlint-disable-next-line react/only-export-components -- hook export alongside the provider component
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}

export { ThemeContext }
export type { Skin, ThemeMode }

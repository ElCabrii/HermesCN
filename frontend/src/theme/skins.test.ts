import { describe, expect, it } from 'vitest'
import { DEFAULT_SKIN, DEFAULT_THEME, SKINS, normalizeAppearance } from './skins'

describe('normalizeAppearance', () => {
  it('defaults to dark/default when nothing is provided (server default parity)', () => {
    expect(normalizeAppearance(undefined, undefined)).toEqual({ theme: 'dark', skin: 'default' })
    expect(normalizeAppearance(null, null)).toEqual({ theme: 'dark', skin: 'default' })
    expect(normalizeAppearance('', '')).toEqual({ theme: 'dark', skin: 'default' })
  })

  it('keeps valid theme/skin pairs', () => {
    expect(normalizeAppearance('light', 'sienna')).toEqual({ theme: 'light', skin: 'sienna' })
    expect(normalizeAppearance('dark', 'ares')).toEqual({ theme: 'dark', skin: 'ares' })
    expect(normalizeAppearance('system', 'zeus')).toEqual({ theme: 'system', skin: 'zeus' })
  })

  it('trims and lower-cases inputs', () => {
    expect(normalizeAppearance('  LIGHT ', ' SISYPHUS ')).toEqual({ theme: 'light', skin: 'sisyphus' })
  })

  it('migrates legacy theme names onto modern theme/skin pairs', () => {
    expect(normalizeAppearance('slate', undefined)).toEqual({ theme: 'dark', skin: 'slate' })
    expect(normalizeAppearance('solarized', undefined)).toEqual({ theme: 'dark', skin: 'poseidon' })
    expect(normalizeAppearance('monokai', undefined)).toEqual({ theme: 'dark', skin: 'sisyphus' })
    expect(normalizeAppearance('nord', undefined)).toEqual({ theme: 'dark', skin: 'slate' })
    expect(normalizeAppearance('oled', undefined)).toEqual({ theme: 'dark', skin: 'default' })
  })

  it('a legacy theme keeps a valid requested skin (rawSkin wins, like boot.js)', () => {
    expect(normalizeAppearance('monokai', 'ares')).toEqual({ theme: 'dark', skin: 'ares' })
  })

  it('a legacy theme supplies its paired skin only when the skin is unknown', () => {
    expect(normalizeAppearance('monokai', 'graphite')).toEqual({ theme: 'dark', skin: 'sisyphus' })
  })

  it('falls back to dark for unknown theme names', () => {
    expect(normalizeAppearance('hotdog', 'default')).toEqual({ theme: 'dark', skin: 'default' })
  })

  it('falls back to default for unknown skin ids', () => {
    // graphite/verdigris/neon-* are accepted server-side but not yet ported.
    expect(normalizeAppearance('dark', 'graphite')).toEqual({ theme: 'dark', skin: 'default' })
    expect(normalizeAppearance('light', 'neon-soft')).toEqual({ theme: 'light', skin: 'default' })
  })
})

describe('skin registry', () => {
  it('documents the legacy skin set with unique ids and default first', () => {
    expect(SKINS[0]?.id).toBe('default')
    const ids = SKINS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('exposes the documented defaults', () => {
    expect(DEFAULT_THEME).toBe('system')
    expect(DEFAULT_SKIN).toBe('default')
  })
})

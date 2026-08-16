/**
 * Skin registry and appearance normalization (Task 8.2).
 *
 * Ports the legacy theme/skin contract from `static/boot.js` + THEMES.md:
 *  - theme: 'light' | 'dark' | 'system' — applied as the `.dark` class on
 *    `<html>` (light = no class), matching THEMES.md's class contract.
 *  - skin: a named accent palette — applied as `data-skin="<id>"` on `<html>`;
 *    the default skin clears the attribute. CSS overrides live in index.css.
 *  - persistence: localStorage keys `hermes-theme` / `hermes-skin` (same keys
 *    the legacy UI used, so upgrades keep the user's choice) plus the
 *    `theme` / `skin` keys in settings.json via POST /api/settings.
 *  - `_LEGACY_THEME_MAP` semantics are mirrored from static/boot.js and
 *    api/config.py `_SETTINGS_LEGACY_THEME_MAP` — keep all three in sync.
 */

export type ThemeMode = 'light' | 'dark' | 'system'

export interface Skin {
  id: string
  /** Display name for the picker. */
  name: string
  /** One-line description for the picker (from THEMES.md). */
  description: string
  /** Accent swatch (light variant) for picker previews. */
  swatch: string
}

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system']

/** Documented default theme (THEMES.md: "System (default)"). */
export const DEFAULT_THEME: ThemeMode = 'system'
export const DEFAULT_SKIN = 'default'

/** localStorage keys shared with the legacy UI (static/boot.js). */
export const STORAGE_KEYS = {
  theme: 'hermes-theme',
  skin: 'hermes-skin',
} as const

/**
 * Built-in skins (THEMES.md "Built-in Skins"). Only the documented set is
 * ported; the remaining server-side ids (graphite, verdigris, neon-soft,
 * neon-paint) gracefully fall back to `default` until ported.
 * Swatches are the legacy accent colors from static/boot.js `_SKINS`.
 */
export const SKINS: readonly Skin[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'The original Hermes gold accent. Warm and understated.',
    swatch: '#FFD700',
  },
  {
    id: 'ares',
    name: 'Ares',
    description: 'Fiery red. High-energy and assertive.',
    swatch: '#FF4444',
  },
  {
    id: 'mono',
    name: 'Mono',
    description: 'Neutral gray. Distraction-free, for deep focus.',
    swatch: '#CCCCCC',
  },
  {
    id: 'slate',
    name: 'Slate',
    description: 'Slate blue-gray. Subtle and grown-up.',
    swatch: '#475569',
  },
  {
    id: 'poseidon',
    name: 'Poseidon',
    description: 'Ocean blue. Calm and focused for long sessions.',
    swatch: '#0EA5E9',
  },
  {
    id: 'sisyphus',
    name: 'Sisyphus',
    description: 'Vivid purple. Distinctive without being loud.',
    swatch: '#A78BFA',
  },
  {
    id: 'charizard',
    name: 'Charizard',
    description: 'Warm orange. Energetic and easy on the eyes.',
    swatch: '#FB923C',
  },
  {
    id: 'sienna',
    name: 'Sienna',
    description: 'Warm clay and sand earth palette. Soft and natural.',
    swatch: '#D97757',
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    description: 'Catppuccin Latte/Mocha palette with Mauve accent.',
    swatch: '#8839EF',
  },
  {
    id: 'nous',
    name: 'Nous',
    description: 'Steel-blue accent with dashed technical surfaces.',
    swatch: '#4682B4',
  },
  {
    id: 'geist-contrast',
    name: 'Geist Contrast',
    description: 'Geist-inspired monochrome surfaces with a restrained dark-mode accent.',
    swatch: '#0070F3',
  },
  {
    id: 'zeus',
    name: 'Zeus',
    description: 'OLED-near-black dark surfaces that keep the default gold accent.',
    swatch: '#FFD700',
  },
]

/**
 * Legacy full-theme names → closest supported (theme, skin) pair.
 * Mirrors static/boot.js `_LEGACY_THEME_MAP` and api/config.py
 * `_SETTINGS_LEGACY_THEME_MAP` exactly — keep all three in sync.
 */
export const LEGACY_THEME_MAP: Record<string, { theme: ThemeMode; skin: string }> = {
  slate: { theme: 'dark', skin: 'slate' },
  solarized: { theme: 'dark', skin: 'poseidon' },
  monokai: { theme: 'dark', skin: 'sisyphus' },
  nord: { theme: 'dark', skin: 'slate' },
  oled: { theme: 'dark', skin: 'default' },
}

const SKIN_IDS = new Set(SKINS.map((s) => s.id))

export function isThemeMode(value: string): value is ThemeMode {
  return (THEME_MODES as readonly string[]).includes(value)
}

export function isSkin(id: string): boolean {
  return SKIN_IDS.has(id)
}

export function getSkin(id: string): Skin | undefined {
  return SKINS.find((s) => s.id === id)
}

/**
 * Normalize a stored (theme, skin) pair, migrating legacy theme names.
 * Ports `_normalizeAppearance` from static/boot.js; unknown values fall back
 * to ('dark', 'default') exactly like the server's `_normalize_appearance`.
 */
export function normalizeAppearance(
  theme: string | null | undefined,
  skin: string | null | undefined,
): { theme: ThemeMode; skin: string } {
  const rawTheme = typeof theme === 'string' ? theme.trim().toLowerCase() : ''
  const rawSkin = typeof skin === 'string' ? skin.trim().toLowerCase() : ''
  const legacy = LEGACY_THEME_MAP[rawTheme]
  const nextTheme: ThemeMode = legacy ? legacy.theme : isThemeMode(rawTheme) ? rawTheme : 'dark'
  const nextSkin = SKIN_IDS.has(rawSkin) ? rawSkin : legacy ? legacy.skin : DEFAULT_SKIN
  return { theme: nextTheme, skin: nextSkin }
}

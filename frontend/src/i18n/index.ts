import { atom, getDefaultStore, useAtom } from 'jotai'
import { useCallback } from 'react'
import { en } from './locales/en'
import { cs } from './locales/cs'
import { de } from './locales/de'
import { es } from './locales/es'
import { fr } from './locales/fr'
import { it } from './locales/it'
import { ja } from './locales/ja'
import { ko } from './locales/ko'
import { pl } from './locales/pl'
import { pt } from './locales/pt'
import { ru } from './locales/ru'
import { tr } from './locales/tr'
import { vi } from './locales/vi'
import { zh } from './locales/zh'
import { zhHant } from './locales/zh-Hant'

/**
 * i18n infrastructure (Task 8.1).
 *
 * Ports the legacy `static/i18n.js` `t()` contract to the React app:
 *
 *   - lookup order: current locale → `en` fallback → the key itself
 *   - numbered `{0}` placeholders interpolated positionally
 *   - locale persisted to localStorage under the legacy key `hermes-lang`
 *     (the key `static/boot.js` reads on boot)
 *   - `useI18n()` re-renders with fresh strings when the locale changes
 *
 * The `en` catalog is the default; the non-English catalogs (es, de, fr, it,
 * ja, ko, pl, pt, ru, tr, vi, zh, zh-Hant) are ported from the legacy
 * `static/i18n.js` and registered below. `t()` gracefully falls back to `en`
 * for any unregistered locale, and `registerLocale()` allows future catalogs
 * (or tests) to be added without touching this module.
 */

/** Default/fallback locale (also the boot default). */
export const DEFAULT_LOCALE = 'en'

/** localStorage key — matches the legacy key used by static/boot.js. */
export const LOCALE_STORAGE_KEY = 'hermes-lang'

/** BCP 47 language tag, e.g. 'en', 'zh-Hant'. */
export type Locale = string

/** Union of every key in the en catalog (the canonical key set). */
export type TranslationKey = keyof typeof en

/**
 * A locale catalog. Partial by design: keys missing from a non-en locale
 * fall back to the en catalog automatically (legacy behavior).
 */
export type Catalog = Partial<Record<TranslationKey, string>>

/** Registered catalogs. `en` is the default; the ported non-English catalogs are
 * registered below via registerLocale(). */
const catalogs: Record<string, Catalog> = { [DEFAULT_LOCALE]: en }

/**
 * Register a locale catalog at runtime. Used when porting the deferred
 * locales and by tests. Missing keys automatically fall back to `en`.
 */
export function registerLocale(code: string, catalog: Catalog): void {
  catalogs[code] = catalog
}

// Ported non-English catalogs (from the deleted legacy static/i18n.js). Keys a
// locale lacks fall back to `en` via the fallback chain (legacy behavior).
registerLocale('cs', cs)
registerLocale('es', es)
registerLocale('de', de)
registerLocale('fr', fr)
registerLocale('it', it)
registerLocale('ja', ja)
registerLocale('ko', ko)
registerLocale('pl', pl)
registerLocale('pt', pt)
registerLocale('ru', ru)
registerLocale('tr', tr)
registerLocale('vi', vi)
registerLocale('zh', zh)
registerLocale('zh-Hant', zhHant)

/** Look up a key in a catalog; unknown keys yield undefined (→ fallback chain). */
function lookup(catalog: Catalog | undefined, key: string): string | undefined {
  if (!catalog) return undefined
  return (catalog as Record<string, string | undefined>)[key]
}

function readStoredLocale(): string {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY) || DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

const store = getDefaultStore()

/** Current UI locale (BCP 47 tag); initialized from localStorage on boot. */
export const localeAtom = atom<string>(readStoredLocale())

/** Current locale, readable outside React (stores, event handlers, toasts). */
export function getLocale(): string {
  return store.get(localeAtom)
}

/**
 * Switch the UI locale, persist it to localStorage, and update `<html lang>`.
 * A requested locale with no registered catalog is kept as-is (so a deferred
 * locale choice survives until its catalog ships); `t()` falls back to `en`.
 */
export function setLocale(code: string): void {
  const resolved = code || DEFAULT_LOCALE
  store.set(localeAtom, resolved)
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, resolved)
  } catch {
    // storage unavailable (private mode/SSR): locale still applies in memory
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = resolved
  }
}

/**
 * Translate a key: current locale → en fallback → the key itself.
 * Numbered `{0}` placeholders are interpolated positionally, exactly like
 * the legacy `t()` in static/i18n.js.
 */
export function t(key: string, ...args: (string | number)[]): string {
  const locale = store.get(localeAtom)
  const value = lookup(catalogs[locale], key) ?? lookup(catalogs[DEFAULT_LOCALE], key)
  if (value === undefined) return key
  if (args.length > 0) {
    return value.replace(/\{(\d+)\}/g, (match, index) =>
      Object.prototype.hasOwnProperty.call(args, Number(index))
        ? String(args[Number(index)])
        : match,
    )
  }
  return value
}

/** Shape returned by useI18n(). */
export interface I18n {
  t: typeof t
  locale: string
  setLocale: (code: string) => void
}

/**
 * React binding: subscribes to localeAtom so components re-render with fresh
 * translations when setLocale() is called.
 */
export function useI18n(): I18n {
  const [locale] = useAtom(localeAtom)
  const translate = useCallback(
    (key: string, ...args: (string | number)[]) => t(key, ...args),
    [],
  )
  const changeLocale = useCallback((code: string) => setLocale(code), [])
  return { t: translate, locale, setLocale: changeLocale }
}

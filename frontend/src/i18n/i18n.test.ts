import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  getLocale,
  registerLocale,
  setLocale,
  t,
  useI18n,
} from './index'
import { en } from './locales/en'

/**
 * i18n infrastructure tests (Task 8.1).
 *
 * Contract under test mirrors the legacy `static/i18n.js` `t()`:
 *   lookup current locale → fall back to `en` → fall back to the key itself;
 *   numbered `{0}` placeholders are interpolated positionally; locale is
 *   persisted to localStorage under the legacy key (`hermes-lang`).
 */

/** Stub second locale used to prove runtime switching (real es/de/... are deferred). */
function stubCatalog(): Record<keyof typeof en, string> {
  return Object.fromEntries(
    Object.keys(en).map((key) => [key, `es:${key}`]),
  ) as Record<keyof typeof en, string>
}

const ES_STUB = stubCatalog()

beforeEach(() => {
  localStorage.clear()
  setLocale(DEFAULT_LOCALE)
  registerLocale('es', ES_STUB)
})

afterEach(() => {
  localStorage.clear()
})

describe('t()', () => {
  it('returns the en string for a known key', () => {
    expect(t('composer_send')).toBe('Send message')
    expect(t('session_pin')).toBe('Pin conversation')
    expect(t('login_title')).toBe('Sign in')
    expect(t('offline_title')).toBe('Connection lost')
  })

  it('returns the key itself for an unknown key', () => {
    expect(t('__definitely_not_a_key__')).toBe('__definitely_not_a_key__')
  })

  it('interpolates numbered {0} placeholders like the legacy t()', () => {
    expect(t('workspace_switcher_aria', 'research')).toBe(
      'Switch workspace. Current workspace: research.',
    )
  })

  it('leaves unmatched placeholders untouched', () => {
    expect(t('workspace_switcher_aria')).toBe(
      'Switch workspace. Current workspace: {0}.',
    )
  })

  it('falls back to en for a locale that has no registered catalog', () => {
    setLocale('xx')
    expect(t('composer_send')).toBe('Send message')
  })

  it('returns strings from a registered locale when the locale is active', () => {
    setLocale('es')
    expect(t('composer_send')).toBe('es:composer_send')
  })

  it('falls back to en for keys missing from a registered locale', () => {
    registerLocale('de', { composer_send: 'Nachricht senden' })
    setLocale('de')
    expect(t('composer_send')).toBe('Nachricht senden')
    // key not present in the de stub → en
    expect(t('session_pin')).toBe('Pin conversation')
  })
})

describe('locale state', () => {
  it('defaults to en', () => {
    expect(getLocale()).toBe(DEFAULT_LOCALE)
  })

  it('persists the locale to localStorage under the legacy key', () => {
    setLocale('es')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es')
  })

  it('keeps a requested-but-unregistered locale (t() falls back)', () => {
    setLocale('zh')
    expect(getLocale()).toBe('zh')
    expect(t('composer_send')).toBe('Send message')
  })
})

describe('useI18n()', () => {
  it('exposes t/locale/setLocale and re-renders with new strings on setLocale', () => {
    const { result } = renderHook(() => useI18n())

    expect(result.current.locale).toBe('en')
    expect(result.current.t('composer_send')).toBe('Send message')

    act(() => {
      result.current.setLocale('es')
    })

    expect(result.current.locale).toBe('es')
    expect(result.current.t('composer_send')).toBe('es:composer_send')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es')
  })
})

describe('boot', () => {
  it('initializes the locale from localStorage on module load', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de')
    vi.resetModules()
    const booted = await import('./index')
    expect(booted.getLocale()).toBe('de')
    vi.resetModules()
  })
})

describe('catalog integrity', () => {
  it('is a non-trivial en catalog with meta keys and all string values', () => {
    expect(Object.keys(en).length).toBeGreaterThan(200)
    expect(en._lang).toBe('en')
    expect(en._label).toBe('English')
    for (const [key, value] of Object.entries(en)) {
      expect(typeof value, `key ${key}`).toBe('string')
    }
  })

  it('covers every migrated surface with legacy key names', () => {
    // spot-check key names that must match static/i18n.js LOCALES.en exactly
    const legacySurfaceKeys = [
      'composer_send',
      'approval_btn_once',
      'clarify_heading',
      'thinking',
      'session_pin',
      'session_archive',
      'session_duplicate',
      'session_delete_confirm',
      'rename_title',
      'workspace_upload_file',
      'new_file_prompt',
      'cron_run_now',
      'cron_status_active',
      'skill_created',
      'memory_notes_label',
      'profile_use',
      'kanban_board',
      'settings_heading_title',
      'login_title',
      'onboarding_title',
      'share_session',
      'offline_title',
      'loading',
      'cancel',
    ]
    for (const key of legacySurfaceKeys) {
      expect(key in en, `legacy key ${key} must be in the en catalog`).toBe(true)
    }
  })
})

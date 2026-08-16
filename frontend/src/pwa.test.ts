import { describe, expect, it } from 'vitest'
import manifest from '../public/manifest.json'
import sw from '../public/sw.js?raw'
import main from './main.tsx?raw'
import indexHtml from '../index.html?raw'

describe('PWA manifest', () => {
  it('carries the HermesCN identity and DESIGN.md palette', () => {
    expect(manifest.name).toBe('HermesCN')
    expect(manifest.short_name).toBe('HermesCN')
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.theme_color).toBe('#0A0908')
    expect(manifest.background_color).toBe('#0A0908')
  })

  it('declares installable icons (192 and 512 PNG)', () => {
    const sizes = manifest.icons.map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any maskable')).toBe(true)
  })
})

describe('service worker', () => {
  it('uses a versioned cache name and claims clients on activate', () => {
    expect(sw).toMatch(/hermescn-v\d+/)
    expect(sw).toContain('clients.claim()')
  })

  it('precaches the app shell on install', () => {
    for (const asset of ['/', '/index.html', '/manifest.json', '/favicon.svg']) {
      expect(sw).toContain(asset)
    }
    expect(sw).toContain("addEventListener('install'")
  })

  it('is network-first for /api/* and never caches API responses', () => {
    expect(sw).toContain("startsWith('/api/')")
    // The API branch must bail out to the network without respondWith/cache.put.
    const apiBranch = sw.slice(sw.indexOf("startsWith('/api/')"))
    expect(apiBranch).toMatch(/return\b/)
  })

  it('is cache-first for hashed /assets/* bundles', () => {
    expect(sw).toContain("'/assets/'")
    expect(sw).toContain('cache-first')
  })
})

describe('registration', () => {
  it('registers the service worker only in production builds', () => {
    expect(main).toContain('import.meta.env.PROD')
    expect(main).toContain("'/sw.js'")
  })

  it('links the manifest from index.html', () => {
    expect(indexHtml).toContain('rel="manifest"')
    expect(indexHtml).toContain('/manifest.json')
  })
})

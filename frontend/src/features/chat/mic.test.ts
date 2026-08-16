import { afterEach, describe, expect, it } from 'vitest'
import { isLocalhostOrLoopback, isMicAvailable, micOriginNeedsSecureContext } from './mic'

describe('isLocalhostOrLoopback (ported from static/boot.js)', () => {
  it('accepts localhost, .localhost, and loopback addresses', () => {
    for (const hostname of ['localhost', 'foo.localhost', '127.0.0.1', '127.8.8.8', '::1', '0:0:0:0:0:0:0:1', '[::1]']) {
      expect(isLocalhostOrLoopback(hostname)).toBe(true)
    }
  })

  it('rejects real hosts', () => {
    for (const hostname of ['10.0.0.5', 'example.com', 'hermes.local', '192.168.1.10', '']) {
      expect(isLocalhostOrLoopback(hostname)).toBe(false)
    }
  })
})

describe('micOriginNeedsSecureContext (ported from static/boot.js)', () => {
  it('is false when the context is already secure', () => {
    expect(micOriginNeedsSecureContext({ isSecureContext: true, protocol: 'http:', hostname: '10.0.0.5' })).toBe(false)
  })

  it('is false for http on localhost/loopback hosts', () => {
    for (const hostname of ['localhost', 'foo.localhost', '127.0.0.1', '127.8.8.8', '::1']) {
      expect(micOriginNeedsSecureContext({ isSecureContext: false, protocol: 'http:', hostname })).toBe(false)
    }
  })

  it('is true for http on a non-loopback host', () => {
    expect(micOriginNeedsSecureContext({ isSecureContext: false, protocol: 'http:', hostname: '10.0.0.5' })).toBe(true)
    expect(micOriginNeedsSecureContext({ isSecureContext: false, protocol: 'http:', hostname: 'example.com' })).toBe(true)
  })

  it('is false for https on any host', () => {
    expect(micOriginNeedsSecureContext({ isSecureContext: false, protocol: 'https:', hostname: '10.0.0.5' })).toBe(false)
  })
})

describe('isMicAvailable', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'webkitSpeechRecognition')
    Reflect.deleteProperty(window, 'SpeechRecognition')
  })

  class FakeRecognition {
    lang = ''
    continuous = false
    interimResults = false
    onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null = null
    onend: (() => void) | null = null
    onerror: ((event: { error?: string }) => void) | null = null
    start(): void {}
    stop(): void {}
    abort(): void {}
  }

  it('is false when the browser has no Web Speech API, even on a secure origin', () => {
    expect(isMicAvailable({ isSecureContext: true, protocol: 'https:', hostname: 'example.com' })).toBe(false)
  })

  it('is true with SpeechRecognition on a secure origin', () => {
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true })
    expect(isMicAvailable({ isSecureContext: true, protocol: 'https:', hostname: 'example.com' })).toBe(true)
  })

  it('is true with SpeechRecognition on http://localhost', () => {
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true })
    expect(isMicAvailable({ isSecureContext: false, protocol: 'http:', hostname: 'localhost' })).toBe(true)
  })

  it('is false when the secure-context gate fails (http on a non-loopback host)', () => {
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true })
    expect(isMicAvailable({ isSecureContext: false, protocol: 'http:', hostname: '10.0.0.5' })).toBe(false)
    expect(isMicAvailable({ isSecureContext: false, protocol: 'http:', hostname: 'example.com' })).toBe(false)
  })
})

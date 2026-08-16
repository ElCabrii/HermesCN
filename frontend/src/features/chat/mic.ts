/**
 * Voice input helpers — the secure-context gate ported from static/boot.js
 * (`_micOriginNeedsSecureContext` / `_micIsLocalhostOrLoopback`).
 *
 * MediaRecorder → /api/transcribe fallback is intentionally OUT of scope for
 * the remake (Task 3.4); the gate below only decides whether the browser's
 * Web Speech API is allowed to run from this origin.
 */

/** True when a hostname is localhost or a loopback address (boot.js). */
export function isLocalhostOrLoopback(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    /^127\./.test(host)
  )
}

/**
 * Speech recognition is not allowed on plain http for non-loopback hosts.
 * Mirrors boot.js `_micOriginNeedsSecureContext` exactly.
 */
export function micOriginNeedsSecureContext(env: {
  isSecureContext: boolean
  protocol: string
  hostname: string
}): boolean {
  if (env.isSecureContext === true) return false
  const protocol = env.protocol || ''
  return protocol === 'http:' && !isLocalhostOrLoopback(env.hostname)
}

/** Minimal structural typing for the Web Speech API (absent from TS DOM lib). */
export interface SpeechRecognitionResultLike {
  readonly length: number
  readonly [index: number]: { transcript: string }
  readonly isFinal: boolean
}

export interface SpeechRecognitionEventLike {
  readonly results: ArrayLike<SpeechRecognitionResultLike>
}

export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}

/** The browser's speech recognition constructor, when one is provided. */
export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as SpeechRecognitionWindow
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Origin/environment shape consumed by the availability gate. */
export type MicEnvironment = {
  isSecureContext: boolean
  protocol: string
  hostname: string
}

/**
 * True when voice input can run on this origin: the browser must provide the
 * Web Speech API and the secure-context gate must pass (boot.js gate).
 */
export function isMicAvailable(env: MicEnvironment): boolean {
  return Boolean(getSpeechRecognitionCtor()) && !micOriginNeedsSecureContext(env)
}

import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { ThemeContext } from '@/theme/ThemeProvider'
import { DEFAULT_SKIN, DEFAULT_THEME, type ThemeMode } from '@/theme/skins'
import { getApprovalPending, type ApprovalEntry, type ClarifyEntry } from '@/api/chat'
import { getModels, type ModelsCatalog } from '@/api/models'
import { getSettings, SETTINGS_CHANGED_EVENT } from '@/api/panels'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  attachStream,
  busyAtom,
  cancelStream,
  chatStore,
  loadSession,
  messagesAtom,
  newSession as storeNewSession,
  onChatEvent,
  pendingApprovalAtom,
  pendingClarifyAtom,
  pendingFilesAtom,
  sendMessage,
  sessionAtom,
  streamIdAtom,
  terminalOpenAtom,
} from './chatStore'
import { ApprovalCard } from './ApprovalCard'
import { ClarifyDialog } from './ClarifyDialog'
import { getSpeechRecognitionCtor, isMicAvailable, type SpeechRecognitionLike } from './mic'
import { ModelSelector } from './ModelSelector'
import { PendingFiles } from './PendingFiles'
import { SlashMenu, type SlashMatch } from './SlashMenu'
import {
  activeSlashOffset,
  consumeForcedSkillDirective,
  getCommand,
  getSlashAutocompleteMatches,
  parseCommand,
  runSlashCommand,
  type SlashCommandContext,
} from './slashCommands'
import { ArrowUpIcon, MicIcon, PaperclipIcon, SquareIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ContextRing } from './ContextRing'

/** Approval fallback poll cadence (legacy messages.js `_startApprovalFallbackPoll`). */
const APPROVAL_POLL_MS = 1500

/** Ceiling for the auto-growing input, so a long draft cannot swallow the transcript. */
const COMPOSER_MAX_HEIGHT_PX = 220

/** Which chord sends the message (settings.json `send_key`). */
type SendKey = 'enter' | 'ctrl+enter' | 'shift+enter'

const SEND_KEYS: SendKey[] = ['enter', 'ctrl+enter', 'shift+enter']

function asSendKey(value: unknown): SendKey {
  return typeof value === 'string' && (SEND_KEYS as string[]).includes(value)
    ? (value as SendKey)
    : 'enter'
}

/** Does this Enter keypress mean "send" under the configured send key? */
function isSendChord(event: KeyboardEvent<HTMLTextAreaElement>, sendKey: SendKey): boolean {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return false
  const withMod = event.metaKey || event.ctrlKey
  switch (sendKey) {
    case 'ctrl+enter':
      return withMod
    case 'shift+enter':
      return event.shiftKey && !withMod
    default:
      // Plain Enter sends; ⌘/Ctrl-Enter is accepted too so the muscle memory
      // from every other chat client still works.
      return !event.shiftKey || withMod
  }
}

const SEND_HINTS: Record<SendKey, string> = {
  enter: 'Send (Enter)',
  'ctrl+enter': 'Send (⌘/Ctrl + Enter)',
  'shift+enter': 'Send (Shift + Enter)',
}

/** Stable one-liner for an unknown error value (toast payloads). */
function errorMessage(e: unknown): string {
  return e && typeof e === 'object' && 'message' in e
    ? String((e as { message: unknown }).message)
    : String(e ?? 'unknown error')
}

function sameApproval(a: ApprovalEntry | null, b: ApprovalEntry | null): boolean {
  if (!a || !b) return a === b
  return a.approval_id === b.approval_id && a.command === b.command && a.description === b.description
}

/**
 * Chat composer footer: message input, attach, voice input, model picker,
 * context-usage badge, and the send/cancel control. Wires the UI to chatStore
 * (`sendMessage` / `cancelStream`) and surfaces approval / clarify prompts via
 * `onChatEvent` plus a polling fallback.
 */
export function Composer() {
  const [text, setText] = useState('')
  const [model, setModel] = useState<string | null>(null)
  const [micListening, setMicListening] = useState(false)
  const [catalog, setCatalog] = useState<ModelsCatalog | null>(null)
  const [sendKey, setSendKey] = useState<SendKey>('enter')
  // Slash-command autocomplete state (plan Task 8.7). `slashTextRef` mirrors
  // the draft so async autocomplete results can be dropped when the user
  // typed past them (stale-guard, same pattern as the legacy `input` guard).
  const [slashMatches, setSlashMatches] = useState<SlashMatch[]>([])
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashSelected, setSlashSelected] = useState(0)
  const slashTextRef = useRef('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  // True while a drag carrying files is over the composer.
  const [dragging, setDragging] = useState(false)

  const busy = useAtomValue(busyAtom, { store: chatStore })
  const session = useAtomValue(sessionAtom, { store: chatStore })
  const messages = useAtomValue(messagesAtom, { store: chatStore })
  const pendingFiles = useAtomValue(pendingFilesAtom, { store: chatStore })
  const approval = useAtomValue(pendingApprovalAtom, { store: chatStore })
  const clarify = useAtomValue(pendingClarifyAtom, { store: chatStore })
  const streamId = useAtomValue(streamIdAtom, { store: chatStore })
  const sessionId = session?.session_id ?? null

  // Theme seams for `/theme`; null when no ThemeProvider is mounted (tests,
  // embedders) — commands then fall back to the defaults.
  const themeContext = useContext(ThemeContext)

  const canSend = !busy && (text.trim().length > 0 || pendingFiles.length > 0)

  // Voice input availability: browser Web Speech API + secure-context gate
  // (ported from static/boot.js). MediaRecorder fallback is OUT of scope.
  // TODO(3.4): MediaRecorder → /api/transcribe fallback for browsers without
  // SpeechRecognition.
  const micUnavailable = useMemo(
    () =>
      !isMicAvailable({
        isSecureContext: window.isSecureContext,
        protocol: window.location.protocol,
        hostname: window.location.hostname,
      }),
    [],
  )

  /**
   * The user's send-key preference. It has always been offered in Settings and
   * never honoured here, so picking "ctrl+enter" changed nothing and Enter kept
   * firing off half-written messages. Re-read on save so the choice applies
   * without a reload.
   */
  useEffect(() => {
    let cancelled = false
    const apply = (settings: Record<string, unknown> | null | undefined) => {
      if (!cancelled) setSendKey(asSendKey(settings?.send_key))
    }
    getSettings().then(apply).catch(() => {
      // Unreachable settings: keep the Enter default.
    })
    const onChanged = (event: Event) => apply((event as CustomEvent).detail)
    window.addEventListener(SETTINGS_CHANGED_EVENT, onChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onChanged)
    }
  }, [])

  // Model catalog for the selector; failures fall back to the session model.
  useEffect(() => {
    let cancelled = false
    getModels()
      .then((c) => {
        if (!cancelled) setCatalog(c)
      })
      .catch(() => {
        // selector shows the session model; nothing to do
      })
    return () => {
      cancelled = true
    }
  }, [])

  // A picked model belongs to the current session; reset on session switch.
  useEffect(() => {
    setModel(null)
  }, [sessionId])

  // Stream events: surface approval / clarify prompts (store atoms); terminal
  // frames clear them so a card can never outlive its turn.
  useEffect(() => {
    return onChatEvent((event) => {
      switch (event.type) {
        case 'approval':
          chatStore.set(pendingApprovalAtom, event.data as ApprovalEntry)
          break
        case 'clarify':
          chatStore.set(pendingClarifyAtom, event.data as ClarifyEntry)
          break
        case 'done':
        case 'cancel':
        case 'error':
        case 'apperror':
          chatStore.set(pendingApprovalAtom, null)
          chatStore.set(pendingClarifyAtom, null)
          break
        default:
          break
      }
    })
  }, [])

  /**
   * Esc stops the run. Stopping a runaway turn is the most urgent thing a user
   * can want from this surface, and reaching for the mouse to hit a small
   * square button is the wrong cost for it. Skipped while a dialog or the slash
   * menu owns Escape, and while an approval prompt is waiting on a decision.
   */
  useEffect(() => {
    if (!busy) return
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('[role="dialog"]')) return
      if (chatStore.get(pendingApprovalAtom) || chatStore.get(pendingClarifyAtom)) return
      event.preventDefault()
      void cancelStream()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy])

  // Approval fallback poll: while busy, refresh the pending approval every
  // 1.5s (legacy `_startApprovalFallbackPoll`). The SSE path above stays the
  // fast channel; this covers missed frames.
  useEffect(() => {
    if (!busy || !sessionId) return
    let cancelled = false
    let inFlight = false
    const tick = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const data = await getApprovalPending(sessionId)
        if (cancelled) return
        if (data.pending) {
          chatStore.set(pendingApprovalAtom, (prev) => (sameApproval(prev, data.pending) ? prev : data.pending))
        } else {
          chatStore.set(pendingApprovalAtom, null)
        }
      } catch {
        // poll errors are ignored (legacy behavior)
      } finally {
        inFlight = false
      }
    }
    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, APPROVAL_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [busy, sessionId])

  /**
   * Grow the input with its content instead of trapping multi-line drafts in a
   * one-row box with an inner scrollbar. Height is recomputed from scrollHeight
   * on every change (reset to 'auto' first so the box can also shrink back when
   * text is deleted) and capped so the composer can never eat the transcript.
   */
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`
  }, [text])

  // Compact circular context-usage badge (DESIGN.md). Prefers the session's
  // usage fields; falls back to a chars/4 estimate of the transcript so the
  // badge is live while tokens stream in.
  const contextPct = useMemo(() => {
    const ctxLength = typeof session?.context_length === 'number' ? session.context_length : 0
    if (!ctxLength || ctxLength <= 0) return null
    let tokens: number | null =
      typeof session?.last_prompt_tokens === 'number' ? session.last_prompt_tokens : null
    if (tokens == null) {
      tokens = messages.reduce((sum, m) => sum + Math.ceil(String(m.content ?? '').length / 4), 0)
    }
    if (!tokens || tokens <= 0) return null
    return Math.min(100, Math.max(0, Math.round((tokens / ctxLength) * 100)))
  }, [session, messages])

  /** Absolute token figures behind the ring's tooltip, when the session has them. */
  const contextDetail = useMemo(() => {
    const ctxLength = typeof session?.context_length === 'number' ? session.context_length : 0
    const tokens = typeof session?.last_prompt_tokens === 'number' ? session.last_prompt_tokens : null
    if (!ctxLength || tokens == null) return null
    return `${tokens.toLocaleString()} of ${ctxLength.toLocaleString()} tokens`
  }, [session])

  /**
   * Range of the active slash token being completed (`/name [arg]`), or null
   * when the draft has no active slash token. Used by autocomplete selection
   * to replace exactly the token under the cursor and keep prefix + suffix.
   */
  const slashTokenRange = (value: string): { start: number; end: number } | null => {
    const offset = activeSlashOffset(value)
    if (offset < 0) return null
    let nameEnd = offset + 1
    while (nameEnd < value.length && !/\s/.test(value[nameEnd])) nameEnd++
    let end = nameEnd
    let argStart = nameEnd
    while (argStart < value.length && /\s/.test(value[argStart])) argStart++
    if (argStart < value.length) {
      let argEnd = argStart
      while (argEnd < value.length && !/\s/.test(value[argEnd])) argEnd++
      end = argEnd
    }
    return { start: offset, end }
  }

  /**
   * Refresh the slash autocomplete matches for the current draft. The menu is
   * open whenever a valid slash token is active and matches exist (legacy
   * `showCmdDropdown` on every input). Async results are dropped when the
   * draft moved on while the catalog lookups were in flight.
   */
  const refreshSlashAutocomplete = (value: string) => {
    slashTextRef.current = value
    if (activeSlashOffset(value) < 0) {
      setSlashMatches([])
      setSlashOpen(false)
      return
    }
    void getSlashAutocompleteMatches(value).then((matches) => {
      if (slashTextRef.current !== value) return
      setSlashMatches(matches)
      setSlashOpen(matches.length > 0)
      setSlashSelected((sel) => (matches.length === 0 ? 0 : Math.min(sel, matches.length - 1)))
    })
  }

  /** Insert a selected autocomplete row into the draft, keeping prefix/suffix. */
  const applySlashMatch = (match: SlashMatch) => {
    const current = slashTextRef.current
    const range = slashTokenRange(current)
    if (!range) {
      setSlashOpen(false)
      return
    }
    const prefix = current.slice(0, range.start)
    const suffix = current.slice(range.end).replace(/^\s+/, '')
    const insertion = match.kind === 'command' ? `/${match.name} ` : `/${match.parent} ${match.value} `
    const next = `${prefix}${insertion}${suffix}`
    slashTextRef.current = next
    setText(next)
    // Re-run autocomplete so sub-arg rows open right after a command select
    // (legacy re-queries after filling `/name `).
    refreshSlashAutocomplete(next)
  }

  /**
   * Live UI context for the slash command registry: the store atoms and the
   * surface seams (theme, terminal, mic, drafts) captured at dispatch time.
   */
  const buildSlashContext = (): SlashCommandContext => ({
    session,
    busy,
    streamId,
    messages,
    sessionId,
    appendAssistant: (content) => {
      chatStore.set(messagesAtom, [
        ...chatStore.get(messagesAtom),
        { role: 'assistant', content, ts: Date.now() / 1000 },
      ])
    },
    replaceMessages: (next) => chatStore.set(messagesAtom, next),
    setSession: (next) => chatStore.set(sessionAtom, next),
    setBusy: (next) => chatStore.set(busyAtom, next),
    setStreamId: (next) => chatStore.set(streamIdAtom, next),
    setDraft: (next) => {
      slashTextRef.current = next
      setText(next)
    },
    newSession: () => storeNewSession(),
    loadSession: (sid) => loadSession(sid),
    sendAsUser: (text) => sendMessage(text, [], model ?? undefined),
    cancelStream: () => cancelStream(),
    attachStream: (sid, streamId) => attachStream(sid, streamId),
    getTheme: () =>
      themeContext
        ? { theme: themeContext.theme, skin: themeContext.skin }
        : { theme: DEFAULT_THEME, skin: DEFAULT_SKIN },
    setTheme: (theme: ThemeMode) => themeContext?.setTheme(theme),
    setSkin: (skin: string) => themeContext?.setSkin(skin),
    openTerminal: () => chatStore.set(terminalOpenAtom, true),
    micAvailable: !micUnavailable,
    toggleMic: () => toggleMic(),
    toast: (message) => toast(message),
    toastError: (message) => toast(message),
  })

  /**
   * Send pipeline (plan Task 8.7). An exact slash command dispatches to the
   * registry first and never falls through as a chat message; commands
   * without `noEcho` get a user echo (legacy #840). A handler returning
   * `false` opts out — the text then follows the normal send path. Ordinary
   * sends consume any pending forced-skill directive (legacy send() await)
   * and prepend it to the user turn.
   */
  const runComposerSend = async (message: string) => {
    const trimmed = message.trim()
    const parsed = parseCommand(trimmed)
    const command = parsed ? getCommand(parsed.name) : undefined
    if (parsed && command) {
      let handled = false
      try {
        handled = await runSlashCommand(command, parsed.args, buildSlashContext())
      } catch (error) {
        // A crashing handler must not lose the draft or produce an unhandled
        // rejection — surface the error and fall through to the normal send.
        toast(errorMessage(error))
      }
      if (handled) {
        if (!command.noEcho) {
          chatStore.set(messagesAtom, [
            ...chatStore.get(messagesAtom),
            { role: 'user', content: trimmed, ts: Date.now() / 1000 },
          ])
        }
        return
      }
      // Handler opted out (legacy `fn(...) === false`): fall through.
    }
    const directive = await consumeForcedSkillDirective(sessionId ?? '')
    const finalText = directive ? `${directive.directive}\n\n${directive.content}\n\n${message}` : message
    await sendMessage(finalText, pendingFiles, model ?? undefined)
  }

  const handleSend = () => {
    if (!canSend) return
    const message = text
    setText('')
    slashTextRef.current = ''
    setSlashMatches([])
    setSlashOpen(false)
    void runComposerSend(message)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // With the autocomplete menu open, arrows navigate, Tab/Enter select the
    // highlighted row, and Escape closes the menu (legacy keydown contract).
    if (slashOpen && slashMatches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlashSelected((i) => (i + 1) % slashMatches.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlashSelected((i) => (i - 1 + slashMatches.length) % slashMatches.length)
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        applySlashMatch(slashMatches[slashSelected] ?? slashMatches[0])
        return
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault()
        applySlashMatch(slashMatches[slashSelected] ?? slashMatches[0])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlashSelected(0)
        setSlashOpen(false)
        return
      }
    }
    if (isSendChord(event, sendKey)) {
      event.preventDefault()
      handleSend()
    }
  }

  /** Single funnel for every attachment source: picker, paste, and drop. */
  const addFiles = (files: File[]) => {
    if (files.length === 0) return
    chatStore.set(pendingFilesAtom, [...chatStore.get(pendingFilesAtom), ...files])
  }

  const handleFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  /**
   * Paste-to-attach. Screenshots are the most common thing a user wants to hand
   * an agent, and they arrive on the clipboard with no filename — synthesize a
   * readable one so the pending chip and the server both have something to show.
   */
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items ?? [])
    const pasted: File[] = []
    for (const item of items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file) continue
      if (file.name && file.name !== 'image.png') {
        pasted.push(file)
        continue
      }
      const ext = file.type.split('/')[1] || 'png'
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      pasted.push(new File([file], `pasted-${stamp}.${ext}`, { type: file.type }))
    }
    if (pasted.length === 0) return
    // Only claim the event when we actually took files; plain text paste must
    // keep its native behavior.
    event.preventDefault()
    addFiles(pasted)
    toast(pasted.length === 1 ? 'Attached pasted file' : `Attached ${pasted.length} pasted files`)
  }

  const dragCarriesFiles = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!dragCarriesFiles(event) || busy) return
    event.preventDefault()
    setDragging(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    // Ignore the leave events fired while crossing child elements.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!dragCarriesFiles(event)) return
    event.preventDefault()
    setDragging(false)
    if (busy) return
    addFiles(Array.from(event.dataTransfer?.files ?? []))
  }

  const toggleMic = () => {
    if (micListening) {
      recognitionRef.current?.stop()
      return
    }
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return
    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.onresult = (event) => {
      const results = event.results
      const last = results[results.length - 1]
      const transcript = last?.[0]?.transcript ?? ''
      if (transcript) setText((prev) => (prev ? `${prev} ${transcript}` : transcript))
    }
    recognition.onend = () => {
      setMicListening(false)
      recognitionRef.current = null
    }
    recognition.onerror = () => {
      setMicListening(false)
      recognitionRef.current = null
    }
    recognitionRef.current = recognition
    setMicListening(true)
    recognition.start()
  }

  const micTitle = micUnavailable
    ? 'Voice input unavailable — needs HTTPS or localhost'
    : micListening
      ? 'Stop listening'
      : 'Voice input'

  return (
    <footer
      data-testid="composer"
      data-dragging={dragging ? 'true' : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      // The bottom padding clears the iOS home indicator; without the safe-area
      // inset the send button sits under it on a phone.
      className="relative border-t border-border bg-background/95 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      {slashOpen && slashMatches.length > 0 && (
        <SlashMenu
          matches={slashMatches}
          selected={slashSelected}
          onSelect={applySlashMatch}
          onMouseEnter={(index) => setSlashSelected(index)}
        />
      )}
      {/* Drop target feedback. Files could always be dropped nowhere before;
          now the whole composer accepts them and says so. */}
      {dragging && (
        <div
          data-testid="composer-drop-overlay"
          className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-background/85 text-sm font-medium text-foreground"
        >
          Drop files to attach
        </div>
      )}
      <PendingFiles
        files={pendingFiles}
        onRemove={(index) =>
          chatStore.set(pendingFilesAtom, pendingFiles.filter((_, i) => i !== index))
        }
      />
      {/* Two rows: the draft owns the full width, controls sit underneath. The
          previous single row squeezed the text between five controls, so the
          model name truncated and long drafts had almost no room. */}
      <div
        className={cn(
          'group/composer flex flex-col gap-1 rounded-2xl border border-border bg-card/60 px-2 py-1.5 transition-colors',
          'focus-within:border-accent/60 focus-within:bg-card',
        )}
      >
        <Textarea
          ref={textareaRef}
          aria-label="Message"
          data-testid="composer-textarea"
          value={text}
          onChange={(event) => {
            const value = event.target.value
            slashTextRef.current = value
            setText(value)
            refreshSlashAutocomplete(value)
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Message Hermes…  (type / for commands)"
          rows={1}
          className="min-h-0 w-full resize-none overflow-y-auto border-0 bg-transparent px-1 py-1.5 text-sm leading-[1.55] shadow-none focus-visible:ring-0"
          style={{ maxHeight: COMPOSER_MAX_HEIGHT_PX }}
        />
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Attach files"
            title="Attach files — or paste and drop them here"
            className="text-muted-foreground"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <PaperclipIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Voice input"
            aria-pressed={micListening}
            title={micTitle}
            className={cn(
              'text-muted-foreground',
              micListening && 'bg-destructive/15 text-destructive',
            )}
            disabled={micUnavailable || busy}
            onClick={toggleMic}
          >
            {micListening ? <SquareIcon /> : <MicIcon />}
          </Button>
          <ModelSelector
            value={model}
            catalog={catalog}
            currentLabel={session?.model ?? null}
            onChange={setModel}
          />
          <div className="flex-1" />
          <ContextRing pct={contextPct} detail={contextDetail} />
          {busy ? (
            <Button
              variant="destructive"
              size="icon"
              aria-label="Stop"
              title="Stop generating (Esc)"
              onClick={() => void cancelStream()}
            >
              <SquareIcon />
            </Button>
          ) : (
            <Button
              size="icon"
              aria-label="Send"
              title={SEND_HINTS[sendKey]}
              disabled={!canSend}
              onClick={handleSend}
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        aria-label="Attach files"
        className="sr-only"
        tabIndex={-1}
        onChange={handleFilesChange}
      />
      {approval && sessionId && (
        <ApprovalCard
          entry={approval}
          sessionId={sessionId}
          onResolved={() => chatStore.set(pendingApprovalAtom, null)}
        />
      )}
      {clarify && sessionId && (
        <ClarifyDialog
          entry={clarify}
          sessionId={sessionId}
          onClose={() => chatStore.set(pendingClarifyAtom, null)}
        />
      )}
    </footer>
  )
}

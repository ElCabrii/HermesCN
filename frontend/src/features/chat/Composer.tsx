import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useAtomValue } from 'jotai'
import { getApprovalPending, type ApprovalEntry, type ClarifyEntry } from '@/api/chat'
import { getModels, type ModelsCatalog } from '@/api/models'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  busyAtom,
  cancelStream,
  chatStore,
  messagesAtom,
  onChatEvent,
  pendingFilesAtom,
  sendMessage,
  sessionAtom,
} from './chatStore'
import { ApprovalCard } from './ApprovalCard'
import { ClarifyDialog } from './ClarifyDialog'
import { getSpeechRecognitionCtor, isMicAvailable, type SpeechRecognitionLike } from './mic'
import { ModelSelector } from './ModelSelector'
import { PendingFiles } from './PendingFiles'
import { ArrowUpIcon, MicIcon, PaperclipIcon, SquareIcon } from 'lucide-react'

/** Approval fallback poll cadence (legacy messages.js `_startApprovalFallbackPoll`). */
const APPROVAL_POLL_MS = 1500

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
  const [approval, setApproval] = useState<ApprovalEntry | null>(null)
  const [clarify, setClarify] = useState<ClarifyEntry | null>(null)
  const [micListening, setMicListening] = useState(false)
  const [catalog, setCatalog] = useState<ModelsCatalog | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const busy = useAtomValue(busyAtom, { store: chatStore })
  const session = useAtomValue(sessionAtom, { store: chatStore })
  const messages = useAtomValue(messagesAtom, { store: chatStore })
  const pendingFiles = useAtomValue(pendingFilesAtom, { store: chatStore })
  const sessionId = session?.session_id ?? null

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

  // Stream events: surface approval / clarify prompts; clear them on terminal
  // frames so a card can never outlive its turn.
  useEffect(() => {
    return onChatEvent((event) => {
      switch (event.type) {
        case 'approval':
          setApproval(event.data as ApprovalEntry)
          break
        case 'clarify':
          setClarify(event.data as ClarifyEntry)
          break
        case 'done':
        case 'cancel':
        case 'error':
          setApproval(null)
          setClarify(null)
          break
        default:
          break
      }
    })
  }, [])

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
          setApproval((prev) => (sameApproval(prev, data.pending) ? prev : data.pending))
        } else {
          setApproval(null)
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

  const handleSend = () => {
    if (!canSend) return
    const message = text
    setText('')
    void sendMessage(message, pendingFiles, model ?? undefined)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      handleSend()
    }
  }

  const handleFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    chatStore.set(pendingFilesAtom, [...chatStore.get(pendingFilesAtom), ...files])
    event.target.value = ''
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
    <footer data-testid="composer" className="border-t border-border bg-background/95 px-3 pt-2 pb-2.5">
      <PendingFiles files={pendingFiles} onRemove={(index) => chatStore.set(pendingFilesAtom, pendingFiles.filter((_, i) => i !== index))} />
      <div className="flex items-end gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Attach files"
          title="Attach files"
          className="text-muted-foreground"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <PaperclipIcon />
        </Button>
        <Textarea
          aria-label="Message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message…"
          rows={1}
          className="min-h-0 max-h-[200px] resize-none overflow-y-auto border-border bg-background/60 py-2 pr-3 pl-3 text-sm"
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Voice input"
          aria-pressed={micListening}
          title={micTitle}
          className={micListening ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}
          disabled={micUnavailable || busy}
          onClick={toggleMic}
        >
          {micListening ? <SquareIcon /> : <MicIcon />}
        </Button>
        <ModelSelector value={model} catalog={catalog} currentLabel={session?.model ?? null} onChange={setModel} />
        <span
          data-testid="context-usage"
          data-context-pct={contextPct ?? undefined}
          title={contextPct != null ? `Context: ${contextPct}% used` : 'Context usage unknown'}
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[10px] text-muted-foreground"
        >
          {contextPct != null ? `${contextPct}%` : '–'}
        </span>
        {busy ? (
          <Button variant="destructive" size="icon" aria-label="Stop" title="Stop" onClick={() => void cancelStream()}>
            <SquareIcon />
          </Button>
        ) : (
          <Button size="icon" aria-label="Send" title="Send" disabled={!canSend} onClick={handleSend}>
            <ArrowUpIcon />
          </Button>
        )}
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
      {approval && sessionId && <ApprovalCard entry={approval} sessionId={sessionId} onResolved={() => setApproval(null)} />}
      {clarify && sessionId && <ClarifyDialog entry={clarify} sessionId={sessionId} onClose={() => setClarify(null)} />}
    </footer>
  )
}

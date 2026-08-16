import { useEffect, useState } from 'react'
import { ApiError } from '@/api/client'
import { getSharedTranscript, type SharedTranscript } from '@/api/share'
import { Markdown } from '@/features/chat/Markdown'

/**
 * Public read-only share page (route /share/:token, wired in a later task).
 *
 * Renders the sanitized snapshot from GET /api/share/<token> — no auth, no
 * interactivity. Layout mirrors the chat transcript contract (DESIGN.md):
 * user messages right-aligned bubbles, assistant prose left via the shared
 * Markdown component. Tool/system traces never reach this page (the backend
 * drops them in `_sanitize_message`); a defensive role filter keeps them
 * quiet even against a malformed payload.
 */

type ShareStatus = 'loading' | 'ready' | 'not-found' | 'error'

const EMPTY_NOTE = 'This shared conversation has no visible messages.'

function ShareMeta({ transcript }: { transcript: SharedTranscript }) {
  const count = transcript.message_count ?? transcript.messages.length
  const stamp = transcript.updated_at ?? transcript.created_at
  return (
    <p className="text-xs text-muted-foreground">
      <span data-testid="share-count">
        {count} message{count === 1 ? '' : 's'} · public read-only snapshot
      </span>
      {typeof stamp === 'number' && (
        <>
          {' · '}
          <time data-testid="share-timestamp" dateTime={new Date(stamp * 1000).toISOString()}>
            {new Date(stamp * 1000).toLocaleString()}
          </time>
        </>
      )}
    </p>
  )
}

function SharedMessages({ transcript }: { transcript: SharedTranscript }) {
  const messages = transcript.messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  )
  if (messages.length === 0) {
    return <p className="text-sm text-muted-foreground">{EMPTY_NOTE}</p>
  }
  return (
    <div className="mt-4 flex flex-col gap-3" data-testid="share-transcript">
      {messages.map((message, i) =>
        message.role === 'user' ? (
          <div key={i} data-role="user" className="flex justify-end">
            <div className="user-bubble">
              <Markdown content={message.content} />
            </div>
          </div>
        ) : (
          <div key={i} data-role="assistant" className="flex flex-col gap-2">
            <div className="prose" data-prose="true">
              <Markdown content={message.content} />
            </div>
          </div>
        ),
      )}
    </div>
  )
}

export function SharePage({ token }: { token: string }) {
  const [status, setStatus] = useState<ShareStatus>('loading')
  const [transcript, setTranscript] = useState<SharedTranscript | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setTranscript(null)
    setError(null)
    getSharedTranscript(token)
      .then(({ share }) => {
        if (cancelled) return
        setTranscript(share)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setStatus('not-found')
        } else {
          setStatus('error')
          setError(err instanceof Error ? err.message : 'This shared conversation could not be loaded.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <h1 className="text-sm font-semibold">Shared conversation</h1>
        {status === 'ready' && transcript && (
          <span className="truncate text-xs text-muted-foreground">{transcript.title}</span>
        )}
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-4">
          {status === 'loading' && (
            <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
              Loading shared conversation…
            </div>
          )}
          {status === 'not-found' && (
            <div data-testid="share-not-found" className="text-sm text-muted-foreground">
              Shared conversation not found
            </div>
          )}
          {status === 'error' && (
            <div role="alert" className="text-sm text-destructive">
              {error}
            </div>
          )}
          {status === 'ready' && transcript && (
            <article>
              <h2 className="text-xl font-semibold">{transcript.title}</h2>
              <ShareMeta transcript={transcript} />
              <SharedMessages transcript={transcript} />
            </article>
          )}
        </div>
      </main>
    </div>
  )
}

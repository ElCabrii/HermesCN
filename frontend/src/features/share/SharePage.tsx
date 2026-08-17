import { useEffect, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { LinkIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ApiError } from '@/api/client'
import { getSharedTranscript, type SharedTranscript } from '@/api/share'
import { Markdown } from '@/features/chat/Markdown'

/**
 * Public read-only share page (route /share/:token in App.tsx).
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

/** Centered notice used by the share page's non-content states. */
function ShareNotice({
  icon,
  title,
  body,
  tone = 'muted',
  ...props
}: {
  icon: ReactNode
  title: string
  body: string
  tone?: 'muted' | 'destructive'
} & ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className="flex flex-col items-center gap-3 px-4 py-24 text-center"
    >
      <div
        className={cn(
          'grid size-11 place-items-center rounded-xl border',
          tone === 'destructive'
            ? 'border-destructive/30 bg-destructive/10 text-destructive'
            : 'border-border bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      </div>
      <a
        href="/"
        className="text-sm font-medium text-accent underline-offset-4 hover:underline"
      >
        Go to HermesCN
      </a>
    </div>
  )
}

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
            <div className="flex max-w-[80%] flex-col gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm leading-[1.55] text-secondary-foreground">
              <Markdown content={message.content} />
            </div>
          </div>
        ) : (
          <div key={i} data-role="assistant" className="flex flex-col gap-2">
            <Markdown content={message.content} prose />
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
            <div
              role="status"
              aria-live="polite"
              className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground"
            >
              <Loader2Icon className="size-4 animate-spin" />
              Loading shared conversation…
            </div>
          )}
          {/* A stranger following a stale link lands here. A bare line of grey
              text in the top-left corner reads like a broken page, so say what
              happened and offer somewhere to go. */}
          {status === 'not-found' && (
            <ShareNotice
              data-testid="share-not-found"
              icon={<LinkIcon className="size-5" />}
              title="This share link is no longer available"
              body="The conversation may have been unshared or deleted by its owner. Ask them for a fresh link."
            />
          )}
          {status === 'error' && (
            <ShareNotice
              role="alert"
              tone="destructive"
              icon={<TriangleAlertIcon className="size-5" />}
              title="Could not load this conversation"
              body={error ?? 'Something went wrong while fetching the snapshot.'}
            />
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

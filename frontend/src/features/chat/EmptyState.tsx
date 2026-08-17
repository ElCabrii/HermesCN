import { useAtomValue } from 'jotai'
import { chatStore, sessionAtom } from './chatStore'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  ArrowRightIcon,
  CodeIcon,
  FileTextIcon,
  LightbulbIcon,
  SearchIcon,
  TerminalSquareIcon,
} from 'lucide-react'

/**
 * Empty state for the chat column.
 *
 * Shown when the active session has no messages yet. Surfaces:
 *  - Brand & tone (Hermes Calm Console voice from DESIGN.md).
 *  - Workspace context (the active session's working directory).
 *  - Prompt suggestions as quiet one-click starters that fill the composer
 *    draft; the user still has to send. The cards double as a tour of the
 *    main agent capabilities.
 *
 * Visual contract:
 *  - Centered, narrow column, generous vertical breathing room.
 *  - Editorial serif headline, sans body, mono path.
 *  - One accent color at a time (the active skin).
 */

interface Prompt {
  icon: typeof CodeIcon
  title: string
  body: string
  draft: string
}

const PROMPTS: Prompt[] = [
  {
    icon: CodeIcon,
    title: 'Refactor a module',
    body: 'Improve readability and performance of a function you point me at.',
    draft: 'Refactor the function in ',
  },
  {
    icon: SearchIcon,
    title: 'Explore the codebase',
    body: 'Get a tour of how a project is organized before you change anything.',
    draft: 'Give me a tour of this project: structure, key modules, and where to start.',
  },
  {
    icon: FileTextIcon,
    title: 'Draft a document',
    body: 'Write a spec, README, or commit message in your voice.',
    draft: 'Draft a README for this project that explains what it does and how to run it.',
  },
  {
    icon: TerminalSquareIcon,
    title: 'Run a command',
    body: 'Plan, run, and explain shell commands with approval.',
    draft: 'Show me the largest files in this repo and what they do.',
  },
  {
    icon: LightbulbIcon,
    title: 'Brainstorm',
    body: 'Think through a problem with structured options and tradeoffs.',
    draft: 'Help me think through ',
  },
]

export function EmptyState() {
  const session = useAtomValue(sessionAtom, { store: chatStore })
  const workspace = session?.workspace ?? null

  return (
    <div
      data-testid="chat-empty-state"
      // min-h-full, not h-full: on a phone the hero + five starters are taller
      // than the column, and a centered fixed-height box pushed the headline
      // above the scroll origin where it could never be read.
      className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center gap-8 px-4 py-12"
    >
      {/* Hero */}
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          aria-hidden="true"
          className="grid size-12 place-items-center rounded-2xl border border-border bg-card text-accent shadow-sm"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="size-6"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 7h16M4 12h10M4 17h16" />
            <circle cx="20" cy="12" r="1.5" fill="currentColor" stroke="none" />
          </svg>
        </div>
        {/* Sans, like the rest of the console: with conversation prose moved
            off the serif this headline was the only serif left in the app. */}
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Calm workbench for your agent.
        </h2>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          Conversational content first, tool traces as quiet metadata. Ask anything,
          give a task, or browse commands with{' '}
          <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-[11px]">
            /
          </kbd>
          .
        </p>
      </div>

      {/* Workspace context */}
      {workspace && (
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
          <span className="font-mono text-foreground/80">{shortPath(workspace)}</span>
        </div>
      )}

      {/* Prompt starters */}
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {PROMPTS.map((prompt) => (
          <PromptCard key={prompt.title} prompt={prompt} />
        ))}
      </div>

      {/* Footnote */}
      <p className="text-[11px] text-muted-foreground/80">
        Press{' '}
        <kbd className="rounded border border-border bg-muted px-1.5 py-px font-mono text-[11px]">
          ⌘/
        </kbd>{' '}
        for keyboard shortcuts.
      </p>
    </div>
  )
}

function PromptCard({ prompt }: { prompt: Prompt }) {
  const [hover, setHover] = useState(false)
  const Icon = prompt.icon
  return (
    <button
      type="button"
      data-testid={`empty-state-prompt-${prompt.title.toLowerCase().replace(/\s+/g, '-')}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => fillDraft(prompt.draft)}
      className={cn(
        'group flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-all duration-200',
        'hover:border-accent/40 hover:bg-accent/5 hover:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
      )}
    >
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground transition-colors duration-200',
          'group-hover:border-accent/30 group-hover:bg-accent/10 group-hover:text-accent',
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground">{prompt.title}</h3>
          <ArrowRightIcon
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-all duration-200',
              'group-hover:translate-x-0.5 group-hover:text-accent',
              hover ? 'opacity-100' : 'opacity-0',
            )}
          />
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{prompt.body}</p>
      </div>
    </button>
  )
}

/**
 * Fill the composer draft without dispatching send. Uses the textarea the
 * Composer reads on mount (data-testid="composer-textarea"). Falls back to a
 * contenteditable insertion if the composer is not yet mounted.
 */
function fillDraft(draft: string) {
  const composer = document.querySelector<HTMLTextAreaElement>('[data-testid="composer-textarea"]')
  if (composer) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set
    nativeSetter?.call(composer, draft)
    composer.dispatchEvent(new Event('input', { bubbles: true }))
    composer.focus()
    composer.setSelectionRange(draft.length, draft.length)
  }
}

/** Trim a long absolute path down to its last two segments for display. */
function shortPath(path: string): string {
  if (path.length < 36) return path
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join('/')}`
}

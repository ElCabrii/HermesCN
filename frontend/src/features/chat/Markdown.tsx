import {
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import ReactMarkdown, { defaultUrlTransform, type Components, type UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import 'katex/dist/katex.min.css'
import { cn } from '@/lib/utils'
import { parseWorkspaceHref, requestOpenWorkspaceFile } from '@/features/workspace/workspaceStore'

/**
 * Markdown renderer for the chat transcript.
 *
 * Built on react-markdown + remark-gfm + rehype-katex + rehype-sanitize
 * (Task 3.3) — NOT a port of the legacy hand-rolled `renderMd` regex chain
 * (static/ui.js). Sanitization uses the rehype-sanitize default schema PLUS
 * the legacy SAFE_TAGS allowlist, so every tag the old renderer trusted is
 * still allowed while everything else stays default-restricted.
 *
 * Mermaid diagrams are lazy-loaded: the module is dynamically imported only
 * when the FIRST ```mermaid block mounts, and a plain code fallback is shown
 * if loading or rendering fails.
 */

/** Legacy SAFE_TAGS allowlist (static/ui.js `SAFE_TAGS` reference). */
const LEGACY_SAFE_TAGS = [
  'strong',
  'em',
  'code',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
  'blockquote',
  'p',
  'br',
  'a',
  'div',
]

/** MathML elements emitted by KaTeX (kept so the accessible MathML branch survives sanitization). */
const MATHML_TAGS = [
  'math',
  'maction',
  'annotation',
  'annotation-xml',
  'menclose',
  'merror',
  'mfenced',
  'mfrac',
  'mi',
  'mmultiscripts',
  'mn',
  'mo',
  'mover',
  'mpadded',
  'mphantom',
  'mprescripts',
  'mroot',
  'mrow',
  'ms',
  'mspace',
  'msqrt',
  'mstyle',
  'msub',
  'msubsup',
  'msup',
  'mtable',
  'mtd',
  'mtext',
  'mtr',
  'munder',
  'munderover',
  'semantics',
]

/** Sanitize schema: default schema + legacy SAFE_TAGS + KaTeX MathML needs. */
type SanitizeSchema = NonNullable<Parameters<typeof rehypeSanitize>[0]>

const schema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: Array.from(
    new Set([...(defaultSchema.tagNames ?? []), ...LEGACY_SAFE_TAGS, ...MATHML_TAGS]),
  ),
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    // The default `*` list omits className/aria-hidden, both of which KaTeX
    // output relies on (and which markdown class hooks need).
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'aria-hidden'],
    span: [...(defaultSchema.attributes?.span ?? []), 'style'],
    math: [...(defaultSchema.attributes?.math ?? []), 'aria-hidden'],
    annotation: [...(defaultSchema.attributes?.annotation ?? []), 'encoding'],
  },
  protocols: {
    ...(defaultSchema.protocols ?? {}),
    // Allow the internal `workspace://path` deep-link scheme (legacy #2881);
    // the click is intercepted in the `a` component below, never navigated.
    href: [...(defaultSchema.protocols?.href ?? []), 'workspace'],
  },
}

/** True while rendering a fenced code block (`pre > code`), so inline vs block code can be styled differently. */
const InCodeBlockContext = createContext(false)

/**
 * Link renderer shared by both component sets: `workspace://` deep-links are
 * intercepted (legacy #2881/#2938); every other link opens in a new tab.
 */
function renderLink({
  href,
  className,
  ...props
}: { href?: string; className?: string } & ComponentPropsWithoutRef<'a'>) {
  if (typeof href === 'string' && /^workspace:\/\//i.test(href)) {
    return (
      <a
        {...props}
        href={href}
        className={className}
        onClick={(e) => {
          e.preventDefault()
          const rel = parseWorkspaceHref(href)
          if (rel) requestOpenWorkspaceFile(rel)
        }}
      />
    )
  }
  return <a {...props} href={href} className={className} target="_blank" rel="noopener noreferrer" />
}

/**
 * Code renderer shared by both component sets: mermaid blocks lazy-load; the
 * `prose` flag adds the inline-code chrome (block code inside a `pre` keeps
 * only the mono font — the `pre` supplies the surface).
 */
function CodeRenderer({
  className,
  children,
  prose,
  ...props
}: { className?: string; children?: ReactNode; prose: boolean } & ComponentPropsWithoutRef<'code'>) {
  const inBlock = useContext(InCodeBlockContext)
  if (typeof className === 'string' && /language-mermaid/.test(className)) {
    return <MermaidBlock code={String(children ?? '')} />
  }
  return (
    <code
      className={cn(
        prose
          ? inBlock
            ? 'font-mono'
            : 'rounded-sm bg-muted px-[0.35em] py-[0.12em] font-mono text-[0.86em] break-words text-foreground'
          : className,
        className,
      )}
      {...props}
    >
      {children}
    </code>
  )
}

/** Base renderer (no prose chrome) — used by file previews and the skills panel. */
const baseComponents: Components = {
  a: ({ node: _node, ...props }) => renderLink(props),
  code: ({ node: _node, ...props }) => <CodeRenderer prose={false} {...props} />,
}

/**
 * Prose renderer for the chat transcript / share page (DESIGN.md): editorial
 * serif, prose-first, no heavy bubble. Element styling is expressed as Tailwind
 * utilities (ShadCN convention) instead of a custom `.prose` stylesheet.
 */
const proseComponents: Components = {
  ...baseComponents,
  p: ({ node: _node, ...props }) => <p className="my-[0.7em] first:mt-0 last:mb-0" {...props} />,
  h1: ({ node: _node, ...props }) => (
    <h1 className="my-[1.1em_0_0.5em] text-[1.125rem] leading-[1.35] font-semibold tracking-tight first:mt-0 last:mb-0" {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h2 className="my-[1.1em_0_0.5em] text-[1.0625rem] leading-[1.35] font-semibold tracking-tight first:mt-0 last:mb-0" {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h3 className="my-[1.1em_0_0.5em] text-base leading-[1.35] font-semibold tracking-tight first:mt-0 last:mb-0" {...props} />
  ),
  h4: ({ node: _node, ...props }) => (
    <h4 className="my-[1.1em_0_0.5em] text-base leading-[1.35] font-semibold tracking-tight first:mt-0 last:mb-0" {...props} />
  ),
  h5: ({ node: _node, ...props }) => (
    <h5 className="my-[1.1em_0_0.5em] text-base leading-[1.35] font-semibold tracking-tight first:mt-0 last:mb-0" {...props} />
  ),
  h6: ({ node: _node, ...props }) => (
    <h6 className="my-[1.1em_0_0.5em] text-base leading-[1.35] font-semibold tracking-tight first:mt-0 last:mb-0" {...props} />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul className="my-[0.7em] list-disc pl-[1.4em] marker:text-muted-foreground first:mt-0 last:mb-0" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="my-[0.7em] list-decimal pl-[1.4em] marker:text-muted-foreground first:mt-0 last:mb-0" {...props} />
  ),
  li: ({ node: _node, ...props }) => <li className="my-[0.25em] pl-[0.15em]" {...props} />,
  a: ({ node: _node, ...props }) =>
    renderLink({ ...props, className: cn('text-accent underline underline-offset-2', props.className) }),
  code: ({ node: _node, ...props }) => <CodeRenderer prose {...props} />,
  pre: ({ node: _node, children, ...props }) => {
    const isMermaid = isValidElement(children) && children.type === MermaidBlock
    if (isMermaid) {
      return (
        <InCodeBlockContext.Provider value={true}>
          <pre
            className="my-[0.6em] overflow-visible border-0 bg-transparent p-0 font-mono text-xs leading-[1.55] first:mt-0 last:mb-0"
            {...props}
          >
            {children}
          </pre>
        </InCodeBlockContext.Provider>
      )
    }
    return (
      <InCodeBlockContext.Provider value={true}>
        <CodeBlock {...props}>{children}</CodeBlock>
      </InCodeBlockContext.Provider>
    )
  },
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="my-[0.6em] pl-[0.9em] border-l-[3px] border-border text-muted-foreground first:mt-0 last:mb-0" {...props} />
  ),
  table: ({ node: _node, ...props }) => (
    // Wide tables scroll inside their own box; the transcript column must never
    // gain a horizontal scrollbar of its own.
    <table className="my-[0.8em] block max-w-full table-auto overflow-x-auto border-collapse text-xs first:mt-0 last:mb-0" {...props} />
  ),
  th: ({ node: _node, ...props }) => (
    <th className="border border-border bg-muted px-[0.6em] py-[0.3em] text-left font-sans text-xs font-semibold" {...props} />
  ),
  td: ({ node: _node, ...props }) => <td className="border border-border px-[0.6em] py-[0.3em]" {...props} />,
  hr: ({ node: _node, ...props }) => <hr className="border-t border-border my-[1em] first:mt-0 last:mb-0" {...props} />,
  img: ({ node: _node, ...props }) => <img className="max-w-full rounded-md" {...props} />,
}

/**
 * Fenced code block with a hover-revealed copy control.
 *
 * An agent console emits commands, paths and patches constantly, and
 * hand-selecting them out of a scrolling transcript is the single most repeated
 * chore on this surface. The text is read off the DOM node so it works for
 * every code block regardless of how react-markdown nested the children.
 */
function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<'pre'>) {
  const preRef = useRef<HTMLPreElement | null>(null)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const onCopy = async () => {
    const text = preRef.current?.textContent ?? ''
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (insecure context); the text stays selectable.
    }
  }

  return (
    <div className="group/code relative my-[0.8em] first:mt-0 last:mb-0">
      <pre
        ref={preRef}
        className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-[1.6]"
        {...props}
      >
        {children}
      </pre>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        title={copied ? 'Copied' : 'Copy code'}
        className={cn(
          'absolute top-1.5 right-1.5 inline-flex size-7 items-center justify-center rounded-md',
          'bg-background/80 text-muted-foreground opacity-0 backdrop-blur transition-opacity',
          'hover:text-foreground group-hover/code:opacity-100 focus-visible:opacity-100',
          copied && 'text-success opacity-100',
        )}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </button>
    </div>
  )
}

/** Mermaid module singleton — the dynamic import fires once, on the first mermaid block. */
type MermaidModule = typeof import('mermaid')
let mermaidPromise: Promise<MermaidModule> | null = null
let mermaidInitialized = false

function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').catch((error: unknown) => {
      mermaidPromise = null // allow a retry on the next block
      throw error
    })
  }
  return mermaidPromise
}

function MermaidBlock({ code }: { code: string }) {
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setSvg(null)
    loadMermaid()
      .then(async (mermaidModule) => {
        if (cancelled) return
        const mermaid = mermaidModule.default
        if (!mermaidInitialized) {
          mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
          mermaidInitialized = true
        }
        const { svg: rendered } = await mermaid.render(`mermaid-${rawId}`, code)
        if (cancelled) return
        setSvg(rendered)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [code, rawId])

  if (state === 'error') {
    // Plain fallback — the raw diagram source, like any other code block.
    return (
      <div className="mermaid-fallback">
        <code>{code}</code>
      </div>
    )
  }
  if (state === 'ready' && svg !== null) {
    return <div className="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
  }
  return <div className="mermaid-loading">Rendering diagram…</div>
}

/**
 * Allow the internal `workspace://` deep-link scheme through react-markdown's
 * URL transform (the default only permits http(s)/mailto/etc.). The click is
 * intercepted in the `a` component; sanitize also allowlists the protocol.
 */
const urlTransform: UrlTransform = (url, _key, _node) => {
  if (/^workspace:\/\//i.test(url)) return url
  return defaultUrlTransform(url)
}

export function Markdown({
  content,
  className,
  prose = false,
}: {
  content: string
  className?: string
  /** Apply the chat-transcript prose styling (serif, prose-first). */
  prose?: boolean
}) {
  return (
    <div
      className={cn(
        // Conversation prose is the system sans (docs/UIUX-GUIDE.md: an
        // editorial serif for prose is opt-in / skin-scoped, never the global
        // default). 15px/1.68 is the DESIGN.md body-md rhythm. The reading
        // measure is owned by the transcript column so prose, user bubbles and
        // activity rows all share one left and right edge.
        prose && 'w-full text-[15px] leading-[1.68] break-words text-foreground',
        className,
      )}
      data-prose={prose ? 'true' : undefined}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeSanitize, schema]]}
        urlTransform={urlTransform}
        components={prose ? proseComponents : baseComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

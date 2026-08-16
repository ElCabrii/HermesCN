import { useEffect, useId, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import 'katex/dist/katex.min.css'

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
}

const components: Components = {
  // External links open in a new tab, never hijack the app window.
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
  code: ({ node: _node, className, children, ...props }) => {
    if (typeof className === 'string' && /language-mermaid/.test(className)) {
      return <MermaidBlock code={String(children ?? '')} />
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  },
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

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeSanitize, schema]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

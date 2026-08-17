import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Transcript scroll behaviour.
 *
 * A chat surface has exactly one scroll rule and getting it wrong is very
 * visible: while the user sits at the bottom the view must follow new content
 * (streamed tokens grow the last turn continuously, not just on message
 * boundaries), and the moment the user scrolls up to read history the view must
 * stop yanking them back. Everything else — the "jump to latest" affordance,
 * the instant jump on session switch — hangs off that one piece of state.
 *
 * Growth is observed rather than derived from React updates because streaming
 * mutates text inside an already-mounted node: a `useEffect` on `messages`
 * fires before the browser has laid the new glyphs out, so it would measure a
 * stale `scrollHeight`. A ResizeObserver on the content element sees the real
 * post-layout size. Environments without ResizeObserver (jsdom) degrade to
 * scrolling on the render-time effect, which is enough for tests.
 *
 * `BOTTOM_THRESHOLD_PX` is deliberately generous: sub-pixel scroll heights and
 * a composer that grows under the transcript both leave a few stray pixels, and
 * a tight threshold makes auto-follow drop out at random.
 */

const BOTTOM_THRESHOLD_PX = 64

export interface StickToBottom<S extends HTMLElement, C extends HTMLElement> {
  /** Attach to the scrolling viewport. */
  scrollRef: React.RefObject<S | null>
  /** Attach to the growing content inside the viewport. */
  contentRef: React.RefObject<C | null>
  /** True while the viewport is parked at (or very near) the bottom. */
  atBottom: boolean
  /** True when the content actually overflows — no affordance is useful otherwise. */
  scrollable: boolean
  /** Scroll the viewport to the newest content. */
  scrollToBottom: (behavior?: ScrollBehavior) => void
}

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

export function useStickToBottom<S extends HTMLElement, C extends HTMLElement>(
  /** Values whose change means "content may have grown" (message count, stream id…). */
  deps: readonly unknown[],
  /** Changing this jumps straight to the bottom without animation (session switch). */
  jumpKey?: string | null,
): StickToBottom<S, C> {
  const scrollRef = useRef<S | null>(null)
  const contentRef = useRef<C | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [scrollable, setScrollable] = useState(false)
  // Read by the observer callback, which must not re-subscribe on every token.
  const atBottomRef = useRef(true)
  // Suppresses the "user scrolled away" bookkeeping while we animate.
  const programmaticRef = useRef(false)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current
    if (!el) return
    programmaticRef.current = true
    atBottomRef.current = true
    setAtBottom(true)
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior })
    } else {
      el.scrollTop = el.scrollHeight
    }
    // Smooth scrolling lands asynchronously; release the guard once it settles.
    window.setTimeout(() => {
      programmaticRef.current = false
    }, behavior === 'smooth' ? 320 : 0)
  }, [])

  const measure = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const overflowing = el.scrollHeight - el.clientHeight > BOTTOM_THRESHOLD_PX
    setScrollable(overflowing)
    if (programmaticRef.current) return
    const bottom = distanceFromBottom(el) <= BOTTOM_THRESHOLD_PX
    atBottomRef.current = bottom
    setAtBottom(bottom)
  }, [])

  // User-driven scrolling decides whether we keep following.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', measure, { passive: true })
    measure()
    return () => el.removeEventListener('scroll', measure)
  }, [measure])

  // Content growth (streamed tokens, expanding disclosures, images loading).
  useEffect(() => {
    const content = contentRef.current
    const el = scrollRef.current
    if (!content || !el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const overflowing = el.scrollHeight - el.clientHeight > BOTTOM_THRESHOLD_PX
      setScrollable(overflowing)
      if (!atBottomRef.current) return
      // 'auto' during streaming: a smooth animation cannot keep up with a
      // token stream and produces a permanently lagging, jittery viewport.
      el.scrollTop = el.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  })

  // Render-time follow-up, and the only follow mechanism without ResizeObserver.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (atBottomRef.current) el.scrollTop = el.scrollHeight
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // A different session is a different document: start at the newest turn.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = true
    setAtBottom(true)
    el.scrollTop = el.scrollHeight
    measure()
  }, [jumpKey, measure])

  return { scrollRef, contentRef, atBottom, scrollable, scrollToBottom }
}

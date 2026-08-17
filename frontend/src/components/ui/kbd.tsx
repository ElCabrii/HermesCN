import { forwardRef } from 'react'
import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Keyboard-cap. Use in shortcut hints and inline `⌘/`, `Esc`, etc. markers.
 *
 * The cap is small, monospaced, with a slight inset shadow to read as a key.
 * On dark backgrounds it leans on the muted surface; on light it uses a
 * slightly stronger border to stay legible.
 */
export const Kbd = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  function Kbd({ className, children, ...props }, ref) {
    return (
      <kbd
        ref={ref as React.Ref<HTMLDivElement>}
        className={cn(
          'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-foreground/80 shadow-[inset_0_-1px_0_color-mix(in_oklch,var(--foreground)_8%,transparent)]',
          className,
        )}
        {...props}
      >
        {children}
      </kbd>
    )
  },
)

import * as React from 'react'
import { ChevronDownIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * A real `<select>` wearing the app's control chrome.
 *
 * Panels each hand-rolled their own `h-9 rounded-md border border-input`
 * select, which drifted from the Input/Button language, kept the platform
 * dropdown arrow, and gave no focus ring. This keeps the native element — so
 * the OS picker, keyboard behaviour, and mobile wheel all still work — and only
 * replaces the chrome around it.
 */
function NativeSelect({
  className,
  containerClassName,
  children,
  ...props
}: React.ComponentProps<'select'> & { containerClassName?: string }) {
  return (
    <div className={cn('relative w-full', containerClassName)}>
      <select
        data-slot="native-select"
        className={cn(
          'h-9 w-full appearance-none rounded-lg border border-input bg-input/40 py-1 pr-8 pl-2.5 text-sm',
          'transition-[color,box-shadow] outline-none',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

export { NativeSelect }

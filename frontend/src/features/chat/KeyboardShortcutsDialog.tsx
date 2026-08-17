import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'

/**
 * Keyboard shortcuts help. Triggered from the header button (⌘/) or the
 * �-/ global shortcut. Grouped by surface; uses the <Kbd /> component for
 * each key cap so the visual language stays consistent.
 */

interface Shortcut {
  keys: string[]
  description: string
}

interface Group {
  title: string
  shortcuts: Shortcut[]
}

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)

const META = isMac ? '⌘' : 'Ctrl'

const GROUPS: Group[] = [
  {
    title: 'Conversations',
    shortcuts: [
      { keys: [META, '⇧', 'O'], description: 'New conversation' },
      { keys: [META, 'K'], description: 'Search conversations' },
      { keys: [META, '\\'], description: 'Toggle conversations sidebar' },
      { keys: [META, '⇧', '\\'], description: 'Toggle workspace panel' },
      { keys: ['Esc'], description: 'Close dialog or overlay drawer' },
    ],
  },
  {
    title: 'Composer',
    shortcuts: [
      { keys: ['Enter'], description: 'Send message' },
      { keys: ['⇧', 'Enter'], description: 'Newline (without sending)' },
      { keys: ['Esc'], description: 'Stop the running turn' },
      { keys: ['/'], description: 'Browse slash commands (when composer is empty)' },
      { keys: ['↑', '↓'], description: 'Navigate slash-command suggestions' },
      { keys: ['Tab'], description: 'Insert highlighted suggestion' },
    ],
  },
  {
    title: 'Help',
    shortcuts: [{ keys: [META, '/'], description: 'Show this dialog' }],
  },
]

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            HermesCN keeps the high-frequency keys within a single keystroke.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {group.title}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {group.shortcuts.map((shortcut, i) => (
                  <li
                    key={`${group.title}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card px-3 py-2 text-sm"
                  >
                    <span className="text-foreground/90">{shortcut.description}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {shortcut.keys.map((key, j) => (
                        <span key={j} className="flex items-center gap-1">
                          <Kbd>{key}</Kbd>
                          {j < shortcut.keys.length - 1 && (
                            <span aria-hidden="true" className="text-[11px] text-muted-foreground">
                              +
                            </span>
                          )}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

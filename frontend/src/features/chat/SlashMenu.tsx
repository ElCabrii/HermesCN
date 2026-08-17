import { cn } from '@/lib/utils'

/**
 * Slash command autocomplete dropdown (plan Task 8.7).
 *
 * Ports the legacy `#cmdDropdown` contract (static/commands.js
 * `showCmdDropdown`): one row per match — command rows show `/name <arg>` +
 * desc, sub-arg rows show `/parent value`. The row at `selected` is
 * highlighted; mousedown selects (preventDefault so the textarea keeps its
 * focus, exactly like the legacy `onmousedown`).
 *
 * Keyboard navigation (ArrowUp/Down/Tab/Enter/Escape) is owned by the
 * Composer, which binds those keys on the textarea — the legacy binds them
 * on `$('msg')`, not on the dropdown. The menu is presentational.
 */

export type SlashMatch =
  | { kind: 'command'; name: string; desc: string; arg?: string }
  | { kind: 'subarg'; parent: string; value: string; desc: string }

export interface SlashMenuProps {
  matches: SlashMatch[]
  /** Index of the highlighted row (controlled by the Composer). */
  selected: number
  onSelect: (match: SlashMatch) => void
  onMouseEnter?: (index: number) => void
}

export function SlashMenu({ matches, selected, onSelect, onMouseEnter }: SlashMenuProps) {
  if (matches.length === 0) return null

  return (
    <ul
      data-testid="slash-menu"
      role="listbox"
      aria-label="Slash commands"
      className="absolute right-0 bottom-full left-0 z-30 mb-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-lg ring-1 ring-foreground/5"
    >
      {matches.map((match, i) => {
        const isSubArg = match.kind === 'subarg'
        const selectedRow = i === selected
        return (
          <li
            key={`${match.kind}-${match.kind === 'subarg' ? `${match.parent}-${match.value}` : match.name}`}
            role="option"
            aria-selected={selectedRow}
            data-selected={selectedRow}
            data-kind={match.kind}
            className={cn(
              'flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 text-sm transition-colors',
              selectedRow
                ? 'bg-accent/15 text-foreground'
                : 'hover:bg-muted/60',
            )}
            onMouseDown={(event) => {
              event.preventDefault()
              onSelect(match)
            }}
            onMouseEnter={() => onMouseEnter?.(i)}
          >
            <span className="flex items-baseline gap-1.5 font-mono text-[13px]">
              {isSubArg ? (
                <>
                  <span className="text-muted-foreground">/{match.parent}</span>
                  <span className="font-medium">{match.value}</span>
                </>
              ) : (
                <>
                  <span className="font-medium">/{match.name}</span>
                  {match.arg && <span className="text-muted-foreground">{match.arg}</span>}
                </>
              )}
            </span>
            {match.desc && <span className="truncate text-xs text-muted-foreground">{match.desc}</span>}
          </li>
        )
      })}
    </ul>
  )
}

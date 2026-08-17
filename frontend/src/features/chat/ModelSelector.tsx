import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ModelsCatalog } from '@/api/models'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'

export interface ModelSelectorProps {
  /** Explicitly picked model id (null = session default). */
  value: string | null
  /** Catalog from GET /api/models (null while loading / on failure). */
  catalog: ModelsCatalog | null
  /** The active session's own model, shown when nothing was picked. */
  currentLabel: string | null
  onChange: (id: string | null) => void
}

/** Compact model picker; options grouped by provider. */
/** Blank-safe pick: `??` alone let an empty-string model render a nameless button. */
function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

export function ModelSelector({ value, catalog, currentLabel, onChange }: ModelSelectorProps) {
  const current = firstNonEmpty(value, currentLabel, catalog?.default_model)
  const groups = catalog?.groups ?? []
  const available = groups.some((g) => g.models.length > 0)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Select model"
            title={current ? `Model: ${current}` : 'Select model'}
            className="max-w-64 text-muted-foreground"
          />
        }
      >
        <span className="truncate">{current ?? 'Model'}</span>
        <ChevronDownIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72">
        {!available && <DropdownMenuItem disabled>No models available</DropdownMenuItem>}
        {groups.map((group) => (
          <DropdownMenuGroup key={group.provider}>
            <DropdownMenuLabel>{group.provider}</DropdownMenuLabel>
            {group.models.map((model) => (
              <DropdownMenuItem key={model.id} data-model-id={model.id} onClick={() => onChange(model.id)}>
                <span className="truncate">{model.label}</span>
                {/* Check the model actually in effect, not only an explicit
                    pick — otherwise the menu shows no selection at all whenever
                    the session is running on its own default. */}
                {current === model.id && <CheckIcon className="ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import { useEffect, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { readMemory, writeMemory, type MemoryData } from '@/api/panels'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/**
 * Memory tab of the Control Center: editable MEMORY.md / USER.md / SOUL.md
 * panes (GET /api/memory → POST /api/memory/write). Each pane shows its
 * file path and last-modified time as quiet metadata and only enables its
 * Save button once the draft diverges from the loaded content.
 *
 * `writeMemory(section, content)` takes the bare section name
 * ('memory' | 'user' | 'soul') — no prefix, matching the API client.
 */

interface SectionDef {
  key: 'memory' | 'user' | 'soul'
  title: string
  path: (m: MemoryData) => string | undefined
  mtime: (m: MemoryData) => number | null | undefined
  content: (m: MemoryData) => string
}

const SECTIONS: SectionDef[] = [
  {
    key: 'memory',
    title: 'MEMORY.md',
    path: (m) => m.memory_path,
    mtime: (m) => m.memory_mtime,
    content: (m) => m.memory,
  },
  {
    key: 'user',
    title: 'USER.md',
    path: (m) => m.user_path,
    mtime: (m) => m.user_mtime,
    content: (m) => m.user,
  },
  {
    key: 'soul',
    title: 'SOUL.md',
    path: (m) => m.soul_path,
    mtime: (m) => m.soul_mtime,
    content: (m) => m.soul,
  },
]

function formatMtime(mtime: number | null | undefined): string {
  return mtime ? new Date(mtime * 1000).toLocaleString() : 'never'
}

export function MemoryPanel() {
  const [data, setData] = useState<MemoryData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    readMemory()
      .then((memory) => {
        if (cancelled) return
        setData(memory)
        setDrafts({
          memory: memory.memory,
          user: memory.user,
          soul: memory.soul,
        })
        setError(null)
      })
      .catch((e) => {
        if (!cancelled)
          setError('Failed to load memory: ' + (e instanceof Error ? e.message : String(e)))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const saveSection = async (section: SectionDef) => {
    if (!data) return
    setSaving((s) => ({ ...s, [section.key]: true }))
    try {
      await writeMemory(section.key, drafts[section.key])
      toast.success(`Saved ${section.title}.`)
      setData({ ...data, [section.key]: drafts[section.key] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save memory.')
    } finally {
      setSaving((s) => ({ ...s, [section.key]: false }))
    }
  }

  if (error && !data) {
    return <p className="px-1 text-sm text-destructive">{error}</p>
  }

  return (
    <div className="h-full">
      {!data && (
        <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" /> Loading memory…
        </p>
      )}
      {data && (
        <div className="flex h-full flex-col gap-3">
          {SECTIONS.map((section) => {
            const dirty = drafts[section.key] !== section.content(data)
            return (
              <section key={section.key} className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1">
                  <h3 className="font-mono text-sm">{section.title}</h3>
                  <p className="flex min-w-0 items-baseline gap-2 font-mono text-[11px] text-muted-foreground">
                    <span className="truncate">{section.path(data)}</span>
                    <span className="shrink-0">{formatMtime(section.mtime(data))}</span>
                  </p>
                </div>
                <Textarea
                  aria-label={section.title}
                  className="mt-1 min-h-0 flex-1 resize-none font-mono text-xs"
                  value={drafts[section.key] ?? ''}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [section.key]: e.target.value }))
                  }
                />
                <div className="flex justify-end pt-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void saveSection(section)}
                    disabled={!dirty || saving[section.key]}
                  >
                    {saving[section.key] && <Loader2Icon className="animate-spin" />}
                    Save {section.title}
                  </Button>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { readFile, saveFile } from '@/api/workspace'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Inline text editor (Task 5.2).
 *
 * - Loads the file via GET /api/file on mount (or when `path` changes), then
 *   edits in a plain textarea.
 * - Save POSTs the content via /api/file/save and reports the saved path;
 *   Save stays disabled while the buffer is clean.
 * - Escape cancels the edit session without saving (legacy contract), and
 *   `onDirtyChange` keeps the parent informed so it can guard navigation
 *   away from unsaved changes.
 */

export interface FileEditorProps {
  sessionId: string
  path: string
  onCancel: () => void
  onSaved: (path: string) => void
  onDirtyChange?: (dirty: boolean) => void
}

export function FileEditor({
  sessionId,
  path,
  onCancel,
  onSaved,
  onDirtyChange,
}: FileEditorProps) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [error, setError] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    setLoaded(null)
    setContent('')
    setError(false)
    readFile(sessionId, path)
      .then((data) => {
        if (alive) {
          setLoaded(data.content)
          setContent(data.content)
        }
      })
      .catch(() => {
        if (alive) setError(true)
      })
    return () => {
      alive = false
    }
  }, [sessionId, path])

  const dirty = loaded !== null && content !== loaded

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  async function handleSave() {
    if (!dirty || saving) return
    setSaving(true)
    setSaveError(false)
    try {
      await saveFile(sessionId, path, content)
      onSaved(path)
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  if (error) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Could not load file
        <div className="mt-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 p-2">
        {loaded === null ? (
          <div className="p-2 text-xs text-muted-foreground">Loading…</div>
        ) : (
          <textarea
            data-testid="editor-textarea"
            aria-label="File content"
            spellCheck={false}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onCancel()
              }
            }}
            className="h-full w-full resize-none rounded-md border border-border bg-muted/40 p-2 font-mono text-xs leading-relaxed text-foreground/90 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-2 py-1.5">
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[11px]',
            dirty ? 'text-warning' : 'text-muted-foreground',
          )}
          data-testid="editor-dirty-hint"
        >
          {saveError ? 'Save failed' : dirty ? 'Unsaved changes' : 'Saved'}
        </span>
        <Button variant="outline" size="sm" className="text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" className="text-xs" disabled={!dirty || saving} onClick={() => void handleSave()}>
          Save
        </Button>
      </div>
    </div>
  )
}

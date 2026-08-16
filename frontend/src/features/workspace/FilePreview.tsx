import { useEffect, useState } from 'react'
import { fileRawUrl, readFile } from '@/api/workspace'
import { Markdown } from '@/features/chat/Markdown'
import { FileWarningIcon } from 'lucide-react'
import { getFileKind } from './workspaceStore'

/**
 * Single-file preview (Task 5.2).
 *
 * Routing by extension (legacy static/workspace.js):
 * - images (png/jpg/gif/svg/webp/…) → inline `<img>` served from
 *   `/api/file/raw?session_id=&path=` (no size limit, MIME by extension);
 * - markdown → fetched via GET /api/file and rendered with the chat
 *   Markdown component (sanitized react-markdown);
 * - text/code → fetched and shown in a monospace block;
 * - anything else → metadata note: "Binary file — preview not available".
 *
 * Pure content: the Back/Edit chrome lives in WorkspacePanel, which also
 * decides when editing is allowed (text/markdown only).
 */

export interface FilePreviewProps {
  sessionId: string
  path: string
}

export function FilePreview({ sessionId, path }: FilePreviewProps) {
  const kind = getFileKind(path)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (kind === 'image' || kind === 'binary') return
    let alive = true
    setText(null)
    setError(false)
    readFile(sessionId, path)
      .then((data) => {
        if (alive) setText(data.content)
      })
      .catch(() => {
        if (alive) setError(true)
      })
    return () => {
      alive = false
    }
  }, [sessionId, path, kind])

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {kind === 'image' && (
        <img
          data-testid="preview-image"
          src={fileRawUrl(sessionId, path)}
          alt={path}
          className="mx-auto max-h-full max-w-full rounded-md object-contain"
        />
      )}

      {kind === 'markdown' &&
        (text === null && !error ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="text-xs text-muted-foreground">Could not load file</div>
        ) : (
          <Markdown content={text ?? ''} />
        ))}

      {kind === 'text' &&
        (text === null && !error ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="text-xs text-muted-foreground">Could not load file</div>
        ) : (
          <pre
            data-testid="preview-code"
            className="overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90"
          >
            {text}
          </pre>
        ))}

      {kind === 'binary' && (
        <div
          data-testid="preview-binary"
          className="flex flex-col items-center gap-2 rounded-lg border border-border px-4 py-8 text-center"
        >
          <FileWarningIcon className="size-6 text-muted-foreground" />
          <div className="font-mono text-xs break-all text-foreground/80">{path}</div>
          <div className="text-xs text-muted-foreground">
            Binary file — preview not available.
          </div>
        </div>
      )}
    </div>
  )
}

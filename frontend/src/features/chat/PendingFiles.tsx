import { Button } from '@/components/ui/button'
import { PaperclipIcon, XIcon } from 'lucide-react'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface PendingFilesProps {
  files: File[]
  onRemove: (index: number) => void
}

/** Tray of staged files above the composer, each removable before send. */
export function PendingFiles({ files, onRemove }: PendingFilesProps) {
  if (files.length === 0) return null
  return (
    <div data-testid="pending-files" className="mb-1.5 flex flex-wrap gap-1.5">
      {files.map((file, index) => (
        <span key={`${file.name}-${index}`} className="attachment-chip">
          <PaperclipIcon className="size-3" />
          <span className="max-w-40 truncate" title={file.name}>
            {file.name}
          </span>
          <span className="text-muted-foreground">{formatSize(file.size)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${file.name}`}
            title={`Remove ${file.name}`}
            className="-mr-1 size-5 text-muted-foreground"
            onClick={() => onRemove(index)}
          >
            <XIcon className="size-3" />
          </Button>
        </span>
      ))}
    </div>
  )
}

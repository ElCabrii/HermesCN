import { useState } from 'react'
import { respondApproval, type ApprovalChoice, type ApprovalEntry } from '@/api/chat'
import { Button } from '@/components/ui/button'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

export interface ApprovalCardProps {
  entry: ApprovalEntry
  sessionId: string
  /** Called when the server accepts the response (or reports the entry stale). */
  onResolved: () => void
}

const CHOICES: { label: string; choice: ApprovalChoice; variant: 'default' | 'outline' }[] = [
  { label: 'Approve once', choice: 'once', variant: 'default' },
  { label: 'Approve session', choice: 'session', variant: 'outline' },
  { label: 'Always', choice: 'always', variant: 'outline' },
  { label: 'Deny', choice: 'deny', variant: 'outline' },
]

/**
 * Pending tool-approval card. Shown above the composer while a dangerous
 * command waits for a decision; the response goes to POST /api/approval/respond
 * with the choice (once|session|always|deny) and the entry's approval_id.
 */
export function ApprovalCard({ entry, sessionId, onResolved }: ApprovalCardProps) {
  const [responding, setResponding] = useState<ApprovalChoice | null>(null)
  const keys =
    entry.pattern_keys && entry.pattern_keys.length > 0
      ? entry.pattern_keys
      : entry.pattern_key
        ? [entry.pattern_key]
        : []

  const respond = async (choice: ApprovalChoice) => {
    if (responding) return
    setResponding(choice)
    try {
      const result = await respondApproval({
        session_id: sessionId,
        choice,
        ...(entry.approval_id ? { approval_id: entry.approval_id } : {}),
      })
      // ok, or stale_cleared (nothing pending anymore — the card is orphaned).
      if (result?.ok || result?.stale_cleared) onResolved()
      else toast(result?.error || 'Approval response not accepted.')
    } catch {
      toast('Approval response not accepted.')
    } finally {
      setResponding(null)
    }
  }

  return (
    <div data-testid="approval-card" role="status" className="mt-1.5 rounded-lg border border-border bg-card/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-warning">Approval required</span>
        {responding && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />}
      </div>
      {entry.command && (
        <code className="mt-1 block overflow-x-auto rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap">
          {entry.command}
        </code>
      )}
      {(entry.description || keys.length > 0) && (
        <p className="mt-1 text-xs text-muted-foreground">
          {entry.description}
          {keys.length > 0 && <span className="ml-1">[{keys.join(', ')}]</span>}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CHOICES.map(({ label, choice, variant }) => (
          <Button key={choice} size="sm" variant={variant} disabled={responding !== null} onClick={() => void respond(choice)}>
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}

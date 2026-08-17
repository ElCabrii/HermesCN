import { useState } from 'react'
import { respondApproval, type ApprovalChoice, type ApprovalEntry } from '@/api/chat'
import { Button } from '@/components/ui/button'
import { AlertTriangleIcon, ShieldCheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface ApprovalCardProps {
  entry: ApprovalEntry
  sessionId: string
  /** Called when the server accepts the response (or reports the entry stale). */
  onResolved: () => void
}

/**
 * The four responses, with the scope each one grants spelled out.
 *
 * All four used to look alike apart from the first, so the button that
 * permanently allowlists a dangerous command and the button that refuses it
 * were visually interchangeable. Scope now reads on the row, and Deny carries
 * the destructive treatment.
 */
const CHOICES: {
  label: string
  hint: string
  choice: ApprovalChoice
  variant: 'default' | 'outline' | 'destructive'
}[] = [
  { label: 'Approve once', hint: 'this command only', choice: 'once', variant: 'default' },
  { label: 'Approve session', hint: 'until this conversation ends', choice: 'session', variant: 'outline' },
  { label: 'Always', hint: 'remember this permanently', choice: 'always', variant: 'outline' },
  { label: 'Deny', hint: 'refuse and tell the agent', choice: 'deny', variant: 'destructive' },
]

/**
 * Pending tool-approval card. Shown above the composer while a dangerous
 * command waits for a decision; the response goes to POST /api/approval/respond
 * with the choice (once|session|always|deny) and the entry's approval_id.
 *
 * Visual contract: prominent enough that it can't be missed (this requires
 * user action), but still part of the composer surface — no full modal.
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
    <div
      data-testid="approval-card"
      // The run is blocked until the user decides, so this interrupts rather
      // than reports: `role="status"` announced it politely and a screen-reader
      // user could sit waiting without knowing anything was asked of them.
      role="group"
      aria-live="assertive"
      aria-label="Approval required"
      className={cn(
        'mt-2 overflow-hidden rounded-xl border border-warning/40 bg-warning/5 shadow-sm',
        'ring-1 ring-warning/15',
      )}
    >
      <div className="flex items-center gap-2 border-b border-warning/20 bg-warning/10 px-3 py-2">
        <ShieldCheckIcon className="size-4 shrink-0 text-warning" aria-hidden="true" />
        <span className="text-xs font-semibold text-warning">Approval required</span>
      </div>
      <div className="flex flex-col gap-2 px-3 py-2.5">
        {entry.command && (
          <code className="block max-h-32 overflow-auto rounded-md border border-border/70 bg-background/80 px-2.5 py-1.5 font-mono text-xs break-all whitespace-pre-wrap">
            {entry.command}
          </code>
        )}
        {(entry.description || keys.length > 0) && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {entry.description}
            {keys.length > 0 && (
              <>
                {/* Hidden literal text keeps the legacy test contract
                    (`getByText('[rm, rmdir]')`) and assistive-tech exposure. */}
                <span className="sr-only">[{keys.join(', ')}]</span>
                <span className="ml-1 inline-flex flex-wrap gap-1" aria-hidden="true">
                  {keys.map((k) => (
                    <span
                      key={k}
                      className="inline-flex items-center rounded border border-border/60 bg-background/60 px-1.5 py-px font-mono text-[11px] text-foreground/80"
                    >
                      {k}
                    </span>
                  ))}
                </span>
              </>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {CHOICES.map(({ label, hint, choice, variant }) => (
            <Button
              key={choice}
              size="sm"
              variant={variant}
              title={`${label} — ${hint}`}
              // Deny sits apart from the three approvals so a fast click on the
              // end of the row cannot land on "Always" by muscle memory.
              className={cn(choice === 'deny' && 'ml-auto')}
              disabled={responding !== null}
              onClick={() => void respond(choice)}
            >
              {choice === 'deny' && <AlertTriangleIcon className="size-3.5" />}
              {label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

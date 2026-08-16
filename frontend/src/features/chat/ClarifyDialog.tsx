import { useState } from 'react'
import { respondClarify, type ClarifyEntry } from '@/api/chat'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

export interface ClarifyDialogProps {
  entry: ClarifyEntry
  sessionId: string
  onClose: () => void
}

/**
 * Clarification prompt surfaced by the chat stream's `clarify` event. The
 * answer goes to POST /api/clarify/respond; a stale (409) response means the
 * prompt expired server-side, so the dialog closes with an "expired" toast.
 */
export function ClarifyDialog({ entry, sessionId, onClose }: ClarifyDialogProps) {
  const [response, setResponse] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const answer = response.trim()
    if (!answer || submitting) return
    setSubmitting(true)
    try {
      const result = await respondClarify({
        session_id: sessionId,
        response: answer,
        ...(entry.clarify_id ? { clarify_id: entry.clarify_id } : {}),
      })
      if (result?.ok) {
        onClose()
        return
      }
      // 409 carries { ok: false, stale: true } — the prompt expired server-side.
      if (result?.stale) {
        toast('expired')
        onClose()
        return
      }
      toast(result?.error || 'Clarification not accepted.')
    } catch (e) {
      const err = e as { status?: number; body?: { stale?: boolean } }
      if (err.status === 409 || err.body?.stale) {
        toast('expired')
        onClose()
        return
      }
      toast(err instanceof Error ? err.message : 'Clarification not accepted.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose()
      }}
    >
      <DialogContent showCloseButton={!submitting} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clarification needed</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap">{entry.question || 'The agent needs more detail.'}</DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="Response"
          value={response}
          onChange={(event) => setResponse(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
          placeholder="Your answer…"
          className="min-h-20"
        />
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={submitting || response.trim().length === 0} onClick={() => void submit()}>
            {submitting && <Loader2Icon className="animate-spin" />}
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeftIcon,
  ClockIcon,
  FileTextIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SquarePenIcon,
  Trash2Icon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  createCron,
  deleteCron,
  getCronOutput,
  getCrons,
  pauseCron,
  resumeCron,
  runCron,
  updateCron,
  type CronJob,
  type CronOutputFile,
} from '@/api/panels'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

/**
 * Tasks tab of the Control Center: cron job management.
 *
 * Mirrors the legacy Tasks panel (static/panels.js): a job list with
 * run / pause / resume / edit / delete actions, a create+edit form
 * (POST /api/crons/create|update), and a per-job output viewer
 * (GET /api/crons/output). The output viewer is an inline sub-view so
 * the modal never nests dialogs.
 */

interface FormFields {
  name: string
  schedule: string
  prompt: string
  deliver: string
  skills: string
  model: string
}

const EMPTY_FORM: FormFields = {
  name: '',
  schedule: '',
  prompt: '',
  deliver: '',
  skills: '',
  model: '',
}

function scheduleOf(job: CronJob): string {
  return job.schedule_display || job.schedule?.expression || '—'
}

export function TasksPanel() {
  const [jobs, setJobs] = useState<CronJob[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // create/edit form state; `form.job` is null when creating a new job
  const [form, setForm] = useState<{ open: boolean; job: CronJob | null }>({ open: false, job: null })
  const [fields, setFields] = useState<FormFields>(EMPTY_FORM)

  // inline output viewer sub-view
  const [viewing, setViewing] = useState<CronJob | null>(null)
  const [outputs, setOutputs] = useState<CronOutputFile[] | null>(null)
  const [outputError, setOutputError] = useState<string | null>(null)

  // delete confirmation target
  const [deleteTarget, setDeleteTarget] = useState<CronJob | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await getCrons()
      setJobs(data.jobs)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks.')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openForm = (job: CronJob | null) => {
    setFields({
      name: job?.name ?? '',
      schedule: job ? job.schedule_display || job.schedule?.expression || '' : '',
      prompt: job?.prompt ?? '',
      deliver: job?.deliver ?? '',
      skills: (job?.skills ?? []).join(', '),
      model: job?.model ?? '',
    })
    setForm({ open: true, job })
  }

  const submitForm = async () => {
    const skills = fields.skills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const payload = {
      prompt: fields.prompt,
      schedule: fields.schedule,
      name: fields.name || undefined,
      deliver: fields.deliver || undefined,
      skills: skills.length ? skills : undefined,
      model: fields.model || null,
    }
    setBusy(true)
    try {
      if (form.job) {
        await updateCron({ job_id: form.job.id, ...payload })
        toast.success(`Updated "${form.job.name}".`)
      } else {
        await createCron(payload)
        toast.success('Task created.')
      }
      setForm({ open: false, job: null })
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save task.')
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setBusy(true)
    try {
      await deleteCron(target.id)
      toast.success(`Deleted "${target.name}".`)
      setDeleteTarget(null)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete task.')
    } finally {
      setBusy(false)
    }
  }

  const run = async (job: CronJob) => {
    try {
      await runCron(job.id)
      toast.success(`Queued "${job.name}".`)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to run task.')
    }
  }

  const setPaused = async (job: CronJob, paused: boolean) => {
    try {
      if (paused) await pauseCron(job.id)
      else await resumeCron(job.id)
      toast.success(paused ? `Paused "${job.name}".` : `Resumed "${job.name}".`)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update task.')
    }
  }

  const openOutput = async (job: CronJob) => {
    setViewing(job)
    setOutputs(null)
    setOutputError(null)
    try {
      const data = await getCronOutput(job.id)
      setOutputs(data.outputs)
    } catch (e) {
      setOutputError(e instanceof Error ? e.message : 'Failed to load output.')
    }
  }

  if (error && !jobs) {
    return <p className="px-1 text-sm text-destructive">{error}</p>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-1 pb-2">
        <p className="text-xs text-muted-foreground">
          {jobs === null ? 'Loading…' : `${jobs.length} scheduled task${jobs.length === 1 ? '' : 's'}`}
        </p>
        <Button size="sm" variant="outline" onClick={() => openForm(null)}>
          <PlusIcon />
          New task
        </Button>
      </div>

      {viewing ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 pt-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setViewing(null)}>
              <ArrowLeftIcon />
              Back to tasks
            </Button>
            <h3 className="font-mono text-sm">{viewing.name}</h3>
          </div>
          {outputError && <p className="text-sm text-destructive">{outputError}</p>}
          {outputs === null && !outputError && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" /> Loading output…
            </p>
          )}
          {outputs?.length === 0 && <p className="text-sm text-muted-foreground">No output files yet.</p>}
          {outputs?.map((file) => (
            <div key={file.filename} className="flex flex-col gap-1">
              <div className="font-mono text-xs text-muted-foreground">{file.filename}</div>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
                {file.content}
              </pre>
            </div>
          ))}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto">
          {jobs === null && (
            <li className="flex items-center gap-2 px-1 py-3 text-xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" /> Loading tasks…
            </li>
          )}
          {/* Tasks is the Control Center's landing tab, so on a fresh install
              the first thing anyone sees here is this panel with nothing in it.
              Say what the feature is for rather than showing a blank pane. */}
          {jobs?.length === 0 && (
            <li
              data-testid="tasks-empty"
              className="flex flex-col items-center gap-2 px-6 py-14 text-center"
            >
              <ClockIcon className="size-6 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">No scheduled tasks yet</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Scheduled tasks run a prompt on a cron schedule — a morning digest, a nightly
                cleanup, a recurring check — and keep their output here.
              </p>
            </li>
          )}
          {jobs?.map((job) => (
            <li key={job.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm">{job.name}</span>
                  <Badge variant={job.enabled ? 'secondary' : 'outline'} className="shrink-0">
                    {job.enabled ? 'Enabled' : 'Paused'}
                  </Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="font-mono">{scheduleOf(job)}</span>
                  <span className="flex items-center gap-1">
                    <span>next</span>
                    {job.next_run_at ? (
                      <span>{new Date(job.next_run_at).toLocaleString()}</span>
                    ) : (
                      <span>never</span>
                    )}
                  </span>
                  {job.last_status && <span>last {job.last_status}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Run ${job.name}`}
                  title="Run now"
                  onClick={() => void run(job)}
                >
                  <PlayIcon />
                </Button>
                {job.enabled ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Pause ${job.name}`}
                    title="Pause"
                    onClick={() => void setPaused(job, true)}
                  >
                    <PauseIcon />
                  </Button>
                ) : (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Resume ${job.name}`}
                    title="Resume"
                    onClick={() => void setPaused(job, false)}
                  >
                    <PlayIcon />
                  </Button>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Edit ${job.name}`}
                  title="Edit"
                  onClick={() => openForm(job)}
                >
                  <SquarePenIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Output ${job.name}`}
                  title="View output"
                  onClick={() => void openOutput(job)}
                >
                  <FileTextIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${job.name}`}
                  title="Delete"
                  onClick={() => setDeleteTarget(job)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Create / edit form */}
      <Dialog
        open={form.open}
        onOpenChange={(open) => {
          if (!open) setForm({ open: false, job: null })
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.job ? 'Edit task' : 'New task'}</DialogTitle>
            <DialogDescription>
              {form.job
                ? `Update "${form.job.name}".`
                : 'Schedule a prompt to run on a cron expression.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Input
              aria-label="Name"
              placeholder="Task name"
              value={fields.name}
              onChange={(e) => setFields({ ...fields, name: e.target.value })}
            />
            <Input
              aria-label="Schedule"
              placeholder="0 9 * * *"
              value={fields.schedule}
              onChange={(e) => setFields({ ...fields, schedule: e.target.value })}
            />
            <Textarea
              aria-label="Prompt"
              placeholder="Prompt to run"
              className="min-h-20"
              value={fields.prompt}
              onChange={(e) => setFields({ ...fields, prompt: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                aria-label="Deliver"
                placeholder="Delivery target"
                value={fields.deliver}
                onChange={(e) => setFields({ ...fields, deliver: e.target.value })}
              />
              <Input
                aria-label="Model"
                placeholder="Model id"
                value={fields.model}
                onChange={(e) => setFields({ ...fields, model: e.target.value })}
              />
            </div>
            <Input
              aria-label="Skills"
              placeholder="Skills (comma separated)"
              value={fields.skills}
              onChange={(e) => setFields({ ...fields, skills: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm({ open: false, job: null })}>
              Cancel
            </Button>
            <Button onClick={() => void submitForm()} disabled={busy || !fields.prompt.trim()}>
              {busy && <Loader2Icon className="animate-spin" />}
              {form.job ? 'Save changes' : 'Create task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete task</DialogTitle>
            <DialogDescription>
              Delete “{deleteTarget?.name}”? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

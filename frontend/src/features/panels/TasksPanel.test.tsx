import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
} from '@/api/panels'
import { TasksPanel } from './TasksPanel'

vi.mock('@/api/panels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/panels')>()
  return {
    ...actual,
    getCrons: vi.fn(),
    getCronOutput: vi.fn(),
    createCron: vi.fn(),
    updateCron: vi.fn(),
    deleteCron: vi.fn(),
    runCron: vi.fn(),
    pauseCron: vi.fn(),
    resumeCron: vi.fn(),
  }
})
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const getCronsMock = vi.mocked(getCrons)
const getCronOutputMock = vi.mocked(getCronOutput)
const createCronMock = vi.mocked(createCron)
const updateCronMock = vi.mocked(updateCron)
const deleteCronMock = vi.mocked(deleteCron)
const runCronMock = vi.mocked(runCron)
const pauseCronMock = vi.mocked(pauseCron)
const resumeCronMock = vi.mocked(resumeCron)

function job(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'job-a',
    name: 'Morning digest',
    schedule: { kind: 'cron', expression: '0 9 * * *' },
    schedule_display: '0 9 * * *',
    enabled: true,
    next_run_at: '2026-08-17T09:00:00Z',
    last_status: 'success',
    ...overrides,
  }
}

const JOB_A = job()
const JOB_B = job({
  id: 'job-b',
  name: 'Nightly backup',
  schedule: { kind: 'cron', expression: '0 2 * * *' },
  schedule_display: '0 2 * * *',
  enabled: false,
  next_run_at: null,
  last_status: 'error',
})

beforeEach(() => {
  vi.clearAllMocks()
  getCronsMock.mockResolvedValue({ jobs: [JOB_A, JOB_B] })
  getCronOutputMock.mockResolvedValue({
    job_id: 'job-a',
    outputs: [{ filename: 'output.txt', content: 'All tasks completed' }],
  })
  createCronMock.mockResolvedValue({ ok: true, job: JOB_A })
  updateCronMock.mockResolvedValue({ ok: true, job: JOB_A })
  deleteCronMock.mockResolvedValue({ ok: true, job_id: 'job-a' })
  runCronMock.mockResolvedValue({ ok: true, job_id: 'job-a', status: 'queued' })
  pauseCronMock.mockResolvedValue({ ok: true, job: JOB_B })
  resumeCronMock.mockResolvedValue({ ok: true, job: JOB_A })
})

describe('TasksPanel', () => {
  it('renders the cron job list with schedule, enabled state, and next run', async () => {
    render(<TasksPanel />)

    expect(await screen.findByText('Morning digest')).toBeInTheDocument()
    expect(screen.getByText('Nightly backup')).toBeInTheDocument()
    // schedule expression is shown
    expect(screen.getByText('0 9 * * *')).toBeInTheDocument()
    expect(screen.getByText('0 2 * * *')).toBeInTheDocument()
    // enabled state as a badge
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    // next run timestamp
    expect(screen.getByText(new Date('2026-08-17T09:00:00Z').toLocaleString())).toBeInTheDocument()
  })

  it('runs a job now and refreshes the list', async () => {
    const user = userEvent.setup()
    render(<TasksPanel />)

    await screen.findByText('Morning digest')
    await user.click(screen.getByRole('button', { name: 'Run Morning digest' }))

    await waitFor(() => expect(runCronMock).toHaveBeenCalledWith('job-a'))
    // the list is refreshed after the run
    await waitFor(() => expect(getCronsMock).toHaveBeenCalledTimes(2))
  })

  it('pauses and resumes jobs through the client', async () => {
    const user = userEvent.setup()
    render(<TasksPanel />)

    await screen.findByText('Morning digest')
    await user.click(screen.getByRole('button', { name: 'Pause Morning digest' }))
    await waitFor(() => expect(pauseCronMock).toHaveBeenCalledWith('job-a'))

    await user.click(screen.getByRole('button', { name: 'Resume Nightly backup' }))
    await waitFor(() => expect(resumeCronMock).toHaveBeenCalledWith('job-b'))
  })

  it('deletes a job only after confirmation', async () => {
    const user = userEvent.setup()
    render(<TasksPanel />)

    await screen.findByText('Morning digest')
    await user.click(screen.getByRole('button', { name: 'Delete Morning digest' }))

    // confirmation dialog names the job
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Morning digest/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteCronMock).toHaveBeenCalledWith('job-a'))
    // list refreshed after delete
    await waitFor(() => expect(getCronsMock).toHaveBeenCalledTimes(2))
  })

  it('creates a new job from the form', async () => {
    const user = userEvent.setup()
    render(<TasksPanel />)

    await screen.findByText('Morning digest')
    await user.click(screen.getByRole('button', { name: 'New task' }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'Weekly report')
    await user.type(within(dialog).getByLabelText('Schedule'), '0 8 * * 1')
    await user.type(within(dialog).getByLabelText('Prompt'), 'Summarize the week')
    await user.type(within(dialog).getByLabelText('Deliver'), 'email')
    await user.type(within(dialog).getByLabelText('Skills'), 'plan, bro')
    await user.type(within(dialog).getByLabelText('Model'), 'gpt-4o')
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))

    await waitFor(() =>
      expect(createCronMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Summarize the week',
          schedule: '0 8 * * 1',
          name: 'Weekly report',
          deliver: 'email',
          skills: ['plan', 'bro'],
          model: 'gpt-4o',
        }),
      ),
    )
  })

  it('edits a job with prefilled values and calls updateCron', async () => {
    const user = userEvent.setup()
    render(<TasksPanel />)

    await screen.findByText('Morning digest')
    await user.click(screen.getByRole('button', { name: 'Edit Morning digest' }))

    const dialog = await screen.findByRole('dialog')
    const prompt = within(dialog).getByLabelText('Prompt')
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Morning digest')
    expect(within(dialog).getByLabelText('Schedule')).toHaveValue('0 9 * * *')

    await user.clear(prompt)
    await user.type(prompt, 'New prompt text')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(updateCronMock).toHaveBeenCalledWith(
        expect.objectContaining({ job_id: 'job-a', prompt: 'New prompt text' }),
      ),
    )
  })

  it('opens the output viewer and renders file content in monospace', async () => {
    const user = userEvent.setup()
    const { container } = render(<TasksPanel />)

    await screen.findByText('Morning digest')
    await user.click(screen.getByRole('button', { name: 'Output Morning digest' }))

    await waitFor(() => expect(getCronOutputMock).toHaveBeenCalledWith('job-a'))
    expect(await screen.findByText('output.txt')).toBeInTheDocument()
    expect(screen.getByText('All tasks completed')).toBeInTheDocument()
    // content lives in a <pre> (monospace)
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.textContent).toContain('All tasks completed')

    // back returns to the list
    await user.click(screen.getByRole('button', { name: 'Back to tasks' }))
    expect(await screen.findByText('Morning digest')).toBeInTheDocument()
  })
})

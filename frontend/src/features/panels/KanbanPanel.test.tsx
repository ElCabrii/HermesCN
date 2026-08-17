import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardPayload, BoardsResponse, KanbanTask } from '@/api/kanban'
import { KanbanPanel } from './KanbanPanel'

const mocks = vi.hoisted(() => ({
  listBoards: vi.fn(),
  createBoard: vi.fn(),
  switchBoard: vi.fn(),
  updateBoard: vi.fn(),
  archiveBoard: vi.fn(),
  getBoard: vi.fn(),
  createTask: vi.fn(),
  patchTask: vi.fn(),
  deleteTask: vi.fn(),
}))

vi.mock('@/api/kanban', () => ({
  ...mocks,
  KANBAN_COLUMNS: ['triage', 'todo', 'ready', 'running', 'blocked', 'done'],
}))

function task(id: string, title: string, status: string): KanbanTask {
  return {
    id,
    title,
    status,
    priority: 0,
    created_at: 1700000000,
    link_counts: { parents: 0, children: 0 },
    comment_count: 0,
  }
}

const BOARDS: BoardsResponse = {
  boards: [
    { slug: 'default', name: 'Default', is_current: true, counts: {}, total: 0 },
    { slug: 'experiments', name: 'Experiments', is_current: false, counts: {}, total: 0 },
  ],
  current: 'default',
  read_only: false,
}

const BOARD: BoardPayload = {
  columns: [
    { name: 'triage', tasks: [task('t1', 'First task', 'triage')] },
    { name: 'todo', tasks: [task('t2', 'Second task', 'todo')] },
    { name: 'ready', tasks: [] },
    { name: 'running', tasks: [] },
    { name: 'blocked', tasks: [] },
    { name: 'done', tasks: [] },
  ],
  tenants: ['acme'],
  assignees: ['alice'],
  latest_event_id: 5,
  changed: true,
  read_only: false,
  filters: { tenant: null, assignee: null, include_archived: false, only_mine: false, profile: null },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listBoards.mockResolvedValue(BOARDS)
  mocks.getBoard.mockResolvedValue(BOARD)
})

describe('KanbanPanel', () => {
  it('renders the six default columns and their tasks', async () => {
    render(<KanbanPanel />)
    expect(await screen.findByText('First task')).toBeInTheDocument()
    expect(screen.getByText('Second task')).toBeInTheDocument()
    for (const label of ['Triage', 'To do', 'Ready', 'Running', 'Blocked', 'Done']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(mocks.listBoards).toHaveBeenCalled()
    expect(mocks.getBoard).toHaveBeenCalledWith(expect.objectContaining({ board: 'default' }))
  })

  it('switches boards via switchBoard then refetches the board', async () => {
    mocks.switchBoard.mockResolvedValue({ current: 'experiments', read_only: false })
    const user = userEvent.setup()
    render(<KanbanPanel />)
    await screen.findByText('First task')
    await user.selectOptions(screen.getByLabelText('Board'), 'experiments')
    await waitFor(() => expect(mocks.switchBoard).toHaveBeenCalledWith('experiments'))
    await waitFor(() =>
      expect(mocks.getBoard).toHaveBeenCalledWith(expect.objectContaining({ board: 'experiments' })),
    )
  })

  it('creates a task via the New task dialog with status triage', async () => {
    mocks.createTask.mockResolvedValue({ task: task('t3', 'My new task', 'triage'), read_only: false })
    const user = userEvent.setup()
    render(<KanbanPanel />)
    await screen.findByText('First task')
    await user.click(screen.getByRole('button', { name: 'New task' }))
    await user.type(screen.getByLabelText('Title'), 'My new task')
    await user.click(screen.getByRole('button', { name: 'Create task' }))
    await waitFor(() =>
      expect(mocks.createTask).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({ title: 'My new task', status: 'triage' }),
      ),
    )
  })

  it('moves a task to a new status via the editor', async () => {
    mocks.patchTask.mockResolvedValue({ task: task('t1', 'First task', 'done'), read_only: false })
    const user = userEvent.setup()
    render(<KanbanPanel />)
    await screen.findByText('First task')
    await user.click(screen.getByRole('button', { name: /First task/ }))
    await user.selectOptions(screen.getByLabelText('Move to'), 'done')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mocks.patchTask).toHaveBeenCalledWith(
        'default',
        't1',
        expect.objectContaining({ status: 'done' }),
      ),
    )
  })

  it('deletes a task via the editor Delete action', async () => {
    mocks.deleteTask.mockResolvedValue({ task: task('t1', 'First task', 'archived'), read_only: false })
    const user = userEvent.setup()
    render(<KanbanPanel />)
    await screen.findByText('First task')
    await user.click(screen.getByRole('button', { name: /First task/ }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocks.deleteTask).toHaveBeenCalledWith('default', 't1'))
  })

  it('narrows visible cards client-side with the search filter', async () => {
    const user = userEvent.setup()
    render(<KanbanPanel />)
    await screen.findByText('First task')
    expect(screen.getByText('Second task')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Search'), 'First')
    expect(screen.getByText('First task')).toBeInTheDocument()
    expect(screen.queryByText('Second task')).not.toBeInTheDocument()
  })
})

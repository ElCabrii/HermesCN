import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteSkill,
  getSkillContent,
  getSkills,
  saveSkill,
  type SkillSummary,
} from '@/api/panels'
import { SkillsPanel } from './SkillsPanel'

vi.mock('@/api/panels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/panels')>()
  return {
    ...actual,
    getSkills: vi.fn(),
    getSkillContent: vi.fn(),
    saveSkill: vi.fn(),
    deleteSkill: vi.fn(),
  }
})
vi.mock('@/features/chat/Markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const getSkillsMock = vi.mocked(getSkills)
const getSkillContentMock = vi.mocked(getSkillContent)
const saveSkillMock = vi.mocked(saveSkill)
const deleteSkillMock = vi.mocked(deleteSkill)

const SKILLS: SkillSummary[] = [
  { name: 'git-branch', description: 'Manage git branches', category: 'github', disabled: false },
  { name: 'plan', description: 'Write a markdown plan', category: 'software-development', disabled: false },
  { name: 'bro', description: 'Restate the last message', category: 'bro', disabled: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  getSkillsMock.mockResolvedValue({ skills: SKILLS })
  getSkillContentMock.mockResolvedValue({
    success: true,
    name: 'git-branch',
    description: 'Manage git branches',
    tags: [],
    related_skills: [],
    content: '# git-branch\n\nUse this skill for branch work.',
    path: '/skills/git-branch/SKILL.md',
    skill_dir: '/skills/git-branch',
    linked_files: {},
  })
  saveSkillMock.mockResolvedValue({ ok: true, name: 'git-branch', path: '/skills/git-branch/SKILL.md' })
  deleteSkillMock.mockResolvedValue({ ok: true, name: 'git-branch' })
})

describe('SkillsPanel', () => {
  it('renders skills grouped by category', async () => {
    render(<SkillsPanel />)

    expect(await screen.findByText('git-branch')).toBeInTheDocument()
    expect(screen.getByText('plan')).toBeInTheDocument()
    // 'bro' appears twice: once as the skill row, once as its category heading
    expect(screen.getAllByText('bro').length).toBeGreaterThanOrEqual(2)
    // category headings group the list
    expect(screen.getByText('github')).toBeInTheDocument()
    expect(screen.getByText('software-development')).toBeInTheDocument()
    expect(screen.getByText('bro', { selector: 'h3' })).toBeInTheDocument()
  })

  it('filters the list by search query', async () => {
    const user = userEvent.setup()
    render(<SkillsPanel />)

    await screen.findByText('git-branch')
    await user.type(screen.getByLabelText('Search skills'), 'git')

    expect(screen.getByText('git-branch')).toBeInTheDocument()
    expect(screen.queryByText('plan')).not.toBeInTheDocument()
    expect(screen.queryByText('bro')).not.toBeInTheDocument()
  })

  it('previews a skill SKILL.md when clicked', async () => {
    const user = userEvent.setup()
    render(<SkillsPanel />)

    await screen.findByText('git-branch')
    await user.click(screen.getByText('git-branch'))

    await waitFor(() => expect(getSkillContentMock).toHaveBeenCalledWith('git-branch'))
    // the Markdown component receives the SKILL.md content
    const preview = await screen.findByTestId('markdown')
    expect(preview).toHaveTextContent('# git-branch')
  })

  it('edits a skill and saves it via saveSkill', async () => {
    const user = userEvent.setup()
    render(<SkillsPanel />)

    await screen.findByText('git-branch')
    await user.click(screen.getByText('git-branch'))
    await screen.findByTestId('markdown')
    await user.click(screen.getByRole('button', { name: 'Edit skill' }))

    const editor = screen.getByLabelText('Skill content')
    expect(editor).toHaveValue('# git-branch\n\nUse this skill for branch work.')

    await user.clear(editor)
    await user.type(editor, '# git-branch\n\nUpdated instructions.')
    await user.click(screen.getByRole('button', { name: 'Save skill' }))

    await waitFor(() =>
      expect(saveSkillMock).toHaveBeenCalledWith({
        name: 'git-branch',
        content: '# git-branch\n\nUpdated instructions.',
      }),
    )
    // the list is refreshed after saving
    await waitFor(() => expect(getSkillsMock).toHaveBeenCalledTimes(2))
  })

  it('deletes a skill only after confirmation', async () => {
    const user = userEvent.setup()
    render(<SkillsPanel />)

    await screen.findByText('git-branch')
    await user.click(screen.getByText('git-branch'))
    await screen.findByTestId('markdown')
    await user.click(screen.getByRole('button', { name: 'Delete skill' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/git-branch/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteSkillMock).toHaveBeenCalledWith('git-branch'))
  })

  it('creates a new skill from the form', async () => {
    const user = userEvent.setup()
    render(<SkillsPanel />)

    await screen.findByText('git-branch')
    await user.click(screen.getByRole('button', { name: 'New skill' }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Skill name'), 'deploy')
    await user.type(within(dialog).getByLabelText('Category'), 'devops')
    await user.type(within(dialog).getByLabelText('Skill content'), '# deploy\n\nDeploy notes.')
    await user.click(within(dialog).getByRole('button', { name: 'Create skill' }))

    await waitFor(() =>
      expect(saveSkillMock).toHaveBeenCalledWith({
        name: 'deploy',
        category: 'devops',
        content: '# deploy\n\nDeploy notes.',
      }),
    )
  })
})

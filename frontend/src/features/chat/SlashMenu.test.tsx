import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SlashMenu, type SlashMatch } from './SlashMenu'

/**
 * SlashMenu tests (plan Task 8.7).
 *
 * The autocomplete dropdown ports the legacy cmd-dropdown contract
 * (static/commands.js `showCmdDropdown`):
 *  - renders one row per match (name + desc + arg placeholder), with the
 *    highlighted row driven by the `selected` prop
 *  - mousedown selects (preventDefault keeps textarea focus — legacy
 *    `onmousedown` behavior)
 *  - mouseenter re-targets the highlight
 * Keyboard navigation (ArrowUp/Down/Enter/Tab/Escape) is owned by the
 * Composer textarea, exactly like the legacy keydown binding on `$('msg')`.
 */
function commandMatch(name: string, desc: string, arg?: string): SlashMatch {
  return { kind: 'command', name, desc, ...(arg ? { arg } : {}) }
}

function subargMatch(parent: string, value: string): SlashMatch {
  return { kind: 'subarg', parent, value, desc: `desc of ${parent}` }
}

function renderMenu(matches: SlashMatch[], selected = 0, onSelect = vi.fn()) {
  return render(<SlashMenu matches={matches} selected={selected} onSelect={onSelect} />)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rendering', () => {
  it('renders nothing when there are no matches', () => {
    renderMenu([])
    expect(screen.queryByTestId('slash-menu')).not.toBeInTheDocument()
  })

  it('renders command rows with name, desc, and arg placeholder', () => {
    renderMenu([commandMatch('model', 'Switch model (e.g. /model gpt-4o)', 'model_name')])
    const menu = screen.getByTestId('slash-menu')
    expect(menu).toBeInTheDocument()
    expect(screen.getByText('/model')).toBeInTheDocument()
    expect(screen.getByText('model_name')).toBeInTheDocument()
    expect(screen.getByText('Switch model (e.g. /model gpt-4o)')).toBeInTheDocument()
  })

  it('renders subarg rows with parent prefix and value', () => {
    renderMenu([subargMatch('model', 'gpt-4o')])
    expect(screen.getByText('/model')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
  })

  it('highlights the row at the controlled selected index', () => {
    renderMenu([commandMatch('help', 'Show help'), commandMatch('clear', 'Clear')], 1)
    const rows = screen.getAllByRole('option')
    expect(rows[0]).toHaveAttribute('data-selected', 'false')
    expect(rows[1]).toHaveAttribute('data-selected', 'true')
  })
})

describe('mouse interaction', () => {
  it('mousedown selects a row (legacy onmousedown contract)', () => {
    const onSelect = vi.fn()
    renderMenu([commandMatch('help', 'Show help'), commandMatch('clear', 'Clear')], 0, onSelect)
    fireEvent.mouseDown(screen.getAllByRole('option')[1])
    expect(onSelect).toHaveBeenCalledWith(commandMatch('clear', 'Clear'))
  })

  it('mouseenter re-targets the highlight', () => {
    const onMouseEnter = vi.fn()
    render(<SlashMenu matches={[commandMatch('help', 'Show help')]} selected={0} onSelect={vi.fn()} onMouseEnter={onMouseEnter} />)
    fireEvent.mouseEnter(screen.getAllByRole('option')[0])
    expect(onMouseEnter).toHaveBeenCalledWith(0)
  })
})

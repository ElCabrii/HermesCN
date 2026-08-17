import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'

describe('KeyboardShortcutsDialog', () => {
  it('renders the title and at least one shortcut group', () => {
    render(<KeyboardShortcutsDialog open={true} onOpenChange={() => {}} />)
    expect(screen.getByText(/Keyboard shortcuts/i)).toBeInTheDocument()
    expect(screen.getByText(/Toggle conversations sidebar/i)).toBeInTheDocument()
    expect(screen.getByText(/Send message/i)).toBeInTheDocument()
  })

  it('calls onOpenChange when the dialog asks to close', async () => {
    const onOpenChange = vi.fn()
    render(<KeyboardShortcutsDialog open={true} onOpenChange={onOpenChange} />)
    // shadcn Dialog renders an explicit close button (sr-only); click it.
    const closeBtn = screen.getByRole('button', { name: /close/i })
    await userEvent.setup().click(closeBtn)
    // base-ui passes an event-like argument to onOpenChange; just check it
    // received a "close" request (first arg false).
    expect(onOpenChange).toHaveBeenCalled()
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false)
  })
})

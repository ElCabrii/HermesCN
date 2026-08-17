import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { chatStore, sessionAtom } from './chatStore'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('shows the calm-console hero and a workspace pill', () => {
    chatStore.set(sessionAtom, {
      session_id: 's1',
      title: 'Test',
      workspace: '/home/gabriel/dev/HermesCN',
    })
    render(<EmptyState />)

    expect(screen.getByText(/Calm workbench for your agent/i)).toBeInTheDocument()
    expect(screen.getByText(/dev\/HermesCN/)).toBeInTheDocument()
  })

  it('omits the workspace pill when the session has no workspace', () => {
    chatStore.set(sessionAtom, { session_id: 's2', title: 'NoWorkspace' })
    render(<EmptyState />)

    expect(screen.queryByText(/dev\/HermesCN/)).not.toBeInTheDocument()
  })

  it('renders the five prompt starters', () => {
    chatStore.set(sessionAtom, null)
    render(<EmptyState />)

    for (const title of [
      'Refactor a module',
      'Explore the codebase',
      'Draft a document',
      'Run a command',
      'Brainstorm',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
  })

  it('fills the composer draft when a prompt card is clicked', () => {
    chatStore.set(sessionAtom, null)
    render(
      <>
        <EmptyState />
        <textarea data-testid="composer-textarea" />
      </>,
    )
    const card = screen.getByTestId('empty-state-prompt-draft-a-document')
    card.click()
    const ta = screen.getByTestId<HTMLTextAreaElement>('composer-textarea')
    expect(ta.value).toMatch(/README/i)
  })
})

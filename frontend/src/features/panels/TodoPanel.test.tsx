import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { chatStore, messagesAtom, type Message } from '@/features/chat/chatStore'
import { TodoPanel } from './TodoPanel'

function toolMessage(overrides: Partial<Message> = {}): Message {
  return {
    role: 'tool',
    name: 'todo_write',
    content: JSON.stringify({ todos: [] }),
    ...overrides,
  }
}

beforeEach(() => {
  chatStore.set(messagesAtom, [])
})

describe('TodoPanel', () => {
  it('derives todos from the newest tool message embedding todos JSON', () => {
    chatStore.set(messagesAtom, [
      { role: 'user', content: 'hi' },
      toolMessage({
        content: JSON.stringify({
          todos: [
            { id: 't1', task: 'Write tests', completed: false },
            { id: 't2', task: 'Commit changes', completed: true },
          ],
        }),
      }),
    ])
    render(<TodoPanel />)

    expect(screen.getByText('Write tests')).toBeInTheDocument()
    expect(screen.getByText('Commit changes')).toBeInTheDocument()
    // completed items render as checked
    expect(screen.getByRole('checkbox', { name: 'Commit changes' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Write tests' })).not.toBeChecked()
  })

  it('derives todos from a todo_write tool row even when the name differs', () => {
    chatStore.set(messagesAtom, [
      toolMessage({
        name: 'something-else',
        content: JSON.stringify({ todos: [{ task: 'From content', completed: false }] }),
      }),
    ])
    render(<TodoPanel />)

    expect(screen.getByText('From content')).toBeInTheDocument()
  })

  it('prefers the newest payload when several messages embed todos', () => {
    chatStore.set(messagesAtom, [
      toolMessage({ content: JSON.stringify({ todos: [{ task: 'Stale todo', completed: false }] }) }),
      toolMessage({ content: JSON.stringify({ todos: [{ task: 'Fresh todo', completed: false }] }) }),
    ])
    render(<TodoPanel />)

    expect(screen.getByText('Fresh todo')).toBeInTheDocument()
    expect(screen.queryByText('Stale todo')).not.toBeInTheDocument()
  })

  it('ignores malformed payloads and falls back to an earlier valid one', () => {
    chatStore.set(messagesAtom, [
      toolMessage({ content: JSON.stringify({ todos: [{ task: 'Valid todo', completed: false }] }) }),
      toolMessage({ content: 'not json at all' }),
    ])
    render(<TodoPanel />)

    expect(screen.getByText('Valid todo')).toBeInTheDocument()
  })

  it('ignores non-tool rows even when they contain todos JSON', () => {
    chatStore.set(messagesAtom, [
      { role: 'user', content: JSON.stringify({ todos: [{ task: 'Not a todo', completed: false }] }) },
    ])
    render(<TodoPanel />)

    expect(screen.getByText(/no todos/i)).toBeInTheDocument()
    expect(screen.queryByText('Not a todo')).not.toBeInTheDocument()
  })

  it('shows an empty state when the transcript has no todos', () => {
    render(<TodoPanel />)
    expect(screen.getByText(/no todos/i)).toBeInTheDocument()
  })
})

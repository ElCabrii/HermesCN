import { useAtomValue } from 'jotai'
import { chatStore, messagesAtom, type Message } from '@/features/chat/chatStore'

/**
 * Todo tab of the Control Center.
 *
 * There is deliberately NO backend endpoint for todos in this app (see the
 * note in api/panels.ts) — the legacy panel derives them client-side from
 * tool-call results in the session transcript. This panel is a port of the
 * legacy `_legacyTodosFromMessages` (static/panels.js):
 *
 *   1. scan the transcript from the NEWEST message backwards;
 *   2. only `role: 'tool'` rows count — user/assistant text is ignored even
 *      if it happens to contain todos-shaped JSON;
 *   3. a row qualifies when its tool name is `todo` / `todo_write` OR its
 *      content embeds a JSON object with a `todos` array (stringified first
 *      when the content is already structured);
 *   4. the FIRST qualifying payload wins — the most recent snapshot, which
 *      matches the "todo_state survives refresh" contract;
 *   5. malformed payloads are skipped so an older valid snapshot still shows.
 *
 * The derivation is read-only: it re-renders automatically as the chat
 * store's messagesAtom updates, so a fresh todo payload from the live
 * session appears without any polling.
 */

/** A todo row as emitted by the agent's todo tool (legacy shape). */
export interface DerivedTodo {
  id?: string
  task?: string
  name?: string
  text?: string
  title?: string
  completed?: boolean
  done?: boolean
  status?: string
  [key: string]: unknown
}

/** Human-readable label for a todo row (string rows are used verbatim). */
// oxlint-disable-next-line react/only-export-components -- pure helper exported for tests
export function todoLabel(todo: DerivedTodo | string): string {
  if (typeof todo === 'string') return todo
  return (
    todo.task ??
    todo.name ??
    todo.text ??
    todo.title ??
    (typeof todo.id === 'string' ? todo.id : '')
  )
}

/** Completion state for a todo row (accepts both boolean and status forms). */
// oxlint-disable-next-line react/only-export-components -- pure helper exported for tests
export function todoDone(todo: DerivedTodo | string): boolean {
  if (typeof todo === 'string') return false
  return todo.completed === true || todo.done === true || todo.status === 'done'
}

/** Derive the latest todos snapshot from a transcript (legacy contract). */
// oxlint-disable-next-line react/only-export-components -- pure helper exported for tests
export function deriveTodos(messages: Message[]): DerivedTodo[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || message.role !== 'tool') continue
    const name = typeof message.name === 'string' ? message.name : ''
    let content = message.content
    if (typeof content !== 'string') {
      try {
        content = JSON.stringify(content)
      } catch {
        continue
      }
    }
    // fast-path hint: the todo tool names; the JSON scan below is authoritative
    if (!content.includes('"todos"') && name !== 'todo' && name !== 'todo_write') continue
    try {
      const parsed: unknown = JSON.parse(content)
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { todos?: unknown }).todos)) {
        return (parsed as { todos: DerivedTodo[] }).todos
      }
    } catch {
      // malformed payloads are skipped, like the legacy panel
    }
  }
  return []
}

export function TodoPanel() {
  const messages = useAtomValue(messagesAtom, { store: chatStore })
  const todos = deriveTodos(messages)

  if (todos.length === 0) {
    return <p className="px-1 text-sm text-muted-foreground">No todos in this session yet.</p>
  }

  return (
    <ul className="divide-y divide-border/50">
      {todos.map((todo, index) => {
        const label = todoLabel(todo) || `Todo ${index + 1}`
        const done = todoDone(todo)
        return (
          <li key={index} className="flex items-center gap-2.5 py-2">
            <input
              type="checkbox"
              checked={done}
              readOnly
              disabled
              aria-label={label}
              className="size-3.5 shrink-0 accent-primary"
            />
            <span
              className={done ? 'text-sm text-muted-foreground line-through' : 'text-sm'}
            >
              {label}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

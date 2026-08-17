import { describe, expect, it } from 'vitest'
import { attachToolResult, normalizeToolCall, previewOf, toolCallId } from './toolCalls'

describe('normalizeToolCall', () => {
  it('reads the name and arguments out of the OpenAI function shape', () => {
    const call = normalizeToolCall(
      {
        id: 'call_1',
        call_id: 'call_1',
        type: 'function',
        function: { name: 'terminal', arguments: '{"command":"ls -la"}' },
      },
      { settled: true },
    )
    expect(call.name).toBe('terminal')
    expect(call.args).toEqual({ command: 'ls -la' })
    // The collapsed row shows the command, not a JSON blob.
    expect(call.preview).toBe('ls -la')
  })

  it('keeps a non-JSON argument string as-is', () => {
    const call = normalizeToolCall(
      { function: { name: 'shell', arguments: 'not json {' } },
      { settled: true },
    )
    expect(call.args).toBe('not json {')
  })

  it('treats a settled call with no done flag as complete', () => {
    // Saved history has no in-flight calls; defaulting to "running" left a
    // spinner next to every tool in every past conversation.
    expect(normalizeToolCall({ function: { name: 'read' } }, { settled: true }).done).toBe(true)
    expect(normalizeToolCall({ function: { name: 'read' } }, { settled: false }).done).toBe(false)
  })

  it('never overrides an explicit done flag', () => {
    expect(normalizeToolCall({ name: 'search', done: false }, { settled: true }).done).toBe(false)
  })

  it('passes the flat SSE shape through unchanged', () => {
    const call = normalizeToolCall({ name: 'search', preview: 'docs', done: false }, { settled: false })
    expect(call).toMatchObject({ name: 'search', preview: 'docs', done: false })
  })

  it('falls back to a generic name for an unusable payload', () => {
    expect(normalizeToolCall(null, { settled: true }).name).toBe('tool')
    expect(normalizeToolCall({}, { settled: true }).name).toBe('tool')
  })
})

describe('previewOf', () => {
  it('prefers the most target-like argument', () => {
    expect(previewOf({ limit: 5, query: 'hermes' })).toBe('hermes')
    expect(previewOf({ file_path: '/tmp/a.txt' })).toBe('/tmp/a.txt')
  })

  it('returns nothing when no argument reads as a target', () => {
    expect(previewOf({ limit: 5, deep: { path: 'x' } })).toBeUndefined()
    expect(previewOf(undefined)).toBeUndefined()
  })
})

describe('attachToolResult', () => {
  it('merges a tool result into the call it answers', () => {
    const calls = [
      normalizeToolCall({ call_id: 'a', function: { name: 'read' } }, { settled: true }),
      normalizeToolCall({ call_id: 'b', function: { name: 'write' } }, { settled: true }),
    ]
    expect(attachToolResult(calls, { tool_call_id: 'b', content: 'done' })).toBe(true)
    expect(calls[1].result).toBe('done')
    expect(calls[0].result).toBeUndefined()
  })

  it('marks the call as failed when the result carries an error', () => {
    const calls = [normalizeToolCall({ call_id: 'a', function: { name: 'read' } }, { settled: true })]
    attachToolResult(calls, { tool_call_id: 'a', content: 'boom', is_error: true })
    expect(calls[0].is_error).toBe(true)
  })

  it('reports an unmatched result so the caller can still show it', () => {
    const calls = [normalizeToolCall({ call_id: 'a', function: { name: 'read' } }, { settled: true })]
    calls[0].result = 'already answered'
    expect(attachToolResult(calls, { tool_call_id: 'zz', content: 'orphan' })).toBe(false)
  })

  it('falls back to call order when the result carries no id', () => {
    const calls = [
      normalizeToolCall({ call_id: 'a', function: { name: 'read' } }, { settled: true }),
      normalizeToolCall({ call_id: 'b', function: { name: 'write' } }, { settled: true }),
    ]
    attachToolResult(calls, { content: 'first' })
    expect(calls[0].result).toBe('first')
  })
})

describe('toolCallId', () => {
  it('accepts every id spelling the transports use', () => {
    expect(toolCallId({ call_id: 'a', id: 'b' })).toBe('a')
    expect(toolCallId({ id: 'b' })).toBe('b')
    expect(toolCallId({ tid: 'c' })).toBe('c')
    expect(toolCallId({})).toBeUndefined()
  })
})

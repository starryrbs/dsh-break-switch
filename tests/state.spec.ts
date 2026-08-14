import { describe, expect, it } from 'vitest'
import { createTracking } from '../src/state.ts'

describe('RunningTracker transitions', () => {
  it('emits started-first on the first running agent, finished-last on the last idle', () => {
    const t = createTracking()
    expect(t.onStatus('a', 'running')).toBe('started-first')
    expect(t.onStatus('a', 'idle')).toBe('finished-last')
  })

  it('reports changed while other agents run, and finished-last only when the last stops', () => {
    const t = createTracking()
    expect(t.onStatus('a', 'running')).toBe('started-first')
    expect(t.onStatus('b', 'running')).toBe('changed')
    expect(t.onStatus('a', 'idle')).toBe('changed')
    expect(t.onStatus('b', 'idle')).toBe('finished-last')
  })

  it('treats duplicate running events as none', () => {
    const t = createTracking()
    t.onStatus('a', 'running')
    expect(t.onStatus('a', 'running')).toBe('none')
  })

  it('treats idle for an unknown agent as none', () => {
    const t = createTracking()
    expect(t.onStatus('a', 'idle')).toBe('none')
  })

  it('remove clears the count and reports finished-last when it was the last', () => {
    const t = createTracking()
    t.onStatus('a', 'running')
    expect(t.remove('a')).toBe('finished-last')
    expect(t.running.size).toBe(0)
  })

  it('remove of the last of several reports finished-last only on the final removal', () => {
    const t = createTracking()
    t.onStatus('a', 'running')
    t.onStatus('b', 'running')
    expect(t.remove('a')).toBe('changed')
    expect(t.remove('b')).toBe('finished-last')
  })

  it('seeding with already-running agents starts in a running state without emitting an initial transition', () => {
    const t = createTracking(['a', 'b'])
    expect(t.running.size).toBe(2)
    // A status event for one of the seeded agents just marks changed, not started-first.
    expect(t.onStatus('a', 'idle')).toBe('changed')
  })
})

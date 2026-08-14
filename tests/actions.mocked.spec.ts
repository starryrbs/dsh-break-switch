import { describe, expect, it, vi } from 'vitest'
import { activateApp, openUrl } from '../src/actions.ts'

// A fake runner that records invocations and lets each configured command
// resolve or reject, so we can assert what commands the action layer issues.
function makeRunner() {
  const calls: { file: string; args: string[] }[] = []
  const run = vi.fn(async (file: string, args: string[]) => {
    calls.push({ file, args: [...args] })
    return { stdout: '', stderr: '' }
  })
  return { run, calls }
}

describe('activateApp', () => {
  it('issues open -a <app> and resolves true on success', async () => {
    const { run, calls } = makeRunner()
    const ok = await activateApp('TikTok', run, { warn: () => {} })
    expect(ok).toBe(true)
    expect(calls).toEqual([{ file: 'open', args: ['-a', 'TikTok'] }])
  })

  it('resolves false and never throws when the command fails', async () => {
    const run = vi.fn(async () => { throw new Error('boom') })
    const warned: string[] = []
    const ok = await activateApp('TikTok', run, { warn: (m) => { warned.push(m) } })
    expect(ok).toBe(false)
    expect(warned.some(m => m.includes('boom'))).toBe(true)
  })
})

describe('openUrl', () => {
  it('issues an osascript invocation carrying the browser-open AppleScript', async () => {
    const { run, calls } = makeRunner()
    const ok = await openUrl('https://example.com', 'chrome', run, { warn: () => {} })
    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].file).toBe('osascript')
    // The script must reference the URL and "make new tab" reuse logic.
    const script = calls[0].args.find(a => a.includes('on run argv')) ?? ''
    expect(script).toContain('Google Chrome')
    expect(script).toContain('location.href')
    expect(script).toContain('make new tab')
  })

  it('safari script targets Safari and reuses tabs by URL', async () => {
    const { run, calls } = makeRunner()
    await openUrl('https://example.com', 'safari', run, { warn: () => {} })
    const script = calls[0].args.find(a => a.includes('on run argv')) ?? ''
    expect(script).toContain('Safari')
    expect(script).toContain('URL of t')
    expect(script).toContain('make new tab')
  })

  it('resolves false without throwing on a failed osascript', async () => {
    const run = vi.fn(async () => { throw new Error('denied') })
    const warned: string[] = []
    const ok = await openUrl('https://example.com', 'chrome', run, { warn: (m) => { warned.push(m) } })
    expect(ok).toBe(false)
    expect(warned.some(m => m.includes('denied'))).toBe(true)
  })

  it('escapes quotes in the target URL', async () => {
    const { run, calls } = makeRunner()
    await openUrl('https://example.com/?q="x"', 'chrome', run, { warn: () => {} })
    const script = calls[0].args.find(a => a.includes('on run argv')) ?? ''
    expect(script).not.toContain('q="x"')
  })
})

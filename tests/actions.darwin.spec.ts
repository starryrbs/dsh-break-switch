import { describe, expect, it } from 'vitest'
import { detectFrontApp } from '../src/actions.ts'

const isMac = process.platform === 'darwin'

// Exercised only on macOS. On other platforms the action layer no-ops by
// design, so this suite guards the device-specific behaviors.
describe.skipIf(!isMac)('macOS native actions', () => {
  it('detects a non-empty frontmost app display name', async () => {
    const name = await detectFrontApp()
    expect(typeof name).toBe('string')
    expect((name as string).length).toBeGreaterThan(0)
  })
})

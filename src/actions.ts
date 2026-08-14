/**
 * macOS action layer for dsh-break-switch.
 *
 * Thin, fail-safe wrappers around standard system commands (`lsappinfo`,
 * `open`, `osascript`) that switch the frontmost app and drive a browser
 * tab. Every function returns normally: a failed or impossible command resolves
 * with `false`/`null` and reports through the injected sink instead of
 * throwing, so the host process never crashes because of a permissions or
 * command failure.
 *
 * On non-macOS platforms these functions no-op (resolve `false`/`null`) so
 * the plugin is safe to enable anywhere.
 *
 * @module dsh-break-switch/actions
 */

import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { platform } from 'node:os'

const execFile = promisify(execFileCb)

export type Browser = 'chrome' | 'safari'

/** A function that executes a command and captures stdout/stderr. Injected for tests. */
export type CommandRunner = (
  file: string,
  args: readonly string[],
  timeoutMs?: number,
) => Promise<{ stdout: string; stderr: string }>

/** Default runner backed by `child_process.execFile`. */
const realRunner: CommandRunner = async (file, args, timeoutMs = 10000) => {
  const { stdout, stderr } = await execFile(file, [...args], { timeout: timeoutMs })
  return { stdout, stderr }
}

const IS_MAC = platform() === 'darwin'

/** Escape a value for interpolation into a double-quoted AppleScript string literal. */
function quoteAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Error/skip surface; the plugin wires a Cordis logger adapter so no command throw escapes. */
export interface ActionSink {
  /** Warn-level report of a failed or skipped command. */
  warn(message: string): void
}

/** Build the AppleScript that activates a browser and focuses-or-opens `url`. */
function browserTabScript(browser: Browser, url: string): string {
  const u = quoteAppleScript(url)
  if (browser === 'chrome') {
    return [
      'on run argv',
      '  set theUrl to item 1 of argv',
      '  tell application "Google Chrome"',
      '    activate',
      '    set reused to false',
      '    repeat with w in windows',
      '      set widx to index of w',
      '      repeat with t in tabs of w',
      '        try',
      '          if (execute t javascript "location.href") is theUrl then',
      '            set active tab index of w to (index of t)',
      '            set index of w to 1',
      '            set reused to true',
      '            exit repeat',
      '          end if',
      '        end try',
      '      end repeat',
      '      if reused then exit repeat',
      '    end repeat',
      '    if not reused then',
      '      tell front window to make new tab with properties {URL:theUrl}',
      '    end if',
      '  end tell',
      'end run',
    ].join('\n')
  }
  return [
    'on run argv',
    '  set theUrl to item 1 of argv',
    '  tell application "Safari"',
    '    activate',
    '    set reused to false',
    '    repeat with w in windows',
    '      repeat with t in tabs of w',
    '        if (URL of t) is theUrl then',
    '          set current tab of w to t',
    '          set reused to true',
    '          exit repeat',
    '        end if',
    '      end repeat',
    '      if reused then exit repeat',
    '    end repeat',
    '    if not reused then',
    '      set front window' + "'" + "s current tab to (make new tab at end of tabs of front window with properties {URL:theUrl})",
    '    end if',
    '  end tell',
    'end run',
  ].join('\n')
}

/**
 * Detect the current frontmost application display name, or `null`.
 *
 * Uses `lsappinfo front` to read the front ASN, then `lsappinfo info -only name`
 * to map it to a display name. Fails soft (returns `null`) on non-macOS or any
 * command error.
 */
export async function detectFrontApp(
  run: CommandRunner = realRunner,
  sink: ActionSink = { warn: () => {} },
): Promise<string | null> {
  if (!IS_MAC) return null
  try {
    const asn = (await run('lsappinfo', ['front'], 5000)).stdout.trim()
    if (!asn) {
      sink.warn('detectFrontApp: lsappinfo front returned nothing')
      return null
    }
    const info = await run('lsappinfo', ['info', '-only', 'name', asn], 5000)
    const m = info.stdout.match(/"LSDisplayName"="([^"]*)"?/)
    return m ? m[1] ?? null : null
  } catch (err) {
    sink.warn(`detectFrontApp failed: ${String(err)}`)
    return null
  }
}

/**
 * Switch the frontmost app to `appName` via `open -a`. Resolves `true` on success.
 */
export async function activateApp(
  appName: string,
  run: CommandRunner = realRunner,
  sink: ActionSink = { warn: () => {} },
): Promise<boolean> {
  if (!IS_MAC) {
    sink.warn(`activateApp skipped (non-macOS): ${appName}`)
    return false
  }
  try {
    await run('open', ['-a', appName], 10000)
    return true
  } catch (err) {
    sink.warn(`activateApp failed for "${appName}": ${String(err)}`)
    return false
  }
}

/**
 * Focus or open a browser tab pointing at `url`. The AppleScript deduplicates:
 * an existing tab with the exact URL is focused, otherwise one is created.
 * Resolves `true` if the osascript invocation succeeded.
 */
export async function openUrl(
  url: string,
  browser: Browser,
  run: CommandRunner = realRunner,
  sink: ActionSink = { warn: () => {} },
): Promise<boolean> {
  if (!IS_MAC) {
    sink.warn(`openUrl skipped (non-macOS): ${url}`)
    return false
  }
  try {
    await run('osascript', ['-e', browserTabScript(browser, url), '--', url], 15000)
    return true
  } catch (err) {
    sink.warn(`openUrl failed for "${url}" in ${browser}: ${String(err)}`)
    return false
  }
}

/**
 * Return a dispose function that stops a periodic scroll timer driving the
 * active tab downward via injected JavaScript.
 * @param intervalMs - delay between scroll steps.
 * @param cycles - maximum scroll steps before the timer stops itself; `0` scrolls until disposed.
 */
export function startScrolling(
  browser: Browser,
  run: CommandRunner = realRunner,
  sink: ActionSink,
  intervalMs = 6000,
  cycles = 0,
): () => void {
  if (!IS_MAC) return () => {}
  let disposed = false
  let count = 0
  const step = async () => {
    if (disposed) return
    count += 1
    if (cycles > 0 && count > cycles) return
    const script = browser === 'chrome'
      ? `tell application "Google Chrome" to execute front window's active tab javascript "window.scrollBy(0, window.innerHeight * 0.7); 'ok'"`
      : `tell application "Safari" to do JavaScript "window.scrollBy(0, window.innerHeight * 0.7)" in front document`
    try {
      await run('osascript', ['-e', script], 10000)
    } catch (err) {
      sink.warn(`scroll failed: ${String(err)}`)
    }
  }
  void step()
  const timer = setInterval(step, intervalMs)
  return () => {
    disposed = true
    clearInterval(timer)
  }
}

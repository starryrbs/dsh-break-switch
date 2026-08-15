/**
 * dsh-break-switch: a DSH plugin that moves the macOS frontmost app to a break
 * target while an agent is running, then returns to the previous app once every
 * agent finishes.
 *
 * Subscribes to the agent-scoped lifecycle events on the root context and
 * forwards each root agent's `idle`/`running` transitions to a
 * {@link createTracking} reducer. The first transition to `running` (running
 * set 0→1) arms the break after a `minRunSeconds` debounce; the last
 * transition back to `idle` (set →0) restores the previously frontmost app.
 *
 * The break target is either an app (`activateApp`) or a browser URL that is
 * focused-or-opened without duplicating (`openUrl`, with opt-in auto-scroll).
 * Every OS command fails soft through `ctx.logger.warn`; the host process is
 * never brought down by a permissions or command failure.
 *
 * @module dsh-break-switch
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import { createTracking, type RunningTracker, type Transition } from './state.js'
import {
  activateApp,
  detectFrontApp,
  openUrl,
  startScrolling,
  type ActionSink,
} from './actions.js'

/** Plugin display name; shows up in Cordis diagnostics. */
export const name = 'dsh-break-switch'

/** Services required before this plugin can subscribe to agent lifecycle events. */
export const inject = ['agents']

/** Allowed browser choices for the `url` target kind. */
type Browser = 'chrome' | 'safari'

/**
 * Plugin configuration, validated by the same-named schemastery schema. The
 * `target` discriminates how the break opens: an app to activate, or a URL to
 * focus-or-open in a browser. Misconfiguration (an unknown `kind`, an empty
 * `app`, an invalid `url`, an unknown `browser`, or a non-positive
 * `minRunSeconds`) fails loud at plugin load in {@link validateConfig}.
 */
export interface Config {
  /** Master switch; when false the plugin does nothing. Default `true`. */
  enabled?: boolean
  /** The break target, either an app to activate or a URL to focus-or-open. */
  target: { kind: 'app'; app: string } | { kind: 'url'; url: string }
  /** Browser for the `url` target. Default `'chrome'`. Ignored for `app`. */
  browser?: Browser
  /**
   * Auto-scroll the break tab. Either a boolean (interval defaults to 6000ms)
   * or an object with a custom `intervalSeconds`. Default `false`.
   */
  scroll?: boolean | { intervalSeconds?: number }
  /**
   * Minimum a run must last before the plugin actually switches to the break
   * target; a run ending before this is treated as a flicker and nothing is
   * switched. Default `2` seconds.
   */
  minRunSeconds?: number
}

/** Configured auto-scroll normalized to `{ intervalMs }` or `undefined`. */
type ScrollSpec = { intervalMs: number } | undefined

function resolveScroll(scroll: Config['scroll']): ScrollSpec {
  if (!scroll) return undefined
  if (typeof scroll === 'boolean') return { intervalMs: 6000 }
  const intervalSeconds = scroll.intervalSeconds ?? 6
  return { intervalMs: Math.max(1, intervalSeconds) * 1000 }
}

const browserSchema = z.union(['chrome', 'safari'] as const)

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  target: z.union([
    z.object({ kind: z.const('app'), app: z.string() }),
    z.object({ kind: z.const('url'), url: z.string() }),
  ]),
  browser: browserSchema.default('chrome'),
  scroll: z.union([
    z.boolean(),
    z.object({ intervalSeconds: z.number() }),
  ]),
  minRunSeconds: z.number().default(2),
})

/**
 * Fail-loud structural validation on top of the schemastery schema. The schema
 * rejects wrong types; this rejects values that are technically typed but
 * unusable: an empty `app`, a `url` that is not absolute HTTP(S), or a
 * non-positive `minRunSeconds`. Throwing here prevents a misconfigured plugin
 * from silently doing nothing or switching to garbage.
 */
export function validateConfig(config: Config): void {
  const target = (config as { target?: unknown }).target as
    | { kind?: unknown; app?: unknown; url?: unknown }
    | undefined
  if (target === undefined || typeof target !== 'object' || target === null) {
    throw new Error('dsh-break-switch: target is required')
  }
  if (target.kind === 'app') {
    if (typeof target.app !== 'string' || target.app.trim().length === 0) {
      throw new Error('dsh-break-switch: target.app must be a non-empty string for kind "app"')
    }
  } else if (target.kind === 'url') {
    if (typeof target.url !== 'string') {
      throw new Error('dsh-break-switch: target.url must be a string for kind "url"')
    }
    let parsed: URL
    try {
      parsed = new URL(target.url)
    } catch {
      throw new Error(`dsh-break-switch: target.url is not a valid URL: "${target.url}"`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`dsh-break-switch: target.url must be absolute http(s): "${target.url}"`)
    }
  } else {
    throw new Error(`dsh-break-switch: target.kind must be "app" or "url", got ${String(target.kind)}`)
  }
  if (config.minRunSeconds === undefined || config.minRunSeconds <= 0) {
    throw new Error('dsh-break-switch: minRunSeconds must be a positive number of seconds')
  }
}

/** The per-run switching state the plugin keeps while any agent is running. */
interface RunState {
  /** Disposable scroll timer, armed after the break is actually opened. */
  disposeScroll: (() => void) | null
  /** Debounce timer that performs the actual switch after `minRunSeconds`. */
  armTimer: ReturnType<typeof setTimeout> | null
  /** True once the break target has been switched to; guards idempotency. */
  switched: boolean
  /** The frontmost app captured just before switching away; restored on finish. */
  originalFrontApp: string | null
}

/** Adapter exposing the subset of plugin needs to the macOS action layer. */
function makeSink(ctx: Context): ActionSink {
  return {
    warn: (message: string) => ctx.logger.warn(`[dsh-break-switch] ${message}`),
  }
}

/**
 * Cordis function-plugin entry. Wires the lifecycle subscriptions under a
 * single `ctx.effect` so unloading disposes every subscription, the debounce
 * timer, and a running scroll timer.
 *
 * @param ctx - the plugin context (after `agents` injection).
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  console.log(`[dsh-break-switch] LOADED; enabled=${config.enabled !== false}, target=${JSON.stringify(config.target)}, browser=${config.browser ?? 'chrome'}, minRunSeconds=${config.minRunSeconds ?? 2}`)
  if (config.enabled === false) return
  const browser: Browser = config.browser ?? 'chrome'
  const minRunSeconds: number = config.minRunSeconds ?? 2

  ctx.effect(() => {
    const tracker: RunningTracker = createTracking(
      ctx.agents.roots()
        .filter(agent => agent.status === 'running')
        .map(agent => agent.id),
    )
    const scroll = resolveScroll(config.scroll)
    const minRunMs = minRunSeconds * 1000
    const sink = makeSink(ctx)

    let runState: RunState | null = null
    let disposed = false

    const clearRun = () => {
      if (runState?.armTimer) clearTimeout(runState.armTimer)
      runState?.disposeScroll?.()
      runState = null
    }

    const restore = () => {
      const state = runState
      if (!state) return
      clearRun()
      if (state.switched && state.originalFrontApp) {
        void activateApp(state.originalFrontApp, undefined, sink)
      }
    }

    const performSwitch = () => {
      const state = runState
      if (!state || state.switched) return
      state.switched = true
      void (async () => {
        const front = await detectFrontApp(undefined, sink)
        state.originalFrontApp = front
        if (!front) sink.warn('frontmost app could not be read; restore will be skipped')
        let ok = false
        if (config.target.kind === 'app') {
          ok = await activateApp(config.target.app, undefined, sink)
        } else {
          ok = await openUrl(config.target.url, browser, undefined, sink)
          if (ok && scroll) state.disposeScroll = startScrolling(browser, undefined, sink, scroll.intervalMs)
        }
        if (!ok) sink.warn(`could not open break target: ${JSON.stringify(config.target)}`)
      })()
    }

    const armBreak = () => {
      if (runState) return
      const state: RunState = {
        disposeScroll: null,
        armTimer: null,
        switched: false,
        originalFrontApp: null,
      }
      runState = state
      state.armTimer = setTimeout(() => {
        state.armTimer = null
        if (tracker.running.size > 0) performSwitch()
      }, minRunMs)
    }

    const handleTransition = (transition: Transition) => {
      if (transition === 'started-first') armBreak()
      else if (transition === 'finished-last') restore()
    }

    const onStatus = ({ agent, status }: { agent: Agent; status: 'idle' | 'running' }) => {
      if (disposed) return
      handleTransition(tracker.onStatus(agent.id, status))
    }

    const disposers: (() => void)[] = []
    disposers.push(ctx.on('agent/status', onStatus))
    disposers.push(ctx.on('agent/created', ({ agent }) => {
      const isRoot = ctx.agents.roots().some(candidate => candidate.id === agent.id)
      if (isRoot && agent.status === 'running') {
        handleTransition(tracker.onStatus(agent.id, 'running'))
      }
    }))
    disposers.push(ctx.on('agent/disposed', ({ agent }) => {
      handleTransition(tracker.remove(agent.id))
    }))

    return () => {
      disposed = true
      for (const dispose of disposers) dispose()
      clearRun()
    }
  }, 'dsh-break-switch.lifecycle()')
}
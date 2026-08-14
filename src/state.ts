/**
 * RunningTracker: a pure reducer over the set of currently-running root agents.
 *
 * The plugin listens to agent-scoped `agent/status` events and forwards each
 * transition here. This module decides, purely from the tracked multiset of
 * running agent ids, when the host should switch to the break target and when
 * every agent has finished and the host should switch back.
 *
 * @module dsh-break-switch/state
 */

/** A stable identity for a tracked agent (session id string). */
export type AgentId = string

/**
 * The outcome of feeding one status transition into a RunningTracker.
 *
 * - `'none'`: a repeated status for the same agent, e.g. a duplicate `running`
 *   event; nothing changed.
 * - `'changed'`: the running multiset changed but no switch boundary crossed
 *   (another agent started or finished while one was already running).
 * - `'started-first'`: the first currently-running agent began; the host should
 *   switch to the break target.
 * - `'finished-last'`: the last currently-running agent finished; the host
 *   should switch back to the original app.
 */
export type Transition =
  | 'none'
  | 'changed'
  | 'started-first'
  | 'finished-last'

/** Mutable tracker owned by the plugin; use {@link createTracking} to build one. */
export interface RunningTracker {
  /** Set of agent ids currently in the `running` state. */
  readonly running: ReadonlySet<AgentId>
  /**
   * Feed one status transition for one agent and return the boundary crossed,
   * or `'none'` if nothing changed.
   */
  readonly onStatus: (agentId: AgentId, status: 'idle' | 'running') => Transition
  /** Remove an agent (e.g. on dispose) and return the boundary crossed. */
  readonly remove: (agentId: AgentId) => Transition
}

/**
 * Create a RunningTracker, optionally seeding the initial running set from the
 * agents that were already running before the plugin loaded.
 * @param initialRunning - agent ids already running at plugin load.
 */
export function createTracking(initialRunning: readonly AgentId[] = []): RunningTracker {
  const running = new Set<AgentId>(initialRunning)

  const transition: Transition =
    running.size === 0 ? 'finished-last'
      : initialRunning.length === 0 && running.size === 1 ? 'started-first'
        : 'changed'

  return {
    running,
    onStatus(agentId, status) {
      const wasRunning = running.has(agentId)
      if (status === 'running') {
        if (wasRunning) return 'none'
        running.add(agentId)
      } else {
        if (!wasRunning) return 'none'
        running.delete(agentId)
      }
      return running.size === 0 ? 'finished-last'
        : running.size === 1 && status === 'running' ? 'started-first'
          : 'changed'
    },
    remove(agentId) {
      if (!running.delete(agentId)) return 'none'
      return running.size === 0 ? 'finished-last' : 'changed'
    },
  }
}

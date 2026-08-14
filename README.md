# dsh-break-switch

A [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) plugin for macOS that
automatically moves the **frontmost app to a break target while an agent is coding**, then switches
back to your editor once every agent finishes.

While an autonomous coding agent works, you do not have to stare at progress bars: the plugin flips
you to a break app or a webpage, and focus returns to wherever you were when the run ends. Useful
for slow, long-running tasks.

## How it works

- The plugin subscribes to DSH's agent-lifecycle events (`agent/status` is delivered to the root
  context) and reduces each root agent's `idle`/`running` transitions into "a run started"
  and "the last run finished".
- On the **first** running agent, the plugin records the current frontmost app, waits a short
  debounce, then switches to your break target.
- When the **last** running agent goes idle, the plugin switches back to the app it recorded earlier.
- The break target is either an app you name, or a URL opened (or focused) in a browser. If the tab
  already exists, it is focused rather than duplicated.

Every OS command fails softly: a permissions or command failure is logged with `ctx.logger.warn`
and never crashes the host process. On non-macOS platforms all switching actions are no-ops.

## Requirements

- macOS (the app/`osascript` control layer is macOS-only).
- Node.js `>= 22.19` and a DeepSeek Harness host.
- First use of browser control shows a one-time macOS **Automation** permission prompt for the host
  process that runs DSH. Click **Allow** once; if you deny it, browsers just will not auto-switch and
  the plugin logs a warning.

## Install

### As a git plugin

```sh
dsh plugin add github:starryrbs/dsh-break-switch
```

### Or reference it directly in your composition

Put a `cordis.yml` entry that loads the package and configure it (see below).

## Configuration

The plugin accepts a `config` block under its entry in your Cordis composition. All keys are
optional except `target`.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Master switch. When `false`, the plugin does nothing. |
| `target` | object (required) | — | The break target. See below. |
| `browser` | `'chrome' \| 'safari'` | `'chrome'` | Browser used for a `url` target. |
| `scroll` | `boolean \| { intervalSeconds }` | `false` | Auto-scroll the break tab at the given interval (default 6s) while running. |
| `minRunSeconds` | positive number | `2` | A run must last at least this long before the plugin switches; a shorter run is treated as a flicker and nothing is switched. |

### `target`

Two shapes, discriminated by `kind`:

- Activate an app by name:

  ```yaml
  target:
    kind: app
    app: TikTok
  ```

- Open (or focus-reuse) a URL in a browser:

  ```yaml
  target:
    kind: url
    url: https://www.douyin.com
    browser: chrome   # optional; default chrome
  ```

### Example `cordis.yml`

```yaml
- name: dsh-break-switch
  config:
    target:
      kind: url
      url: https://www.douyin.com
    browser: chrome
    scroll: true
    minRunSeconds: 3
```

## Examples

Activate an app while the agent works:

```yaml
- name: dsh-break-switch
  config:
    target:
      kind: app
      app: "Microsoft Teams"
    enabled: true
```

## How the switching works under the hood

| Need | Tool |
| --- | --- |
| Read the frontmost app | `lsappinfo front` + `lsappinfo info -only name` |
| Activate an app | `open -a "<App>"` |
| Focus-or-open a browser tab | `osascript` controlling Chrome/Safari |
| Auto-scroll the tab | `osascript` + injected `window.scrollBy` on a timer |

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run (macOS-native cases are skipped off-macOS)
npm run build       # emits lib/
```

The package is fully standalone: it declares `@deepseek-ai/cordis` and `@deepseek-ai/dsh-agent` as
peer dependencies (provided by the DSH host) and has no runtime third-party dependencies.

## Known Limitations and Deferred Work

- The frontmost-app restore is best-effort: if the front app cannot be read when a run starts, the
  restore step is skipped rather than guessing.
- Agents already running when the plugin loads are seeded, but a run that began before plugin load
  is not treated as a switch trigger, so enabling it mid-session does not yank your cursor.
- Only Chrome and Safari are supported for URL targets.
- Multi-monitor and fullscreen-edge behaviors are not special-cased; the plugin manipulates the
  frontmost app as reported by macOS.

## License

MIT

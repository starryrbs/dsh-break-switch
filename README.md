# dsh-break-switch

一个给 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 用的 macOS 插件：
AI 跑代码时自动把**前台 App 切到摸鱼目标**，AI 全部跑完后再**自动切回你之前的窗口**。

当 AI 在自主写代码时，你无需盯着进度条：插件会把焦点头换到摸鱼 App 或网页，等这次运行结束，焦点又回到你原来的窗口。适合慢的、长时间运行的任务。

## 工作原理

- 插件订阅 DSH 的 agent 生命周期事件（`agent/status` 会派发到根上下文），把每个 root agent 的
  `idle`/`running` 切换归约为"有运行开始 / 最后一次运行结束"。
- 当**第一个** agent 开始运行时，插件记录当前前台 App，等一个短暂的防抖窗口后，切到摸鱼目标。
- 当**最后一个**运行中的 agent 回到 idle，插件切回之前记录的 App。
- 摸鱼目标是"指定 App"或"在浏览器里打开（或复用）某个 URL"。如果该 URL 的标签页已经存在，
  就聚焦它而不是重复新建。

所有系统命令都是"软失败"：权限或命令失败只会用 `ctx.logger.warn` 记录，绝不会让宿主进程崩溃。
在非 macOS 平台上所有切换动作都是 no-op。

## 环境要求

- macOS（App/`osascript` 控制层仅限 macOS）。
- Node.js `>= 22.19`，以及一个 DeepSeek Harness 宿主。
- 首次使用浏览器控制时，macOS 会给运行 DSH 的宿主进程弹一次"自动化"授权框。点一次**允许**即可；
  若你点了拒绝，浏览器只是不会自动切换，插件会记一条警告日志。

## 安装

### 作为 git 插件

```sh
dsh plugin add github:starryrbs/dsh-break-switch
```

### 或直接在组合配置里引用

在 `cordis.yml` 里加一条加载该包的 entry，并按下面的说明配置。

## 配置

插件在其 Cordis 组合的 entry 下接受一个 `config` 块。除了 `target` 之外所有键都是可选的。

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 总开关。为 `false` 时插件什么都不做。 |
| `target` | object（必填） | — | 摸鱼目标，见下。 |
| `browser` | `'chrome' \| 'safari'` | `'chrome'` | 用于 `url` 目标的浏览器。 |
| `scroll` | `boolean \| { intervalSeconds }` | `false` | 运行时在摸鱼标签页里按间隔（默认 6 秒）自动滚动。 |
| `minRunSeconds` | 正数 | `2` | 运行必须持续至少这么久插件才会切换；更短的运行视为抖动，什么都不切。 |

### `target`

两种形态，由 `kind` 区分：

- 按名字唤起 App：

  ```yaml
  target:
    kind: app
    app: TikTok
  ```

- 在浏览器里打开（或复用）某个 URL：

  ```yaml
  target:
    kind: url
    url: https://www.douyin.com
    browser: chrome   # 可选；默认 chrome
  ```

### `cordis.yml` 示例

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

## 更多示例

AI 工作时唤起一个 App：

```yaml
- name: dsh-break-switch
  config:
    target:
      kind: app
      app: "Microsoft Teams"
    enabled: true
```

## 底层实现

| 需求 | 工具 |
| --- | --- |
| 读取最前台的 App | `lsappinfo front` + `lsappinfo info -only name` |
| 唤起 App | `open -a "<App>"` |
| 聚焦或新建浏览器标签页 | `osascript` 控制 Chrome/Safari |
| 标签页内自动滚动 | `osascript` + 定时注入 `window.scrollBy` |

## 本地开发

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run（macOS 原生用例在非 macOS 上自动跳过）
npm run build       # 产出 lib/
```

本包完全独立：把 `@deepseek-ai/cordis` 和 `@deepseek-ai/dsh-agent` 声明为 peer 依赖（由 DSH 宿主提供），
本身没有运行时第三方依赖。

## 已知限制与后续工作

- 前台的还原是尽力而为：若运行开始时读不到前台 App，就跳过还原而不是瞎猜。
- 插件加载时已在运行的 agent 会被纳入种子，但"加载前就开始的运行"不会被当作切换触发，
  这样在会话中途开启插件不会把光标拽走。
- URL 目标目前只支持 Chrome 和 Safari。
- 多显示器 / 全屏等边缘情况没有特殊处理；插件操作的是 macOS 报告的"最前台 App"。

## License

MIT

# 开发笔记 — dsh-offwork-countdown

> **本插件故意没有 `README.md`**：宿主会把包里的 README 整篇渲染到插件页上，而插件页
> 已经有简介（`locale/*.json` 的 `meta.description`）和配置卡片，再加一整篇就是重复。
> 用户向信息留在简介与卡片里，其余全写在这里。

## 注册（5 条 / 3 个座位）

| 座位 | 注册 | 作用 |
|---|---|---|
| `conversation.composer.dock` | `offwork-countdown` / order 12 | 用量栏倒计时胶囊 |
| `conversation.composer.dock` | `offwork-countdown-timer` / order 13 | 用量栏计时器 |
| `shell.overlay` | `offwork-countdown-float` / order 20 | 悬浮卡片（`pointer-events: auto`，浮层本身是穿透的） |
| `plugins.bundle.config` | `dsh-offwork-countdown` 与 `include:dsh-offwork-countdown` | 插件页配置卡片 |

keyed 座位用 `key` 而不是 `id`；`include:` 前缀两种写法都挂，防 Loader 版本差异。
`settings.section` 与 `plugins.row.config` 都试过，最后按照用户要求只留插件页这一处。

## 数据

页面侧 `localStorage`，键见 `client.js` 的 `STORAGE_KEY`，Host 半不持有状态：

```js
{ start, end, lunch, lunchStart, lunchEnd, morningLunch,
  timer, timerLabel,
  dock, dockSeconds, timerSeconds, floatSeconds,
  float, floatSide, dblclick, lastDrink, pos }
```

`normalize()` 逐字段兜底：v1（只有 `start`/`end`）、v2（开关叫 `water`）、
v3（计时文案存整句）的数据都能直接升级。

## 时间计算

- `viewAt(date, settings)` → `{ kind, target, msLeft, progress }`，
  `kind ∈ rest | before | working | lunch | after`，`target ∈ start | lunchStart | lunchEnd | end`。
- 周一到周五算工作日；`end <= start` 视为跨夜班次（不拆午休）。
- 午休只在起止确实落在上下班之间时生效，否则按没有午休处理。
- 进度条跟着 `target` 走：数下班 = 已干活比例（午休剔除）；数午饭 = 上午时段比例；
  午休 = 午休比例。
- `timerElapsed()` 的基准是 `max(当天上班, 上次点击)`，休息日与上班前返回 `null`。
- 关秒只影响 `formatDuration(ms, false)` 的输出（`HH:MM`）；悬浮卡片同时收窄
  （`floatWidth` → 190px）并把字号提到 46px，否则右边会空一块。

## 悬浮卡片的位置

- 位置存在 localStorage 的 `pos`；拖过就听它，没拖过就按「上/下」现算（`anchorPos`）。
- 所有写入点都过 `clampPos`：拖动、窗口 resize、从旧位置恢复。
- 竖直方向最小 `y = TOP_SAFE (52px)`：桌面端是无边框窗口，最小化/最大化/关闭按钮画在
  页面内容之上，卡片滑到最上面会被那几个按钮盖住。改这条时别把最小值调回 8。
- `maxY` 是「窗口高度 - 72」，只保证卡片顶部可见；卡片很高时底部会超出，这是既有的取舍。

## 已知坑

- **插件页的标题/描述/图标/README 都是宿主读的包元数据**：改完 `locale/*.json`、
  `README.md`、`icon.svg` 只刷新页面不生效，要重启 dsh（或重装 bundle）。
- 只改 `client.js` 会热更新；换 `package.json` / `cordis.patch.yml` 需要重装。
- `install_bundle` / `remove_bundle` 会跑 pnpm，把手工塞进 profile `node_modules`、
  却没写进 `dependencies` 的包挪进 `node_modules/.ignored/`；装完记得搬回来。
- profile 用 symlink 指向本目录，别挪目录，否则 dsh 启动报 `failed to import`。

## 校验

```bash
node --check client.js      # 语法
node test/logic.mjs         # 纯函数单测，无依赖
```

测试用 `vm` 把 `client.js` 当脚本加载，只测 `viewAt` / `timerElapsed` / `normalize` /
`formatDuration` / `floatWidth` 这些纯函数，不碰 React。
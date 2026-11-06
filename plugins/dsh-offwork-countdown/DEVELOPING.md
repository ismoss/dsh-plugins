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

- 位置存的是**锚点**，不是像素：`pos = { ax: 'left' | 'right', dx, ay: 'top' | 'bottom', dy }`，
  `dx` / `dy` 是离所贴那条边的距离。渲染时由 `resolveAnchor` 按当前窗口现算 ——
  缩放窗口时卡片一直贴着同一条边。**旧实现存的是像素坐标**，窗口一缩小 x 被夹进新视口，
  再放大就留在中间了，这是 11-06 修掉的 bug。
- 没拖过的位置由「上方 / 下方」推导（`defaultAnchor`）：贴右边 24px，贴顶 16vh 或贴底 96px。
- 拖动落点用 `anchorFromPoint` 换算：按**卡片中心**落在哪半边决定贴左/贴右、贴上/贴下。
- `clampPoint` 负责夹进可视区：竖直最小 `y = TOP_SAFE (52px)` —— 桌面端是无边框窗口，
  最小化/最大化/关闭按钮画在页面内容之上，卡片顶到那儿会被盖住；最大值是「窗口高度 - 72」。
- 旧数据里存过的 `{ x, y }` 由 `normalizePos` 按当前窗口换算一次成锚点，之后不再漂。
- 卡片高度是 `useLayoutEffect` 实测的（两种宽度下数字高度不同），贴底锚定与拖动换算都用它。

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
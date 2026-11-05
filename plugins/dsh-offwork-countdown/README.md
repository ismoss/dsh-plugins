# dsh-offwork-countdown

给 DeepSeek Harness Web UI 的一对时间件：**跟着班表走的倒计时** + **点一下归零的计时器**，
外加一张可拖动的悬浮卡片。纯前端插件，没有构建步骤，装好即用。

## 座位与形态

三个座位、五条注册（`conversation.composer.dock` 上挂了倒计时和计时器两条）：

| 座位 | 形态 | 说明 |
|---|---|---|
| `conversation.composer.dock` | 用量栏里的纯文字胶囊 | 「距下班 / 距午饭 / 午休 / 已下班」；颜色与旁边的用量元素一致，没有强调色 |
| `conversation.composer.dock` | 用量栏里的可点计时器 | 「距上次 + 自填词」，点一下归零 |
| `shell.overlay` | 悬浮卡片 | 大号 `HH:MM:SS` + 进度条 + 页脚（下班时间 / 百分比）；可拖、可双击关、上/下两档 |
| `plugins.bundle.config` | 插件页里的配置卡片 | 插件页简介下方、组件列表上方，可折叠 |

## 设置在哪

**只有一处**：`设置 → 插件 → 下班倒计时`，简介下面那张卡片。

## 数据

全部在浏览器侧 `localStorage`（键 `{{SECRET_m4kd92x7}}`，与 `client.js` 里的 `STORAGE_KEY` 一致），
Host 半不持有状态：

```js
{ start, end, lunch, lunchStart, lunchEnd, morningLunch,
  timer, timerLabel, floatSide, dock, float, dblclick, lastDrink, pos }
```

`normalize()` 逐字段兜底，所以老版本数据（只有 `start`/`end`，或开关还叫 `water`）
读进来就能用，不会丢时间设置。

## 时间规则

- 周一到周五才算工作日。
- 下班时间不晚于上班时间 → 跨夜班次，下班落在次日；这类班次不拆午休。
- 午休只在起止确实落在上班与下班之间时生效，否则按没有午休处理（不产生负数工时）。
- 进度条跟着当前数的目标：数下班 = 已干活比例（午休剔除）；数午饭 = 上午时段比例；
  午休 = 午休比例。全部灰阶，不随状态换色。
- 计时器的基准是 `max(当天上班时间, 上次点击)`，所以隔夜不会累加，休息日与上班前不显示。

## 已知坑

- **插件页的标题/描述/图标是宿主读的包元数据**：改完 `locale/*.json` 只刷新页面不生效，
  要重启 DSH（或重装 bundle）。
- 只改 `client.js` 会自动热更新（宿主按需重取 artifact），不必重装也不必重启；
  但换 `package.json` / `cordis.patch.yml` 需要重装。
- 安装时 `install_bundle` 会跑 pnpm，把**手工放进 profile `node_modules`、却没写进
  `dependencies`** 的包挪进 `node_modules/.ignored/`；装完如果别的插件报
  `failed to import`，去那里把目录搬回来。

## 校验

```bash
node --check client.js      # 语法
node test/logic.mjs         # 纯函数单测，无依赖
```

测试用 `vm` 把 `client.js` 当脚本加载，只测 `viewAt` / `timerElapsed` / `normalize` /
`formatDuration` 这些纯函数，不碰 React。
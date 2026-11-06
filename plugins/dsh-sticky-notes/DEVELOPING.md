# DEVELOPING — dsh-sticky-notes

开发视角的东西：座位、数据形状、RPC 契约、工具参数、已知坑、校验命令。

> **本插件故意没有 `README.md`**：dsh 会把插件包里的 README 整篇渲染到插件页（位置在「简介」
> 和「组件列表」之间），和简介、配置卡片重复。用户向的信息只放两处——`locale/{zh,en}.json`
> 的 `meta.description`，以及插件页上的配置卡片；其余都写在这里。

## 文件

| 文件 | 职责 |
|---|---|
| `notes.js` | 纯逻辑：Markdown ↔ 便签数组、编号分配、新建/改/追加/删、错误码。不碰文件系统 |
| `store.js` | 每个工作区一个文件的读写：原子写、串行队列、目录扫描、工作区 key 归一化 |
| `workspace.js` | 纯逻辑：会话 → DSH 工作区的解析（依赖注入，可脱机单测） |
| `index.js` | Host 半：`/api/sticky-notes` 精确 Fetch 路由 + `sticky_notes` 工具 + 工作区解析 |
| `client.js` | 浏览器半：三个座位（用量栏入口、快捷卡片、便签页）+ 插件页说明卡片 |
| `test/logic.mjs` | 纯逻辑与真实临时文件往返测试，退出码即结果 |

## 座位

| Slot | kind | 注册 | 作用 |
|---|---|---|---|
| `conversation.composer.dock` | list | `id: sticky-notes`, `order: 14`, `label` thunk | 用量栏「便签 N」入口；点击行为读 localStorage 偏好 |
| `shell.overlay` | list | `id: sticky-notes-quick`, `order: 24` | 直接写新便签的浮动卡片（关闭时返回 null） |
| `sidebar.panellist` | list | `id: sticky-notes`, `order: 20` | 侧栏图标，排在 `schedules`（自动化任务，order 10）之后 |
| `main` | keyed | `key: sticky-notes` | 独立便签页（左右两栏） |
| `plugins.bundle.config` | keyed | `key: dsh-sticky-notes` | 插件页说明卡片 |

打开便签页不需要自己造导航：`ctx.get("layout").selectPanel("sticky-notes")`。

已占用的 id 记在这里，方便对照：`sidebar.panellist` 里 `plugins`(0)、`schedules`(10)；`main` 里
`plugins`、`conversation`、`schedules`。

## 分区单位：工作区，不是会话目录

便签按 **DSH 工作区**分区。会话的 `header.cwd` 在创建时固定，就是它所属的工作区目录；
中途 `cd` 只改 `workingDirectory`。所以 `workspace.js` 一律拿 `header.cwd` 去对注册表：

| 顺序 | 依据 | `source` |
|---|---|---|
| 1 | 注册表索引：`workspace.sessionIds` 含这个会话（侧栏分组用的同一份数据） | `registry` |
| 2 | `header.cwd` 与某个工作区路径完全相同 | `header` |
| 3 | `header.cwd` 在某个工作区目录之下，取路径最长的那个 | `prefix` |
| 4 | `workspaceRegistry.resolveByPath()` 用 realpath 再认一次（软链/大小写/短路径） | `realpath` |
| 5 | 都不是：当作独立分区，标题取目录名 | `directory` |

拿不到会话（比如从侧栏直接打开便签页）时返回空路径，由浏览器用它记住的最后一个工作区。

## 数据

一个工作区一个文件：`<dir>/<目录slug>-<path hash8>.md`。

- `dir`：`DSH_STICKY_NOTES_DIR` → `$DSH_HOME/sticky-notes` → `~/.dsh/sticky-notes`。
- 工作区 key = 先 `path.resolve` 归一（`E:\Repo\.` / `E:/Repo/` 与 `E:\Repo` 必须同键），
  再把 `\` 归一成 `/`、去尾分隔符；**只有非 Linux** 才折叠大小写（Linux 上 `/a/App` 与
  `/a/app` 是两个真实目录）。文件名里的 slug 也取自归一后的路径，否则同一个工作区会裂成
  `repo-<hash>.md` 和 `ws-<hash>.md` 两份。
- 工作区路径与显示名记在文件开头的 `<!-- dsh-sticky-notes:v2 {...} -->` 里，所以列一次目录就
  能还原出所有分组，不需要索引文件。

便签对象：

```js
{ no: 3, id: "uuid", title: "…", body: "markdown", createdAt, updatedAt, rev: 2 }
```

编号规则：
- 新建时取 `max(现有最大号, 文件头 lastNo) + 1`。`lastNo` 是高水位，写在文件头元数据里，
  所以**删掉最大号再新建也不会复用**——编号可以被 AI 长期引用。
- 解析分三遍：认下不重复的显式编号 → 手写时没编号的补号（**没有高水位**才从 1 起补空位；
  有高水位就补到 high+1 之后，绝不捡已退休的号）→ 撞号的给高水位之上的新号。
  任何情况下都不把别人已有的号往后推，同一份文件多次解析结果一致。
- 编号上界 `MAX_NOTE_NUMBER = 1e9`：超过上界的号当作没编号重新分配。这条不是洁癖——
  `2^53` 附近 `cursor += 1` 不前进，解析会死循环、把整个 Host 卡住。
- 删到一张不剩时文件里只剩前言：解析**照样读文件头元数据**（`readPreambleMeta`），否则
  `lastNo` 和分组会一起丢，下一张还会复用 #1。

标题：
- 标题只能是单行：`\r \n \u2028 \u2029` 一律压成空格。U+2028/U+2029 是行分隔符，
  留着会让那一行匹配不上 `HEADING`，整张便签被静默吞掉。
- 空标题是合法的，写成 `## 3.`（点后无尾空格，免得被编辑器删掉空格后解析错位）。显式传
  `title: ""` = 清空；**不传** `title` = 保持原样。别再把两者混为一谈。
- 截断按 **code point** 而不是 UTF-16 单元：按单元切会把 emoji 切成半个代理，写盘变 U+FFFD。

## HTTP 契约

`POST /api/sticky-notes`，body `{ method, payload }`，返回 `{ ok, value }` 或
`{ ok: false, error: { code, message, details } }`。

| method | payload | value |
|---|---|---|
| `groups` | `{ sessionId? }` | `{ current, dir, groups: [{workspace,title,count,updatedAt}], workspace? }` |
| `notes` | `{ workspace }` | `{ workspace, title, notes, revision, exists }` |
| `save` | `{ workspace, note: { no?, title?, body?, baseRev? } }` | `{ note, notes, … }` |
| `append` | `{ workspace, no, body }` | `{ note, notes, … }` |
| `remove` | `{ workspace, no, baseRev? }` | `{ removed, notes, … }` |

`sessionId` 只用来解析「当前工作区」：取不到会话时返回 `current: ""`，浏览器用自己记住的
最后一个工作区，不猜宿主默认目录。`workspace` 参数传的是**工作区目录**；不传就按
`sessionId` 解析。传了的话会先过一遍 `workspaceRegistry.resolveByPath()` 换成规范路径，
避免 `E:\Repo\.` 这种写法裂出第二份文件/第二个分组。

错误码：`sticky/invalid`、`sticky/not-found`、`sticky/conflict`（`details.current` 是服务端副本）、
`sticky/too-large`、`sticky/io`、`sticky/offline`、`sticky/unknown`。

## 工具

`sticky_notes`，参数 `{ action, no?, title?, body?, workspace? }`。

- 直接注册原始 `ToolDefinition` 对象，**不 import `@deepseek-ai/dsh-tools` 的 `defineTool`**：
  profile 里装的是 link，解析不到 dsh 包；仓约定也是「无运行时依赖」。
- `parameters` 必须是**完整 JSON Schema**（`{ type: "object", properties, required }`），
  不是 `defineTool` 那种属性表——差别踩过，写错的话模型侧 schema 会畸形。
- 结果既是 `value`（JSON）也由 `output.render` 包成文本；工具返回值保持有界：`list` 只给
  编号/标题/预览，正文只在 `read` 里给。
- `workspace` 不传时用 `workspaceOf(ctx, exec.agent.id)` 解析出会话所属的**工作区**（不是
  `workingDirectory`：那个是会话当前目录，`cd` 过就不对了）。
- `workspace` 传了就必须是**已注册**的工作区绝对路径，否则 `sticky/not-found`：防止模型幻觉出
  一个路径、凭空造出空分区。
- `no` 统一用 `noteNumber()` 解析：只有 `undefined`/`null` 算「没传」，数字或数字字符串都收，
  其余（`""`、负号、小数）一律 `sticky/invalid`。别再让 `"3"` 在 read 能读、在 write 变新建，
  也别让 `no: ""` 悄悄新建一张副本。
- `list` 有 `limit`（默认 50，上限 200）和 `offset`，返回里带 `total`；offset 越界时说
  「有 N 张，offset 越界」，不能报「没有便签」。
- `read` 把正文截到 4 万字符再给模型（外部撑大的文件不该整段进上下文）。
- `write` 一个字段都不给（`{no:1}`）直接报 `sticky/invalid`：否则 rev 白涨一次、给别的编辑器
  制造假冲突。`baseRev` 传了非整数也报错，不许当缺省处理。

## 界面

- 样式全部走 `--dsw-alias-*` token 并带 fallback；`<style>` 必须渲染在**自己座位组件的最外层**
  （用量栏那个入口一开始忘了带样式，宿主默认按钮样式就露出来了：描边 + 换行）。
- 点用量栏入口的行为是浏览器偏好（localStorage `dsh-sticky-notes/prefs`）：
  `{ dock: boolean, click: "quick" | "panel-current" | "panel-all", lastWorkspace }`。
- 便签页每 10 秒拉一次（"所有工作区"视图也会整组重取），所以 AI `append` 进去的内容会自己
  出现；展开中但没改过的卡片照常刷新，真改过字的那张转冲突提示，不静默覆盖。
- 切工作区一律走 `selectWorkspace()`：`loadNotes` 在 `"*"` 视图下只更新 `all`、不改
  `selected`，直接用它会「点了新建却什么都不出来」。
- 展开键是 `${workspace}#${no}` 字符串：同一屏里两个工作区的 #3 不能一起展开。
- 收起卡片不丢草稿：草稿按同一个键暂存在模块级 `draftCache`，重开时优先恢复；这期间便签
  在别处被改过就直接进冲突态。
- 读某一份失败只在正文区顶部提示（`notesError`），不能把整页换成错误横幅——那会连带把
  展开中卡片的草稿一起卸载。

## 已知坑

- 改 `index.js`（Host 半）不会热更：`dsh-hmr` 不跟 `link:` 出去的真实路径。用
  `plugin_manager set_plugin false/true` 重载插件，或重启 dsh。
- 分区单位是工作区，不是会话目录。曾经用 `workingDirectory.get(session)`（会话当前目录）去
  分组，结果 `cd` 过的会话会把便签写到 `sessions\<本次>\` 这种子目录分区里——现在用
  `session.header.cwd`。
- 改 `package.json` / `locale/*.json` / `icon.svg` 是包元数据，要重启才会在插件页刷新。
- `sessionId` 只在会话有活 Agent 时才解析得到目录；归档会话取不到，此时页面退到浏览器记住的
  工作区。
- Windows 上 `rename` 可能被索引/杀毒短暂占住（`EPERM`/`EACCES`）：`store.js` 退化成直写，
  但直写前会先把旧文件复制成 `<file>.bak`，直写失败时临时文件也留着（里面是新内容），
  不会出现「唯一副本被截断」。
- 读文件用 `TextDecoder("utf-8", { fatal: true })`：非 UTF-8（GBK/UTF-16/坏字节）直接抛
  `sticky/encoding`，拒绝改写。用宽松解码会把非法序列变成 U+FFFD，下一次保存就把整份文件写坏。
- 读侧**不再**校验 4 MB 上限（只在写的时候校验），否则文件被外部编辑顶破上限后，连删一张
  都做不到、这个工作区永久不可用。
- 正文里的 `## ` 是便签分隔符：写回时会被降成 `### `（`demoteBodyHeadings`），否则下一次
  解析会把一张便签劈成两张、编号跟着漂。手写文件时自己也别用 `## `。

## 用户向：三个入口、存在哪、文件长什么样

（README 删掉后这几段并进来；用户看到的信息仍在 `meta.description` 和插件页配置卡片里。）

| 入口 | 是什么 | 怎么用 |
|---|---|---|
| 用量栏（输入框下面一行） | 小图标 + 「便签」 | 点一下按设置行事：直接弹出写便签的小卡片，或打开便签页 |
| 侧栏「自动化任务」下面 | 「便签」图标 | 独立便签页：左边按工作区分组，右边是编号便签与编辑区 |
| 插件页 | 配置卡片 | 显示存储目录，并带上和便签页同一套设置 |

便签落在 `$DSH_HOME/sticky-notes/`（Windows 上是 `C:\Users\<你>\.dsh\sticky-notes\`），
一个工作区一个文件，文件名 = 工作区目录名 + 路径哈希，例如 `deepseek-test-1a2b3c4d.md`。
换位置就设环境变量 `DSH_STICKY_NOTES_DIR` 指向任意目录（支持 `~`），重启 dsh 生效；想跟着
同步盘或仓库走就指过去。文件是纯 Markdown，可以在编辑器里直接改，便签页下一次刷新会接住。

```markdown
# 便签

<!-- dsh-sticky-notes:v2 {"workspace":"E:\\path\\to\\repo","title":"我的仓库","lastNo":3} -->

## 1. 买牛奶
<!-- dsh-note: {"no":1,"id":"…","created":"…","updated":"…","rev":3} -->
两盒，周四之前。
```

用户要知道的边界：正文 4 万字符、单工作区 500 张、单文件 4 MB；两处同时改同一张时后保存的
拿到冲突（界面给「载入最新 / 覆盖保存」）；文件必须是 UTF-8，非 UTF-8 会被拒绝改写；便签是
「任何会话都能读」的共享文本，来源不可信的内容别写进去（等于给别的会话留提示注入面）。

## 校验

```bash
node --check client.js
node --check index.js
node --check notes.js
node --check store.js
node test/logic.mjs
```

`test/logic.mjs` 覆盖：编号解析与补号、`###` 归正文、序列化往返、前言保留与元数据替换、
新建/修改/追加/删除、冲突与 not-found、`workspaceKey` 大小写与分隔符归一、真实临时文件往返
（含外部直接改文件后被下一次读取接住），以及工作区解析的五条路径（注册表索引、header 精确匹配、
子目录取最长父工作区、路径写法不同仍命中、realpath 兜底、未注册目录自成一组、注册表抛错不炸）。
目前 40 条。审查找出并固化成回归的几条：正文 `##` 不会劈裂便签、U+2028/U+2029 标题不吞便签、
emoji 标题 save→parse 往返后仍是 200 个 code point 且无 U+FFFD、删到空文件仍保留 lastNo 与分组、
有高水位时无号便签不捡退休号、`{no:1}` 空更新被拒、`baseRev:"1"` 被拒、删便签的冲突、
超大编号不死循环、`E:\Repo\.` 与 `E:\Repo` 同文件而 `E:\a\repo` 与 `E:\b\repo` 不同、
并发 save 不丢便签。
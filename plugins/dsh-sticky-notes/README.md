# dsh-sticky-notes

给 DeepSeek Harness Web UI 的便签：输入框旁边一个「便签」开关，点开是一块可拖动的
便签板。**正文不在浏览器里**——Host 把它写进 `notes.md`，换浏览器、重启 DSH 都还在，
而且这个文件可以直接交给 AI 读写。

## 座位与形态

| 座位 | 形态 | 说明 |
|---|---|---|
| `conversation.composer.dock` | 用量栏里的文字开关 | 「便签」+ 数量；点一下开合便签板 |
| `shell.overlay` | 悬浮便签板 | 列表 / 编辑 / 置顶 / 六种颜色 / 删除；拖动标题栏移动，位置记住 |
| `plugins.bundle.config` | 插件页的配置卡片 | 存储路径、数量、连接状态、文件格式说明 |

## 便签存在哪

**默认**：`~/.dsh/sticky-notes.md`（Windows 上是 `C:\Users\<你>\.dsh\sticky-notes.md`）。

**换位置**：设环境变量 `DSH_STICKY_NOTES_FILE`，指向任意绝对路径（支持 `~`），重启
DSH 生效。想让便签跟着 git 或同步盘走，就指到那个目录里，例如：

```powershell
$env:DSH_STICKY_NOTES_FILE = "E:\path\to\sync\notes.md"
```

**换机器**：文件本身不会自己长脚。把默认文件复制/软链到同步盘，或直接用上面的环境
变量指到同步目录，才能跨机器；只放在 `~/.dsh` 里能跨浏览器、跨会话，但换机器要手动搬。

**AI 读写**：直接把路径告诉 AI，或让它读 `notes.md`。文件是纯 Markdown，外部改动会在
便签板下一次轮询（打开时每 10 秒）或点刷新时出现。

## 文件格式

```markdown
# 便签

<!-- dsh-sticky-notes:v1 -->

## 买牛奶
<!-- dsh-note: {"id":"…","color":"yellow","pinned":false,"created":"…","updated":"…","rev":3} -->
两盒，周四之前。

## 修路由器
<!-- dsh-note: {"id":"…","color":"blue","pinned":true,"created":"…","updated":"…","rev":1} -->
先重启，不行再换电源。
```

- 每个以 `## ` 开头的行开启一张便签。
- 标题下一行的 HTML 注释是这张便签的身份：`id`、颜色、置顶、创建/更新时间、`rev`
  （乐观并发版本）。**改正文时保留它**；删掉后会按标题和正文重新派生一个 `ext-…` id，
  正文不丢，但颜色、置顶和 `rev` 会重置。
- 文件开头（第一张便签之前）的内容是前言，原样保留，可以写自己的说明。
- 人手/AI 新加的 `## 标题` 没有注释也能读；第一次在便签板里保存后会补上注释。
- 正文里如果要有二级标题，请用 `###`：`## ` 会被当成新便签。这是格式本身的取舍。

## 数据流与 RPC

```text
浏览器便签板 ── ctx.connection.rpc.call ──▶ Host 半 ── 读改写 ──▶ notes.md
             ◀── ok / error 信封 ──────────
```

通道：`/dsh-sticky-notes`（Connection 的通用 RPC；和 `/api` 一样走浏览器认证与
Host/Origin 栅栏，只接受 owner）。

| 端点 | 入参 | 返回 |
|---|---|---|
| `list` | `{}` | `{ notes, revision, path, displayPath, exists, loadedAt }` |
| `save` | `{ note }`，`note` 带 `id?`、`title`、`body`、`color`、`pinned`、`baseRev?` | `{ note, notes, revision, … }` |
| `remove` | `{ id, baseRev? }` | `{ removed, notes, revision, … }` |

- `save` 传了 `id` 但找不到 → `sticky/not-found`；`baseRev` 对不上 → `sticky/conflict`，
  `details.current` 是服务端当前副本。不传 `baseRev` 表示覆盖。
- 其他错误码：`sticky/invalid`、`sticky/too-large`、`sticky/forbidden`、`sticky/io`。
- 所有 Host 写入串行执行；写文件用同目录临时文件 + rename，外部编辑也能被下一次
  「读改写」接住。

### 为什么不用 Typert Gateway

Typert 的 Remote 约定需要生成器产出的 `typert.host.js` / `typert.remote-client.js`
（以及 zod 运行时），而这仓的硬约定是**纯 JS、无构建、无运行时依赖**。这里用
Connection 的通用 RPC 通道：同一条浏览器到 Host 的传输、同一套认证与错误信封，
只是省掉代码生成。代价是没有 Typert 的类型反射和 JSON Schema 校验——参数校验在
`notes.js` / `store.js` 里手写，单测覆盖。

## 本地只存什么

浏览器 `localStorage` 只存界面偏好（键 `dsh-sticky-notes/prefs`）：

```js
{ open: false, pos: null }   // 面板开合、拖动后的位置
```

便签正文、颜色、置顶、时间全部在 `notes.md`。清浏览器数据不会清掉便签。

## 已知坑

- 改 `client.js` 会热更新；改 `package.json` / `locale/*.json` / `icon.svg` 属于包
  元数据，要重启 DSH 才会在插件页生效。
- 改 `DSH_STICKY_NOTES_FILE` 要重启 DSH（Host 半在加载时解析路径）。
- 两个浏览器同时编辑同一张便签时，后保存的一方会拿到 `sticky/conflict`；便签板会
  让你选「覆盖保存」或「放弃本地改动」，不会静默覆盖。
- 文件里 `## ` 是便签分隔符；正文要二级标题用 `###`。
- 安装时 `install_bundle` 会跑 pnpm，可能把手工塞进 profile `node_modules` 却没写进
  `dependencies` 的插件挪进 `.ignored/`；装完留意别的插件是否还正常。
- 便签文件可能有私人内容；本仓公开，`notes.md` 不要提交进这个仓库。

## 校验

```bash
node --check client.js
node --check index.js
node --check notes.js
node --check store.js
node test/logic.mjs
```

`test/logic.mjs` 覆盖：Markdown 往返、外部编辑收养、重复 id、坏元数据、CRLF、
前言保留、`##` 拆分约定、乐观并发冲突、真实临时文件读写、客户端 RPC 信封与
纯函数（预览、相对时间、偏好归一化）。不引测试框架，退出码即结果。

## 许可

[MIT](../../LICENSE)
# AGENTS.md — 本仓约定

我自己搓的 dsh（[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)）Web UI 插件集合。
一个插件一个目录，全部纯 JS、无构建、无运行时依赖。

## 加一个新插件

1. 新建 `plugins/<包名>/`，包名带 `dsh-` 前缀。
2. 必备文件：

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.bundle.patch` 指向 `cordis.patch.yml`；有 UI 再加 `dsh.client`（`platform: web`）和 `./client` 导出 |
| `cordis.patch.yml` | `- insert: [{ id: <行 id>, name: '<包名>' }]` |
| `index.js` | Host 半；没有 Host 逻辑就 `export function apply() {}` |
| `client.js` | 浏览器半，`window.__ModuleLoader__.load({ id: '<包名>', factory })` |
| `locale/{zh,en}.json` | 插件页标题与描述（`meta.title` / `meta.description`） |
| `icon.svg` | 插件页图标，原创或许可允许再分发，≤256 KiB |
| `DEVELOPING.md` | 开发视角：注册表、数据字段、时间/边界规则、已知坑、校验命令 |

**不要放 `README.md`**（见下方硬约定）：宿主会把包里的 README 整篇渲染到插件页。

3. 根 `README.md` 的插件表加一行。
4. 有可测的纯函数就写 `test/logic.mjs`（不引测试框架，直接断言 + 退出码），`npm test` 要能跑。

## 加一个 skill

skill 不是插件：没有 `package.json`、不装进 profile、没有 UI，DSH 通过 `~/.dsh/skills` 的软链直接读。

1. 新建 `skills/<名字>/SKILL.md`，frontmatter 写 `name` 和 `description`——**description 决定它什么时候被加载**，把触发词、适用场景、不适用场景都写进去。
2. 长内容放 `references/*.md`，`SKILL.md` 里只留指针和硬规则，控制在 150 行内。
3. 在 magpie 的 `library.json` 里登记 `{ "name": "<名字>", "agents": ["dsh"] }`，并让 `~/.dsh/skills/<名字>` 指到本仓这个目录。
4. 根 `README.md` 的 skill 表加一行。

skill 改完不用重启、不用重装，下一个回合就生效（`SKILL.md` 的 description 变了，列表下一轮刷新）。

## 硬约定

- **没有构建步骤**：`client.js` 就是浏览器能直接执行的自执行文件，不引入打包器、JSX、TypeScript。
- **不 import dsh 的 Client 包**（`@deepseek-ai/dsh-client-ui-*` 等）；样式只用 `--dsw-alias-*` 主题
  token 并都带 fallback。
- **不碰 profile**：安装、卸载一律走 dsh 的 `plugin_manager`，不要手改 profile 的
  `package.json` 或 `node_modules`。
- **插件包里不放 `README.md`**：宿主会把包的 README 整篇渲染到插件页，和简介 + 配置卡片
  重复。用户向信息写进 `locale/*.json` 的 `meta.description` 与配置卡片，其余写
  `DEVELOPING.md`。
- **界面文案走 locale**：`zh` / `en` 两份字典都要齐，不要硬编码裸中文（注释除外）。
- **只在 dsh 提供的 slot 里渲染**，不要往 `document.body` 追加节点。
- **提交只 add 自己碰过的路径**：仓库可能同时有别的会话在改，`git add -A` 会把别人
  正在写的半成品卷进你的提交。

## 验证

```bash
node --check plugins/<包名>/client.js
node plugins/<包名>/test/logic.mjs
```

改 `client.js` 会热更新；改 `package.json` / `locale/*` / `icon.svg` 属于包元数据，
要重启 dsh 才会在插件页生效。

## 隐私

本仓公开。不要提交本机绝对路径、用户名、邮箱、token、apiKey 或个人数据；
示例路径一律写成 `E:\path\to\...` 这类占位形式。
# dsh-plugins

自己搓的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（下称 dsh）Web UI 小插件集合。
一个插件一个目录，纯 JS、无构建、无运行时依赖，直接以本地目录装进 dsh 的 profile。

| 插件 | 一句话 | 目录 |
|---|---|---|
| **下班倒计时** `dsh-offwork-countdown` | 输入框下方的下班倒计时 + 点一下归零的计时器 + 可拖动的悬浮卡片 | [plugins/dsh-offwork-countdown](./plugins/dsh-offwork-countdown) |
| **便签** `dsh-sticky-notes` | 输入框旁的便签开关 + 可拖动便签板；正文落到宿主机的 `notes.md`，换浏览器、重启都在，AI 也能直接读写 | [plugins/dsh-sticky-notes](./plugins/dsh-sticky-notes) |

## 怎么装

每个子目录本身就是一个 dsh bundle（`package.json` 里有 `dsh.bundle.patch`）。clone 本仓后，
把子目录的**绝对路径**交给 dsh 里的 AI：

> 帮我装一下 `E:\path\to\dsh-plugins\plugins\dsh-offwork-countdown` 这个插件

它背后执行的是 `plugin_manager` 的 `install_bundle`（目标填那个绝对路径），装完在
**设置 → 插件** 里能看到，插件页里就是它的配置。

## 目录约定

```text
plugins/
  <包名>/                  # 一个目录 = 一个 npm 包 = 一个 dsh bundle
    package.json           # 必须声明 dsh.bundle.patch；有 UI 的还要 dsh.client
    cordis.patch.yml       # 往 profile 里插入的插件行
    index.js               # Host 半（没有 Host 逻辑时 export apply 空实现）
    client.js              # 浏览器半，window.__ModuleLoader__.load 自执行
    locale/{zh,en}.json    # 插件页显示的标题与描述
    icon.svg               # 插件页图标（≤256KiB，留在包内）
    README.md              # 用户视角：插件干什么、怎么配（会整篇渲染到插件页）
    DEVELOPING.md          # 开发视角：注册表、数据字段、边界规则、已知坑、校验
    test/logic.mjs         # 纯函数单测，node test/logic.mjs
```

刻意保持简单：**没有构建步骤、没有 npm 依赖、没有 CI 配置**。`client.js` 改完
`node --check` + `node test/logic.mjs` 就算验过。

## 注意事项（踩过的坑）

- 改 `client.js` 会热更新，不用重装；但改 **`package.json` / `locale/*.json` / `icon.svg`**
  这类包元数据，要**重启 dsh** 才会在插件页生效。
- 用本地目录安装时，`install_bundle` 会跑一次 pnpm。如果 profile 里还有**手工塞进
  `node_modules`、却没写进 `dependencies`** 的插件，它会被挪到 `node_modules/.ignored/`；
  装完记得搬回去，或者干脆把它也正式声明成依赖。
- profile 里装的是 **symlink**：别把这个本地目录挪走或删掉，否则 dsh 启动时会报
  `failed to import`。

## 许可

[MIT](./LICENSE)

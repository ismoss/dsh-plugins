---
name: hub-ops
description: >-
  中枢会话的操作手册：把一件事拆成任务、派给子会话、收结构化回执、只在需要人验收或拍板时开口。
  当用户说「你是中枢」「你做中枢」「你当中枢」「你来调度」「你当调度」「帮我管这几个会话」
  「开一个中枢」「把这个项目交给几个会话做」「指挥子会话」「hub」「orchestrate」时使用。
  命中后第一件事是加载本 skill，再开工——不要在没读它的情况下凭印象调度。
  依赖 dsh-session-messaging 的 session_send_message / session_create / session_tasks /
  session_archive 和 sticky_notes。不用于：自己动手改代码、单个会话里的一次性任务、
  或者用户明确说「你自己做」。
  英文触发词：hub session / orchestrate sub-sessions / dispatch tasks.
---

# 中枢 · 只做四件事

拆活、派活、收结论、向人汇报。**业务代码永远在子会话里写，你不改文件、不跑构建、不做验收判定的替代。**

## 一、你手里的工具（真实签名，别猜）

| 工具 | 参数 | 什么时候用 |
|---|---|---|
| `session_create` | `title` `message` `task_id` `this_round[]` `already_done[]` `note` `force` `workspace?` | 这个任务还没有会话 → 新开一个，新会话直接成为该任务的写者 |
| `session_send_message` | `session_id` `message` `task_id` `this_round[]` `already_done[]` `note` `task_title` `status` `done[]` `force` `delivery?` | 已有会话 → 派下一轮；**带 `status` 就是回执，不是派活** |
| `session_list` | `query?` `all_workspaces?` `limit?` | 找会话；持有任务的会话会多一列 `task` |
| `session_tasks` | `task_id?` `limit?` | 查账本：谁在干、第几轮、已完成、有没有回执 |
| `session_archive` | `session_id` `unarchive?` `confirm?` | 退役：不带 `confirm` 只做检查，干净了才 `confirm: true` |
| `sticky_notes` | `list` `read` `write` `append` `status` `owner` | 给人看的项目便签；和 `task_id` 用同一个项目名对齐 |

账本和看板在 `~/.dsh/session-tasks/`：一个任务一份 JSONL，外加一份人看的 `board.md`。

## 二、一次派活（照抄这个形状）

```text
session_create({
  title: "登录重构 · 接 AuthService",
  task_id: "login-refactor",
  note: 3,
  this_round: ["把登录页接到 AuthService", "补 AuthService 单测"],
  message: "按「本次只做」两条做，做完回报。"
})
```

四个字段不能省：

- **`task_id`**：一个项目一个 id，全生命周期不变。省了它，锁、历史、看门狗全部失效。
- **`this_round`**：这一轮**只**做什么，一行一条。这同时是回执和看门狗重派的依据。
- **`note`**：对应便签号，让「项目 → 便签 → 任务」三者能互相翻。
- **`message`**：人话，一两句。别把 `this_round` 复述一遍。

`already_done` 可以不传——账本里的历史会自动折叠进消息头部；只有在账本里没有的既有事实才手写。

## 三、回执是唯一真相

子会话会用 `status` 回报：

| 收到的 | 你要做什么 |
|---|---|
| `status: "done"` + `done[]` | 更新判断，准备向人汇报，然后走收尾 |
| `status: "blocked"` | **立刻**转达给人，写清子会话列出的选项；不要自己替他拍板 |
| `status: "doing"` | 只记一笔，不打扰人；若它同时问了问题，按 `blocked` 处理 |

**不要**把子会话的原文粘给人。三条以内的人话：做完了什么、有没有需要决定的事、下一步谁做。

## 四、什么时候开口（这条最容易做错）

绿点表示"有回合结束但人没看"，不表示"需要人"。所以**你每结束一轮，人就多一个绿点**。开口只允许三种情况：

1. **要人验收**：东西能点了，说清点哪里、看什么算过。
2. **要人拍板**：有真实分叉，且你确实无权替他选。
3. **失联**：看门狗判定超时、重试也没回来。

其余一切——进度、中间结论、你查到的资料——写进 `board.md` 和便签，**不产出对话回合**。宁可这一轮什么都不说。

## 五、失联

看门狗会自己处理：一轮超过 25 分钟没有回执、且会话不在 running，会自动重派一次，并给你发一条「【看门狗】」。累计重派 2 次不回来，它会停下来等你决定。

你收到看门狗通知时：

- 它说「已自动重派」→ **你什么都不用做**，更不要自己再派一次（单写者锁会拒绝你，用 `force` 强抢才是错的）。
- 它说「停手等你决定」→ 这时候才开口问人：换会话接手、查网关、还是放弃。

## 六、收尾三步（缺一步就叫没做完）

1. **让它回执**：没有 `status: "done"` 的任务不收尾；卡住的就先问人。
2. **退役检查**：`session_archive({ session_id })` 不带 `confirm` —— 它会告诉你这个会话还持有什么。
   - 干净 → `confirm: true` 归档，行和绿点一起消失；
   - 不干净 → 先解决，别硬来（它会直接报错）。
3. **便签落地**：`sticky_notes` 把结论追加回对应编号，状态推成 done。便签是给人看的，别写过程。

删除会话不在你手里，也别向人提议用工具删——那是菜单里由人点的动作。

## 七、硬边界

- **一个 `task_id` 同时只有一个会话在干。** 被拒绝是正常工作，不是故障；要换人必须 `force: true` 并说明为什么。
- **不重派正在跑的会话。** 看门狗都不做，你更不该做。
- **不直接改子会话工作目录里的文件。** 要改就派给它，或明确告诉人。
- **不一次派两件事给同一个 `task_id`。** 拆成两个 id。
- **不复述、不翻译子会话的长输出。** 需要细节就让人自己去看那个会话。

## 八、失败模式（见到就停手）

| 症状 | 原因 | 处理 |
|---|---|---|
| 派活被拒「is held by session …」 | 任务已被别的会话持有 | 先 `session_tasks` 看谁在干；确实要换人才 `force` |
| 派活被拒「already dispatched this exact instruction」 | 30 分钟内重发了同一句 | 确认对方真没动，再 `force: true` |
| `session_archive` 报「cannot be retired yet」 | 还持有 doing/blocked 任务，或在跑 | 先收尾，别绕 |
| 自己的上下文越来越长 | 你把子会话的输出来回搬运了 | 只留结论，细节让对方留在自己会话里 |

## 九、Drex 决策闸门（可选增强）

> 前提：本机接入了 drex MCP，工具里能看到 `decide` 才用；看不到就是没加载，别假装有（接入方式见维护仓 MAINTAIN）。
> Drex 是**决策模型**，不是执行器：喂一段 state + 若干 typed questions，回**校准概率 / 标签 / 档位**。它只帮你在关键节点分诊；活仍由子会话干，成品验收仍归人。

**四个时刻（按收益从高到低，能问才问）**

| 时刻 | 触发点 | state 喂什么 | 问哪几个 typed 问题 | 怎么用结果 |
|---|---|---|---|---|
| ② 回执分诊 | 收到 `status:"done"`、收尾前 | `this_round` + `done[]` 结论 + 验收标准（只发摘要） | `round_ok`(noul) 是否达成本轮；`action`(choice) accept/send_back/ask_human | `round_ok` 低或 `action=send_back` → 打回；仅内部任务且明显完成才自收；**对人有交付物的，仍走 §四 请人验收** |
| ④ 开口过滤 | 打算开口前 | 结论摘要 + 是否不可逆 | `needs_human`(noul) 是否必须人拍板/验收 | 低 → 不开口，写 board/便签；高 → 开口。失联照 §五，不问 Drex |
| ① 拆活路由 | 需求还没定 task_id | 需求原文 + 现有 task_id/便签 | `project`(choice) 归哪个项目；`split`(noul) 是否拆多个 | 仅作建议，task_id 与拆法仍由你定 |
| ③ 失联参考 | 看门狗「停手等你决定」 | 任务年龄、会话状态、已重派次数 | `next`(choice) 重派/换会话/放弃/问人 | 仅参考；**「running 不重派」压过它** |

一次调用尽量把问题批量问完（省额度）：

```text
decide({
  state: "task_id=… 第N轮\n本次只做：…\n回执 done：…\n验收标准：…",
  questions: {
    round_ok: { type: "noul", instructions: "这轮是否达标、可收尾？" },
    action:   { type: "choice", instructions: "下一步？",
                criteria: { accept: "收尾", send_back: "打回", ask_human: "请人拍板" } }
  }
})
```

**硬边界**

- **失败即回退**：`decide` 报错/超时/没额度 → 回到原判断（拿不准就按 §四 开口），绝不让流程卡住，绝不因一个概率就自动归档/删除/提交。
- **概率不是真理**：只做门槛、排序、分诊；不可逆动作仍由人点或按既有铁律。
- **数据边界**：state 会发到第三方云端，只发粗粒度摘要，**不塞源码、密钥、客户隐私、本机路径**。
- **额度**：走 API key 的**账户额度**——每月 $5（新账号前 3 个月 $25，按月发不累计）；Drex 极便宜（按输入 token 计费、输出免费；约每百万任务 $100–200 量级），$5 大致上万次，日常用不完。所谓"10 次/分、100 次/天"是**不带 key 的免费档**，不适用。仍建议能批量就问完，但不用抠。
- **谁能用**：中枢会话本身就有新会话里的 `decide`；`session_create` 派出的子会话也挂着同一工具（已验证）。但**②验收、④开口这类判断留在中枢做**——别让被验收的子会话给自己打分（利益冲突）；子会话顶多用它做自己内部的局部选择。

没有 drex：以上整节跳过，按 §三/四/五 原逻辑走。

## 十、谁负责提交（版本控制库是共享可写资源，git 与 svn 同理）

版本控制库是**共享可写资源**：单写者锁只按 `task_id` 分，挡不住"两个不同任务改同一个库"。git（本地项目）和 svn（公司代码）都按下面这套，只是落地动作不同。

**通用三条**
- **中枢不提交**：只判断"该不该提交 + 派 `commit:<库>` 任务 + 收回执"，不亲手 commit/push。
- **worker 不直接提交共享库**（当可能有别的会话在改同一个库）。
- **每库一个提交/集成会话（单写者）**：唯一提交者；按"本次只做"范围、据 `this_round/done` 写提交说明、跑门禁、回报提交号。

**git（本地项目控制）**
- 并行改同仓 → 每个任务一个 worktree 分支（本机已装 worktree 工具），提交会话串行 `git add <具体路径>` → commit → `git push`。
- 永远按路径 `git add`，禁止 `git add -A` / `git add .`。
- 简化：某仓确定同时只有一个写者 → 该 worker 自己提交也行（仍只加自己碰过的路径）。

**svn（公司代码，更保守）**
- `svn commit` 直接进中心库、无本地分支/暂存区、基本不可回退；一旦提交就落到公司库，比 git 更要单写者。
- **默认由人最终 `svn commit`**：会话只改代码 + 给 `svn status`/diff 证据 + 变更清单，交给用户审后提交（沿用现状：TV0001 那些会话都"未提交"、留人提交）。只有你明确授权，才交给某个 svn 提交会话。
- 提交前先 `svn update`（防 out-of-date），且 `svn commit <具体路径>`——**绝不整工作副本一刀提交**，否则把别的会话改动一起带上服务器。
- 并行：SVN 没有 worktree，用**独立 checkout 副本**隔离，或干脆串行。

**把提交当任务**：`commit:<库名>`，单写者锁天然串行；中枢派它、等回执（提交号 / 是否 push 或 commit / 门禁结果）。
**禁止**：中枢亲手提交；多会话对同一共享库/工作副本并发提交；git `add -A`、svn 整 wc commit。

## 十一、参考

- [references/playbook.md](references/playbook.md)：一次完整派活的真实调用记录与产物形状。
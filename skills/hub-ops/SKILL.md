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

## 九、参考

- [references/playbook.md](references/playbook.md)：一次完整派活的真实调用记录与产物形状。
# 一次完整派活

场景：人只说了一句「登录页要接到 AuthService，顺手补测试」。下面是中枢该做的全部动作。

## 0. 先看账本，别急着开新会话

```text
session_tasks({})
```

```text
Task board (~/.dsh/session-tasks, 2 task(s), most recently active first):
- login-refactor [done] round 2 owner session-9f3c ("登录重构") | last: 拆完 AuthService，12 条测试全过
- iptv-p0015 [doing] round 4 owner session-07ab ("IPTV 农场") | this round: 修打包脚本
```

`login-refactor` 已经有了，而且上一轮是 done——所以这次是**同一个任务的第 3 轮**，不是新项目。新开一个会话会让历史断掉。

## 1. 派活

```text
session_send_message({
  session_id: "session-9f3c",
  task_id: "login-refactor",
  note: 3,
  this_round: ["把登录页接到 AuthService", "补 AuthService 的单测"],
  message: "按「本次只做」两条做，做完回报。"
})
```

```text
Message delivered to session session-9f3c ("登录重构"). It was idle and is starting a turn with the message.
Task "login-refactor" round 3 is now held by that session.
```

子会话那边看到的是消息本体前面多了一段：

```text
【任务 login-refactor · 第 3 轮 · 进行中】
项目：登录重构
便签：#3

已完成：
- 拆出 AuthService
- 现有调用点全部改完

本次只做：
- 把登录页接到 AuthService
- 补 AuthService 的单测

回执契约（这一轮收尾时必须照做）：
1. 结论写在最后一条回复里，不要只说「收到」。
2. 同时调用 session_send_message：session_id="session-a1", task_id="login-refactor", round=3, status="done", done=[…]。
3. 需要我拍板时 status="blocked"…
```

## 2. 等回执，期间闭嘴

这一轮中枢**什么都不说**。人不该因为你派了活就多一个绿点。

## 3. 回执到了

```text
session_send_message({
  session_id: "session-a1",
  task_id: "login-refactor",
  status: "done",
  round: 3,
  done: ["登录页已接上", "补了 3 条单测"],
  message: "接好了，12 条全过。"
})
```

```text
Message delivered to session session-a1 ("中枢"). It was idle and is starting a turn with the message.
Recorded task "login-refactor" as done.
```

## 4. 收尾

```text
session_archive({ session_id: "session-9f3c" })
```

```text
Ready to retire: session session-9f3c ("登录重构") holds no live task and is not running.
Nothing was archived; call again with confirm: true.
```

```text
session_archive({ session_id: "session-9f3c", confirm: true })
```

```text
Archived session session-9f3c ("登录重构"). It left the sidebar and takes no messages
until it is restored; nothing was deleted.
```

```text
sticky_notes({ action: "append", no: 3, body: "登录页已接 AuthService；单测 12 条全过。" })
sticky_notes({ action: "status", no: 3, status: "done" })
```

## 5. 向人开口（唯一一次）

```text
登录页接完了，12 条测试全过。

要你验一下：打开 /login，用错误密码连试三次，看是否停在原地不跳转。
不对的话告诉我，我先恢复该会话，再把第 4 轮派给它（新一轮会带上已有结论）。
```

一句话验收、一句话退路。不要贴 diff、不要贴子会话原文。

---

## 对照：做错的版本

```text
❌ 直接 session_create 一个新会话
   → 历史断掉，第 3 轮的「已完成」全丢，可能重做第 1 轮的活

❌ 派完活回来跟人说「已经派给会话 X 了，请稍等」
   → 白烧一轮 token，人多一个绿点，信息量为零

❌ 回执 done 之后直接说「全部完成」
   → 没做退役检查、没落便签，行还挂在侧栏，绿点还在

❌ 人没问，你自己又 force 重派一次
   → 两个会话干同一件事，这正是单写者锁存在的理由
```
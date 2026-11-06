#!/usr/bin/env node
/**
 * 纯逻辑测试：不引测试框架，断言失败就退出码 1。
 *
 *   node test/logic.mjs
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NotesError,
  applyAppend,
  applyBoardPost,
  applyStatus,
  applyRemove,
  applySave,
  normalizeInput,
  parseNotesFile,
  previewOf,
  serializeNotesFile
} from "../notes.js";
import { createWorkspaceStore, fileForWorkspace, workspaceKey } from "../store.js";
import { insidePath, resolveWorkspace } from "../workspace.js";

let passed = 0;
let failed = 0;
function test(name, body) {
  return Promise.resolve()
    .then(body)
    .then(() => {
      passed += 1;
      console.log(`ok ${passed} - ${name}`);
    })
    .catch((error) => {
      failed += 1;
      console.error(`not ok - ${name}`);
      console.error(error);
    });
}

const cond = { now: "2026-11-06T00:00:00.000Z", newId: () => "id-1" };

await test("parse: numbered headings and meta", () => {
  const text = [
    "# 便签",
    "",
    '<!-- dsh-sticky-notes:v2 {"workspace":"E:\\\\x","title":"X"} -->',
    "",
    "## 1. 买牛奶",
    '<!-- dsh-note: {"no":1,"id":"a","created":"2026-01-01T00:00:00.000Z","updated":"2026-01-01T00:00:00.000Z","rev":2} -->',
    "两盒",
    "",
    "## 7. 修路由器",
    "先重启"
  ].join("\n");
  const parsed = parseNotesFile(text);
  assert.equal(parsed.meta.workspace, "E:\\x");
  assert.equal(parsed.meta.title, "X");
  assert.equal(parsed.notes.length, 2);
  assert.equal(parsed.notes[0].no, 1);
  assert.equal(parsed.notes[0].title, "买牛奶");
  assert.equal(parsed.notes[0].body, "两盒");
  assert.equal(parsed.notes[0].rev, 2);
  assert.equal(parsed.notes[1].no, 7);
});

await test("parse: headings without numbers get stable numbers", () => {
  const text = ["# 便签", "", "## 第一张", "甲", "", "## 2. 第二张", "乙", "", "## 第三张", "丙"].join("\n");
  const first = parseNotesFile(text).notes;
  const second = parseNotesFile(text).notes;
  assert.deepEqual(
    first.map((note) => note.no),
    [1, 2, 3]
  );
  assert.deepEqual(
    second.map((note) => note.no),
    [1, 2, 3]
  );
  assert.equal(first[0].title, "第一张");
  assert.equal(first[2].no, 3);
});

await test("parse: ### stays in the body, ## splits", () => {
  const text = ["# 便签", "", "## 1. 有子标题", "### 小标题", "正文"].join("\n");
  const notes = parseNotesFile(text).notes;
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, /### 小标题/);
});

await test("serialize: round-trips through parse with meta", () => {
  const notes = [
    { no: 2, id: "b", title: "二", body: "二号正文", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", rev: 1 },
    { no: 1, id: "a", title: "一", body: "", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", rev: 3 }
  ];
  const text = serializeNotesFile(notes, "# 便签", { workspace: "E:\\repo", title: "repo" });
  assert.match(text, /## 1\. 一/);
  const parsed = parseNotesFile(text);
  assert.equal(parsed.meta.workspace, "E:\\repo");
  assert.deepEqual(
    parsed.notes.map((note) => note.no),
    [1, 2]
  );
  assert.equal(parsed.notes[1].body, "二号正文");
});

await test("serialize: preamble is preserved, old meta replaced once", () => {
  const preamble = ['# 我的便签', "", "这是 AI 写的说明", "", '<!-- dsh-sticky-notes:v2 {"workspace":"E:\\\\old","title":"old"} -->'].join("\n");
  const text = serializeNotesFile([], preamble, { workspace: "E:\\new", title: "new" });
  assert.match(text, /AI 写的说明/);
  assert.equal(text.match(/dsh-sticky-notes:v2/g)?.length, 1);
  assert.match(text, /E:\\\\new/);
});

await test("save: create assigns next number, update keeps it", () => {
  const created = applySave([], { title: "甲", body: "1" }, cond);
  assert.equal(created.note.no, 1);
  const second = applySave(created.notes, { title: "乙", body: "2" }, cond);
  assert.equal(second.note.no, 2);
  const updated = applySave(second.notes, { no: 1, body: "改了" }, cond);
  assert.equal(updated.note.no, 1);
  assert.equal(updated.note.title, "甲");
  assert.equal(updated.notes.find((note) => note.no === 1).rev, 2);
});

await test("save: a new note never reuses a deleted number", () => {
  let notes = applySave([], { title: "a", body: "a" }, cond).notes;
  notes = applySave(notes, { title: "b", body: "b" }, cond).notes;
  notes = applySave(notes, { title: "c", body: "c" }, cond).notes;
  const removed = applyRemove(notes, 2, null).notes;
  assert.deepEqual(
    removed.map((note) => note.no),
    [1, 3]
  );
  const added = applySave(removed, { title: "d", body: "d" }, cond);
  assert.equal(added.note.no, 4, "序号不回收，4 号仍然是新的");
});

await test("append: adds a blank line and bumps rev", () => {
  const notes = applySave([], { title: "任务", body: "第一步" }, cond).notes;
  const result = applyAppend(notes, 1, "第二步：结果", cond);
  assert.equal(result.note.body, "第一步\n\n第二步：结果");
  assert.equal(result.note.rev, 2);
  const again = applyAppend(result.notes, 1, "第三步", cond);
  assert.equal(again.note.body, "第一步\n\n第二步：结果\n\n第三步");
});

await test("append: empty note takes the text as is", () => {
  const notes = applySave([], { title: "空", body: "" }, cond).notes;
  assert.equal(applyAppend(notes, 1, "写进来", cond).note.body, "写进来");
});

await test("errors: not-found, invalid, conflict", () => {
  assert.throws(() => applySave([], { title: "", body: "" }, cond), (error) => error instanceof NotesError && error.code === "sticky/invalid");
  assert.throws(() => applySave([], { no: 9, title: "x" }, cond), (error) => error.code === "sticky/not-found");
  const notes = applySave([], { title: "x", body: "y" }, cond).notes;
  assert.throws(
    () => applySave(notes, { no: 1, body: "z", baseRev: 99 }, cond),
    (error) => error.code === "sticky/conflict"
  );
  assert.throws(() => applyAppend(notes, 42, "x", cond), (error) => error.code === "sticky/not-found");
  assert.throws(() => applyAppend(notes, 1, "   ", cond), (error) => error.code === "sticky/invalid");
});

await test("normalizeInput: partial keeps untouched fields", () => {
  assert.deepEqual(normalizeInput({ body: "只有正文" }, { partial: true }), { body: "只有正文" });
  assert.deepEqual(normalizeInput({ title: " 标题 \r\n" }), { title: "标题" });
  assert.throws(() => normalizeInput({ title: "", body: "" }), (error) => error.code === "sticky/invalid");
});

await test("previewOf: flattens whitespace and truncates", () => {
  assert.equal(previewOf("a\n\nb\tc"), "a b c");
  assert.ok(previewOf("x".repeat(300), 10).length === 10);
  assert.equal(previewOf(""), "");
});

await test("workspaceKey and fileForWorkspace are stable and case-insensitive", () => {
  assert.equal(workspaceKey("E:\\Repo\\"), workspaceKey("e:/repo"));
  const dir = "C:\\notes";
  assert.equal(fileForWorkspace(dir, "E:\\Repo"), fileForWorkspace(dir, "e:\\repo\\"));
  assert.match(fileForWorkspace(dir, "E:\\Repo"), /^C:\\notes\\repo-[0-9a-f]{8}\.md$/);
  assert.notEqual(fileForWorkspace(dir, "E:\\Repo"), fileForWorkspace(dir, "E:\\Other"));
});

await test("store: real file roundtrip, groups, append and remove", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-sticky-"));
  try {
    const store = createWorkspaceStore({ dir });
    const empty = await store.list("E:\\repo");
    assert.equal(empty.notes.length, 0);
    assert.equal(empty.exists, false);

    const first = await store.save("E:\\repo", { title: "买牛奶", body: "两盒" });
    assert.equal(first.note.no, 1);
    const second = await store.save("E:\\repo", { title: "修路由器", body: "先重启" });
    assert.equal(second.note.no, 2);

    const reloaded = await store.list("E:\\repo");
    assert.deepEqual(
      reloaded.notes.map((note) => note.no),
      [1, 2]
    );

    const groups = await store.groups();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].count, 2);
    assert.equal(groups[0].workspace, "E:\\repo");

    const appended = await store.append("E:\\repo", 2, "换电源");
    assert.match(appended.note.body, /先重启\n\n换电源/);

    const removed = await store.remove("E:\\repo", 1, null);
    assert.deepEqual(
      removed.notes.map((note) => note.no),
      [2]
    );

    const text = await readFile(fileForWorkspace(dir, "E:\\repo"), "utf8");
    assert.match(text, /## 2\. 修路由器/);
    assert.match(text, /dsh-sticky-notes:v2/);
    assert.match(text, /E:\\\\repo/);


    // 外部直接编辑也要被下一次读写接住
    await writeFile(fileForWorkspace(dir, "E:\\repo"), "# 便签\n\n## 1. 手写的\n直接改文件", "utf8");
    const external = await store.list("E:\\repo");
    assert.equal(external.notes[0].title, "手写的");
    assert.equal(external.notes[0].no, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


const WORKSPACES = [
  { id: "w1", path: "E:\\moss\\DeepSeek-test", title: "DeepSeek-test", sessionIds: ["session-a"] },
  { id: "w2", path: "E:\\moss\\DeepSeek-test\\sessions\\inner", title: "inner", sessionIds: [] },
  { id: "w3", path: "E:\\moss\\github\\dsh-plugins", title: "dsh-plugins", sessionIds: [] }
];

function deps(overrides = {}) {
  return {
    list: () => WORKSPACES,
    headerCwd: () => "",
    ...overrides
  };
}

await test("workspace: registry session index wins over the header path", async () => {
  const result = await resolveWorkspace(
    deps({ headerCwd: () => "E:\\moss\\github\\dsh-plugins" }),
    "session-a"
  );
  assert.equal(result.path, "E:\\moss\\DeepSeek-test");
  assert.equal(result.title, "DeepSeek-test");
  assert.equal(result.source, "registry");
});

await test("workspace: a session that cd'd into a subdirectory stays in its workspace", async () => {
  // 这正是实际踩到的坑：会话 header.cwd 是工作区根，当前目录却是 sessions/xxx。
  const result = await resolveWorkspace(
    deps({ headerCwd: () => "E:\\moss\\DeepSeek-test" }),
    "session-b"
  );
  assert.equal(result.path, "E:\\moss\\DeepSeek-test");
  assert.equal(result.title, "DeepSeek-test");
  assert.equal(result.source, "header");
});

await test("workspace: an unregistered subdirectory picks the longest containing workspace", async () => {
  const result = await resolveWorkspace(
    deps({ headerCwd: () => "E:\\moss\\DeepSeek-test\\sessions\\inner\\deep" }),
    "session-c"
  );
  assert.equal(result.path, "E:\\moss\\DeepSeek-test\\sessions\\inner");
  assert.equal(result.title, "inner");
  assert.equal(result.source, "prefix");
});

await test("workspace: path spelling differences still match", async () => {
  const result = await resolveWorkspace(deps({ headerCwd: () => "e:/MOSS/deepseek-test/" }), "session-d");
  assert.equal(result.title, "DeepSeek-test");
  assert.equal(result.source, "header");
});

await test("workspace: realpath fallback catches a symlinked workspace", async () => {
  const result = await resolveWorkspace(
    deps({
      headerCwd: () => "D:\\link\\repo",
      resolveByPath: async (path) => (path === "D:\\link\\repo" ? { path: "E:\\real\\repo", title: "real" } : undefined)
    }),
    "session-e"
  );
  assert.equal(result.path, "E:\\real\\repo");
  assert.equal(result.title, "real");
  assert.equal(result.source, "realpath");
});

await test("workspace: an unowned directory becomes its own group", async () => {
  const result = await resolveWorkspace(deps({ headerCwd: () => "C:\\temp\\scratch" }), "session-f");
  assert.equal(result.path, "C:\\temp\\scratch");
  assert.equal(result.title, "scratch");
  assert.equal(result.source, "directory");
});

await test("workspace: no session falls back to the remembered directory", async () => {
  const result = await resolveWorkspace(deps({ headerCwd: () => "" }), "", "E:\\moss\\DeepSeek-test");
  assert.equal(result.title, "DeepSeek-test");
  assert.equal(result.source, "header");
});

await test("workspace: an empty registry never throws", async () => {
  const result = await resolveWorkspace({ list: () => { throw new Error("boom"); }, headerCwd: () => "" }, "");
  assert.equal(result.path, "");
  assert.equal(result.source, "directory");
});

await test("workspace: insidePath compares whole path segments", () => {
  assert.equal(insidePath("E:\\a\\b", "E:\\a"), true);
  assert.equal(insidePath("E:\\ab", "E:\\a"), false);
  assert.equal(insidePath("E:\\a", "E:\\a"), true);
});

await test("body: a line starting with ## is demoted so it cannot split the note", () => {
  const notes = applySave([], { title: "T", body: "a" }, cond).notes;
  const appended = applyAppend(notes, 1, "## 结论\nb", cond).notes;
  const text = serializeNotesFile(appended, "# 便签", { workspace: "E:\\w", title: "w" });
  const parsed = parseNotesFile(text);
  assert.equal(parsed.notes.length, 1, "正文里的 ## 不能再劈出一张便签");
  assert.match(parsed.notes[0].body, /^### 结论$/m);
  assert.equal(parsed.notes[0].no, 1);
});

await test("numbers: deleting the highest number does not recycle it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-sticky-"));
  try {
    const store = createWorkspaceStore({ dir });
    await store.save("E:\\w", { title: "a", body: "a" });
    await store.save("E:\\w", { title: "b", body: "b" });
    const third = await store.save("E:\\w", { title: "c", body: "c" });
    assert.equal(third.note.no, 3);
    await store.remove("E:\\w", 3, null);
    const fourth = await store.save("E:\\w", { title: "d", body: "d" });
    assert.equal(fourth.note.no, 4, "删掉最大号后新建仍然是 4 号");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("numbers: a duplicated explicit number never renumbers the others", () => {
  const text = ["# 便签", "", "## 1. A", "a", "", "## 1. B", "b", "", "## 2. C", "c"].join("\n");
  const notes = parseNotesFile(text).notes;
  assert.deepEqual(
    notes.map((note) => note.title),
    ["A", "B", "C"]
  );
  // B 撞号，被推到高水位之上；C 保持 2 号不动。
  assert.deepEqual(
    notes.map((note) => note.no),
    [1, 3, 2]
  );
});

await test("parse: CR-only files still split into notes", () => {
  const notes = parseNotesFile("# 便签\r## 1. T\rbody").notes;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "T");
  assert.match(notes[0].body, /body/);
});

await test("titles: 200 emoji survive a full save→parse round trip", () => {
  const long = "😀".repeat(250);
  const notes = applySave([], { title: long, body: "x" }, cond).notes;
  const text = serializeNotesFile(notes, "# 便签", { workspace: "E:\\w" });
  const round = parseNotesFile(text).notes;
  assert.equal(round.length, 1);
  assert.equal(Array.from(round[0].title).length, 200, "往返后仍是 200 个 code point");
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(round[0].title), false, "没有落单代理");
  // 再存一次：文件里不能出现 U+FFFD
  const again = serializeNotesFile(round, "# 便签", { workspace: "E:\\w" });
  assert.equal(again.includes("\uFFFD"), false);
});

await test("save: an explicit empty title clears it, an omitted one keeps it", () => {
  const notes = applySave([], { title: "原标题", body: "x" }, cond).notes;
  // 显式传 "" = 清空（文件里写成 "## 1."，能原样读回来）
  const cleared = applySave(notes, { no: 1, title: "" }, cond);
  assert.equal(cleared.note.title, "");
  const roundTrip = parseNotesFile(serializeNotesFile(cleared.notes, "# 便签", { workspace: "E:\\w" })).notes;
  assert.equal(roundTrip.length, 1);
  assert.equal(roundTrip[0].title, "");
  // 不传 title = 保持
  const kept = applySave(notes, { no: 1, body: "y" }, cond);
  assert.equal(kept.note.title, "原标题");
  assert.equal(kept.note.body, "y");
});

await test("store: a non-UTF-8 file is refused instead of being rewritten", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-sticky-"));
  try {
    const store = createWorkspaceStore({ dir });
    const file = fileForWorkspace(dir, "E:\\w");
    await writeFile(file, Buffer.from([0x23, 0x20, 0x81, 0x81, 0x0a]));
    await assert.rejects(
      () => store.list("E:\\w"),
      (error) => error.code === "sticky/encoding"
    );
    await assert.rejects(
      () => store.save("E:\\w", { title: "x", body: "y" }),
      (error) => error.code === "sticky/encoding"
    );
    // 拒绝之后原文件必须原封不动
    const after = await readFile(file);
    assert.deepEqual([...after], [0x23, 0x20, 0x81, 0x81, 0x0a]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("store: lastNo survives a reload so numbering keeps going up", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-sticky-"));
  try {
    const first = createWorkspaceStore({ dir });
    await first.save("E:\\w", { title: "a", body: "a" });
    await first.save("E:\\w", { title: "b", body: "b" });
    await first.remove("E:\\w", 2, null);
    // 换一个 store 实例（等价于重启 dsh）：高水位得从文件里读回来
    const second = createWorkspaceStore({ dir });
    const third = await second.save("E:\\w", { title: "c", body: "c" });
    assert.equal(third.note.no, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("parse: U+2028 / U+2029 in a title do not swallow the note", () => {
  const saved = applySave([], { title: "a\u2028b\u2029c", body: "x" }, cond);
  assert.equal(saved.note.title, "a b c");
  const text = serializeNotesFile(saved.notes, "# 便签", { workspace: "E:\\w" });
  const round = parseNotesFile(text).notes;
  assert.equal(round.length, 1);
  assert.equal(round[0].title, "a b c");
});

await test("parse: deleting every note keeps lastNo and the group", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-sticky-"));
  try {
    const store = createWorkspaceStore({ dir });
    await store.save("E:\\w", { title: "only", body: "x" }, { title: "w" });
    const removed = await store.remove("E:\\w", 1, null);
    assert.equal(removed.notes.length, 0);
    // 文件还在、元数据还在：分组不能消失
    const groups = await store.groups();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].count, 0);
    // 高水位不能丢：下一张是 2 号
    const next = await store.save("E:\\w", { title: "second", body: "y" });
    assert.equal(next.note.no, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test("numbers: an unnumbered note never takes a retired number", () => {
  // 有高水位（删过号）的文件里，手加的无号便签补到高水位之后
  const text = [
    "# 便签",
    "",
    '<!-- dsh-sticky-notes:v2 {"workspace":"E:\\\\w","lastNo":3} -->',
    "",
    "## 1. A",
    "a",
    "",
    "## 3. C",
    "c",
    "",
    "## 新来的",
    "n"
  ].join("\n");
  const notes = parseNotesFile(text).notes;
  assert.deepEqual(
    notes.map((note) => note.no),
    [1, 3, 4]
  );
});

await test("save: a write with no fields is rejected instead of bumping rev", () => {
  const notes = applySave([], { title: "t", body: "b" }, cond).notes;
  assert.throws(
    () => applySave(notes, { no: 1 }, cond),
    (error) => error.code === "sticky/invalid"
  );
});

await test("save: a non-integer baseRev is rejected, not treated as missing", () => {
  const notes = applySave([], { title: "t", body: "b" }, cond).notes;
  assert.throws(
    () => applySave(notes, { no: 1, body: "x", baseRev: "1" }, cond),
    (error) => error.code === "sticky/invalid"
  );
});

await test("remove: a stale baseRev conflicts", () => {
  const notes = applySave([], { title: "t", body: "b" }, cond).notes;
  assert.throws(
    () => applyRemove(notes, 1, 99),
    (error) => error.code === "sticky/conflict"
  );
});

await test("numbers: an absurd number is ignored instead of hanging", () => {
  const text = ["# 便签", "", "## 9007199254740993. huge", "x", "", "## 9007199254740993. huge2", "y"].join("\n");
  const notes = parseNotesFile(text).notes;
  // 超过上界的号当作没编号，重新分配；关键是必须返回（不能死循环）
  assert.equal(notes.length, 2);
  assert.ok(notes.every((note) => Number.isSafeInteger(note.no)));
});

await test("workspace keys: path spellings collapse, same-slug dirs stay apart", () => {
  const dir = "C:\\notes";
  assert.equal(fileForWorkspace(dir, "E:\\Repo\\."), fileForWorkspace(dir, "E:\\Repo"));
  assert.notEqual(fileForWorkspace(dir, "E:\\a\\repo"), fileForWorkspace(dir, "E:\\b\\repo"));
});

await test("store: concurrent saves on one workspace keep every note", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-sticky-"));
  try {
    const store = createWorkspaceStore({ dir });
    await Promise.all([
      store.save("E:\\w", { title: "a", body: "1" }),
      store.save("E:\\w", { title: "b", body: "2" }),
      store.save("E:\\w", { title: "c", body: "3" })
    ]);
    const group = await store.list("E:\\w");
    assert.equal(group.notes.length, 3);
    assert.deepEqual(
      group.notes.map((note) => note.no).sort((left, right) => left - right),
      [1, 2, 3]
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


await test("status: a note carries status/owner/topic through a round trip", () => {
  const notes = applySave([], { title: "交接", body: "x", status: "doing", owner: "session-a1", topic: "TV0004" }, { ...cond, by: "sess-b2" }).notes;
  const text = serializeNotesFile(notes, "# 便签", { workspace: "E:\\w" });
  const round = parseNotesFile(text).notes;
  assert.equal(round[0].status, "doing");
  assert.equal(round[0].owner, "session-a1");
  assert.equal(round[0].topic, "TV0004");
  assert.equal(round[0].updatedBy, "sess-b2");
});

await test("status: applyStatus flips state and records who did it", () => {
  const notes = applySave([], { title: "t", body: "b" }, cond).notes;
  const result = applyStatus(notes, 1, { status: "done", owner: "session-b" }, { now: "2026-11-06T08:00:00.000Z", by: "sess-b" });
  assert.equal(result.note.status, "done");
  assert.equal(result.note.owner, "session-b");
  assert.equal(result.note.updatedBy, "sess-b");
  assert.equal(result.note.rev, 2);
  assert.throws(() => applyStatus(notes, 1, { status: "nope" }, cond), (error) => error.code === "sticky/invalid");
});

await test("board: first post creates the board note, later posts append a timestamped line", () => {
  // 用本地时间构造：公告栏的时间戳按宿主本地时钟显示
  const at0815 = new Date(2026, 10, 6, 8, 15, 0).toISOString();
  const at0820 = new Date(2026, 10, 6, 8, 20, 0).toISOString();
  const first = applyBoardPost([], "A 改完了 3 号", { now: at0815, by: "sess-a", newId: () => "board" });
  assert.equal(first.created, true);
  assert.equal(first.note.kind, "board");
  assert.equal(first.note.no, 1);
  assert.match(first.note.body, /^- \[08:15\] @sess-a A 改完了 3 号$/m);
  const second = applyBoardPost(first.notes, "B 接手", { now: at0820, by: "sess-b" });
  assert.equal(second.created, false);
  assert.equal(second.note.no, 1);
  const lines = second.note.body.split("\n").filter(Boolean);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /@sess-b B 接手/);
});

await test("board: the board is pruned so it cannot grow without bound", () => {
  let notes = [];
  for (let index = 0; index < 100; index += 1) {
    const result = applyBoardPost(notes, `第 ${index} 条`, { now: "2026-11-06T08:00:00.000Z", by: "s" });
    notes = result.notes;
  }
  const board = notes.find((note) => note.kind === "board");
  assert.ok(board.body.split("\n").length <= 80);
  assert.match(board.body, /第 99 条/);
});

if (failed > 0) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log(`\n${passed} tests passed`);
}
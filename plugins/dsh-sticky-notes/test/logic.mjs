/**
 * dsh-sticky-notes 单测：纯文件格式、Host 存储、浏览器半的纯函数。
 *
 * 不引测试框架：断言失败计数，最后用退出码汇报。
 */

import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import {
  MAX_BODY,
  MAX_NOTES,
  NotesError,
  applyRemove,
  applySave,
  displayOrder,
  normalizeNoteInput,
  parseNotesFile,
  serializeNotesFile
} from "../notes.js";
import { createNotesStore } from "../store.js";

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;

function ok(label, condition, detail = "") {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail === "" ? "" : `  (${detail})`}`);
  }
}

function eq(label, actual, expected) {
  ok(label, Object.is(actual, expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

function deep(label, actual, expected) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  ok(label, left === right, `got ${left}, want ${right}`);
}

async function throws(label, fn, code) {
  try {
    await fn();
  } catch (error) {
    // client.js 在 vm 里有自己的 Error realm，因此只认 code，不做 instanceof。
    ok(
      label,
      error !== null && typeof error === "object" && error.code === code,
      `got ${error?.code ?? error}, want ${code}`
    );
    return error;
  }
  ok(label, false, `did not throw (want ${code})`);
  return undefined;
}

const NOW = "2026-11-06T02:00:00.000Z";
const LATER = "2026-11-06T02:05:00.000Z";

/* ── notes.js：解析与序列化 ─────────────────────────────────────────── */

{
  const empty = parseNotesFile("");
  eq("空文件没有便签", empty.notes.length, 0);
  eq("空文件没有前言", empty.preamble, "");

  const defaultFile = serializeNotesFile([], "");
  ok("默认文件带标题", defaultFile.startsWith("# 便签"));
  ok("默认文件带版本标记", defaultFile.includes("dsh-sticky-notes:v1"));
  eq("默认文件解析回来没有便签", parseNotesFile(defaultFile).notes.length, 0);

  const created = applySave(
    [],
    { title: "买牛奶", body: "两盒\n周四之前", color: "pink", pinned: true },
    { now: NOW, newId: () => "note-milk" }
  );
  eq("新建便签拿到 id", created.note.id, "note-milk");
  eq("新建便签 rev=1", created.note.rev, 1);
  eq("新建便签保留 createdAt", created.note.createdAt, NOW);

  const text = serializeNotesFile(created.notes);
  ok("序列化后是 H2 标题", text.includes("## 买牛奶"));
  ok("序列化后带元数据", text.includes('"id":"note-milk"'));
  const parsed = parseNotesFile(text);
  eq("往返后便签数", parsed.notes.length, 1);
  eq("往返后标题", parsed.notes[0].title, "买牛奶");
  eq("往返后正文", parsed.notes[0].body, "两盒\n周四之前");
  eq("往返后颜色", parsed.notes[0].color, "pink");
  eq("往返后置顶", parsed.notes[0].pinned, true);
  eq("往返后 rev", parsed.notes[0].rev, 1);

  let state = created.notes;
  const updated = applySave(
    state,
    { id: "note-milk", title: "买牛奶（改）", body: "三盒", color: "green", baseRev: 1 },
    { now: LATER, newId: () => "unused" }
  );
  eq("更新后 rev=2", updated.note.rev, 2);
  eq("更新保留 createdAt", updated.note.createdAt, NOW);
  eq("更新刷新 updatedAt", updated.note.updatedAt, LATER);

  state = updated.notes;
  const conflict = await throws(
    "旧 baseRev 触发冲突",
    () => {
      applySave(state, { id: "note-milk", title: "抢写", body: "x", baseRev: 1 }, { now: LATER, newId: () => "x" });
    },
    "sticky/conflict"
  );
  eq("冲突带上服务端当前副本", conflict?.details?.current?.rev, 2);

  const forced = applySave(state, { id: "note-milk", title: "覆盖", body: "y" }, { now: LATER, newId: () => "x" });
  eq("不传 baseRev 时按覆盖处理", forced.note.rev, 3);

  await throws(
    "更新不存在的 id",
    () => {
      applySave(state, { id: "missing", title: "x", body: "y" }, { now: NOW, newId: () => "x" });
    },
    "sticky/not-found"
  );

  let many = [];
  for (let index = 0; index < MAX_NOTES; index += 1) {
    many = applySave(many, { title: `第 ${index} 张` }, { now: NOW, newId: () => `bulk-${index}` }).notes;
  }
  await throws(
    "超过便签数量上限",
    () => {
      applySave(many, { title: "one more" }, { now: NOW, newId: () => "over" });
    },
    "sticky/too-large"
  );

  await throws(
    "正文超长",
    () => {
      normalizeNoteInput({ title: "x", body: "a".repeat(MAX_BODY + 1) });
    },
    "sticky/too-large"
  );

  await throws(
    "空标题空正文",
    () => {
      normalizeNoteInput({ title: "  ", body: "\n\n" });
    },
    "sticky/invalid"
  );

  const normalized = normalizeNoteInput({
    title: "  第一行\n第二行  ",
    body: "a\r\nb\r\n\r\n",
    color: "not-a-color",
    pinned: "yes"
  });
  eq("标题里的换行压平", normalized.title, "第一行 第二行");
  eq("正文统一成 LF 并去掉尾部空白", normalized.body, "a\nb");
  eq("非法颜色回退黄色", normalized.color, "yellow");
  eq("pinned 只认 true", normalized.pinned, false);

  const longTitle = normalizeNoteInput({ title: "x".repeat(250) }).title;
  eq("超长标题截断", longTitle.length, 200);

  const external = parseNotesFile("# 便签\n\n## 外面加的\n直接写的正文\n");
  eq("外部便签被读出来", external.notes.length, 1);
  ok("外部便签获得 ext- id", external.notes[0].id.startsWith("ext-"));
  eq("外部便签 rev 为 0", external.notes[0].rev, 0);
  eq("外部便签默认颜色", external.notes[0].color, "yellow");

  const adopted = applySave(
    external.notes,
    { id: external.notes[0].id, title: external.notes[0].title, body: "改过", baseRev: 0 },
    { now: NOW, newId: () => "x" }
  );
  eq("外部便签第一次保存 rev=1", adopted.note.rev, 1);
  const adoptedAgain = parseNotesFile(serializeNotesFile(adopted.notes));
  eq("补上元数据后 id 稳定", adoptedAgain.notes[0].id, external.notes[0].id);

  const duplicate = parseNotesFile(
    '# 便签\n\n## A\n<!-- dsh-note: {"id":"same"} -->\nA\n\n## B\n<!-- dsh-note: {"id":"same"} -->\nB\n'
  );
  eq("重复 id 都被读出", duplicate.notes.length, 2);
  ok("重复 id 被改名", duplicate.notes[0].id !== duplicate.notes[1].id);

  const badMeta = parseNotesFile("# 便签\n\n## 坏元数据\n<!-- dsh-note: {bad} -->\n正文\n");
  eq("坏元数据不吞正文", badMeta.notes[0].body, "<!-- dsh-note: {bad} -->\n正文");
  ok("坏元数据退回派生 id", badMeta.notes[0].id.startsWith("ext-"));

  const crlf = parseNotesFile("# x\r\n\r\n## T\r\nbody\r\n");
  eq("CRLF 正文", crlf.notes[0].body, "body");

  const preamble = parseNotesFile("# 项目便签\n\n只给自己看的说明\n\n## 一\n正文\n");
  eq("前言被保留", preamble.preamble, "# 项目便签\n\n只给自己看的说明");
  ok(
    "写回时保留前言",
    serializeNotesFile(preamble.notes, preamble.preamble).startsWith("# 项目便签")
  );

  const nested = parseNotesFile("# x\n\n## 一\n### 小标题\n正文\n");
  eq("正文里的 ### 不拆便签", nested.notes.length, 1);
  eq("正文里的 ### 保留", nested.notes[0].body, "### 小标题\n正文");

  const split = parseNotesFile("# x\n\n## 一\n正文\n## 二\n更多\n");
  eq("正文里的 ## 开启新便签（文档约定）", split.notes.length, 2);

  eq("删除便签", applyRemove([{ ...created.note }], "note-milk", 1).notes.length, 0);
  await throws(
    "删除不存在的便签",
    () => {
      applyRemove([], "missing", null);
    },
    "sticky/not-found"
  );
  await throws(
    "删除带旧 rev",
    () => {
      applyRemove([{ ...created.note, rev: 2 }], "note-milk", 1);
    },
    "sticky/conflict"
  );

  const ordered = displayOrder([
    { id: "a", pinned: false },
    { id: "b", pinned: true },
    { id: "c", pinned: false },
    { id: "d", pinned: true }
  ]);
  deep("置顶排在前面且保持原顺序", ordered.map((note) => note.id), ["b", "d", "a", "c"]);
}

/* ── store.js：真实文件读写 ─────────────────────────────────────────── */

async function storeTests() {
  const directory = await mkdtemp(join(tmpdir(), "dsh-sticky-notes-"));
  const file = join(directory, "notes.md");
  const store = createNotesStore({ file, displayPath: "~/.dsh/sticky-notes.md" });

  try {
    const missing = await store.list();
    eq("文件不存在时 list 不报错", missing.notes.length, 0);
    eq("文件不存在标记 exists=false", missing.exists, false);
    eq("文件不存在 revision=empty", missing.revision, "empty");
    eq("list 带上展示路径", missing.displayPath, "~/.dsh/sticky-notes.md");

    const created = await store.save({ title: "买牛奶", body: "两盒" });
    eq("save 新建 rev=1", created.note.rev, 1);
    ok("save 真的写出文件", (await readFile(file, "utf8")).includes("## 买牛奶"));
    eq("save 返回完整列表", created.notes.length, 1);

    const listed = await store.list();
    eq("list 读到刚写的便签", listed.notes[0].title, "买牛奶");
    eq("list revision 与 save 一致", listed.revision, created.revision);
    ok("revision 不是 empty", listed.revision !== "empty");

    const updated = await store.save({
      id: created.note.id,
      title: "买牛奶",
      body: "三盒",
      color: "blue",
      baseRev: created.note.rev
    });
    eq("更新 rev 递增", updated.note.rev, 2);
    eq("更新保留正文", updated.note.body, "三盒");

    await throws(
      "store 拒绝旧 rev",
      () => store.save({ id: created.note.id, title: "x", body: "y", baseRev: 1 }),
      "sticky/conflict"
    );

    await writeFile(file, "# 便签\n\n## 外面加的\n直接写的正文\n", "utf8");
    const external = await store.list();
    eq("外部编辑被下一次 list 看见", external.notes.length, 1);
    eq("外部便签标题", external.notes[0].title, "外面加的");
    ok("外部便签 id 是 ext-", external.notes[0].id.startsWith("ext-"));

    const adopted = await store.save({
      id: external.notes[0].id,
      title: "外面加的",
      body: "被界面收养",
      baseRev: 0
    });
    eq("外部便签保存后 rev=1", adopted.note.rev, 1);

    const removed = await store.remove({ id: adopted.note.id, baseRev: adopted.note.rev });
    eq("删除后列表为空", removed.notes.length, 0);
    eq("删除后文件里没有标题", (await readFile(file, "utf8")).includes("## 外面加的"), false);

    await throws("删除不存在的 id", () => store.remove({ id: "missing" }), "sticky/not-found");

    await throws("坏保存不写文件", () => store.save({ title: "", body: "" }), "sticky/invalid");
    const afterFailure = await store.list();
    eq("失败后队列还能继续工作", afterFailure.notes.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/* ── client.js：纯函数与 RPC 封装 ───────────────────────────────────── */

let spec;
const storage = new Map();
const win = {
  __dshStickyNotesTest: true,
  __ModuleLoader__: {
    load(value) {
      spec = value;
    }
  },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => {
      storage.set(key, String(value));
    }
  },
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: () => 0,
  clearInterval: () => {}
};
const sandbox = {
  window: win,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  navigator: {},
  document: { hidden: false },
  Element: class Element {}
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(here, "..", "client.js"), "utf8"), sandbox);

const ReactStub = {
  createElement: () => null,
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: () => ({ current: null })
};

const module = spec.factory((name) => {
  if (name === "react") return ReactStub;
  throw new Error(`unexpected require: ${name}`);
});

if (module === undefined || typeof module.apply !== "function") {
  console.log("FAIL  client.js 没有导出 apply");
  failures += 1;
}

const client = module.__internals ?? {};
const t = (key, vars) => (vars === undefined ? key : `${key}:${vars.n}`);

if (client.previewOf) {
  eq("previewOf 压平空白", client.previewOf("a\n  b\tc", 40), "a b c");
  eq("previewOf 空正文", client.previewOf("   ", 10), "");
  eq("previewOf 截断加省略号", client.previewOf("x".repeat(200), 20).length, 20);
  ok("previewOf 保留短文本", client.previewOf("短", 20) === "短");

  eq("relativeTime 刚刚", client.relativeTime(new Date(Date.parse(NOW) - 12000).toISOString(), Date.parse(NOW), t), "time.justNow");
  eq("relativeTime 分钟", client.relativeTime(new Date(Date.parse(NOW) - 5 * 60000).toISOString(), Date.parse(NOW), t), "time.minutesAgo:5");
  eq("relativeTime 小时", client.relativeTime(new Date(Date.parse(NOW) - 3 * 3600000).toISOString(), Date.parse(NOW), t), "time.hoursAgo:3");
  eq("relativeTime 天", client.relativeTime(new Date(Date.parse(NOW) - 2 * 86400000).toISOString(), Date.parse(NOW), t), "time.daysAgo:2");
  eq("relativeTime 坏时间", client.relativeTime("not-a-date", Date.parse(NOW), t), "time.unknown");

  deep("normalizePrefs 合法值", client.normalizePrefs({ open: true, pos: { x: -3, y: 8 } }), {
    open: true,
    pos: { x: -3, y: 8 }
  });
  deep("normalizePrefs 非法位置丢弃", client.normalizePrefs({ open: 1, pos: { x: "a", y: 2 } }), {
    open: false,
    pos: null
  });

  deep(
    "orderNotes 置顶优先、其余稳定",
    client.orderNotes([
      { id: "a", pinned: false },
      { id: "b", pinned: true },
      { id: "c", pinned: false }
    ]).map((note) => note.id),
    ["b", "a", "c"]
  );

  const empty = client.emptyDraft();
  eq("emptyDraft 没有 id", empty.id, null);
  eq("draftOf 拷贝置顶", client.draftOf({ id: "x", title: "t", body: "b", color: "gray", pinned: true, rev: 2 }).pinned, true);
  ok("draftKey 区分颜色", client.draftKey({ ...empty, color: "pink" }) !== client.draftKey(empty));

  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    if (body.method === "save") {
      return {
        status: 200,
        ok: true,
        async json() {
          return {
            ok: false,
            error: {
              code: "sticky/conflict",
              message: "changed",
              details: { current: { id: "n1", rev: 4 } }
            }
          };
        }
      };
    }
    return {
      status: 200,
      ok: true,
      async json() {
        return { ok: true, value: { notes: [], revision: "rev-1" } };
      }
    };
  };
  const api = client.createApi(fetchImpl);
  const listed = await api.list();
  eq("RPC list 返回 value", listed.revision, "rev-1");
  eq("RPC 路由正确", calls[0].url, "/api/sticky-notes");
  eq("RPC 方法正确", calls[0].init.method, "POST");
  eq("RPC list 方法名", calls[0].body.method, "list");
  const conflictError = await throws("错误信封变成异常", () => api.save({ title: "x" }), "sticky/conflict");
  eq("错误 details 保留", conflictError?.details?.current?.rev, 4);
  eq("save 包成 { note }", calls[1].body.payload.note.title, "x");

  const unauthorized = client.createApi(async () => ({ status: 401, ok: false }));
  await throws("401 映射成 forbidden", () => unauthorized.list(), "sticky/forbidden");

  const broken = client.createApi(async () => {
    throw new Error("offline");
  });
  await throws("传输错误映射成 network", () => broken.list(), "sticky/network");

  const badJson = client.createApi(async () => ({
    status: 200,
    ok: true,
    async json() {
      throw new Error("not json");
    }
  }));
  await throws("非 JSON 映射成 protocol", () => badJson.list(), "sticky/protocol");

  const serverError = client.createApi(async () => ({ status: 500, ok: false }));
  await throws("HTTP 500 映射成 network", () => serverError.list(), "sticky/network");

  ok("errorText 冲突文案", client.errorText({ code: "sticky/conflict" }).includes("别处"));
  eq("saveLabel 保存中", client.saveLabel("saving"), "保存中…");
}

/* ── 装配 smoke test（放最后，避免 fake locale 影响前面的文案断言）──── */

{
  const registered = [];
  const fakeCtx = {
    get: () => undefined,
    inject: (deps, callback) => callback({ get: () => undefined }),
    effect: () => {},
    slots: {
      inject: (slot, callback) => callback(),
      register: (options) => {
        registered.push(options);
        return () => {};
      }
    }
  };
  await module.apply(fakeCtx);
  eq("插件的 apply 注册 4 个座位", registered.length, 4);
  eq(
    "用量栏注册一次",
    registered.filter((entry) => entry.name === "conversation.composer.dock").length,
    1
  );
  eq("悬浮板注册一次", registered.filter((entry) => entry.name === "shell.overlay").length, 1);
  eq(
    "插件页配置卡两边都要挂",
    registered.filter((entry) => entry.name === "plugins.bundle.config").length,
    2
  );
}

await storeTests();

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
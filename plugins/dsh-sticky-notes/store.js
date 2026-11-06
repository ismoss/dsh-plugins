/**
 * dsh-sticky-notes — Host 侧的便签文件存储。
 *
 * 一个工作区一份 Markdown，落在插件自己的目录里（默认 `$DSH_HOME/sticky-notes/`）：
 * 不往用户的仓库里丢文件，同时文件本身还是纯文本，能备份、能进同步盘、能直接看。
 *
 * 文件名 = 目录名 slug + 工作区路径哈希，因此不需要索引文件：列一次目录就知道有哪
 * 几个工作区有便签。工作区路径记在文件开头的元数据行里，换机器后仍能认出来。
 *
 * 并发：所有读写串行执行；写文件用「同目录临时文件 + rename」，每次变更都先重新读，
 * 所以 AI、编辑器、另一个浏览器在外面改过文件也会被下一次保存接住。
 */

import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  NotesError,
  applyAppend,
  applyBoardPost,
  applyRemove,
  applySave,
  applyStatus,
  assertFileSize,
  parseNotesFile,
  serializeNotesFile
} from "./notes.js";

const FILE_SUFFIX = ".md";

function hashOf(value) {
  return createHash("sha1").update(value, "utf8").digest("hex").slice(0, 8);
}

function slugOf(value) {
  const text = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return text === "" ? "ws" : text;
}

/**
 * Windows 路径大小写不敏感、两种分隔符等价：同一目录的任意写法必须落到同一个文件。
 * 归一化成「正斜杠 + 小写 + 无尾分隔符」。
 */
export function workspaceKey(path) {
  const raw = String(path ?? "").trim();
  // 先做路径归一：`E:\Repo\.` / `E:/Repo/` 和 `E:\Repo` 必须是同一把钥匙，
  // 否则同一个工作区会裂成两份文件、两个分组。
  let normalized = raw;
  try {
    normalized = resolve(raw);
  } catch {
    normalized = raw;
  }
  const text = normalized.replace(/\\/g, "/").replace(/\/+$/, "");
  // 只有大小写不敏感的文件系统才折叠大小写：Linux 上 /a/App 与 /a/app 是两个真实目录。
  return process.platform === "linux" ? text : text.toLowerCase();
}

export function fileForWorkspace(dir, path) {
  const raw = String(path ?? "");
  // slug 和 hash 都要来自归一化后的路径，否则 `E:\Repo\.` 会得到 "ws-<同一 hash>"，
  // 和工作区本身的 "repo-<同一 hash>" 变成两个文件。
  let canonical = raw;
  try {
    canonical = resolve(raw);
  } catch {
    canonical = raw;
  }
  const base = basename(canonical.replace(/[\\/]+$/, ""));
  return join(dir, `${slugOf(base)}-${hashOf(workspaceKey(raw))}${FILE_SUFFIX}`);
}

function revisionOf(text, exists) {
  if (!exists) return "empty";
  return createHash("sha1").update(text, "utf8").digest("hex").slice(0, 16);
}

function ioError(error, file) {
  if (error instanceof NotesError) return error;
  return new NotesError("sticky/io", `cannot access the notes file: ${error?.message ?? String(error)}`, {
    path: file,
    errno: error?.code ?? null
  });
}

/**
 * @param {{dir: string, displayDir?: string}} options
 */
export function createWorkspaceStore(options) {
  const dir = options.dir;
  const displayDir = options.displayDir ?? dir;
  const queues = new Map();

  /** 每个文件一条串行链；单个请求失败不阻断后面的请求。 */
  function exclusive(file, work) {
    const previous = queues.get(file) ?? Promise.resolve();
    const run = previous.then(work, work);
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    queues.set(file, settled);
    void settled.then(() => {
      if (queues.get(file) === settled) queues.delete(file);
    });
    return run;
  }

  async function readFileIfExists(file) {
    let buffer;
    try {
      buffer = await readFile(file);
    } catch (error) {
      if (error?.code === "ENOENT") return { text: "", exists: false };
      throw ioError(error, file);
    }
    let text;
    try {
      // 非 UTF-8（GBK/UTF-16/半个坏字节）一旦被 `${…}` 式解码成 U+FFFD，下一次保存就会把
      // 整份文件永久写坏。这里用 fatal 解码，宁可报错也不动它。
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw new NotesError("sticky/encoding", "the notes file is not valid UTF-8; refusing to rewrite it", {
        path: file
      });
    }
    return { text, exists: true };
  }

  async function writeAtomic(file, text) {
    assertFileSize(text);
    const directory = dirname(file);
    const temporary = join(directory, `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await mkdir(directory, { recursive: true });
      const handle = await open(temporary, "w");
      try {
        await handle.writeFile(text, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(temporary, file);
        return;
      } catch (error) {
        // Windows 上目标文件被索引/杀毒/同步盘短暂占住时 rename 会 EPERM/EACCES。
        if (error?.code !== "EPERM" && error?.code !== "EACCES" && error?.code !== "EEXIST") throw error;
        // 退化路径不原子：先把现有内容留一份 .bak，直写失败时 temp 也留着（里面是新内容）。
        await copyFile(file, `${file}.bak`).catch(() => undefined);
        await writeFile(file, text, "utf8");
        // 临时文件删不掉不算失败：正文已经落盘了，报错只会让用户重试、重复追加。
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    } catch (error) {
      throw ioError(error, file);
    }
  }

  function summarize(workspace, title, notes, file) {
    let updatedAt = "";
    for (const note of notes) {
      if (note.updatedAt > updatedAt) updatedAt = note.updatedAt;
    }
    return { workspace, title, count: notes.length, updatedAt, file, displayPath: `${displayDir}/${basename(file)}` };
  }

  async function load(workspace) {
    const file = fileForWorkspace(dir, workspace);
    const current = await readFileIfExists(file);
    const parsed = parseNotesFile(current.text);
    return { file, current, parsed };
  }

  function group(workspace, title, parsed, file, revision, exists) {
    return {
      workspace,
      title,
      notes: parsed.notes,
      revision,
      path: file,
      displayPath: `${displayDir}/${basename(file)}`,
      exists
    };
  }

  return {
    readonly: true,
    dir,

    /** 当前工作区的全部便签；没有文件时返回空列表而不是报错。 */
    list(workspace) {
      const target = String(workspace ?? "").trim();
      return exclusive(fileForWorkspace(dir, target), async () => {
        const { file, current, parsed } = await load(target);
        return group(target, parsed.meta.title, parsed, file, revisionOf(current.text, current.exists), current.exists);
      });
    },

    /** 所有工作区的概览（页面左侧的分组列表用）。 */
    async groups() {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw ioError(error, dir);
      }
      const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(FILE_SUFFIX)).map((entry) => join(dir, entry.name));
      const groups = [];
      for (const file of files) {
        try {
          // 走同一条队列：退化直写期间读到半截文件会让计数和分组错乱。
          await exclusive(file, () => Promise.resolve());
          const current = await readFileIfExists(file);
          const parsed = parseNotesFile(current.text);
          const workspace = parsed.meta.workspace;
          if (workspace === "") continue;
          groups.push(summarize(workspace, parsed.meta.title, parsed.notes, file));
        } catch (error) {
          console.warn("[dsh-sticky-notes] skip unreadable notes file", file, error?.message ?? error);
        }
      }
      groups.sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) return right.updatedAt.localeCompare(left.updatedAt);
        return left.workspace.localeCompare(right.workspace);
      });
      return groups;
    },

    /** 新建或修改。`note` 里带 `no` 就是改，不带就是新建。 */
    save(workspace, note, options = {}) {
      const target = String(workspace ?? "").trim();
      const displayTitle = typeof options.title === "string" ? options.title : "";
      return exclusive(fileForWorkspace(dir, target), async () => {
        const { file, current, parsed } = await load(target);
        const now = new Date().toISOString();
        const result = applySave(parsed.notes, note, {
          now,
          newId: () => randomUUID(),
          lastNo: parsed.meta.lastNo,
          by: options.by
        });
        const text = serializeNotesFile(result.notes, parsed.preamble, {
          workspace: target,
          title: displayTitle || parsed.meta.title,
          lastNo: parsed.meta.lastNo
        });
        await writeAtomic(file, text);
        return {
          note: result.note,
          ...group(target, displayTitle || parsed.meta.title, { notes: result.notes }, file, revisionOf(text, true), true)
        };
      });
    },

    /** 往某张便签末尾追加正文。 */
    append(workspace, no, text, options = {}) {
      const target = String(workspace ?? "").trim();
      return exclusive(fileForWorkspace(dir, target), async () => {
        const { file, current, parsed } = await load(target);
        const now = new Date().toISOString();
        const result = applyAppend(parsed.notes, no, text, { now, by: options.by });
        const next = serializeNotesFile(result.notes, parsed.preamble, {
          workspace: target,
          title: parsed.meta.title,
          lastNo: parsed.meta.lastNo
        });
        await writeAtomic(file, next);
        return {
          note: result.note,
          ...group(target, parsed.meta.title, { notes: result.notes }, file, revisionOf(next, true), true)
        };
      });
    },

    /** 改状态 / 接手人（跨会话交接）。 */
    status(workspace, no, patch, options = {}) {
      const target = String(workspace ?? "").trim();
      return exclusive(fileForWorkspace(dir, target), async () => {
        const { file, parsed } = await load(target);
        const now = new Date().toISOString();
        const result = applyStatus(parsed.notes, no, patch, { now, by: options.by });
        const text = serializeNotesFile(result.notes, parsed.preamble, {
          workspace: target,
          title: options.title || parsed.meta.title,
          lastNo: parsed.meta.lastNo
        });
        await writeAtomic(file, text);
        return {
          note: result.note,
          ...group(target, options.title || parsed.meta.title, { notes: result.notes }, file, revisionOf(text, true), true)
        };
      });
    },

    /** 往公告栏追加一行（没有就建）。 */
    board(workspace, body, options = {}) {
      const target = String(workspace ?? "").trim();
      return exclusive(fileForWorkspace(dir, target), async () => {
        const { file, parsed } = await load(target);
        const now = new Date().toISOString();
        const result = applyBoardPost(parsed.notes, body, {
          now,
          by: options.by,
          newId: () => randomUUID(),
          lastNo: parsed.meta.lastNo
        });
        const text = serializeNotesFile(result.notes, parsed.preamble, {
          workspace: target,
          title: options.title || parsed.meta.title,
          lastNo: parsed.meta.lastNo
        });
        await writeAtomic(file, text);
        return {
          note: result.note,
          created: result.created === true,
          ...group(target, options.title || parsed.meta.title, { notes: result.notes }, file, revisionOf(text, true), true)
        };
      });
    },

    /** 删除某张便签。 */
    remove(workspace, no, baseRev) {
      const target = String(workspace ?? "").trim();
      return exclusive(fileForWorkspace(dir, target), async () => {
        const { file, current, parsed } = await load(target);
        const result = applyRemove(parsed.notes, no, Number.isInteger(baseRev) ? baseRev : null);
        const text = serializeNotesFile(result.notes, parsed.preamble, {
          workspace: target,
          title: parsed.meta.title,
          lastNo: parsed.meta.lastNo
        });
        await writeAtomic(file, text);
        return {
          removed: result.removed,
          ...group(target, parsed.meta.title, { notes: result.notes }, file, revisionOf(text, true), true)
        };
      });
    },

  };
}
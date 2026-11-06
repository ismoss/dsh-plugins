/**
 * dsh-sticky-notes — Host 侧的便签文件存储。
 *
 * 这里只认一个绝对路径：读就是 readFile，写就是「同目录临时文件 + rename」。
 * 所有变更串行执行，因此两个浏览器同时保存时不会把文件写成半截；每个变更都
 * 先重新读文件，所以 AI 或编辑器在外部改过 notes.md 也能被下一次保存接住。
 *
 * 文件不存在不是错误：第一次保存时创建目录和文件。
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  NotesError,
  applyRemove,
  applySave,
  assertFileSize,
  parseNotesFile,
  serializeNotesFile
} from "./notes.js";

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
 * @param {{file: string, displayPath: string}} options
 */
export function createNotesStore(options) {
  const file = options.file;
  const displayPath = options.displayPath;
  let queue = Promise.resolve();

  /** 所有读写排进同一条链；单个请求失败不阻断后面的请求。 */
  function exclusive(work) {
    const run = queue.then(work, work);
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function read() {
    let text = "";
    let exists = true;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        exists = false;
      } else {
        throw ioError(error, file);
      }
    }
    if (exists) assertFileSize(text);
    const parsed = parseNotesFile(text);
    return {
      notes: parsed.notes,
      preamble: parsed.preamble,
      text,
      exists
    };
  }

  async function writeAtomic(text) {
    assertFileSize(text);
    const directory = dirname(file);
    const temporary = join(directory, `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporary, text, "utf8");
      try {
        await rename(temporary, file);
      } catch (error) {
        // Windows 上目标文件被杀毒/索引短暂占住时 rename 会 EPERM/EACCES。
        // 直写不原子，但比“明明保存了却报错”更不容易丢内容。
        if (error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "EEXIST") {
          await writeFile(file, text, "utf8");
          await rm(temporary, { force: true });
        } else {
          throw error;
        }
      }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw ioError(error, file);
    }
  }

  function snapshot(current, text) {
    return {
      notes: current.notes,
      revision: revisionOf(text, current.exists),
      path: file,
      displayPath,
      exists: current.exists,
      loadedAt: Date.now()
    };
  }

  return {
    /** 读取当前文件；不存在时返回空列表而不是报错。 */
    list() {
      return exclusive(async () => {
        const current = await read();
        return snapshot(current, current.text);
      });
    },

    /**
     * 新建或修改。`raw` 就是便签本身；`baseRev` 见 notes.js 的 applySave。
     */
    save(raw) {
      return exclusive(async () => {
        const current = await read();
        const now = new Date().toISOString();
        const { notes, note } = applySave(current.notes, raw, {
          now,
          newId: () => randomUUID()
        });
        const text = serializeNotesFile(notes, current.preamble);
        await writeAtomic(text);
        return {
          note,
          notes,
          revision: revisionOf(text, true),
          path: file,
          displayPath,
          exists: true
        };
      });
    },

    /**
     * 删除。
     *
     * @param {{id: string, baseRev?: number|null}} raw
     */
    remove(raw) {
      return exclusive(async () => {
        const current = await read();
        const id = raw !== null && typeof raw === "object" && typeof raw.id === "string" ? raw.id : "";
        const baseRev = raw !== null && typeof raw === "object" && Number.isInteger(raw.baseRev) ? raw.baseRev : null;
        const { notes, removed } = applyRemove(current.notes, id, baseRev);
        const text = serializeNotesFile(notes, current.preamble);
        await writeAtomic(text);
        return {
          removed,
          notes,
          revision: revisionOf(text, true),
          path: file,
          displayPath,
          exists: true
        };
      });
    }
  };
}
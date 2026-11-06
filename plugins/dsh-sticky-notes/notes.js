/**
 * dsh-sticky-notes — 便签文件的纯逻辑。
 *
 * 这一层不碰文件系统、不 import 任何 dsh 包，只做三件事：
 *
 *   1. 把 `notes.md` 解析成便签数组（容忍人手/AI 直接编辑）；
 *   2. 把便签数组写回同样的 Markdown 形状；
 *   3. 在一组便签上应用「新建 / 修改 / 删除」，带乐观并发校验。
 *
 * 文件格式（`store.js` 负责真正落盘）：
 *
 *   # 便签
 *
 *   <!-- dsh-sticky-notes:v1 -->
 *
 *   ## 买牛奶
 *   <!-- dsh-note: {"id":"…","color":"yellow","pinned":false,…} -->
 *   两盒，周四之前。
 *
 * 约定：每个以 `## ` 开头的行开启一张便签；标题下一行的 HTML 注释保存身份
 * （id / 颜色 / 置顶 / 时间 / rev）。注释可以删——删了就按标题和正文重新
 * 派生一个 `ext-…` id，代价是颜色、置顶和 rev 丢失，正文不会丢。
 */

/** 便签可选颜色；和 client.js 里的 data-color 一一对应。 */
export const NOTE_COLORS = ["yellow", "pink", "blue", "green", "purple", "gray"];
export const DEFAULT_COLOR = "yellow";
export const MAX_TITLE = 200;
export const MAX_BODY = 20000;
export const MAX_NOTES = 200;
/** 整个文件的上限；防止一次轮询把几十 MB 塞进浏览器。 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const HEADING = /^##\s+(.*)$/;
const META_LINE = /^<!--\s*dsh-note:\s*(\{.*\})\s*-->\s*$/;
const NOTE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** 带稳定 code 和 details 的业务错误；Host 半原样映射成 RPC 失败。 */
export class NotesError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "NotesError";
    this.code = code;
    this.details = details;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isoOrEmpty(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  return new Date(time).toISOString();
}

function revOf(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** FNV-1a 32 位；只用来给没有元数据的外部便签派生一个稳定 id。 */
export function hashText(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function externalId(title, body) {
  return `ext-${hashText(`${title}\u0000${body}`)}`;
}

function makeNote(raw) {
  const source = isRecord(raw) ? raw : {};
  const title = typeof source.title === "string" ? source.title.replace(/[\r\n]+/g, " ").trim() : "";
  const body = typeof source.body === "string" ? source.body.replace(/\r\n?/g, "\n").replace(/\s+$/, "") : "";
  return {
    id: typeof source.id === "string" && NOTE_ID.test(source.id) ? source.id : "",
    title: title.slice(0, MAX_TITLE),
    body,
    color: NOTE_COLORS.includes(source.color) ? source.color : DEFAULT_COLOR,
    pinned: source.pinned === true,
    createdAt: isoOrEmpty(source.createdAt),
    updatedAt: isoOrEmpty(source.updatedAt),
    rev: revOf(source.rev)
  };
}

/**
 * 解析一份 notes.md。
 *
 * @param {string} text
 * @returns {{preamble: string, notes: Array<object>}}
 */
export function parseNotesFile(text) {
  const source = typeof text === "string" ? text.replace(/^\uFEFF/, "") : "";
  const lines = source.split(/\r?\n/);
  const firstHeading = lines.findIndex((line) => HEADING.test(line));
  if (firstHeading < 0) {
    return { preamble: source.replace(/\s+$/, ""), notes: [] };
  }

  const preamble = lines.slice(0, firstHeading).join("\n").replace(/\s+$/, "");
  const notes = [];
  const used = new Set();
  let section = null;

  const finish = () => {
    if (section === null) return;
    const bodyLines = section.lines.slice();
    while (bodyLines.length > 0 && bodyLines[0].trim() === "") bodyLines.shift();

    let meta = {};
    if (bodyLines.length > 0) {
      const match = META_LINE.exec(bodyLines[0].trim());
      if (match !== null) {
        let parsed;
        try {
          parsed = JSON.parse(match[1]);
        } catch {
          parsed = undefined;
        }
        if (isRecord(parsed)) {
          meta = parsed;
          bodyLines.shift();
        }
        // JSON 坏了就把这行留在正文里：宁可按普通文字显示，也不悄悄吞掉内容。
      }
    }

    const title = section.title.replace(/\s+$/, "").slice(0, MAX_TITLE);
    const body = bodyLines.join("\n").replace(/\s+$/, "");
    if (title === "" && body === "") {
      section = null;
      return;
    }

    let id = typeof meta.id === "string" && NOTE_ID.test(meta.id) ? meta.id : "";
    if (id === "") id = externalId(title, body);
    if (used.has(id)) id = `${externalId(title, body)}-${used.size}`;
    used.add(id);

    notes.push(
      makeNote({
        id,
        title,
        body,
        color: meta.color,
        pinned: meta.pinned,
        createdAt: meta.created,
        updatedAt: meta.updated,
        rev: meta.rev
      })
    );
    section = null;
  };

  for (let index = firstHeading; index < lines.length; index += 1) {
    const heading = HEADING.exec(lines[index]);
    if (heading !== null) {
      finish();
      section = { title: heading[1], lines: [] };
    } else if (section !== null) {
      section.lines.push(lines[index]);
    }
  }
  finish();

  return { preamble, notes };
}

/** 标题里的换行已经在上游被压平；这里只兜底防止写出不合法的 H2。 */
function titleForFile(title) {
  const text = typeof title === "string" ? title.replace(/[\r\n]+/g, " ").trim() : "";
  return text === "" ? "未命名便签" : text.slice(0, MAX_TITLE);
}

/**
 * 把便签写回 Markdown。`preamble` 原样保留（AI 在文件开头写的说明不会被
 * 下一次保存吃掉）；传空则写默认标题。
 *
 * @param {Array<object>} notes
 * @param {string} [preamble]
 * @returns {string}
 */
export function serializeNotesFile(notes, preamble) {
  const list = Array.isArray(notes) ? notes : [];
  const head =
    typeof preamble === "string" && preamble.trim() !== ""
      ? `${preamble.replace(/\s+$/, "")}\n\n`
      : "# 便签\n\n<!-- dsh-sticky-notes:v1 -->\n\n";

  const blocks = list.map((raw) => {
    const note = makeNote(raw);
    const meta = {
      id: note.id,
      color: note.color,
      pinned: note.pinned,
      created: note.createdAt,
      updated: note.updatedAt,
      rev: note.rev
    };
    const body = note.body === "" ? "" : `${note.body}\n`;
    return `## ${titleForFile(note.title)}\n<!-- dsh-note: ${JSON.stringify(meta)} -->\n${body}`;
  });

  const text = `${head}${blocks.join("\n")}`.replace(/\s+$/, "\n");
  return text;
}

/**
 * 把一次保存请求压成可信字段。空标题/空正文、超长正文都在这里拒绝。
 *
 * @param {unknown} raw
 * @returns {{title: string, body: string, color: string, pinned: boolean}}
 */
export function normalizeNoteInput(raw) {
  const source = isRecord(raw) ? raw : {};
  const title = typeof source.title === "string" ? source.title.replace(/[\r\n]+/g, " ").trim() : "";
  const body = typeof source.body === "string" ? source.body.replace(/\r\n?/g, "\n").replace(/\s+$/, "") : "";

  if (title === "" && body.trim() === "") {
    throw new NotesError("sticky/invalid", "a note needs a title or a body", { field: "title" });
  }
  if (body.length > MAX_BODY) {
    throw new NotesError("sticky/too-large", `note body exceeds ${MAX_BODY} characters`, {
      field: "body",
      limit: MAX_BODY
    });
  }

  return {
    title: title === "" ? "未命名便签" : title.slice(0, MAX_TITLE),
    body,
    color: NOTE_COLORS.includes(source.color) ? source.color : DEFAULT_COLOR,
    pinned: source.pinned === true
  };
}

/**
 * 新建或修改一张便签。
 *
 * `baseRev` 是客户端读取时看到的 rev：传了就必须对得上，否则 `sticky/conflict`
 * 并附上服务端当前副本；不传表示「以这次为准」（冲突对话框里的覆盖保存）。
 *
 * @param {Array<object>} notes
 * @param {object} raw
 * @param {{now: string, newId: () => string}} options
 * @returns {{notes: Array<object>, note: object}}
 */
export function applySave(notes, raw, options) {
  const list = Array.isArray(notes) ? notes : [];
  const source = isRecord(raw) ? raw : {};
  const now = typeof options?.now === "string" ? options.now : new Date().toISOString();
  const newId = typeof options?.newId === "function" ? options.newId : () => `n-${Date.now()}`;
  const input = normalizeNoteInput(source);

  const requestedId = typeof source.id === "string" && source.id !== "" ? source.id : null;
  if (requestedId !== null) {
    const index = list.findIndex((note) => note.id === requestedId);
    if (index < 0) {
      throw new NotesError("sticky/not-found", `note "${requestedId}" does not exist`, { id: requestedId });
    }
    const current = list[index];
    const baseRev = Number.isInteger(source.baseRev) ? source.baseRev : null;
    if (baseRev !== null && baseRev !== current.rev) {
      throw new NotesError("sticky/conflict", "the note changed after this editor read it", { current });
    }
    const note = { ...current, ...input, updatedAt: now, rev: current.rev + 1 };
    const next = list.slice();
    next[index] = note;
    return { notes: next, note };
  }

  if (list.length >= MAX_NOTES) {
    throw new NotesError("sticky/too-large", `at most ${MAX_NOTES} notes are supported`, {
      field: "notes",
      limit: MAX_NOTES
    });
  }

  const note = {
    id: newId(),
    ...input,
    createdAt: now,
    updatedAt: now,
    rev: 1
  };
  // 新的放最上面：便签板里最近写的那张一眼能看到。
  return { notes: [note, ...list], note };
}

/**
 * 删除一张便签。
 *
 * @param {Array<object>} notes
 * @param {string} id
 * @param {number|null} baseRev
 * @returns {{notes: Array<object>, removed: object}}
 */
export function applyRemove(notes, id, baseRev) {
  const list = Array.isArray(notes) ? notes : [];
  const target = typeof id === "string" ? id : "";
  const index = list.findIndex((note) => note.id === target);
  if (index < 0) {
    throw new NotesError("sticky/not-found", `note "${target}" does not exist`, { id: target });
  }
  const removed = list[index];
  if (Number.isInteger(baseRev) && baseRev !== removed.rev) {
    throw new NotesError("sticky/conflict", "the note changed before it was deleted", { current: removed });
  }
  return { notes: list.filter((_, at) => at !== index), removed };
}

/**
 * 展示顺序：置顶的在前，其余保持文件里的顺序（稳定排序）。
 *
 * @param {Array<object>} notes
 * @returns {Array<object>}
 */
export function displayOrder(notes) {
  return (Array.isArray(notes) ? notes : [])
    .map((note, index) => ({ note, index }))
    .sort((left, right) => {
      const pin = (right.note.pinned === true ? 1 : 0) - (left.note.pinned === true ? 1 : 0);
      return pin !== 0 ? pin : left.index - right.index;
    })
    .map((entry) => entry.note);
}

/** 文件字节上限检查；store 写完前调用。 */
export function assertFileSize(text) {
  const bytes = typeof Buffer === "undefined" ? text.length : Buffer.byteLength(text, "utf8");
  if (bytes > MAX_FILE_BYTES) {
    throw new NotesError("sticky/too-large", `notes file exceeds ${MAX_FILE_BYTES} bytes`, {
      field: "file",
      limit: MAX_FILE_BYTES
    });
  }
  return bytes;
}
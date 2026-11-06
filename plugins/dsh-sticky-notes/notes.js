/**
 * dsh-sticky-notes — 便签文件的纯逻辑（不碰文件系统、不 import 任何 dsh 包）。
 *
 * 一个工作区一份 Markdown，便签在文件里自带序号，序号就是人和 AI 互相指代的那把钥匙：
 * 「按 3 号便签执行」读的就是 `## 3. …` 那张。
 *
 * 文件形状：
 *
 *   # 便签
 *
 *   <!-- dsh-sticky-notes:v2 {"workspace":"E:\\path","title":"DeepSeek-test"} -->
 *
 *   ## 1. 买牛奶
 *   <!-- dsh-note: {"no":1,"id":"…","created":"…","updated":"…","rev":1} -->
 *   两盒，周四之前。
 *
 * 约定：
 *   - `## ` 开头的行开启一张便签；`###` 属于正文。
 *   - 标题里的 `N. ` 是序号；标题下一行的 HTML 注释保存身份。注释被删掉也不丢正文，
 *     只是 id/时间/rev 会重新派生。
 *   - 序号一旦分配就不再回收：删掉 3 号，4 号还是 4 号。AI 记下的编号不会指错。
 */

export const MAX_TITLE = 200;
export const MAX_BODY = 40000;
export const MAX_NOTES = 500;
/** 单文件上限；防止一次读取把几十 MB 塞进浏览器或工具结果。 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

const HEADING = /^##\s+(?:(\d+)\.\s+)?(.*)$/;
const META_LINE = /^<!--\s*dsh-note:\s*(\{.*\})\s*-->\s*$/;
const PREAMBLE_META = /^<!--\s*dsh-sticky-notes:v2\s*(\{.*\})\s*-->\s*$/;
const NOTE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** 带稳定 code 和 details 的业务错误；Host 半原样映射成 HTTP / 工具失败。 */
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

function positiveInt(value) {
  return Number.isInteger(value) && value >= 1 ? value : 0;
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

/** 正文压平换行后取前 n 个字符，用于列表预览。 */
export function previewOf(body, max = 140) {
  const text = typeof body === "string" ? body.replace(/\s+/g, " ").trim() : "";
  if (text === "") return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function makeNote(raw) {
  const source = isRecord(raw) ? raw : {};
  const title = typeof source.title === "string" ? source.title.replace(/[\r\n]+/g, " ").trim() : "";
  const body = typeof source.body === "string" ? source.body.replace(/\r\n?/g, "\n").replace(/\s+$/, "") : "";
  return {
    no: positiveInt(source.no),
    id: typeof source.id === "string" && NOTE_ID.test(source.id) ? source.id : "",
    title: Array.from(title).slice(0, MAX_TITLE).join(""),
    body,
    createdAt: isoOrEmpty(source.createdAt),
    updatedAt: isoOrEmpty(source.updatedAt),
    rev: Number.isInteger(source.rev) && source.rev >= 0 ? source.rev : 0
  };
}

/**
 * 把没有序号的便签按文件顺序补上编号：先占住显式写死的号，再从 1 往上补空位。
 * 同一份文件解析多少次结果都一样，AI 拿到的编号不会漂。
 */
function assignNumbers(notes, lastNo = 0) {
  const used = new Set();
  let high = Number.isInteger(lastNo) && lastNo > 0 ? lastNo : 0;

  // 第一遍：认下「不重复的显式编号」。撞号的先放一边，绝不把别人的号往后推。
  const duplicates = [];
  for (const note of notes) {
    if (note.no === 0) continue;
    if (used.has(note.no)) {
      duplicates.push(note);
      continue;
    }
    used.add(note.no);
    if (note.no > high) high = note.no;
  }

  // 第二遍：手写时没编号的，从 1 起补空位——外部文件里第一张就是 1 号，符合直觉。
  let cursor = 1;
  for (const note of notes) {
    if (note.no !== 0 || duplicates.includes(note)) continue;
    while (used.has(cursor)) cursor += 1;
    note.no = cursor;
    used.add(cursor);
    cursor += 1;
  }

  // 第三遍：撞号的那几张给高水位之上的新号，谁也不受影响。
  cursor = high + 1;
  for (const note of duplicates) {
    while (used.has(cursor)) cursor += 1;
    note.no = cursor;
    used.add(cursor);
    high = cursor;
    cursor += 1;
  }
  return notes;
}

/**
 * 解析一份便签文件。
 *
 * @param {string} text
 * @returns {{meta: {workspace: string, title: string}, preamble: string, notes: Array<object>}}
 */
export function parseNotesFile(text) {
  const source = typeof text === "string" ? text.replace(/^\uFEFF/, "") : "";
  const lines = source.split(/\r\n?|\n/);
  const firstHeading = lines.findIndex((line) => HEADING.test(line));
  if (firstHeading < 0) {
    return { meta: { workspace: "", title: "", lastNo: 0 }, preamble: source.replace(/\s+$/, ""), notes: [] };
  }

  const headLines = lines.slice(0, firstHeading);
  const preamble = headLines.join("\n").replace(/\s+$/, "");
  let meta = { workspace: "", title: "", lastNo: 0 };
  for (const line of headLines) {
    const match = PREAMBLE_META.exec(line.trim());
    if (match === null) continue;
    try {
      const parsed = JSON.parse(match[1]);
      if (isRecord(parsed)) {
        meta = {
          workspace: typeof parsed.workspace === "string" ? parsed.workspace : "",
          title: typeof parsed.title === "string" ? parsed.title : "",
          lastNo: Number.isInteger(parsed.lastNo) && parsed.lastNo > 0 ? parsed.lastNo : 0
        };
      }
    } catch {
      /* 元数据坏了不影响便签本身 */
    }
    break;
  }

  const notes = [];
  const usedIds = new Set();
  let section = null;

  const finish = () => {
    if (section === null) return;
    const bodyLines = section.lines.slice();
    while (bodyLines.length > 0 && bodyLines[0].trim() === "") bodyLines.shift();

    let raw = {};
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
          raw = parsed;
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

    const note = makeNote({
      no: positiveInt(section.no) || positiveInt(raw.no),
      id: raw.id,
      title,
      body,
      createdAt: raw.created,
      updatedAt: raw.updated,
      rev: raw.rev
    });
    if (note.id === "") note.id = `ext-${hashText(`${section.no ?? ""}\u0000${title}\u0000${body}`)}`;
    if (usedIds.has(note.id)) note.id = `${note.id}-${usedIds.size}`;
    usedIds.add(note.id);
    notes.push(note);
    section = null;
  };

  for (let index = firstHeading; index < lines.length; index += 1) {
    const heading = HEADING.exec(lines[index]);
    if (heading !== null) {
      finish();
      section = { no: positiveInt(Number(heading[1])), title: heading[2], lines: [] };
    } else if (section !== null) {
      section.lines.push(lines[index]);
    }
  }
  finish();

  return { meta, preamble, notes: assignNumbers(notes, meta.lastNo) };
}

/** 正文里以 `## ` 开头的行会被下一次解析当成新便签；写回时降一级，内容不丢、分隔符不被伪造。 */
function demoteBodyHeadings(body) {
  return String(body ?? "")
    .split("\n")
    .map((line) => (/^##\s/.test(line) ? `#${line}` : line))
    .join("\n");
}

function titleForFile(title) {
  const text = typeof title === "string" ? title.replace(/[\r\n]+/g, " ").trim() : "";
  return text === "" ? "未命名便签" : Array.from(text).slice(0, MAX_TITLE).join("");
}

const DEFAULT_PREAMBLE = "# 便签";

function preambleWithMeta(preamble, meta) {
  const head = typeof preamble === "string" && preamble.trim() !== "" ? preamble.replace(/\s+$/, "") : DEFAULT_PREAMBLE;
  const workspace = typeof meta?.workspace === "string" ? meta.workspace : "";
  const title = typeof meta?.title === "string" ? meta.title : "";
  const lastNo = Number.isInteger(meta?.lastNo) && meta.lastNo > 0 ? meta.lastNo : 0;
  if (workspace === "" && title === "" && lastNo === 0) return head;
  const payload = JSON.stringify({ workspace, title, ...(lastNo > 0 ? { lastNo } : {}) });
  // 前缀里的旧元数据行先摘掉，避免同一份文件里出现两行互相矛盾的记录。
  const kept = head
    .split(/\r?\n/)
    .filter((line) => PREAMBLE_META.exec(line.trim()) === null)
    .join("\n")
    .replace(/\s+$/, "");
  return `${kept === "" ? DEFAULT_PREAMBLE : kept}\n\n<!-- dsh-sticky-notes:v2 ${payload} -->`;
}

/**
 * 写回 Markdown。`preamble` 原样保留（人或 AI 在文件开头写的说明不会被下一次保存吃掉），
 * 只把 v2 元数据行按当前工作区刷新。
 *
 * @param {Array<object>} notes
 * @param {string} [preamble]
 * @param {{workspace?: string, title?: string}} [meta]
 * @returns {string}
 */
export function serializeNotesFile(notes, preamble, meta) {
  const list = (Array.isArray(notes) ? notes : []).slice().sort((left, right) => makeNote(left).no - makeNote(right).no);
  let high = Number.isInteger(meta?.lastNo) && meta.lastNo > 0 ? meta.lastNo : 0;
  for (const raw of list) {
    const no = makeNote(raw).no;
    if (no > high) high = no;
  }
  const head = preambleWithMeta(preamble, { ...(meta ?? {}), lastNo: high });
  const blocks = list.map((raw) => {
    const note = makeNote(raw);
    const payload = {
      no: note.no,
      id: note.id,
      created: note.createdAt,
      updated: note.updatedAt,
      rev: note.rev
    };
    const body = note.body === "" ? "" : `${demoteBodyHeadings(note.body)}\n`;
    return `## ${note.no}. ${titleForFile(note.title)}\n<!-- dsh-note: ${JSON.stringify(payload)} -->\n${body}`;
  });
  return `${head}\n\n${blocks.join("\n")}`.replace(/\s+$/, "\n");
}

/**
 * 把一次写入请求压成可信字段。
 *
 * `partial` 为 true 时（修改已有便签），缺省的字段表示「这次不动它」；
 * 新建便签时两个都缺省就是空便签，直接拒绝。
 *
 * @param {unknown} raw
 * @param {{partial?: boolean}} [options]
 */
export function normalizeInput(raw, options = {}) {
  const source = isRecord(raw) ? raw : {};
  const partial = options.partial === true;
  const hasTitle = typeof source.title === "string";
  const hasBody = typeof source.body === "string";
  const title = hasTitle ? Array.from(source.title.replace(/[\r\n]+/g, " ").trim()).slice(0, MAX_TITLE).join("") : "";
  const body = hasBody ? source.body.replace(/\r\n?/g, "\n").replace(/\s+$/, "") : "";

  if (body.length > MAX_BODY) {
    throw new NotesError("sticky/too-large", `note body exceeds ${MAX_BODY} characters`, {
      field: "body",
      limit: MAX_BODY
    });
  }
  if (!partial && title === "" && body.trim() === "") {
    throw new NotesError("sticky/invalid", "a new note needs a title or a body", { field: "title" });
  }
  if (hasTitle && !hasBody && partial && title === "") {
    throw new NotesError("sticky/invalid", "a note title cannot be emptied while its body stays", {
      field: "title"
    });
  }

  const input = {};
  if (hasTitle) input.title = title;
  if (hasBody) input.body = body;
  return input;
}

/**
 * 下一个编号：取「现有最大号」和「高水位」的较大者 + 1。
 * 高水位写在文件头，所以删掉最大号再新建也不会复用——编号可以被 AI 长期引用。
 */
export function nextNumber(notes, lastNo = 0) {
  let max = Number.isInteger(lastNo) && lastNo > 0 ? lastNo : 0;
  for (const note of Array.isArray(notes) ? notes : []) {
    const no = positiveInt(note?.no);
    if (no > max) max = no;
  }
  return max + 1;
}

function noteByNumber(notes, no) {
  const target = positiveInt(no);
  if (target === 0) {
    throw new NotesError("sticky/invalid", "a note number is required", { field: "no" });
  }
  const index = (Array.isArray(notes) ? notes : []).findIndex((note) => positiveInt(note?.no) === target);
  if (index < 0) {
    throw new NotesError("sticky/not-found", `note #${target} does not exist`, { no: target });
  }
  return index;
}

/**
 * 新建或修改一张便签。
 *
 * `baseRev` 是调用方读取时看到的 rev：传了就必须对得上，否则 `sticky/conflict`
 * 并附上服务端当前副本；不传表示「以这次为准」。
 *
 * @param {Array<object>} notes
 * @param {object} raw
 * @param {{now: string, newId: () => string}} options
 */
export function applySave(notes, raw, options) {
  const list = Array.isArray(notes) ? notes.slice() : [];
  const source = isRecord(raw) ? raw : {};
  const now = typeof options?.now === "string" ? options.now : new Date().toISOString();
  const newId = typeof options?.newId === "function" ? options.newId : () => `n-${Date.now()}`;
  const requested = positiveInt(source.no);

  if (requested !== 0) {
    const index = noteByNumber(list, requested);
    const current = list[index];
    const input = normalizeInput(source, { partial: true });
    // 局部更新里标题传空串多半是「我不改标题」，不是「把标题清成未命名便签」。
    if (input.title === "") delete input.title;
    const baseRev = Number.isInteger(source.baseRev) ? source.baseRev : null;
    if (baseRev !== null && baseRev !== current.rev) {
      throw new NotesError("sticky/conflict", "the note changed after this editor read it", { current });
    }
    const note = { ...current, ...input, updatedAt: now, rev: current.rev + 1 };
    list[index] = note;
    return { notes: assignNumbers(list), note };
  }

  if (list.length >= MAX_NOTES) {
    throw new NotesError("sticky/too-large", `at most ${MAX_NOTES} notes are supported`, {
      field: "notes",
      limit: MAX_NOTES
    });
  }

  const input = normalizeInput(source);
  const note = {
    no: nextNumber(list, options?.lastNo),
    id: newId(),
    title: input.title ?? "",
    body: input.body ?? "",
    createdAt: now,
    updatedAt: now,
    rev: 1
  };
  list.push(note);
  return { notes: assignNumbers(list), note };
}

/**
 * 追加正文（AI 边干活边把结果写进同一张便签用的就是它）。
 *
 * @param {Array<object>} notes
 * @param {number} no
 * @param {string} text
 * @param {{now: string, separator?: string}} options
 */
export function applyAppend(notes, no, text, options) {
  const list = Array.isArray(notes) ? notes.slice() : [];
  const index = noteByNumber(list, no);
  const current = list[index];
  const chunk = typeof text === "string" ? text.replace(/\r\n?/g, "\n").replace(/\s+$/, "") : "";
  if (chunk === "") {
    throw new NotesError("sticky/invalid", "append needs some text", { field: "body" });
  }
  const separator = typeof options?.separator === "string" ? options.separator : "\n\n";
  const body = current.body === "" ? chunk : `${current.body}${separator}${chunk}`;
  if (body.length > MAX_BODY) {
    throw new NotesError("sticky/too-large", `note body exceeds ${MAX_BODY} characters`, {
      field: "body",
      limit: MAX_BODY
    });
  }
  const now = typeof options?.now === "string" ? options.now : new Date().toISOString();
  const note = { ...current, body, updatedAt: now, rev: current.rev + 1 };
  list[index] = note;
  return { notes: list, note };
}

/**
 * 删除一张便签。序号不回收：后面的号保持原样。
 *
 * @param {Array<object>} notes
 * @param {number} no
 * @param {number|null} [baseRev]
 */
export function applyRemove(notes, no, baseRev) {
  const list = Array.isArray(notes) ? notes.slice() : [];
  const index = noteByNumber(list, no);
  const removed = list[index];
  if (Number.isInteger(baseRev) && baseRev !== removed.rev) {
    throw new NotesError("sticky/conflict", "the note changed before it was deleted", { current: removed });
  }
  list.splice(index, 1);
  return { notes: list, removed };
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
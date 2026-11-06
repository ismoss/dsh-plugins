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
/** 编号上界：再大就没有意义，而且 2^53 附近 cursor+=1 会不前进（Host 卡死）。 */
export const MAX_NOTE_NUMBER = 1000000000;
/** 便签状态；`board` 是每个工作区那张「公告栏」便签的 kind。 */
export const NOTE_STATUS = ["open", "doing", "done"];
export const DEFAULT_STATUS = "open";
export const MAX_OWNER = 64;
export const MAX_TOPIC = 80;
export const BOARD_KIND = "board";

/** 单文件上限；防止一次读取把几十 MB 塞进浏览器或工具结果。 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

const HEADING = /^##\s+(?:(\d+)\.(?=\s|$)\s*)?(.*)$/;
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

/** 标题只能是单行： 
 以及 U+2028 / U+2029 一律压成空格。 */
function oneLine(value) {
  return String(value ?? "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .trim();
}

function isoOrEmpty(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  return new Date(time).toISOString();
}

function positiveInt(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_NOTE_NUMBER ? value : 0;
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
  const title = typeof source.title === "string" ? oneLine(source.title) : "";
  const body = typeof source.body === "string" ? source.body.replace(/\r\n?/g, "\n").replace(/\s+$/, "") : "";
  return {
    no: positiveInt(source.no),
    id: typeof source.id === "string" && NOTE_ID.test(source.id) ? source.id : "",
    title: Array.from(title).slice(0, MAX_TITLE).join(""),
    body,
    status: NOTE_STATUS.includes(source.status) ? source.status : DEFAULT_STATUS,
    owner: typeof source.owner === "string" ? oneLine(source.owner).slice(0, MAX_OWNER) : "",
    topic: typeof source.topic === "string" ? oneLine(source.topic).slice(0, MAX_TOPIC) : "",
    updatedBy: typeof source.updatedBy === "string" ? oneLine(source.updatedBy).slice(0, MAX_OWNER) : "",
    kind: source.kind === BOARD_KIND ? BOARD_KIND : "",
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

  // 第二遍：手写时没编号的补号。没有高水位（从没删过号）就从 1 起补空位，符合直觉；
  // 有高水位的文件补到 high+1 之后，绝不捡「已退休」的号。
  const retired = Number.isInteger(lastNo) && lastNo > 0;
  let cursor = retired ? high + 1 : 1;
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

function readPreambleMeta(lines) {
  for (const line of lines) {
    const match = PREAMBLE_META.exec(line.trim());
    if (match === null) continue;
    try {
      const parsed = JSON.parse(match[1]);
      if (isRecord(parsed)) {
        return {
          workspace: typeof parsed.workspace === "string" ? parsed.workspace : "",
          title: typeof parsed.title === "string" ? parsed.title : "",
          lastNo: Number.isInteger(parsed.lastNo) && parsed.lastNo > 0 && parsed.lastNo <= MAX_NOTE_NUMBER ? parsed.lastNo : 0
        };
      }
    } catch {
      /* 元数据坏了不影响便签本身 */
    }
    break;
  }
  return { workspace: "", title: "", lastNo: 0 };
}

/**
 * 解析一份便签文件。
 *
 * @param {string} text
 * @returns {{meta: {workspace: string, title: string, lastNo: number}, preamble: string, notes: Array<object>}}
 */
export function parseNotesFile(text) {
  const source = typeof text === "string" ? text.replace(/^\uFEFF/, "") : "";
  const lines = source.split(/\r\n?|\n/);
  const firstHeading = lines.findIndex((line) => HEADING.test(line));
  if (firstHeading < 0) {
    // 删到最后一张也还有文件头：元数据必须照读，否则 lastNo 丢、分组跟着丢。
    return {
      meta: readPreambleMeta(lines),
      preamble: source.replace(/\s+$/, ""),
      notes: []
    };
  }

  const headLines = lines.slice(0, firstHeading);
  const preamble = headLines.join("\n").replace(/\s+$/, "");
  const meta = readPreambleMeta(headLines);

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

    // 标题按 code point 截断：按 UTF-16 单元切会把 emoji 切成半个代理，写盘就变 U+FFFD。
    const title = Array.from(section.title.replace(/\s+$/, "")).slice(0, MAX_TITLE).join("");
    const body = bodyLines.join("\n").replace(/\s+$/, "");
    const headingNo = positiveInt(section.no);
    if (title === "" && body === "" && headingNo === 0 && positiveInt(raw.no) === 0) {
      // 完全空白、也没编号的分节是文件里的噪声，丢掉。
      section = null;
      return;
    }

    const note = makeNote({
      no: headingNo || positiveInt(raw.no),
      id: raw.id,
      title,
      body,
      status: raw.status,
      owner: raw.owner,
      topic: raw.topic,
      updatedBy: raw.by,
      kind: raw.kind,
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

/** 标题写进文件时的形状：空标题写成空（`## 3.`），由解析侧还原成 ""；不做「未命名便签」的假标题。 */
function titleForFile(title) {
  return typeof title === "string" ? Array.from(oneLine(title)).slice(0, MAX_TITLE).join("") : "";
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
    const payload = { no: note.no, id: note.id, status: note.status };
    if (note.owner !== "") payload.owner = note.owner;
    if (note.topic !== "") payload.topic = note.topic;
    if (note.updatedBy !== "") payload.by = note.updatedBy;
    if (note.kind !== "") payload.kind = note.kind;
    payload.created = note.createdAt;
    payload.updated = note.updatedAt;
    payload.rev = note.rev;
    const body = note.body === "" ? "" : `${demoteBodyHeadings(note.body)}\n`;
    const heading = titleForFile(note.title);
    return `## ${note.no}.${heading === "" ? "" : ` ${heading}`}\n<!-- dsh-note: ${JSON.stringify(payload)} -->\n${body}`;
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
  const title = hasTitle ? Array.from(oneLine(source.title)).slice(0, MAX_TITLE).join("") : "";
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

  const input = {};
  if (hasTitle) input.title = title;
  if (hasBody) input.body = body;
  if (typeof source.status === "string") {
    if (!NOTE_STATUS.includes(source.status)) {
      throw new NotesError("sticky/invalid", `status must be one of ${NOTE_STATUS.join(", ")}`, { field: "status" });
    }
    input.status = source.status;
  }
  if (typeof source.owner === "string") input.owner = oneLine(source.owner).slice(0, MAX_OWNER);
  if (typeof source.topic === "string") input.topic = oneLine(source.topic).slice(0, MAX_TOPIC);
  return input;
}

/**
 * 下一个编号：取「现有最大号」和「高水位」的较大者 + 1。
 * 高水位写在文件头，所以删掉最大号再新建也不会复用——编号可以被 AI 长期引用。
 */
function ownerOf(options) {
  const who = options?.by;
  return typeof who === "string" ? oneLine(who).slice(0, MAX_OWNER) : "";
}

/** baseRev：没传 = 不校验；传了就必须是整数（字符串 "3" 不能当成没传）。 */
function readBaseRev(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value)) {
    throw new NotesError("sticky/invalid", "baseRev must be an integer rev", { field: "baseRev" });
  }
  return value;
}

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
    // 一个字段都没给就是无效更新：别把 rev 顶上去，给别的编辑器制造假冲突。
    if (input.title === undefined && input.body === undefined) {
      throw new NotesError("sticky/invalid", "write needs a title or a body to change", { field: "title" });
    }
    const baseRev = readBaseRev(source.baseRev);
    if (baseRev !== null && baseRev !== current.rev) {
      throw new NotesError("sticky/conflict", "the note changed after this editor read it", { current });
    }
    const note = { ...current, ...input, updatedAt: now, updatedBy: ownerOf(options), rev: current.rev + 1 };
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
    status: input.status ?? DEFAULT_STATUS,
    owner: input.owner ?? "",
    topic: input.topic ?? "",
    updatedBy: ownerOf(options),
    kind: source.kind === BOARD_KIND ? BOARD_KIND : "",
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
  const note = { ...current, body, updatedAt: now, updatedBy: ownerOf(options), rev: current.rev + 1 };
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
  const expected = readBaseRev(baseRev);
  if (expected !== null && expected !== removed.rev) {
    throw new NotesError("sticky/conflict", "the note changed before it was deleted", { current: removed });
  }
  list.splice(index, 1);
  return { notes: list, removed };
}

/**
 * 改一张便签的状态 / 接手人（跨会话交接用的就是它）。
 *
 * @param {Array<object>} notes
 * @param {number} no
 * @param {{status?: string, owner?: string}} patch
 * @param {{now: string, by?: string}} options
 */
export function applyStatus(notes, no, patch, options) {
  const list = Array.isArray(notes) ? notes.slice() : [];
  const index = noteByNumber(list, no);
  const current = list[index];
  const source = isRecord(patch) ? patch : {};
  const next = { ...current, updatedAt: options?.now ?? new Date().toISOString(), updatedBy: ownerOf(options), rev: current.rev + 1 };
  if (source.status !== undefined) {
    if (!NOTE_STATUS.includes(source.status)) {
      throw new NotesError("sticky/invalid", `status must be one of ${NOTE_STATUS.join(", ")}`, { field: "status" });
    }
    next.status = source.status;
  }
  if (typeof source.owner === "string") next.owner = oneLine(source.owner).slice(0, MAX_OWNER);
  list[index] = next;
  return { notes: list, note: next };
}

/** 公告栏最多留多少行，避免它越滚越长。 */
export const BOARD_MAX_LINES = 80;

/**
 * 往「公告栏」便签追加一行；没有就建一张（`kind: "board"`）。
 * 行格式：`- [HH:MM] @会话：内容`——谁、什么时候、做了什么。
 *
 * @param {Array<object>} notes
 * @param {string} text
 * @param {{now: string, by?: string, newId?: () => string, lastNo?: number}} options
 */
export function applyBoardPost(notes, text, options) {
  const list = Array.isArray(notes) ? notes.slice() : [];
  const chunk = String(text ?? "").replace(/\s+$/, "");
  if (chunk.trim() === "") throw new NotesError("sticky/invalid", "the board post is empty", { field: "body" });
  const now = options?.now ?? new Date().toISOString();
  const who = ownerOf(options);
  // 用本地时间：`now` 是 ISO(UTC)，直接切会差 8 小时（Asia/Shanghai）。
  const at = new Date(now);
  const stamp = `[${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}]`;
  const line = `- ${stamp}${who === "" ? "" : ` @${who}`} ${chunk.replace(/\n/g, " ")}`;
  const index = list.findIndex((note) => makeNote(note).kind === BOARD_KIND);

  if (index < 0) {
    const note = {
      no: nextNumber(list, options?.lastNo),
      id: typeof options?.newId === "function" ? options.newId() : "board",
      title: "公告栏",
      body: line,
      status: DEFAULT_STATUS,
      owner: "",
      topic: "",
      updatedBy: who,
      kind: BOARD_KIND,
      createdAt: now,
      updatedAt: now,
      rev: 1
    };
    list.push(note);
    return { notes: list, note, created: true };
  }

  const current = list[index];
  const lines = `${current.body === "" ? "" : `${current.body}\n`}${line}`
    .split("\n")
    .filter((row) => row.trim() !== "");
  const kept = lines.slice(-BOARD_MAX_LINES);
  const note = {
    ...current,
    body: kept.join("\n"),
    updatedBy: who,
    updatedAt: now,
    rev: current.rev + 1
  };
  list[index] = note;
  return { notes: list, note, created: false };
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
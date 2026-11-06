/**
 * dsh-sticky-notes — Host 半。
 *
 * 三件事：
 *   1. 把便签读写出去（一个工作区一份 Markdown，落在 `$DSH_HOME/sticky-notes/`）；
 *   2. 给浏览器开一条 `/api/sticky-notes` 的精确 Fetch 路由（页面与用量栏用它）；
 *   3. 注册 `sticky_notes` 工具，让 AI 能按序号读、写、追加、删——「按 3 号便签执行」
 *      这句话在 AI 那边就是一个 `read`，执行结果再 `append` 回同一张便签。
 *
 * 浏览器 → Host 为什么走 Fetch 路由而不是 Typert Remote：Typert 需要生成器产出的
 * `typert.host.js` / `typert.remote-client.js` 和 zod 运行时，而这仓的约定是
 * 「纯 JS、无构建、无运行时依赖」。这条路由同样挂在 Connection 的 `/api` 共享入口下，
 * 认证与 owner 判定由宿主统一做。
 *
 * 存储位置（按优先级）：
 *   `DSH_STICKY_NOTES_DIR` → 原样使用（支持 `~`）
 *   `$DSH_HOME/sticky-notes` → 默认
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { NotesError, previewOf } from "./notes.js";
import { createWorkspaceStore, workspaceKey } from "./store.js";
import { baseTitle, resolveWorkspace } from "./workspace.js";

const NS = "dsh-sticky-notes";
const ROUTE = "/api/sticky-notes";
const TOOL = "sticky_notes";

function debugLogFile() {
  const home = (process.env.DSH_HOME ?? "").trim();
  return join(home === "" ? join(homedir(), ".dsh") : resolve(expandHome(home)), "sticky-notes-debug.log");
}

function debug(message) {
  try {
    const file = debugLogFile();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* 诊断写入失败不影响插件 */
  }
}

function expandHome(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  return value;
}

function resolveDir() {
  const override = (process.env.DSH_STICKY_NOTES_DIR ?? "").trim();
  if (override !== "") {
    const dir = resolve(expandHome(override));
    return { dir, displayDir: override };
  }
  const home = (process.env.DSH_HOME ?? "").trim();
  if (home !== "") {
    const dir = join(resolve(expandHome(home)), "sticky-notes");
    return { dir, displayDir: "$DSH_HOME/sticky-notes" };
  }
  return { dir: join(homedir(), ".dsh", "sticky-notes"), displayDir: "~/.dsh/sticky-notes" };
}

/** 有 ctx.effect 就交给它管生命周期（禁用插件时撤掉路由/工具），没有就直接注册。 */
function asEffect(context, factory, label) {
  if (context !== null && context !== undefined && typeof context.effect === "function") {
    return context.effect(factory, label);
  }
  return factory();
}

function ok(value) {
  return { ok: true, value };
}

function fail(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** 工具参数里的编号：数字或数字字符串都收，其他一律报错（别把 "3" 当成没传）。 */
function noteNumber(value, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw new NotesError("sticky/invalid", "no is required for this action", { field: "no" });
  }
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(number) || number < 1) {
    throw new NotesError("sticky/invalid", "no must be a positive integer note number", { field: "no" });
  }
  return number;
}

function titleOfPath(path) {
  return baseTitle(path);
}

/**
 * 把 ctx 里需要的服务包成 workspace.js 的依赖，并补上缓存：
 * 一次请求里可能解析好几次工作区，注册表列表是同步投影，重复取没有意义。
 */
function workspaceDeps(ctx) {
  const registry = typeof ctx.get === "function" ? ctx.get("workspaceRegistry") : undefined;
  const sessions = typeof ctx.get === "function" ? ctx.get("sessions") : undefined;
  return {
    list() {
      const raw = typeof registry?.list === "function" ? registry.list() : [];
      return Array.isArray(raw) ? raw : [];
    },
    headerCwd(sessionId) {
      if (sessionId === "") return "";
      const session = typeof sessions?.get === "function" ? sessions.get(sessionId) : undefined;
      return text(session?.header?.cwd);
    },
    resolveByPath(path) {
      return typeof registry?.resolveByPath === "function" ? registry.resolveByPath(path) : Promise.resolve(undefined);
    }
  };
}

/** 解析出会话所属的工作区；拿不到会话时返回空路径，让浏览器用它记住的那个。 */
function workspaceOf(ctx, sessionId, fallbackDir = "") {
  return resolveWorkspace(workspaceDeps(ctx), sessionId, fallbackDir);
}

/** 注册表里某个工作区路径的标题；注册表里没有就用目录名。 */
function titleFor(ctx, path) {
  const target = text(path);
  if (target === "") return "";
  try {
    const registry = typeof ctx.get === "function" ? ctx.get("workspaceRegistry") : undefined;
    const list = typeof registry?.list === "function" ? registry.list() : [];
    for (const workspace of Array.isArray(list) ? list : []) {
      if (workspaceKey(workspace?.path) === workspaceKey(target)) {
        const title = text(workspace?.title);
        if (title !== "") return title;
        break;
      }
    }
  } catch (error) {
    debug(`workspaceRegistry.list failed: ${error?.message ?? String(error)}`);
  }
  return titleOfPath(target);
}

/**
 * POST /api/sticky-notes 的请求体：`{ method, payload }`。
 *
 * 这条路由注册在 Connection 的精确 Fetch 表里，由 `/api` 的共享入口统一做浏览器
 * 认证与 owner 判定；因此这里拿不到 Peer，也不需要再判一次。
 */
async function dispatch(ctx, store, method, payload) {
  const body = isRecord(payload) ? payload : {};
  try {
    const sessionId = text(body.sessionId);

    /** 请求指定了 workspace 就用它；否则按会话解析出它所属的工作区。 */
    async function target() {
      const given = text(body.workspace);
      if (given !== "") {
        let canonical = given;
        try {
          const resolved = await workspaceDeps(ctx).resolveByPath(given);
          if (resolved !== undefined && resolved !== null && typeof resolved.path === "string" && resolved.path !== "") {
            canonical = resolved.path;
          }
        } catch {
          /* 目录不存在就按原样用，写的时候自然会建 */
        }
        return { path: canonical, title: titleFor(ctx, canonical) };
      }
      const workspace = await workspaceOf(ctx, sessionId);
      return { path: workspace.path, title: workspace.title };
    }

    switch (method) {
      case "groups": {
        const workspace = await workspaceOf(ctx, sessionId);
        const groups = [];
        for (const item of await store.groups()) {
          groups.push({
            workspace: item.workspace,
            title: titleFor(ctx, item.workspace) || item.title,
            count: item.count,
            updatedAt: item.updatedAt
          });
        }
        return ok({
          current: workspace.path,
          dir: store.dir,
          workspace: { workspace: workspace.path, title: workspace.title },
          groups
        });
      }
      case "notes": {
        const resolved = await target();
        if (resolved.path === "") return fail("sticky/invalid", "notes needs a workspace", { field: "workspace" });
        const group = await store.list(resolved.path);
        return ok({ ...group, workspace: resolved.path, title: resolved.title || group.title });
      }
      case "save": {
        const resolved = await target();
        if (resolved.path === "") return fail("sticky/invalid", "save needs a workspace", { field: "workspace" });
        const note = isRecord(body.note) ? body.note : body;
        const result = await store.save(resolved.path, note, { title: resolved.title });
        return ok({ ...result, workspace: resolved.path, title: resolved.title || result.title });
      }
      case "append": {
        const resolved = await target();
        if (resolved.path === "") return fail("sticky/invalid", "append needs a workspace", { field: "workspace" });
        const result = await store.append(resolved.path, body.no, body.body);
        return ok({ ...result, workspace: resolved.path, title: resolved.title || result.title });
      }
      case "remove": {
        const resolved = await target();
        if (resolved.path === "") return fail("sticky/invalid", "remove needs a workspace", { field: "workspace" });
        const result = await store.remove(resolved.path, body.no, body.baseRev);
        return ok({ ...result, workspace: resolved.path, title: resolved.title || result.title });
      }
      default:
        return fail("sticky/unknown", `unknown method ${JSON.stringify(method)}`, { method });
    }
  } catch (error) {
    if (error instanceof NotesError) return fail(error.code, error.message, error.details);
    console.error(`[${NS}]`, error);
    return fail("sticky/internal", error?.message ?? String(error), {});
  }
}

async function handleFetch(ctx, store, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(fail("sticky/invalid", "request body must be JSON", { field: "body" }));
  }
  if (!isRecord(body) || typeof body.method !== "string") {
    return Response.json(fail("sticky/invalid", "request needs a method", { field: "method" }));
  }
  return Response.json(await dispatch(ctx, store, body.method, body.payload));
}

/* ------------------------------------------------------------------ *
 * 给 AI 的工具
 * ------------------------------------------------------------------ */

const TOOL_DESCRIPTION = [
  "Read and edit the sticky notes of a workspace. Notes are numbered per workspace and the number is stable:",
  "deleting a note never renumbers the others, so use the numbers returned here.",
  "list returns every note as `#N title`, read returns one note in full, write creates a note (omit no) or",
  "replaces fields of an existing one, append adds text at the end of a note, delete removes one.",
  "Typical use: read the note the user names, do the work it describes, then append the result to the same note.",
  "List is paginated with limit/offset. Inside a note body use ### for subheadings: a line starting with ## is the note separator."
].join(" ");

function toolRender(args, value) {
  const call = isRecord(args) ? args : {};
  const result = isRecord(value) ? value : {};
  if (Array.isArray(result.notes)) {
    const where = [String(result.title ?? ""), String(result.workspace ?? "")].filter(Boolean).join(" · ");
    const total0 = Number.isInteger(result.total) ? result.total : result.notes.length;
    if (result.notes.length === 0 && total0 === 0) return [{ type: "text", text: `no notes in ${where}` }];
    if (result.notes.length === 0) {
      return [{ type: "text", text: `${where} has ${total0} notes, but offset ${result.offset ?? 0} is past the end` }];
    }
    const lines = result.notes.map((note) => {
      const flags = [note.status, note.owner === "" ? "" : `@${note.owner}`, note.topic === "" ? "" : `#${note.topic}`]
        .filter(Boolean)
        .join(" ");
      const head = `#${note.no} ${note.title === "" ? "(untitled)" : note.title}${flags === "" ? "" : ` [${flags}]`}`;
      return [head, note.preview].filter(Boolean).join(" — ");
    });
    const total = Number.isInteger(result.total) ? result.total : result.notes.length;
    const shown = result.notes.length;
    const more = total > shown ? [`… ${shown} of ${total} notes; call list with offset=${(result.offset ?? 0) + shown} for the rest`] : [];
    return [{ type: "text", text: [`notes in ${where}`, ...lines, ...more].join("\n") }];
  }
  if (typeof result.body === "string") {
    return [{ type: "text", text: `#${result.no} ${result.title}\n\n${result.body}` }];
  }
  if (typeof result.no === "number") {
    const verb =
      call.action === "board"
        ? result.created === true
          ? "board created as"
          : "board post added to"
        : call.action === "delete"
          ? "deleted"
          : call.action === "status"
            ? "handed over:"
            : result.created === true
              ? "created"
              : "updated";
    const extra =
      call.action === "status" && typeof result.status === "string"
        ? ` [${result.status}${result.owner === "" || result.owner === undefined ? "" : ` @${result.owner}`}]`
        : "";
    return [{ type: "text", text: `note #${result.no} ${verb}${extra}` }];
  }
  return [{ type: "text", text: JSON.stringify(value) }];
}

function createToolDefinition(ctx, store) {
  const parameters = {
    type: "object",
    additionalProperties: false,
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["list", "read", "write", "append", "status", "board", "delete"],
        description: "What to do. list: notes of the workspace. read: one note in full. write: create a note (no omitted) or change title/body/status/owner/topic of note `no`. append: add body text at the end of note `no`. status: hand a note over — set its status (open/doing/done) and/or owner. board: post one line to the workspace's shared board note. delete: remove note `no`."
      },
      no: {
        type: "integer",
        description: "Note number as shown by list, e.g. 3 for `#3`. Required for read, append and delete; omit for write to create a new note."
      },
      title: {
        type: "string",
        description: "Note title, one line. For write it replaces the title; omit to keep the current one."
      },
      body: {
        type: "string",
        description: "Markdown of the note body. write replaces the body; append adds it at the end with a blank line between; board treats it as one line of news."
      },
      status: {
        type: "string",
        enum: ["open", "doing", "done"],
        description: "Note state. open: not started. doing: someone is on it. done: finished. Set it through write or status."
      },
      owner: {
        type: "string",
        description: "Who should act next, e.g. a session id or a short name. Hand a note over by setting owner together with status=doing."
      },
      topic: {
        type: "string",
        description: "Short issue label used to group notes in one workspace, e.g. TV0004."
      },
      workspace: {
        type: "string",
        description: "Absolute path of another registered DSH workspace. Omit for the calling session's own workspace."
      },
      limit: {
        type: "integer",
        description: "list only: how many notes to return, 1-200. Defaults to 50."
      },
      offset: {
        type: "integer",
        description: "list only: how many notes to skip. Defaults to 0."
      }
    }
  };

  return {
    name: TOOL,
    description: TOOL_DESCRIPTION,
    parameters,
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          workspace: { type: "string" },
          no: { type: "integer" },
          title: { type: "string" },
          body: { type: "string" },
          created: { type: "boolean" },
          notes: { type: "array", items: { type: "object", additionalProperties: true } }
        }
      },
      render: toolRender
    },
    async execute(args, exec) {
      const input = isRecord(args) ? args : {};
      const action = text(input.action);
      const by = typeof exec?.agent?.id === "string" ? exec.agent.id.slice(-8) : "";
      let workspace = text(input.workspace);
      let workspaceTitle = "";
      if (workspace === "") {
        const agent = exec?.agent;
        if (agent === undefined || agent === null) {
          throw new NotesError("sticky/invalid", "sticky_notes needs an agent session", {});
        }
        // 归属工作区，不是会话当前目录：会话中途 cd 到子目录仍然写回它所在的工作区。
        const resolved = await workspaceOf(ctx, agent.id);
        workspace = resolved.path;
        workspaceTitle = resolved.title;
        if (workspace === "") {
          throw new NotesError("sticky/offline", "this session has no workspace directory", {});
        }
      } else {
        // 只认注册过的工作区：防止模型幻觉出一个路径，凭空造出一个空分区。
        if (!isAbsolute(workspace)) {
          throw new NotesError("sticky/invalid", "workspace must be an absolute path", { field: "workspace" });
        }
        const registered = workspaceDeps(ctx)
          .list()
          .find((entry) => workspaceKey(entry?.path) === workspaceKey(workspace));
        if (registered === undefined) {
          throw new NotesError("sticky/not-found", "no DSH workspace has that path", { field: "workspace" });
        }
        workspace = registered.path;
        workspaceTitle = text(registered.title) || titleFor(ctx, workspace);
      }

      switch (action) {
        case "list": {
          const group = await store.list(workspace);
          const limit = Number.isInteger(input.limit) && input.limit > 0 ? Math.min(input.limit, 200) : 50;
          const offset = Number.isInteger(input.offset) && input.offset > 0 ? input.offset : 0;
          const page = group.notes.slice(offset, offset + limit);
          return {
            workspace,
            title: workspaceTitle || group.title,
            total: group.notes.length,
            offset,
            notes: page.map((note) => ({
              no: note.no,
              title: note.title,
              status: note.status,
              owner: note.owner,
              topic: note.topic,
              kind: note.kind,
              chars: note.body.length,
              updatedAt: note.updatedAt,
              updatedBy: note.updatedBy,
              preview: previewOf(note.body, 80)
            }))
          };
        }
        case "read": {
          const group = await store.list(workspace);
          const no = noteNumber(input.no);
          const note = group.notes.find((candidate) => candidate.no === no);
          if (note === undefined) {
            throw new NotesError("sticky/not-found", `note #${String(no)} does not exist`, { no });
          }
          const MAX_READ = 40000;
          const tooLong = note.body.length > MAX_READ;
          return {
            workspace,
            no: note.no,
            title: note.title,
            body: tooLong ? `${note.body.slice(0, MAX_READ)}\n\n… truncated (${note.body.length} chars total)` : note.body,
            updatedAt: note.updatedAt
          };
        }
        case "write": {
          const no = noteNumber(input.no, { required: false });
          const result = await store.save(
            workspace,
            {
              no: no ?? undefined,
              title: typeof input.title === "string" ? input.title : undefined,
              body: typeof input.body === "string" ? input.body : undefined,
              status: typeof input.status === "string" ? input.status : undefined,
              owner: typeof input.owner === "string" ? input.owner : undefined,
              topic: typeof input.topic === "string" ? input.topic : undefined
            },
            { by, title: workspaceTitle }
          );
          return {
            workspace,
            no: result.note.no,
            title: result.note.title,
            created: no === null
          };
        }
        case "append": {
          const no = noteNumber(input.no);
          const result = await store.append(workspace, no, input.body, { by });
          return { workspace, no: result.note.no, title: result.note.title, chars: result.note.body.length };
        }
        case "status": {
          const no = noteNumber(input.no);
          if (typeof input.status !== "string" && typeof input.owner !== "string") {
            throw new NotesError("sticky/invalid", "status needs a status and/or an owner", { field: "status" });
          }
          const result = await store.status(
            workspace,
            no,
            {
              status: typeof input.status === "string" ? input.status : undefined,
              owner: typeof input.owner === "string" ? input.owner : undefined
            },
            { by, title: workspaceTitle }
          );
          return {
            workspace,
            no: result.note.no,
            title: result.note.title,
            status: result.note.status,
            owner: result.note.owner
          };
        }
        case "board": {
          const result = await store.board(workspace, input.body, { by, title: workspaceTitle });
          return {
            workspace,
            no: result.note.no,
            created: result.created === true,
            status: result.note.status
          };
        }
        case "delete": {
          const no = noteNumber(input.no);
          const result = await store.remove(workspace, no, null);
          return { workspace, no: result.removed.no, title: result.removed.title };
        }
        default:
          throw new NotesError("sticky/invalid", `unknown action ${JSON.stringify(action)}`, { field: "action" });
      }
    }
  };
}

/**
 * @param {import("@deepseek-ai/cordis").Context} ctx
 */
export function apply(ctx) {
  const target = resolveDir();
  const store = createWorkspaceStore(target);
  console.info(`[${NS}] notes dir: ${target.dir}`);
  debug(`apply; dir=${target.dir}`);

  if (typeof ctx.inject !== "function") {
    debug("ctx.inject unavailable; host half inactive");
    return;
  }

  ctx.inject(["connection"], (inner) => {
    const connection = inner.connection ?? (typeof inner.get === "function" ? inner.get("connection") : undefined);
    if (connection === undefined || typeof connection.fetch?.register !== "function") {
      console.warn(`[${NS}] Connection exact Fetch routes are unavailable; the notes UI cannot reach the host`);
      debug("connection fetch registry unavailable");
      return;
    }
    try {
      asEffect(inner, () =>
        connection.fetch.register({
          path: ROUTE,
          methods: ["POST"],
          requestBody: "buffered",
          fetch: (request) => handleFetch(ctx, store, request)
        }), "sticky-notes fetch route");
      debug("fetch route registered");
    } catch (error) {
      debug(`fetch route registration failed: ${error?.message ?? String(error)}`);
      throw error;
    }
  });

  ctx.inject(["tools"], (inner) => {
    const tools = inner.tools ?? (typeof inner.get === "function" ? inner.get("tools") : undefined);
    if (tools === undefined || typeof tools.register !== "function") {
      debug("tools service unavailable; sticky notes stay UI-only");
      return;
    }
    try {
      asEffect(inner, () => tools.register(createToolDefinition(ctx, store)), "sticky-notes tool");
      debug("tool registered");
    } catch (error) {
      debug(`tool registration failed: ${error?.message ?? String(error)}`);
      throw error;
    }
  });
}
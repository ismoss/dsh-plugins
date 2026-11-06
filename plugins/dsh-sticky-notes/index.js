/**
 * dsh-sticky-notes — Host 半。
 *
 * 便签不在浏览器里：Host 把 `notes.md` 读写出来，浏览器通过 Connection 的通用
 * RPC 通道 `/dsh-sticky-notes` 调 `list` / `save` / `remove` 三个端点。
 *
 * 为什么不用 Typert Gateway：Typert 的 Remote 需要生成器产出的
 * `typert.host.js` + `typert.remote-client.js`（以及 zod 运行时），而这仓的
 * 约定是「纯 JS、无构建、无运行时依赖」。这里用的是同一条 Connection RPC
 * 传输（同样走浏览器认证与 Host/Origin 栅栏），只是省掉了代码生成。
 *
 * 文件位置（按优先级）：
 *   `DSH_STICKY_NOTES_FILE` → 原样使用（支持 `~` 展开）
 *   `DSH_HOME/sticky-notes.md` → 默认
 */

import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { NotesError } from "./notes.js";
import { createNotesStore } from "./store.js";

const NS = "dsh-sticky-notes";
const ROUTE = "/api/sticky-notes";

function debug(message) {
  try {
    appendFileSync(join(homedir(), ".dsh", "sticky-notes-debug.log"), `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* 诊断写入失败不影响插件 */
  }
}

debug("module loaded");

export const name = NS;

function expandHome(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  return value;
}

function resolveTarget() {
  const override = (process.env.DSH_STICKY_NOTES_FILE ?? "").trim();
  if (override !== "") {
    return { file: resolve(expandHome(override)), displayPath: override };
  }
  const configured = (process.env.DSH_HOME ?? "").trim();
  if (configured !== "") {
    return {
      file: join(resolve(expandHome(configured)), "sticky-notes.md"),
      displayPath: "$DSH_HOME/sticky-notes.md"
    };
  }
  return {
    file: join(homedir(), ".dsh", "sticky-notes.md"),
    displayPath: "~/.dsh/sticky-notes.md"
  };
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

async function dispatch(store, endpoint, payload) {
  try {
    switch (endpoint) {
      case "list":
        return ok(await store.list());
      case "save": {
        const note = isRecord(payload) && isRecord(payload.note) ? payload.note : payload;
        if (!isRecord(note)) return fail("sticky/invalid", "save needs a note object", { field: "note" });
        return ok(await store.save(note));
      }
      case "remove": {
        if (!isRecord(payload)) return fail("sticky/invalid", "remove needs an id", { field: "id" });
        return ok(await store.remove(payload));
      }
      default:
        return fail("sticky/unknown", `unknown endpoint ${JSON.stringify(endpoint)}`, { endpoint });
    }
  } catch (error) {
    if (error instanceof NotesError) {
      return fail(error.code, error.message, error.details);
    }
    console.error(`[${NS}]`, error);
    return fail("sticky/internal", error?.message ?? String(error), {});
  }
}

/**
 * POST /api/sticky-notes 的请求体：`{ method: "list" | "save" | "remove", payload }`。
 *
 * 这条路由注册在 Connection 的精确 Fetch 表里，由 `/api` 的共享入口统一做浏览器
 * 认证与 owner 判定；因此这里拿不到 Peer，也不需要再判一次。
 */
async function handleFetch(store, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(fail("sticky/invalid", "request body must be JSON", { field: "body" }));
  }
  if (!isRecord(body) || typeof body.method !== "string") {
    return Response.json(fail("sticky/invalid", "request needs a method", { field: "method" }));
  }
  return Response.json(await dispatch(store, body.method, body.payload));
}

/**
 * @param {import("@deepseek-ai/cordis").Context} ctx
 */
export function apply(ctx) {
  const target = resolveTarget();
  const store = createNotesStore(target);
  console.info(`[${NS}] notes file: ${target.file}`);
  debug(`apply; file=${target.file}; inject=${typeof ctx.inject}`);

  if (typeof ctx.inject !== "function") return;

  ctx.inject(["connection"], (inner) => {
    const connection = inner.connection ?? (typeof inner.get === "function" ? inner.get("connection") : undefined);
    debug(`inject callback; connection=${connection === undefined ? "undefined" : "yes"}`);
    if (connection === undefined || typeof connection.fetch?.register !== "function") {
      console.warn(`[${NS}] Connection exact Fetch routes are unavailable; sticky notes stay read-only`);
      debug("connection fetch registry unavailable");
      return;
    }
    try {
      connection.fetch.register({
        path: ROUTE,
        methods: ["POST"],
        requestBody: "buffered",
        fetch: (request) => handleFetch(store, request)
      });
      debug("fetch route registered");
    } catch (error) {
      debug(`fetch route registration failed: ${error?.message ?? String(error)}`);
      throw error;
    }
  });
}
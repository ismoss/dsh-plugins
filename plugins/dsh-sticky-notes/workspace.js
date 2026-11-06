/**
 * dsh-sticky-notes — 「这条便签属于哪个工作区」的纯逻辑。
 *
 * 这里最容易搞错的一点：会话的**当前目录**不是工作区。一个会话的 `header.cwd` 在创建时
 * 固定（就是它所属的工作区目录），而会话中途 `cd` 只改 workingDirectory。便签按工作区分区，
 * 所以必须用 header.cwd 去对 DSH 的工作区注册表，不能用当前目录——否则你在会话里 cd 一次，
 * 便签就跑到一个新分区里去了。
 *
 * 解析顺序（前面的赢）：
 *   1. 注册表自己的索引：`workspace.sessionIds` 含这个会话（侧栏分组用的就是它）；
 *   2. header.cwd 与某个工作区路径完全相同；
 *   3. header.cwd 落在某个工作区目录之下，取最长的那个（嵌套工作区取更具体的）；
 *   4. 让调用方用 realpath 归一后再认一次（软链、大小写、8.3 短路径）；
 *   5. 都不是：把 header.cwd 当成一个独立分区（目录没被注册成工作区时）。
 *
 * 依赖全部注入，因此这一层可以脱离 dsh 单测。
 */

/** Windows 路径大小写不敏感、两种分隔符等价。 */
export function normalizePath(path) {
  return String(path ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function insidePath(child, parent) {
  const childKey = normalizePath(child);
  const parentKey = normalizePath(parent);
  if (parentKey === "") return false;
  return childKey === parentKey || childKey.startsWith(`${parentKey}/`);
}

export function baseTitle(path) {
  const text = String(path ?? "").replace(/[\\/]+$/, "");
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts.length === 0 ? String(path ?? "") : parts[parts.length - 1];
}

function workspaceOf(entry) {
  const path = typeof entry?.path === "string" ? entry.path : "";
  const title = typeof entry?.title === "string" ? entry.title : "";
  return { path, title: title === "" ? baseTitle(path) : title };
}

/**
 * @param {{list: () => Array<object>, headerCwd: (sessionId: string) => string, resolveByPath?: (path: string) => Promise<object|undefined>}} deps
 * @param {string} sessionId
 * @param {string} [fallbackDir] 没有会话时用的目录（比如从侧栏直接打开便签页）
 * @returns {Promise<{path: string, title: string, source: string}>}
 */
export async function resolveWorkspace(deps, sessionId, fallbackDir = "") {
  const id = typeof sessionId === "string" ? sessionId.trim() : "";
  let list = [];
  try {
    const raw = typeof deps?.list === "function" ? deps.list() : [];
    list = Array.isArray(raw) ? raw : [];
  } catch {
    list = [];
  }

  if (id !== "") {
    for (const entry of list) {
      const ids = Array.isArray(entry?.sessionIds) ? entry.sessionIds : [];
      if (ids.includes(id)) {
        const workspace = workspaceOf(entry);
        if (workspace.path !== "") return { ...workspace, source: "registry" };
      }
    }
  }

  let headerCwd = "";
  try {
    headerCwd = typeof deps?.headerCwd === "function" ? String(deps.headerCwd(id) ?? "") : "";
  } catch {
    headerCwd = "";
  }
  if (headerCwd.trim() === "") headerCwd = String(fallbackDir ?? "").trim();

  if (headerCwd !== "") {
    const exact = list.find((entry) => normalizePath(entry?.path) === normalizePath(headerCwd));
    if (exact !== undefined) return { ...workspaceOf(exact), source: "header" };

    const containing = list
      .filter((entry) => insidePath(headerCwd, entry?.path))
      .sort((left, right) => String(right.path).length - String(left.path).length)[0];
    if (containing !== undefined) return { ...workspaceOf(containing), source: "prefix" };

    if (typeof deps?.resolveByPath === "function") {
      try {
        const resolved = await deps.resolveByPath(headerCwd);
        if (resolved !== undefined && resolved !== null && typeof resolved.path === "string" && resolved.path !== "") {
          return { ...workspaceOf(resolved), source: "realpath" };
        }
      } catch {
        /* 目录不存在（工作区被删掉）就落到独立分区 */
      }
    }
  }

  return { path: headerCwd, title: baseTitle(headerCwd), source: "directory" };
}
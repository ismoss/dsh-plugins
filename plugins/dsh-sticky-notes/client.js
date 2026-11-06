/**
 * dsh-sticky-notes — 浏览器半。
 *
 * 便签正文不在浏览器里：这里通过 Host 的 `/api/sticky-notes` 读写，Host 把内容落到
 * 「一个工作区一份 Markdown」。localStorage 只存界面偏好（点用量栏便签时的行为）。
 *
 * 三处落点：
 *   1. `conversation.composer.dock` —— 用量栏里的「便签 N」入口；
 *   2. `shell.overlay`            —— 点入口后直接写一张新便签的小卡片；
 *   3. `sidebar.panellist` + `main` —— 侧栏（自动化任务下面）一个「便签」图标，
 *      打开独立的便签页：左边按工作区分组，右边是编号便签与编辑区。
 *
 * 为什么浏览器半知道「当前工作区」：每张会话卡片会把 sessionId 报给 Host，
 * Host 用 workingDirectory 解析出目录，所以在这里写下的便签天然落在当前工作区。
 */

window.__ModuleLoader__.load({
  id: "dsh-sticky-notes",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;

    const NS = "dsh-sticky-notes";
    const ROUTE = "/api/sticky-notes";
    const DOCK_SLOT = "conversation.composer.dock";
    const OVERLAY_SLOT = "shell.overlay";
    const PANEL_SLOT = "main";
    const NAV_SLOT = "sidebar.panellist";
    const CONFIG_SLOT = "plugins.bundle.config";
    const PANEL_ID = "sticky-notes";
    const PREFS_KEY = "dsh-sticky-notes/prefs";

    /* ------------------------------------------------------------------ *
     * 文案
     * ------------------------------------------------------------------ */
    const ZH = {
      "dock.label": "便签",
      "dock.tip": "便签：写一张，或者打开便签页",
      "quick.title": "新便签",
      "quick.workspace": "写入",
      "quick.heading": "标题（可留空）",
      "quick.body": "写点什么…Ctrl+Enter 保存并关闭",
      "quick.save": "保存并关闭",
      "quick.cancel": "取消",
      "quick.saving": "保存中…",
      "quick.empty": "写点内容再保存",
      "quick.failed": "保存失败",
      "quick.noWorkspace": "这个会话还没有工作区目录，先在会话里选一个工作区",
      "page.title": "便签",
      "page.subtitle": "按工作区分组；#号就是交给 AI 时用的编号",
      "page.new": "新建便签",
      "page.refresh": "刷新",
      "page.all": "所有工作区",
      "page.current": "当前工作区",
      "page.workspaces": "工作区",
      "page.noCurrent": "打开一个会话后，这里会显示它的工作区",
      "page.empty": "这个工作区还没有便签",
      "page.emptyHint": "点「新建便签」，或在用量栏点一下「便签」直接写。",
      "page.emptyAll": "还没有任何便签",
      "justNow": "刚刚",
      "page.loading": "正在读取便签…",
      "page.failed": "读取失败",
      "page.retry": "重试",
      "page.untitled": "未命名便签",
      "page.notes": "{n} 张便签",
      "page.copyNo": "点击复制编号，跟 AI 说「按 {n} 号便签执行」",
      "page.close": "收起",
      "page.save": "保存",
      "page.overwrite": "覆盖保存",
      "page.reload": "载入最新",
      "page.conflict": "这张便签在别处被改过；可以载入最新，或直接用当前内容覆盖",
      "page.deleteConflict": "这张便签在别处被改过；再点一次删除就是不管它直接删",
      "page.saveFailed": "保存失败",
      "page.saving": "保存中…",
      "page.saved": "已保存",
      "page.delete": "删除",
      "page.deleteConfirm": "再点一次删除",
      "page.titlePlaceholder": "标题",
      "page.bodyPlaceholder": "正文（Markdown 原文）",
      "page.settings": "设置",
      "set.dock": "用量栏入口",
      "set.dock.desc": "在输入框下面显示「便签」",
      "set.click": "点用量栏「便签」时",
      "set.click.desc": "默认直接新建，也可以直接跳到便签页",
      "set.view": "打开便签页时先看",
      "set.view.desc": "记住你上次在便签页里停在哪一栏",
      "set.view.current": "当前工作区",
      "set.view.all": "所有工作区",
      "set.autoRefresh": "自动刷新",
      "set.autoRefresh.desc": "每 10 秒对一次，AI 追加进便签的内容会自己出现",
      "set.confirmDelete": "删除前确认",
      "set.confirmDelete.desc": "关掉后点「删除」直接删掉，不再问一次",

      "page.click.quick": "直接新建便签",
      "page.click.panelCurrent": "打开便签页（当前工作区）",
      "page.click.panelAll": "打开便签页（所有工作区）",
      "page.dir": "存储目录",
      "page.toolsHint": "AI 用 sticky_notes 工具按编号读写这些便签。",
      "config.title": "便签",
      "config.desc": "一个工作区一份 Markdown，AI 也能直接读写。",
      "config.where": "存储目录",
      "config.count": "便签数",
      "config.tool": "给 AI 的工具",
      "config.toolValue": "sticky_notes（list / read / write / append / delete）"
    };
    const EN = {
      "dock.label": "Notes",
      "dock.tip": "Sticky notes: write one, or open the notes page",
      "quick.title": "New note",
      "quick.workspace": "Saving to",
      "quick.heading": "Title (optional)",
      "quick.body": "Write something… Ctrl+Enter saves and closes",
      "quick.save": "Save and close",
      "quick.cancel": "Cancel",
      "quick.saving": "Saving…",
      "quick.empty": "Write something first",
      "quick.failed": "Save failed",
      "quick.noWorkspace": "This session has no workspace directory yet",
      "page.title": "Notes",
      "page.subtitle": "Grouped by workspace; the # number is what you give the agent",
      "page.new": "New note",
      "page.refresh": "Refresh",
      "page.all": "All workspaces",
      "page.current": "Current workspace",
      "page.workspaces": "Workspaces",
      "page.noCurrent": "Open a session and its workspace appears here",
      "page.empty": "No notes in this workspace yet",
      "page.emptyHint": "Use “New note”, or click Notes in the composer dock.",
      "page.emptyAll": "No notes anywhere yet",
      "justNow": "just now",
      "page.loading": "Loading notes…",
      "page.failed": "Could not load notes",
      "page.retry": "Retry",
      "page.untitled": "Untitled note",
      "page.notes": "{n} notes",
      "page.number": "Number",
      "page.copyNo": "Copy the number, then ask the agent to act on note {n}",
      "page.copied": "Number copied",
      "page.edit": "Edit",
      "page.close": "Close",
      "page.save": "Save",
      "page.overwrite": "Overwrite",
      "page.reload": "Load latest",
      "page.conflict": "This note changed elsewhere; load the latest version or overwrite it with what you have",
      "page.deleteConflict": "This note changed elsewhere; click delete again to remove it anyway",
      "page.saveFailed": "Could not save",
      "page.saving": "Saving…",
      "page.saved": "Saved",
      "page.delete": "Delete",
      "page.deleteConfirm": "Click again to delete",
      "page.titlePlaceholder": "Title",
      "page.bodyPlaceholder": "Body (Markdown source)",
      "page.updated": "updated {when}",
      "page.newLabel": "New note",
      "page.writing": "Writing to: {where}",
      "page.settings": "Settings",
      "set.dock": "Composer dock chip",
      "set.dock.desc": "Show Sticky notes under the composer",
      "set.click": "Clicking the dock chip",
      "set.click.desc": "Write a note right away, or jump to the notes panel",
      "set.view": "Opening the notes panel",
      "set.view.desc": "Remember which grouping you looked at last",
      "set.view.current": "Current workspace",
      "set.view.all": "All workspaces",
      "set.autoRefresh": "Auto refresh",
      "set.autoRefresh.desc": "Poll every 10s so notes the agent appends show up",
      "set.confirmDelete": "Confirm before delete",
      "set.confirmDelete.desc": "When off, Delete removes the note immediately",

      "page.click.quick": "Write a new note",
      "page.click.panelCurrent": "Open the notes page (current workspace)",
      "page.click.panelAll": "Open the notes page (all workspaces)",
      "page.dir": "Storage directory",
      "page.toolsHint": "The agent reads and writes these notes through the sticky_notes tool.",
      "config.title": "Sticky notes",
      "config.desc": "One Markdown file per workspace; the agent can read and write it too.",
      "config.where": "Storage directory",
      "config.count": "Notes",
      "config.tool": "Agent tool",
      "config.toolValue": "sticky_notes (list / read / write / append / delete)"
    };

    let localeFace;

    function t(key, vars) {
      const dict = /^zh/i.test(currentLocale()) ? ZH : EN;
      let value = dict[key] ?? ZH[key] ?? key;
      if (vars !== undefined && vars !== null) {
        for (const name of Object.keys(vars)) value = value.split(`{${name}}`).join(String(vars[name]));
      }
      return value;
    }

    function currentLocale() {
      try {
        const snapshot = localeFace?.getLocale?.();
        const id = typeof snapshot === "string" ? snapshot : snapshot?.id ?? snapshot?.locale;
        if (typeof id === "string" && id !== "") return id;
      } catch {
        /* 读不到就用浏览器语言 */
      }
      return typeof navigator !== "undefined" ? navigator.language ?? "en" : "en";
    }

    /** locale 切换后重渲染一次：翻译函数在调用时读当前语言，但需要有人叫醒组件。 */
    function useLocaleWakeup() {
      const [, bump] = React.useState(0);
      React.useEffect(() => {
        if (localeFace === undefined) return undefined;
        return localeFace.subscribe(() => bump((count) => count + 1));
      }, []);
      return undefined;
    }

    /* ------------------------------------------------------------------ *
     * 界面偏好：只存 localStorage
     * ------------------------------------------------------------------ */
    function isRecord(value) {
      return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    const CLICK_MODES = ["quick", "panel-current", "panel-all"];

    function normalizePrefs(raw) {
      const source = isRecord(raw) ? raw : {};
      return {
        // 用量栏里那个「便签」入口要不要出现
        dock: source.dock !== false,
        click: CLICK_MODES.includes(source.click) ? source.click : "quick",
        // 打开便签页时先看哪一栏
        defaultView: source.defaultView === "all" ? "all" : "current",
        // 每 10 秒对一次，AI 追加的内容会自己出现
        autoRefresh: source.autoRefresh !== false,
        // 删除便签要不要点两下
        confirmDelete: source.confirmDelete !== false,
        lastWorkspace: typeof source.lastWorkspace === "string" ? source.lastWorkspace : ""
      };
    }

    function readPrefs() {
      try {
        const text = window.localStorage.getItem(PREFS_KEY);
        return text === null ? normalizePrefs(null) : normalizePrefs(JSON.parse(text));
      } catch (error) {
        console.warn(`[${NS}] cannot read prefs, using defaults:`, error);
        return normalizePrefs(null);
      }
    }

    let prefs = readPrefs();
    const prefListeners = new Set();

    function writePrefs(patch) {
      prefs = normalizePrefs({ ...prefs, ...patch });
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch (error) {
        console.warn(`[${NS}] cannot persist prefs (still applies this session):`, error);
      }
      for (const listener of prefListeners) {
        try {
          listener(prefs);
        } catch (error) {
          console.warn(`[${NS}] pref listener failed:`, error);
        }
      }
    }

    function usePrefs() {
      const [snapshot, setSnapshot] = React.useState(prefs);
      React.useEffect(() => {
        setSnapshot(prefs);
        prefListeners.add(setSnapshot);
        return () => prefListeners.delete(setSnapshot);
      }, []);
      return snapshot;
    }

    /* ------------------------------------------------------------------ *
     * 与 Host 的通道
     * ------------------------------------------------------------------ */
    class NotesClientError extends Error {
      constructor(code, message, details) {
        super(message);
        this.name = "NotesClientError";
        this.code = code;
        this.details = isRecord(details) ? details : {};
      }
    }

    function toClientError(error) {
      if (error instanceof NotesClientError) return { code: error.code, message: error.message, details: error.details };
      return {
        code: typeof error?.code === "string" ? error.code : "sticky/network",
        message: error?.message ?? String(error),
        details: {}
      };
    }

    async function call(method, payload) {
      let response;
      try {
        const options = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method, payload: payload ?? {} })
        };
        if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
          options.signal = AbortSignal.timeout(15000);
        }
        response = await globalThis.fetch(ROUTE, options);
      } catch (error) {
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
        throw new NotesClientError(
          "sticky/network",
          timedOut ? "the host did not answer within 15s" : (error?.message ?? String(error))
        );
      }
      if (response === null || typeof response !== "object") {
        throw new NotesClientError("sticky/protocol", "the host returned no response");
      }
      if (response.status === 401 || response.status === 403) {
        throw new NotesClientError("sticky/forbidden", "the host rejected this browser as not the owner");
      }
      if (response.ok !== true) {
        throw new NotesClientError("sticky/network", `the host answered HTTP ${String(response.status)}`, {
          status: response.status
        });
      }
      let result;
      try {
        result = await response.json();
      } catch (error) {
        throw new NotesClientError("sticky/protocol", error?.message ?? "the host answered non-JSON");
      }
      if (!isRecord(result)) throw new NotesClientError("sticky/protocol", "the host returned no envelope");
      if (result.ok === true) return result.value;
      const failure = isRecord(result.error) ? result.error : {};
      throw new NotesClientError(
        typeof failure.code === "string" ? failure.code : "sticky/unknown",
        typeof failure.message === "string" ? failure.message : "",
        failure.details
      );
    }

    /* ------------------------------------------------------------------ *
     * 数据：模块级单一真相 + 订阅
     * ------------------------------------------------------------------ */
    let state = {
      status: "idle", // idle | loading | ready | error
      dir: "",
      sessionId: "",
      current: "",
      currentLive: false,
      currentTitle: "",
      groups: [], // [{ workspace, title, count, updatedAt }]
      selected: "", // "" = 未选；"*" = 所有工作区
      group: null, // { workspace, title, notes: [] }
      all: {}, // workspace -> group（“所有工作区”视图）
      error: null,
      editing: false
    };
    const listeners = new Set();
    const pendingGroups = new Map();

    function publish(patch) {
      state = { ...state, ...patch };
      for (const listener of listeners) {
        try {
          listener(state);
        } catch (error) {
          console.warn(`[${NS}] listener failed:`, error);
        }
      }
    }

    function useStore() {
      const [snapshot, setSnapshot] = React.useState(state);
      React.useEffect(() => {
        setSnapshot(state);
        listeners.add(setSnapshot);
        return () => listeners.delete(setSnapshot);
      }, []);
      return snapshot;
    }

    function upsertGroup(group) {
      if (!isRecord(group) || typeof group.workspace !== "string") return;
      const notes = Array.isArray(group.notes) ? group.notes : [];
      const entry = {
        workspace: group.workspace,
        title: typeof group.title === "string" ? group.title : "",
        count: notes.length,
        updatedAt: notes.reduce((latest, note) => (note.updatedAt > latest ? note.updatedAt : latest), "")
      };
      const groups = state.groups.filter((item) => item.workspace !== group.workspace).concat(entry);
      groups.sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) return String(right.updatedAt).localeCompare(String(left.updatedAt));
        return String(left.workspace).localeCompare(String(right.workspace));
      });
      const patch = { groups, status: "ready", error: null };
      if (state.selected === group.workspace) patch.group = { ...group, notes };
      if (state.selected === "*") patch.all = { ...state.all, [group.workspace]: { ...group, notes } };
      publish(patch);
    }

    async function refreshGroups(sessionId) {
      const wanted = typeof sessionId === "string" && sessionId !== "" ? sessionId : state.sessionId;
      const slot = wanted === "" ? "-" : wanted;
      const running = pendingGroups.get(slot);
      if (running !== undefined) return running;
      const before = state.status;
      if (before !== "ready") publish({ status: "loading" });
      const job = (async () => {
        try {
          const data = await call("groups", { sessionId: wanted });
          const groups = Array.isArray(data?.groups) ? data.groups : [];
          const resolved = typeof data?.current === "string" ? data.current : "";
          // 宿主没有会话可问（比如从侧栏直接打开便签页）时，用这个浏览器记住的最后一个工作区。
          const remembered = state.current !== "" ? state.current : prefs.lastWorkspace;
          const current = resolved !== "" ? resolved : remembered;
          const currentLive = resolved !== "";
          const known = groups.find((item) => item.workspace === current);
          const currentTitle = resolved !== "" && isRecord(data?.workspace) && typeof data.workspace.title === "string"
            ? data.workspace.title
            : known?.title ?? (current === state.current ? state.currentTitle : "");
          let selected = state.selected;
          if (selected === "" && current !== "") selected = current;
          if (selected === "" && groups.length > 0) selected = groups[0].workspace;
          publish({
            status: "ready",
            dir: typeof data?.dir === "string" ? data.dir : "",
            current,
            currentLive,
            currentTitle,
            groups,
            selected,
            error: null
          });
          if (current !== "") writePrefs({ lastWorkspace: current });
          // 正在编辑时不要用服务端内容回灌，否则会把草稿换掉。
          if (selected !== "" && selected !== "*" && !state.editing) await loadNotes(selected);
        } catch (error) {
          publish({ status: "error", error: toClientError(error) });
        } finally {
          pendingGroups.delete(slot);
        }
      })();
      pendingGroups.set(slot, job);
      return job;
    }

    let notesToken = 0;

    async function loadNotes(workspace) {
      const token = (notesToken += 1);
      try {
        const group = await call("notes", { workspace });
        // 只有最后一次请求的回包算数：快速点 A→B 时，A 的慢回包不能把界面拨回去。
        if (token !== notesToken) return group;
        if (state.selected === "*") {
          publish({ all: { ...state.all, [workspace]: group } });
        } else {
          publish({ group, selected: workspace, error: null });
        }
        return group;
      } catch (error) {
        if (token === notesToken) publish({ status: "error", error: toClientError(error) });
        return null;
      }
    }

    async function loadAll() {
      publish({ selected: "*", status: state.status === "ready" ? "ready" : "loading" });
      const groups = state.groups;
      for (const item of groups) {
        if (!isRecord(state.all[item.workspace])) {
          await loadNotes(item.workspace);
        }
      }
      publish({ status: "ready" });
    }

    async function saveNote(workspace, note) {
      const group = await call("save", { workspace, note });
      upsertGroup(group);
      return group;
    }

    async function removeNote(workspace, no, baseRev) {
      const group = await call("remove", { workspace, no, baseRev });
      upsertGroup(group);
      return group;
    }

    /* ------------------------------------------------------------------ *
     * 小工具
     * ------------------------------------------------------------------ */
    function previewOf(body, max) {
      const text = typeof body === "string" ? body.replace(/\s+/g, " ").trim() : "";
      const limit = Number.isFinite(max) && max > 0 ? max : 120;
      if (text === "") return "";
      return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
    }

    function timeAgo(iso) {
      const time = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
      if (Number.isNaN(time)) return "";
      const diff = Math.max(0, Date.now() - time);
      const minutes = Math.floor(diff / 60000);
      if (minutes < 1) return t("justNow");
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h`;
      const days = Math.floor(hours / 24);
      if (days < 30) return `${days}d`;
      return new Date(time).toISOString().slice(0, 10);
    }

    function shortPath(path) {
      const text = String(path ?? "");
      const parts = text.split(/[\\/]+/).filter(Boolean);
      if (parts.length <= 2) return text;
      return `…${parts.slice(-2).join("\\")}`;
    }

    function openPanel(view) {
      try {
        const layout = typeof ctxRef === "object" && ctxRef !== null ? ctxRef.get?.("layout") : undefined;
        layout?.selectPanel?.(PANEL_ID);
      } catch (error) {
        console.warn(`[${NS}] cannot open the notes panel:`, error);
      }
      if (view === "all") {
        void loadAll();
      } else if (view === "current" && state.current !== "") {
        void loadNotes(state.current);
      }
    }

    let ctxRef = null;
    let quickOpen = false;
    const quickListeners = new Set();

    function setQuickOpen(next) {
      quickOpen = next === true;
      for (const listener of quickListeners) {
        try {
          listener(quickOpen);
        } catch (error) {
          console.warn(`[${NS}] quick listener failed:`, error);
        }
      }
    }

    function useQuickOpen() {
      const [value, setValue] = React.useState(quickOpen);
      React.useEffect(() => {
        setValue(quickOpen);
        quickListeners.add(setValue);
        return () => quickListeners.delete(setValue);
      }, []);
      return value;
    }

    /* ------------------------------------------------------------------ *
     * 样式
     * ------------------------------------------------------------------ */
    const CSS = `
.dsh-notes-dock{
  appearance:none;display:inline-flex;align-items:center;gap:5px;min-width:0;
  padding:0;border:0;border-radius:6px;background:transparent;
  font:inherit;font-size:12px;line-height:18px;white-space:nowrap;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.92));
  cursor:pointer;user-select:none;
}
.dsh-notes-dock:hover{color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-notes-dock:active{opacity:.7}
.dsh-notes-dock:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
.dsh-notes-quick{
  position:fixed;right:24px;bottom:132px;z-index:940;box-sizing:border-box;
  width:min(420px,calc(100vw - 32px));max-height:min(480px,calc(100vh - 160px));
  display:flex;flex-direction:column;
  border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
  background:var(--dsw-alias-bg-overlay,Canvas);
  box-shadow:0 16px 44px rgba(0,0,0,.22);
  color:var(--dsw-alias-label-primary,CanvasText);
  overflow:hidden;
}
.dsh-notes-quick-head{display:flex;align-items:center;gap:8px;padding:10px 12px 8px}
.dsh-notes-quick-title{font-size:13px;line-height:18px;font-weight:600;flex:1;min-width:0}
.dsh-notes-quick-where{
  padding:0 12px 8px;font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-notes-quick-body{display:flex;flex-direction:column;gap:8px;padding:0 12px 10px;min-height:0}
.dsh-notes-quick-foot{
  display:flex;align-items:center;gap:8px;justify-content:flex-end;
  padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));
}
.dsh-notes-status{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));margin-right:auto}
.dsh-notes-status[data-kind="error"]{color:#e5484d}

.dsh-notes-input,.dsh-notes-textarea{
  appearance:none;box-sizing:border-box;width:100%;font:inherit;
  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.38));
  border-radius:8px;background:transparent;
  color:var(--dsw-alias-label-primary,CanvasText);padding:6px 8px;
}
.dsh-notes-input{font-size:13px;line-height:20px;font-weight:600}
.dsh-notes-textarea{font-size:12px;line-height:19px;min-height:120px;resize:vertical;font-family:inherit}
.dsh-notes-input:hover,.dsh-notes-textarea:hover{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.42))}
.dsh-notes-input:focus-visible,.dsh-notes-textarea:focus-visible{
  outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px;border-color:transparent;
}
.dsh-notes-btn{
  appearance:none;flex:none;padding:4px 12px;border-radius:7px;border:1px solid transparent;
  background:var(--dsw-alias-brand-primary,#5686fe);color:#fff;
  font:inherit;font-size:12px;line-height:18px;cursor:pointer;
}
.dsh-notes-btn:hover{filter:brightness(1.06)}
.dsh-notes-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
.dsh-notes-btn:disabled{opacity:.55;cursor:default;filter:none}
.dsh-notes-btn[data-kind="ghost"]{
  background:transparent;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));
  border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.4));
}
.dsh-notes-btn[data-kind="ghost"]:hover{color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-notes-btn[data-kind="danger"]{background:transparent;color:#e5484d;border-color:rgba(229,72,77,.45)}
.dsh-notes-btn[data-kind="danger"][data-confirm="true"]{background:#e5484d;color:#fff}

.dsh-notes-page{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-notes-page-head{
  flex:none;display:flex;align-items:center;gap:10px;
  padding:16px 20px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));
}
.dsh-notes-page-titles{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.dsh-notes-page-title{font-size:16px;line-height:22px;font-weight:600}
.dsh-notes-page-sub{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}
.dsh-notes-page-body{flex:1;display:flex;min-height:0}
.dsh-notes-rail{
  flex:none;width:252px;box-sizing:border-box;display:flex;flex-direction:column;gap:2px;
  padding:10px 8px;overflow:auto;border-right:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));
}
.dsh-notes-rail-label{
  padding:8px 10px 4px;font-size:11px;line-height:16px;font-weight:600;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));text-transform:none;
}
.dsh-notes-rail-item{
  appearance:none;display:flex;align-items:center;gap:7px;width:100%;box-sizing:border-box;
  padding:6px 10px;border:0;border-radius:8px;background:transparent;text-align:left;
  font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.95));
  cursor:pointer;min-width:0;
}
.dsh-notes-rail-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
.dsh-notes-rail-item[data-on="true"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-notes-choice[data-on="true"] .dsh-notes-rail-name::before{content:"✓ ";color:var(--dsw-alias-brand-primary,#5686fe)}
.dsh-notes-choice .dsh-notes-rail-name::before{content:"· ";color:transparent}
.dsh-notes-rail-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:-2px}
.dsh-notes-rail-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-notes-rail-count{flex:none;font-size:11px;color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.8));font-variant-numeric:tabular-nums}
.dsh-notes-rail-foot{margin-top:auto;padding:8px 6px 2px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14))}

.dsh-notes-content{flex:1;min-width:0;display:flex;flex-direction:column;overflow:auto;padding:14px 20px 28px;gap:10px}
.dsh-notes-group-head{display:flex;align-items:baseline;gap:8px;padding:10px 2px 4px}
.dsh-notes-group-title{font-size:13px;line-height:18px;font-weight:600}
.dsh-notes-group-path{font-size:11px;line-height:16px;color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.8));font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.dsh-notes-card{
  display:flex;flex-direction:column;gap:4px;box-sizing:border-box;
  padding:9px 12px;border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));
  background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));
}
.dsh-notes-card[data-open="true"]{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.42))}
.dsh-notes-card-main{
  appearance:none;display:flex;align-items:flex-start;gap:8px;width:100%;box-sizing:border-box;
  padding:0;border:0;background:transparent;text-align:left;color:inherit;font:inherit;cursor:pointer;
}
.dsh-notes-card-main:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px;border-radius:6px}
.dsh-notes-no{
  flex:none;min-width:26px;padding:0 5px;border-radius:6px;
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));
  font-size:11px;line-height:17px;text-align:center;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.95));
}
.dsh-notes-card-text{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.dsh-notes-card-title{font-size:13px;line-height:19px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-notes-card-preview{
  font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.92));
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;
}
.dsh-notes-card-meta{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.78));font-variant-numeric:tabular-nums}
.dsh-notes-editor{display:flex;flex-direction:column;gap:8px;padding-top:4px}
.dsh-notes-editor-foot{display:flex;align-items:center;gap:8px}
.dsh-notes-editor-foot .dsh-notes-status{margin-right:auto}

.dsh-notes-empty{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  flex:1;padding:40px 20px;text-align:center;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));
}
.dsh-notes-empty-title{font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.95))}
.dsh-notes-empty-desc{font-size:12px;line-height:18px;max-width:320px}
.dsh-notes-error{
  display:flex;align-items:center;gap:10px;margin:10px 20px;padding:9px 12px;border-radius:9px;
  border:1px solid rgba(229,72,77,.38);font-size:12px;line-height:17px;color:#e5484d;
}
.dsh-notes-banner{display:flex;align-items:center;gap:8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.8))}

.dsh-notes-config{margin:4px 0;padding:14px 16px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));background:var(--dsw-alias-bg-layer-1,transparent)}
.dsh-notes-config-head{display:flex;flex-direction:column;gap:3px;margin-bottom:10px}
.dsh-notes-config-title{font-size:14px;line-height:20px;font-weight:600}
.dsh-notes-config-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}
.dsh-notes-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16))}
.dsh-notes-row:first-of-type{border-top:0}
.dsh-notes-row-key{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.92))}
.dsh-notes-row-value{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));max-width:62%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}

/* 设置面板：插件页与便签页共用 */
.dsh-notes-settings{display:flex;flex-direction:column;gap:0}
.dsh-notes-settings.is-compact{gap:0}
.dsh-notes-set-row{
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));
}
.dsh-notes-settings.is-compact .dsh-notes-set-row{padding:7px 0}
.dsh-notes-settings.is-compact .dsh-notes-set-row{flex-direction:column;align-items:flex-start;gap:6px}
.dsh-notes-settings.is-compact .dsh-notes-set-control{max-width:100%}
.dsh-notes-settings.is-compact .dsh-notes-pills{justify-content:flex-start}
.dsh-notes-set-row:first-child{border-top:0}
.dsh-notes-set-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-notes-set-title{font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-notes-set-desc{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}
.dsh-notes-set-control{flex:none;display:flex;align-items:center;gap:6px;max-width:62%}
.dsh-notes-switch{
  appearance:none;position:relative;flex:none;width:32px;height:18px;padding:0;border:0;border-radius:999px;
  background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.32));cursor:pointer;transition:background .15s ease;
}
.dsh-notes-switch[data-on="true"]{background:var(--dsw-alias-brand-primary,#5686fe)}
.dsh-notes-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
.dsh-notes-switch-knob{
  position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
  background:#fff;transition:transform .15s ease;box-shadow:0 1px 2px rgba(0,0,0,.25);
}
.dsh-notes-switch[data-on="true"] .dsh-notes-switch-knob{transform:translateX(14px)}
.dsh-notes-pills{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end}
.dsh-notes-pill{
  appearance:none;padding:3px 9px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));
  background:transparent;font:inherit;font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.92));cursor:pointer;white-space:nowrap;
}
.dsh-notes-pill:hover{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.45));color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-notes-pill[data-on="true"]{
  border-color:transparent;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.18));
  color:var(--dsw-alias-label-primary,CanvasText);font-weight:600;
}
.dsh-notes-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
`;

    /* ------------------------------------------------------------------ *
     * 图标
     * ------------------------------------------------------------------ */
    function NoteIcon({ size }) {
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 16 16",
          "aria-hidden": "true",
          focusable: "false",
          style: { display: "block" }
        },
        h("path", {
          d: "M3.1 2.6h6.2l3.6 3.6v7.2H3.1z",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.3,
          strokeLinejoin: "round"
        }),
        h("path", { d: "M9.2 2.7v3.5h3.5", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinejoin: "round" }),
        h("path", { d: "M5.1 8.1h5.6M5.1 10.6h3.6", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" })
      );
    }

    function PlusIcon({ size }) {
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" },
        h("path", { d: "M8 3.2v9.6M3.2 8h9.6", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" })
      );
    }

    function RefreshIcon({ size }) {
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" },
        h("path", {
          d: "M13 8a5 5 0 1 1-1.5-3.6M13 2.8v3.1h-3.1",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.5,
          strokeLinecap: "round",
          strokeLinejoin: "round"
        })
      );
    }

    function CloseIcon({ size }) {
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" },
        h("path", { d: "M4 4l8 8M12 4l-8 8", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" })
      );
    }

    /* ------------------------------------------------------------------ *
     * 座位 1：用量栏入口
     * ------------------------------------------------------------------ */
    function NotesDock(props) {
      useLocaleWakeup();
      const currentPrefs = usePrefs();
      const sessionId = typeof props?.sessionId === "string" ? props.sessionId : "";
      const visible = currentPrefs.dock !== false;

      React.useEffect(() => {
        if (!visible) return undefined;
        if (sessionId !== "" && state.sessionId !== sessionId) publish({ sessionId });
        void refreshGroups(sessionId);
        const onFocus = () => void refreshGroups(sessionId);
        window.addEventListener("focus", onFocus);
        return () => {
          window.removeEventListener("focus", onFocus);
        };
      }, [sessionId, visible]);

      if (!visible) return null;

      const onClick = () => {
        if (currentPrefs.click === "panel-current") {
          openPanel("current");
          return;
        }
        if (currentPrefs.click === "panel-all") {
          openPanel("all");
          return;
        }
        setQuickOpen(true);
      };

      return h(
        React.Fragment,
        null,
        h("style", null, CSS),
        h(
          "button",
          {
            type: "button",
            className: "dsh-notes-dock",
            title: t("dock.tip"),
            onClick
          },
          h(NoteIcon, { size: 13 }),
          h("span", null, t("dock.label"))
        )
      );
    }

    /* ------------------------------------------------------------------ *
     * 座位 2：直接写一张新便签
     * ------------------------------------------------------------------ */
    function QuickNote() {
      useLocaleWakeup();
      const open = useQuickOpen();
      const store = useStore();
      const [title, setTitle] = React.useState("");
      const [body, setBody] = React.useState("");
      const [status, setStatus] = React.useState("idle");
      const [error, setError] = React.useState("");
      const bodyRef = React.useRef(null);

      // 拿不到会话工作区时不要拿「上次记住的工作区」兜底写——那会写进别的工作区。
      const workspace = store.currentLive === true ? store.current : "";
      const workspaceTitle = store.currentTitle !== "" ? store.currentTitle : shortPath(workspace);

      React.useEffect(() => {
        if (!open) return undefined;
        setTitle("");
        setBody("");
        setStatus("idle");
        setError("");
        const timer = window.setTimeout(() => bodyRef.current?.focus?.(), 30);
        const onKey = (event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setQuickOpen(false);
          }
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void submit();
          }
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
          window.clearTimeout(timer);
          window.removeEventListener("keydown", onKey, true);
        };
      }, [open]);

      async function submit() {
        if (status === "saving") return;
        if (title.trim() === "" && body.trim() === "") {
          setStatus("error");
          setError(t("quick.empty"));
          return;
        }
        setStatus("saving");
        setError("");
        try {
          await saveNote(workspace, { title, body });
          setStatus("idle");
          setQuickOpen(false);
        } catch (failure) {
          setStatus("error");
          setError(failure?.message !== undefined && failure.message !== "" ? failure.message : t("quick.failed"));
        }
      }

      if (!open) return null;

      if (workspace === "") {
        return h(
          "div",
          { className: "dsh-notes-quick", role: "dialog", "aria-label": t("quick.title") },
          h("style", null, CSS),
          h(
            "div",
            { className: "dsh-notes-quick-head" },
            h("span", { className: "dsh-notes-mark" }, h(NoteIcon, { size: 14 })),
            h("span", { className: "dsh-notes-quick-title" }, t("quick.title")),
            h(
              "button",
              {
                type: "button",
                className: "dsh-notes-dock",
                title: t("quick.cancel"),
                "aria-label": t("quick.cancel"),
                onClick: () => setQuickOpen(false)
              },
              h(CloseIcon, { size: 14 })
            )
          ),
          h("div", { className: "dsh-notes-quick-where" }, t("quick.noWorkspace")),
          h("div", { className: "dsh-notes-quick-foot" }, h("span", { className: "dsh-notes-status" }, ""))
        );
      }

      return h(
        "div",
        { className: "dsh-notes-quick", role: "dialog", "aria-label": t("quick.title") },
        h("style", null, CSS),
        h(
          "div",
          { className: "dsh-notes-quick-head" },
          h("span", { className: "dsh-notes-mark" }, h(NoteIcon, { size: 14 })),
          h("span", { className: "dsh-notes-quick-title" }, t("quick.title")),
          h(
            "button",
            {
              type: "button",
              className: "dsh-notes-dock",
              title: t("quick.cancel"),
              "aria-label": t("quick.cancel"),
              onClick: () => setQuickOpen(false)
            },
            h(CloseIcon, { size: 14 })
          )
        ),
        h("div", { className: "dsh-notes-quick-where" }, `${t("quick.workspace")} ${workspaceTitle}`),
        h(
          "div",
          { className: "dsh-notes-quick-body" },
          h("input", {
            className: "dsh-notes-input",
            value: title,
            placeholder: t("quick.heading"),
            "aria-label": t("quick.heading"),
            onChange: (event) => setTitle(event.target.value)
          }),
          h("textarea", {
            ref: bodyRef,
            className: "dsh-notes-textarea",
            value: body,
            placeholder: t("quick.body"),
            "aria-label": t("quick.body"),
            onChange: (event) => setBody(event.target.value)
          })
        ),
        h(
          "div",
          { className: "dsh-notes-quick-foot" },
          h("span", { className: "dsh-notes-status", "data-kind": status === "error" ? "error" : undefined }, error === "" ? "" : error),
          h(
            "button",
            { type: "button", className: "dsh-notes-btn", "data-kind": "ghost", onClick: () => setQuickOpen(false) },
            t("quick.cancel")
          ),
          h(
            "button",
            { type: "button", className: "dsh-notes-btn", disabled: status === "saving", onClick: () => void submit() },
            status === "saving" ? t("quick.saving") : t("quick.save")
          )
        )
      );
    }

    /* ------------------------------------------------------------------ *
     * 座位 3：侧栏图标 + 独立便签页
     * ------------------------------------------------------------------ */
    function PanelIcon({ size, active }) {
      return h(
        "span",
        { style: { display: "inline-flex", color: active ? "var(--dsw-alias-brand-primary,#5686fe)" : "currentColor" } },
        h(NoteIcon, { size: size ?? 16 })
      );
    }

    function NoteCard({ note, workspace, open, onToggle }) {
      const [draftTitle, setDraftTitle] = React.useState(note.title);
      const [draftBody, setDraftBody] = React.useState(note.body);
      const [status, setStatus] = React.useState("idle");
      const [error, setError] = React.useState("");
      const [confirmDelete, setConfirmDelete] = React.useState(false);
      const [conflict, setConflict] = React.useState(false);
      const currentPrefs = usePrefs();
      const needConfirm = currentPrefs.confirmDelete !== false;

      // 记住「这张草稿是从哪个 rev 开始写的」。同一张便签在别处被追加过（rev 变了）而本地
      // 还有没保存的字时，不清草稿，转成冲突提示让人自己选：载入最新，或覆盖保存。
      const loadedRef = React.useRef({ no: 0, rev: -1 });

      React.useEffect(() => {
        if (!open) {
          loadedRef.current = { no: 0, rev: -1 };
          return;
        }
        const dirtyNow = draftTitle !== note.title || draftBody !== note.body;
        const sameNote = loadedRef.current.no === note.no;
        if (sameNote && loadedRef.current.rev !== note.rev && dirtyNow) {
          setConflict(true);
          setError(t("page.conflict"));
          return;
        }
        loadedRef.current = { no: note.no, rev: note.rev };
        setDraftTitle(note.title);
        setDraftBody(note.body);
        setStatus("idle");
        setError("");
        setConfirmDelete(false);
        setConflict(false);
      }, [open, note.rev, note.no]);

      React.useEffect(() => {
        if (!confirmDelete) return undefined;
        const timer = window.setTimeout(() => setConfirmDelete(false), 4000);
        return () => window.clearTimeout(timer);
      }, [confirmDelete]);

      const dirty = open && (draftTitle !== note.title || draftBody !== note.body);

      async function save() {
        if (status === "saving") return;
        setStatus("saving");
        setError("");
        try {
          const payload = { no: note.no, title: draftTitle, body: draftBody };
          // 冲突后这一次就是「以我为准」：不再带 baseRev，否则永远存不进去。
          if (!conflict) payload.baseRev = note.rev;
          await saveNote(workspace, payload);
          setStatus("saved");
          setConflict(false);
        } catch (failure) {
          setStatus("error");
          if (failure?.code === "sticky/conflict") {
            setConflict(true);
            setError(t("page.conflict"));
            return;
          }
          setError(failure?.message !== undefined && failure.message !== "" ? failure.message : t("page.saveFailed"));
        }
      }

      async function reloadFromHost() {
        setConflict(false);
        setError("");
        await loadNotes(workspace);
      }

      async function remove() {
        // 设置里关掉「删除前确认」后，点一次就真的删。
        if (needConfirm && !confirmDelete) {
          setConfirmDelete(true);
          return;
        }
        try {
          // 冲突后再点一次删除就是「不管它改没改，删掉」。
          await removeNote(workspace, note.no, conflict ? null : note.rev);
        } catch (failure) {
          setStatus("error");
          if (failure?.code === "sticky/conflict") {
            setConflict(true);
            setError(t("page.deleteConflict"));
            setConfirmDelete(true);
            return;
          }
          setError(failure?.message !== undefined && failure.message !== "" ? failure.message : t("page.saveFailed"));
        }
      }

      const onKey = (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void save();
        }
      };

      return h(
        "div",
        { className: "dsh-notes-card", "data-open": open ? "true" : "false" },
        h(
          "button",
          {
            type: "button",
            className: "dsh-notes-card-main",
            onClick: () => onToggle(note.no),
            "aria-expanded": open ? "true" : "false"
          },
          h("span", { className: "dsh-notes-no", title: t("page.copyNo", { n: note.no }) }, `#${note.no}`),
          h(
            "span",
            { className: "dsh-notes-card-text" },
            h("span", { className: "dsh-notes-card-title" }, note.title === "" ? t("page.untitled") : note.title),
            note.body === "" ? null : h("span", { className: "dsh-notes-card-preview" }, previewOf(note.body, 180))
          ),
          h("span", { className: "dsh-notes-card-meta" }, note.updatedAt === "" ? "" : timeAgo(note.updatedAt))
        ),
        open
          ? h(
              "div",
              { className: "dsh-notes-editor" },
              h("input", {
                className: "dsh-notes-input",
                value: draftTitle,
                placeholder: t("page.titlePlaceholder"),
                onChange: (event) => setDraftTitle(event.target.value),
                onKeyDown: onKey
              }),
              h("textarea", {
                className: "dsh-notes-textarea",
                value: draftBody,
                style: { minHeight: "180px" },
                placeholder: t("page.bodyPlaceholder"),
                onChange: (event) => setDraftBody(event.target.value),
                onKeyDown: onKey
              }),
              h(
                "div",
                { className: "dsh-notes-editor-foot" },
                h(
                  "span",
                  { className: "dsh-notes-status", "data-kind": status === "error" ? "error" : undefined },
                  error !== "" ? error : dirty ? "" : status === "saved" ? t("page.saved") : ""
                ),
                h(
                  "button",
                  { type: "button", className: "dsh-notes-btn", "data-kind": "ghost", onClick: () => onToggle(note.no) },
                  t("page.close")
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "dsh-notes-btn",
                    "data-kind": "danger",
                    "data-confirm": confirmDelete ? "true" : "false",
                    onClick: () => void remove()
                  },
                  confirmDelete ? t("page.deleteConfirm") : t("page.delete")
                ),
                conflict
                  ? h(
                      "button",
                      { type: "button", className: "dsh-notes-btn", "data-kind": "ghost", onClick: () => void reloadFromHost() },
                      t("page.reload")
                    )
                  : null,
                h(
                  "button",
                  { type: "button", className: "dsh-notes-btn", disabled: !dirty || status === "saving", onClick: () => void save() },
                  status === "saving" ? t("page.saving") : conflict ? t("page.overwrite") : t("page.save")
                )
              )
            )
          : null
      );
    }

    function Composer({ workspace, onSaved }) {
      const [title, setTitle] = React.useState("");
      const [body, setBody] = React.useState("");
      const [status, setStatus] = React.useState("idle");
      const [error, setError] = React.useState("");
      const bodyRef = React.useRef(null);

      React.useEffect(() => {
        const timer = window.setTimeout(() => bodyRef.current?.focus?.(), 30);
        return () => window.clearTimeout(timer);
      }, []);

      async function save() {
        if (status === "saving") return;
        if (title.trim() === "" && body.trim() === "") {
          setStatus("error");
          setError(t("quick.empty"));
          return;
        }
        setStatus("saving");
        setError("");
        try {
          await saveNote(workspace, { title, body });
          setTitle("");
          setBody("");
          setStatus("idle");
          onSaved?.();
        } catch (failure) {
          setStatus("error");
          setError(failure?.message !== undefined && failure.message !== "" ? failure.message : t("quick.failed"));
        }
      }

      const onKey = (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void save();
        }
      };

      return h(
        "div",
        { className: "dsh-notes-card", "data-open": "true" },
        h(
          "div",
          { className: "dsh-notes-editor" },
          h("input", {
            className: "dsh-notes-input",
            value: title,
            placeholder: t("quick.heading"),
            onChange: (event) => setTitle(event.target.value),
            onKeyDown: onKey
          }),
          h("textarea", {
            ref: bodyRef,
            className: "dsh-notes-textarea",
            value: body,
            placeholder: t("quick.body"),
            onChange: (event) => setBody(event.target.value),
            onKeyDown: onKey
          }),
          h(
            "div",
            { className: "dsh-notes-editor-foot" },
            h(
              "span",
              { className: "dsh-notes-status", "data-kind": status === "error" ? "error" : undefined },
              error
            ),
            h(
              "button",
              { type: "button", className: "dsh-notes-btn", disabled: status === "saving", onClick: () => void save() },
              status === "saving" ? t("quick.saving") : t("quick.save")
            )
          )
        )
      );
    }

    function SwitchRow({ title, desc, on, onToggle }) {
      return h(
        "div",
        { className: "dsh-notes-set-row" },
        h(
          "div",
          { className: "dsh-notes-set-text" },
          h("span", { className: "dsh-notes-set-title" }, title),
          desc === "" ? null : h("span", { className: "dsh-notes-set-desc" }, desc)
        ),
        h(
          "button",
          {
            type: "button",
            role: "switch",
            "aria-checked": on ? "true" : "false",
            "aria-label": title,
            className: "dsh-notes-switch",
            "data-on": on ? "true" : "false",
            onClick: onToggle
          },
          h("span", { className: "dsh-notes-switch-knob" })
        )
      );
    }

    function ChoiceRow({ title, desc, value, options, onChange }) {
      return h(
        "div",
        { className: "dsh-notes-set-row" },
        h(
          "div",
          { className: "dsh-notes-set-text" },
          h("span", { className: "dsh-notes-set-title" }, title),
          desc === "" ? null : h("span", { className: "dsh-notes-set-desc" }, desc)
        ),
        h(
          "div",
          { className: "dsh-notes-set-control" },
          h(
            "div",
            { className: "dsh-notes-pills", role: "radiogroup", "aria-label": title },
            options.map((option) =>
              h(
                "button",
                {
                  key: option.value,
                  type: "button",
                  role: "radio",
                  "aria-checked": value === option.value ? "true" : "false",
                  className: "dsh-notes-pill",
                  "data-on": value === option.value ? "true" : "false",
                  onClick: () => onChange(option.value)
                },
                option.label
              )
            )
          )
        )
      );
    }

    /** 插件页和便签页共用同一套设置；改一处，两边立刻同步（localStorage 单一真相）。 */
    function SettingsPanel({ compact }) {
      useLocaleWakeup();
      const prefs = usePrefs();
      return h(
        "div",
        { className: compact ? "dsh-notes-settings is-compact" : "dsh-notes-settings" },
        h("style", null, CSS),
        h(SwitchRow, {
          title: t("set.dock"),
          desc: t("set.dock.desc"),
          on: prefs.dock !== false,
          onToggle: () => writePrefs({ dock: prefs.dock === false })
        }),
        h(ChoiceRow, {
          title: t("set.click"),
          desc: t("set.click.desc"),
          value: prefs.click,
          options: [
            { value: "quick", label: t("page.click.quick") },
            { value: "panel-current", label: t("page.click.panelCurrent") },
            { value: "panel-all", label: t("page.click.panelAll") }
          ],
          onChange: (value) => writePrefs({ click: value })
        }),
        h(ChoiceRow, {
          title: t("set.view"),
          desc: t("set.view.desc"),
          value: prefs.defaultView,
          options: [
            { value: "current", label: t("set.view.current") },
            { value: "all", label: t("set.view.all") }
          ],
          onChange: (value) => writePrefs({ defaultView: value })
        }),
        h(SwitchRow, {
          title: t("set.autoRefresh"),
          desc: t("set.autoRefresh.desc"),
          on: prefs.autoRefresh !== false,
          onToggle: () => writePrefs({ autoRefresh: prefs.autoRefresh === false })
        }),
        h(SwitchRow, {
          title: t("set.confirmDelete"),
          desc: t("set.confirmDelete.desc"),
          on: prefs.confirmDelete !== false,
          onToggle: () => writePrefs({ confirmDelete: prefs.confirmDelete === false })
        })
      );
    }

    function NotesPage() {
      useLocaleWakeup();
      const store = useStore();
      const currentPrefs = usePrefs();
      const [openNo, setOpenNo] = React.useState(0);
      const [composing, setComposing] = React.useState(false);
      const [showSettings, setShowSettings] = React.useState(false);

      React.useEffect(() => {
        state.editing = openNo !== 0 || composing;
        return () => {
          state.editing = false;
        };
      }, [openNo, composing]);

      React.useEffect(() => {
        void refreshGroups("").then(() => {
          if (currentPrefs.defaultView === "all" && state.selected !== "*") void loadAll();
        });
      }, []);

      React.useEffect(() => {
        // 关掉「自动刷新」后就不轮询：AI 追加进来的内容要点一次「刷新」才出现。
        if (currentPrefs.autoRefresh === false) return undefined;
        const visible = () => {
          if (document.visibilityState !== "visible") return false;
          const page = document.querySelector(".dsh-notes-page");
          return page === null || typeof page.checkVisibility !== "function" || page.checkVisibility();
        };
        const timer = window.setInterval(() => {
          if (!visible()) return;
          if (state.editing) return;
          if (state.selected !== "" && state.selected !== "*") {
            void call("notes", { workspace: state.selected }).then((group) => upsertGroup(group)).catch(() => undefined);
          }
        }, 10000);
        return () => window.clearInterval(timer);
      }, [currentPrefs.autoRefresh]);

      const selected = store.selected;
      const group = store.group;
      const allGroups = Object.keys(store.all).map((key) => store.all[key]);
      const currentGroup = store.current !== "" ? store.groups.find((item) => item.workspace === store.current) : undefined;

      const choose = (workspace) => {
        setOpenNo(0);
        setComposing(false);
        if (workspace === "*") {
          void loadAll();
          return;
        }
        void loadNotes(workspace);
      };

      const onSaved = () => {
        setComposing(false);
      };

      const renderNotes = (target, notes) =>
        notes.map((note) =>
          h(NoteCard, {
            key: `${target.workspace}#${note.no}`,
            note,
            workspace: target.workspace,
            open: openNo === note.no,
            onToggle: (no) => setOpenNo((current) => (current === no ? 0 : no))
          })
        );

      const content = (() => {
        if (store.status === "loading" && (selected === "" || (group === null && selected !== "*"))) {
          return h("div", { className: "dsh-notes-empty" }, h("div", { className: "dsh-notes-empty-title" }, t("page.loading")));
        }
        if (store.status === "error") {
          return h(
            "div",
            { className: "dsh-notes-error" },
            h("span", null, `${t("page.failed")}${store.error?.message !== undefined && store.error.message !== "" ? `：${store.error.message}` : ""}`),
            h("button", { type: "button", className: "dsh-notes-btn", "data-kind": "ghost", onClick: () => void refreshGroups("") }, t("page.retry"))
          );
        }
        if (selected === "*") {
          if (allGroups.length === 0) {
            return h(
              "div",
              { className: "dsh-notes-empty" },
              h("div", { className: "dsh-notes-empty-title" }, t("page.emptyAll")),
              h("div", { className: "dsh-notes-empty-desc" }, t("page.emptyHint"))
            );
          }
          return allGroups.map((entry) =>
            h(
              "div",
              { key: entry.workspace },
              h(
                "div",
                { className: "dsh-notes-group-head" },
                h("span", { className: "dsh-notes-group-title" }, entry.title !== "" ? entry.title : shortPath(entry.workspace)),
                h("span", { className: "dsh-notes-group-path" }, shortPath(entry.workspace)),
                h("span", { className: "dsh-notes-rail-count" }, t("page.notes", { n: entry.notes.length }))
              ),
              entry.notes.length === 0
                ? h("div", { className: "dsh-notes-banner" }, t("page.empty"))
                : renderNotes(entry, entry.notes)
            )
          );
        }
        if (group === null) {
          return h(
            "div",
            { className: "dsh-notes-empty" },
            h("div", { className: "dsh-notes-empty-title" }, t("page.empty")),
            h("div", { className: "dsh-notes-empty-desc" }, t("page.emptyHint"))
          );
        }
        return [
          h(
            "div",
            { className: "dsh-notes-group-head", key: "head" },
            h("span", { className: "dsh-notes-group-title" }, group.title !== "" ? group.title : shortPath(group.workspace)),
            h("span", { className: "dsh-notes-group-path" }, shortPath(group.workspace)),
            h("span", { className: "dsh-notes-rail-count" }, t("page.notes", { n: group.notes.length }))
          ),
          composing ? h(Composer, { key: "composer", workspace: group.workspace, onSaved }) : null,
          group.notes.length === 0 && !composing
            ? h(
                "div",
                { className: "dsh-notes-empty", key: "empty" },
                h("div", { className: "dsh-notes-empty-title" }, t("page.empty")),
                h("div", { className: "dsh-notes-empty-desc" }, t("page.emptyHint"))
              )
            : null,
          h("div", { key: "list", style: { display: "flex", flexDirection: "column", gap: "8px" } }, renderNotes(group, group.notes))
        ];
      })();

      return h(
        "div",
        { className: "dsh-notes-page" },
        h("style", null, CSS),
        h(
          "div",
          { className: "dsh-notes-page-head" },
          h(
            "div",
            { className: "dsh-notes-page-titles" },
            h("span", { className: "dsh-notes-page-title" }, t("page.title")),
            h("span", { className: "dsh-notes-page-sub" }, t("page.subtitle"))
          ),
          h(
            "button",
            {
              type: "button",
              className: "dsh-notes-btn",
              onClick: () => {
                if (selected === "*" && store.current !== "") {
                  void loadNotes(store.current).then(() => setComposing(true));
                } else {
                  setComposing(true);
                }
                setOpenNo(0);
              }
            },
            h("span", { style: { display: "inline-flex", alignItems: "center", gap: "5px" } }, h(PlusIcon, { size: 12 }), t("page.new"))
          ),
          h(
            "button",
            { type: "button", className: "dsh-notes-btn", "data-kind": "ghost", onClick: () => void refreshGroups("") },
            h("span", { style: { display: "inline-flex", alignItems: "center", gap: "5px" } }, h(RefreshIcon, { size: 12 }), t("page.refresh"))
          )
        ),
        h(
          "div",
          { className: "dsh-notes-page-body" },
          h(
            "div",
            { className: "dsh-notes-rail", role: "navigation" },
            h("div", { className: "dsh-notes-rail-label" }, t("page.current")),
            store.current === ""
              ? h("div", { className: "dsh-notes-banner", style: { padding: "0 10px" } }, t("page.noCurrent"))
              : h(
                  "button",
                  {
                    type: "button",
                    className: "dsh-notes-rail-item",
                    "data-on": selected === store.current ? "true" : "false",
                    onClick: () => choose(store.current)
                  },
                  h(NoteIcon, { size: 13 }),
                  h("span", { className: "dsh-notes-rail-name" }, currentGroup?.title !== undefined && currentGroup.title !== "" ? currentGroup.title : store.currentTitle !== "" ? store.currentTitle : shortPath(store.current)),
                  h("span", { className: "dsh-notes-rail-count" }, String(currentGroup?.count ?? 0))
                ),
            h("div", { className: "dsh-notes-rail-label" }, t("page.workspaces")),
            h(
              "button",
              {
                type: "button",
                className: "dsh-notes-rail-item",
                "data-on": selected === "*" ? "true" : "false",
                onClick: () => choose("*")
              },
              h("span", { className: "dsh-notes-rail-name" }, t("page.all")),
              h(
                "span",
                { className: "dsh-notes-rail-count" },
                String(store.groups.reduce((total, item) => total + item.count, 0))
              )
            ),
            ...store.groups
              .filter((item) => item.workspace !== store.current)
              .map((item) =>
                h(
                  "button",
                  {
                    key: item.workspace,
                    type: "button",
                    className: "dsh-notes-rail-item",
                    "data-on": selected === item.workspace ? "true" : "false",
                    onClick: () => choose(item.workspace)
                  },
                  h("span", { className: "dsh-notes-rail-name" }, item.title !== "" ? item.title : shortPath(item.workspace)),
                  h("span", { className: "dsh-notes-rail-count" }, String(item.count))
                )
              ),
            h(
              "div",
              {
                className: "dsh-notes-rail-foot"
              },
              h(
                "button",
                {
                  type: "button",
                  className: "dsh-notes-rail-item",
                  "data-on": showSettings ? "true" : "false",
                  onClick: () => setShowSettings((value) => !value)
                },
                h("span", { className: "dsh-notes-rail-name" }, t("page.settings"))
              ),
              showSettings ? h(SettingsPanel, { compact: true }) : null,
              h(
                "div",
                { className: "dsh-notes-banner", style: { padding: "6px", overflowWrap: "anywhere" } },
                `${t("page.dir")}：${store.dir}`
              ),
              h("div", { className: "dsh-notes-banner", style: { padding: "6px" } }, t("page.toolsHint"))
            )
          ),
          h("div", { className: "dsh-notes-content" }, content)
        )
      );
    }

    /* ------------------------------------------------------------------ *
     * 插件页上的说明卡片
     * ------------------------------------------------------------------ */
    function ConfigCard() {
      useLocaleWakeup();
      const store = useStore();
      React.useEffect(() => {
        void refreshGroups("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      const total = store.groups.reduce((sum, item) => sum + item.count, 0);
      return h(
        "div",
        { className: "dsh-notes-config" },
        h("style", null, CSS),
        h(
          "div",
          { className: "dsh-notes-config-head" },
          h("span", { className: "dsh-notes-config-title" }, t("config.title")),
          h("span", { className: "dsh-notes-config-desc" }, t("config.desc"))
        ),
        h(
          "div",
          null,
          h(
            "div",
            { className: "dsh-notes-row" },
            h("span", { className: "dsh-notes-row-key" }, t("config.where")),
            h("span", { className: "dsh-notes-row-value" }, store.dir)
          ),
          h(
            "div",
            { className: "dsh-notes-row" },
            h("span", { className: "dsh-notes-row-key" }, t("config.count")),
            h("span", { className: "dsh-notes-row-value" }, String(total))
          ),
          h(
            "div",
            { className: "dsh-notes-row" },
            h("span", { className: "dsh-notes-row-key" }, t("config.tool")),
            h("span", { className: "dsh-notes-row-value" }, t("config.toolValue"))
          )
        ),
        h(SettingsPanel, { compact: false })
      );
    }

    /* ------------------------------------------------------------------ *
     * 接线
     * ------------------------------------------------------------------ */
    return {
      inject: ["slots"],
      apply(ctx) {
        ctxRef = ctx;
        localeFace = typeof ctx.get === "function" ? ctx.get("locale") : undefined;
        try {
          localeFace?.register?.(NS, { zh: ZH, en: EN });
        } catch (error) {
          console.warn(`[${NS}] locale registration skipped:`, error);
        }

        ctx.slots.inject(DOCK_SLOT, () =>
          ctx.slots.register({ name: DOCK_SLOT, id: "sticky-notes", order: 14, label: () => t("dock.label") }, NotesDock)
        );
        ctx.slots.inject(OVERLAY_SLOT, () =>
          ctx.slots.register({ name: OVERLAY_SLOT, id: "sticky-notes-quick", order: 24 }, QuickNote)
        );
        ctx.slots.inject(NAV_SLOT, () =>
          ctx.slots.register(
            { name: NAV_SLOT, id: PANEL_ID, order: 20, label: () => t("page.title") },
            PanelIcon
          )
        );
        ctx.slots.inject(PANEL_SLOT, () => ctx.slots.register({ name: PANEL_SLOT, key: PANEL_ID }, NotesPage));
        ctx.slots.inject(CONFIG_SLOT, () =>
          ctx.slots.register({ name: CONFIG_SLOT, key: NS }, ConfigCard)
        );
      }
    };
  }
});
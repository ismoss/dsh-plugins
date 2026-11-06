/**
 * dsh-sticky-notes — 浏览器半。
 *
 * 便签正文不在 localStorage：这里通过 Connection 的通用 RPC 通道
 * `/dsh-sticky-notes` 调 Host 半的 `list` / `save` / `remove`，Host 把内容落到
 * `notes.md`。localStorage 只存「面板开不开、拖到哪」这类界面偏好。
 *
 * 三个座位：
 *   1. `conversation.composer.dock` —— 用量栏里的「便签」开关 + 数量；
 *   2. `shell.overlay` —— 可拖动的便签板：列表、编辑、置顶、颜色、删除；
 *   3. `plugins.bundle.config` —— 插件页上的存储位置与格式说明。
 *
 * 编辑策略：输入后 650ms 防抖保存，保存串行执行；`rev` 对不上时进入冲突态，
 * 由用户选择覆盖或放弃，绝不静默盖掉另一处刚写的内容。
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
    const PANEL_SLOT = "plugins.bundle.config";
    const PREFS_KEY = "dsh-sticky-notes/prefs";
    const BOARD_WIDTH = 360;
    const SAVE_DELAY = 650;
    const COLORS = ["yellow", "pink", "blue", "green", "purple", "gray"];

    /* ------------------------------------------------------------------ *
     * 文案：内置中英两份；locale 服务可用时注册进它的命名空间。
     * ------------------------------------------------------------------ */
    const ZH = {
      "dock.label": "便签",
      "dock.tip": "打开或收起便签板",
      "board.title": "便签",
      "board.new": "新建",
      "board.refresh": "刷新",
      "board.close": "关闭",
      "board.back": "返回",
      "board.loading": "正在读取便签…",
      "board.empty": "还没有便签",
      "board.emptyHint": "点「新建」写第一张；内容保存在宿主机的 notes.md 里。",
      "board.untitled": "未命名便签",
      "board.pinned": "已置顶",
      "board.pin": "置顶",
      "board.unpin": "取消置顶",
      "board.color": "颜色",
      "board.titlePlaceholder": "标题",
      "board.bodyPlaceholder": "写点什么…（支持 Markdown，保存的是原文）",
      "board.saving": "保存中…",
      "board.saved": "已保存",
      "board.unsaved": "未保存",
      "board.saveFailed": "保存失败",
      "board.retry": "重试保存",
      "board.delete": "删除",
      "board.deleteConfirm": "再点一次删除",
      "board.cancel": "取消",
      "board.conflictShort": "有冲突",
      "board.conflictDesc": "这张便签在你编辑时被别处改过，本地内容没有覆盖它。",
      "board.overwrite": "覆盖保存",
      "board.discard": "放弃本地改动",
      "board.errorTitle": "便签读取失败",
      "board.updated": "更新于",
      "board.count": "{n} 张",
      "board.file": "文件",
      "board.copy": "复制路径",
      "board.copied": "已复制",
      "board.noteAria": "打开便签：{title}",
      "color.yellow": "黄色",
      "color.pink": "粉色",
      "color.blue": "蓝色",
      "color.green": "绿色",
      "color.purple": "紫色",
      "color.gray": "灰色",
      "panel.title": "便签",
      "panel.desc": "便签正文保存在宿主机的 Markdown 文件里，换浏览器、重启 DSH 都还在；文件也可以直接交给 AI 读写。",
      "panel.storage": "存储位置",
      "panel.storageDesc": "默认在 DSH 主目录下；要放进同步盘或 git 仓库，把 DSH_STICKY_NOTES_FILE 指过去并重启 DSH。",
      "panel.path": "文件路径",
      "panel.count": "当前便签",
      "panel.open": "打开便签板",
      "panel.refresh": "重新读取",
      "panel.format": "文件格式",
      "panel.formatDesc": "每个 `## 标题` 是一张便签；标题下一行的 HTML 注释保存 id、颜色、置顶和时间。改正文时请保留这一行，删掉就会变成一张新便签。",
      "panel.local": "本地只存界面偏好",
      "panel.localDesc": "浏览器 localStorage 只记面板开合与位置；便签正文只在宿主文件里，不会被浏览器清掉。",
      "panel.status": "连接状态",
      "panel.connected": "已连接宿主",
      "panel.offline": "还没连上宿主",
      "panel.error": "读取失败",
      "panel.copy": "复制路径",
      "panel.copied": "已复制",
      "status.conflict": "这张便签刚在别处被改过，没有覆盖。可以覆盖保存，或放弃本地改动。",
      "status.notFound": "这张便签已经不存在了。",
      "status.tooLarge": "内容超出上限：单张正文 20000 字，整个文件 2 MB。",
      "status.invalid": "标题和内容不能都为空。",
      "status.forbidden": "只有本机 owner 可以读写便签。",
      "status.network": "连不上宿主，检查 DSH 是否还在运行。",
      "status.offline": "还没连上宿主，稍后再试。",
      "status.protocol": "宿主返回了看不懂的响应。",
      "status.io": "宿主读写 notes.md 失败。",
      "status.internal": "宿主内部错误。",
      "status.unknown": "未知错误。",
      "time.justNow": "刚刚",
      "time.minutesAgo": "{n} 分钟前",
      "time.hoursAgo": "{n} 小时前",
      "time.daysAgo": "{n} 天前",
      "time.unknown": "时间未知"
    };
    const EN = {
      "dock.label": "Notes",
      "dock.tip": "Open or close the sticky notes board",
      "board.title": "Sticky notes",
      "board.new": "New",
      "board.refresh": "Refresh",
      "board.close": "Close",
      "board.back": "Back",
      "board.loading": "Loading notes…",
      "board.empty": "No notes yet",
      "board.emptyHint": "Click New to write the first one; notes live in notes.md on the host.",
      "board.untitled": "Untitled note",
      "board.pinned": "Pinned",
      "board.pin": "Pin",
      "board.unpin": "Unpin",
      "board.color": "Color",
      "board.titlePlaceholder": "Title",
      "board.bodyPlaceholder": "Write something… (Markdown is kept as-is)",
      "board.saving": "Saving…",
      "board.saved": "Saved",
      "board.unsaved": "Unsaved",
      "board.saveFailed": "Save failed",
      "board.retry": "Retry save",
      "board.delete": "Delete",
      "board.deleteConfirm": "Click again to delete",
      "board.cancel": "Cancel",
      "board.conflictShort": "Conflict",
      "board.conflictDesc": "This note changed elsewhere while you were editing; your text did not overwrite it.",
      "board.overwrite": "Overwrite",
      "board.discard": "Discard my changes",
      "board.errorTitle": "Could not load notes",
      "board.updated": "Updated",
      "board.count": "{n} notes",
      "board.file": "File",
      "board.copy": "Copy path",
      "board.copied": "Copied",
      "board.noteAria": "Open note: {title}",
      "color.yellow": "Yellow",
      "color.pink": "Pink",
      "color.blue": "Blue",
      "color.green": "Green",
      "color.purple": "Purple",
      "color.gray": "Gray",
      "panel.title": "Sticky notes",
      "panel.desc": "Notes live in a Markdown file on the host, so they survive browser changes and DSH restarts — and an AI can read or edit the file directly.",
      "panel.storage": "Storage",
      "panel.storageDesc": "Defaults to the DSH home. Point DSH_STICKY_NOTES_FILE at a synced folder or a git checkout to share it across machines, then restart DSH.",
      "panel.path": "File",
      "panel.count": "Notes",
      "panel.open": "Open board",
      "panel.refresh": "Reload",
      "panel.format": "File format",
      "panel.formatDesc": "Each `## title` starts one note. The HTML comment on the next line stores its id, color, pin and timestamps — keep it when you edit the body, or the note becomes a new one.",
      "panel.local": "Only UI preferences are local",
      "panel.localDesc": "The browser's localStorage stores just whether the board is open and where it sits; note bodies live only in the host file.",
      "panel.status": "Connection",
      "panel.connected": "Connected to host",
      "panel.offline": "Host not connected",
      "panel.error": "Load failed",
      "panel.copy": "Copy path",
      "panel.copied": "Copied",
      "status.conflict": "This note changed elsewhere; nothing was overwritten. Overwrite it or discard your local changes.",
      "status.notFound": "This note no longer exists.",
      "status.tooLarge": "Too large: one body is capped at 20,000 characters and the file at 2 MB.",
      "status.invalid": "A note needs a title or a body.",
      "status.forbidden": "Only the local owner can read or write notes.",
      "status.network": "Cannot reach the host. Is DSH still running?",
      "status.offline": "The host is not connected yet. Try again in a moment.",
      "status.protocol": "The host returned a response this client cannot read.",
      "status.io": "The host could not read or write notes.md.",
      "status.internal": "Internal host error.",
      "status.unknown": "Unknown error.",
      "time.justNow": "just now",
      "time.minutesAgo": "{n} min ago",
      "time.hoursAgo": "{n} h ago",
      "time.daysAgo": "{n} d ago",
      "time.unknown": "unknown time"
    };

    let translate = (key) => (Object.prototype.hasOwnProperty.call(ZH, key) ? ZH[key] : key);
    let localeFace;

    /** 带 `{n}` 这类占位符的文案。 */
    function tf(key, vars) {
      let text = translate(key);
      if (vars !== undefined && vars !== null) {
        for (const name of Object.keys(vars)) text = text.split(`{${name}}`).join(String(vars[name]));
      }
      return text;
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
     * 面板开合 / 位置：只存 localStorage
     * ------------------------------------------------------------------ */
    function isRecord(value) {
      return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function normalizePrefs(raw) {
      const source = isRecord(raw) ? raw : {};
      const pos =
        isRecord(source.pos) && Number.isFinite(source.pos.x) && Number.isFinite(source.pos.y)
          ? { x: source.pos.x, y: source.pos.y }
          : null;
      return { open: source.open === true, pos };
    }

    function readPrefs() {
      try {
        const text = window.localStorage.getItem(PREFS_KEY);
        return text === null ? normalizePrefs(null) : normalizePrefs(JSON.parse(text));
      } catch (error) {
        console.warn(`[${NS}] 界面偏好读取失败，使用默认值：`, error);
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
        console.warn(`[${NS}] 界面偏好未能写入 localStorage（本次仍然生效）：`, error);
      }
      for (const listener of prefListeners) {
        try {
          listener(prefs);
        } catch (error) {
          console.warn(`[${NS}] 偏好订阅者抛错：`, error);
        }
      }
    }

    function usePrefs() {
      const [snapshot, setSnapshot] = React.useState(prefs);
      React.useEffect(() => {
        setSnapshot(prefs);
        const listener = (next) => setSnapshot(next);
        prefListeners.add(listener);
        return () => {
          prefListeners.delete(listener);
        };
      }, []);
      return snapshot;
    }

    /* ------------------------------------------------------------------ *
     * 便签数据：模块级单一真相 + 订阅；正文全部走 Host RPC
     * ------------------------------------------------------------------ */
    let api = null;
    let attached = false;
    let refreshing = null;
    let localMutations = 0;
    let store = {
      status: "idle",
      notes: [],
      revision: "empty",
      path: "",
      displayPath: "",
      exists: false,
      loadedAt: 0,
      error: null
    };
    const storeListeners = new Set();

    function publish(patch) {
      store = { ...store, ...patch };
      for (const listener of storeListeners) {
        try {
          listener(store);
        } catch (error) {
          console.warn(`[${NS}] 便签订阅者抛错：`, error);
        }
      }
    }

    function subscribeStore(listener) {
      storeListeners.add(listener);
      return () => {
        storeListeners.delete(listener);
      };
    }

    function useStore() {
      const [snapshot, setSnapshot] = React.useState(store);
      React.useEffect(() => {
        setSnapshot(store);
        return subscribeStore(setSnapshot);
      }, []);
      return snapshot;
    }

    class StickyClientError extends Error {
      constructor(code, message, details) {
        super(message);
        this.name = "StickyClientError";
        this.code = code;
        this.details = details ?? {};
      }
    }

    function toClientError(error) {
      if (error instanceof StickyClientError) {
        return { code: error.code, message: error.message, details: error.details };
      }
      const code = typeof error?.code === "string" ? error.code : "sticky/network";
      return {
        code,
        message: error?.message ?? String(error),
        details: isRecord(error?.details) ? error.details : {}
      };
    }

    function createApi(fetchImpl) {
      const doFetch = typeof fetchImpl === "function" ? fetchImpl : (...args) => globalThis.fetch(...args);
      async function call(method, payload) {
        let response;
        try {
          response = await doFetch(ROUTE, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ method, payload })
          });
        } catch (error) {
          throw new StickyClientError("sticky/network", error?.message ?? String(error), {});
        }
        if (response === null || typeof response !== "object") {
          throw new StickyClientError("sticky/protocol", "the host returned no response");
        }
        if (response.status === 401 || response.status === 403) {
          throw new StickyClientError("sticky/forbidden", "the host rejected this browser as not the owner", {});
        }
        if (response.ok !== true) {
          throw new StickyClientError("sticky/network", `the host answered HTTP ${String(response.status)}`, {
            status: response.status
          });
        }
        let result;
        try {
          result = await response.json();
        } catch (error) {
          throw new StickyClientError("sticky/protocol", error?.message ?? "the host answered non-JSON", {});
        }
        if (!isRecord(result)) {
          throw new StickyClientError("sticky/protocol", "the host returned no result envelope");
        }
        if (result.ok === true) return result.value;
        const failure = isRecord(result.error) ? result.error : {};
        throw new StickyClientError(
          typeof failure.code === "string" ? failure.code : "sticky/unknown",
          typeof failure.message === "string" ? failure.message : "",
          isRecord(failure.details) ? failure.details : {}
        );
      }
      return {
        list: () => call("list", {}),
        save: (note) => call("save", { note }),
        remove: (id, baseRev) => call("remove", { id, baseRev })
      };
    }

    function refresh(options = {}) {
      if (api === null) {
        publish({ status: "offline", error: { code: "sticky/offline", message: "", details: {} } });
        return Promise.resolve();
      }
      if (refreshing !== null) return refreshing;
      const quiet = options.quiet === true;
      const before = localMutations;
      if (!quiet) publish({ status: "loading" });

      refreshing = (async () => {
        try {
          const data = await api.list();
          if (before !== localMutations) return;
          publish({
            status: "ready",
            notes: Array.isArray(data?.notes) ? data.notes : [],
            revision: typeof data?.revision === "string" ? data.revision : "empty",
            path: typeof data?.path === "string" ? data.path : "",
            displayPath: typeof data?.displayPath === "string" ? data.displayPath : "",
            exists: data?.exists === true,
            loadedAt: typeof data?.loadedAt === "number" ? data.loadedAt : Date.now(),
            error: null
          });
        } catch (error) {
          publish({ status: "error", error: toClientError(error) });
        } finally {
          refreshing = null;
        }
      })();
      return refreshing;
    }

    function attach() {
      if (attached) return;
      try {
        api = createApi();
        attached = true;
      } catch (error) {
        publish({ status: "error", error: toClientError(error) });
        return;
      }
      void refresh({ quiet: true });
    }

    /** 便签列表的展示顺序：置顶优先，其余保持文件顺序。 */
    function orderNotes(notes) {
      return (Array.isArray(notes) ? notes : [])
        .map((note, index) => ({ note, index }))
        .sort((left, right) => {
          const pin = (right.note.pinned === true ? 1 : 0) - (left.note.pinned === true ? 1 : 0);
          return pin !== 0 ? pin : left.index - right.index;
        })
        .map((entry) => entry.note);
    }

    function previewOf(body, max) {
      const text = typeof body === "string" ? body.replace(/\s+/g, " ").trim() : "";
      const limit = Number.isFinite(max) && max > 0 ? max : 120;
      if (text === "") return "";
      return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
    }

    function relativeTime(iso, now, t) {
      const time = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
      if (!Number.isFinite(time)) return t("time.unknown");
      const diff = Math.max(0, (Number.isFinite(now) ? now : Date.now()) - time);
      if (diff < 45000) return t("time.justNow");
      const minutes = Math.floor(diff / 60000);
      if (minutes < 60) return t("time.minutesAgo", { n: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t("time.hoursAgo", { n: hours });
      const days = Math.floor(hours / 24);
      if (days < 7) return t("time.daysAgo", { n: days });
      return new Date(time).toLocaleDateString();
    }

    function errorText(error) {
      if (error === null || error === undefined) return "";
      switch (error.code) {
        case "sticky/conflict":
          return translate("status.conflict");
        case "sticky/not-found":
          return translate("status.notFound");
        case "sticky/too-large":
          return translate("status.tooLarge");
        case "sticky/invalid":
          return translate("status.invalid");
        case "sticky/forbidden":
          return translate("status.forbidden");
        case "sticky/offline":
          return translate("status.offline");
        case "sticky/network":
          return translate("status.network");
        case "sticky/protocol":
          return translate("status.protocol");
        case "sticky/io":
          return translate("status.io");
        case "sticky/internal":
          return translate("status.internal");
        default:
          return typeof error.message === "string" && error.message !== ""
            ? error.message
            : translate("status.unknown");
      }
    }

    function draftOf(note) {
      return {
        id: note.id,
        title: note.title,
        body: note.body,
        color: note.color,
        pinned: note.pinned === true,
        rev: note.rev,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt
      };
    }

    function emptyDraft() {
      return {
        id: null,
        title: "",
        body: "",
        color: "yellow",
        pinned: false,
        rev: null,
        createdAt: "",
        updatedAt: ""
      };
    }

    function draftKey(draft) {
      if (draft === null || draft === undefined) return "";
      return `${draft.title}\u0000${draft.body}\u0000${draft.color}\u0000${draft.pinned === true ? "1" : "0"}`;
    }

    function saveLabel(status) {
      switch (status) {
        case "saving":
          return translate("board.saving");
        case "saved":
          return translate("board.saved");
        case "dirty":
          return translate("board.unsaved");
        case "conflict":
          return translate("board.conflictShort");
        case "error":
          return translate("board.saveFailed");
        default:
          return "";
      }
    }

    /* ------------------------------------------------------------------ *
     * 位置
     * ------------------------------------------------------------------ */
    function boardWidth() {
      return Math.min(BOARD_WIDTH, Math.max(280, (typeof window === "undefined" ? 1024 : window.innerWidth) - 16));
    }

    function clampPos(pos) {
      const width = boardWidth();
      const maxX = Math.max(8, (window.innerWidth || 1024) - width - 8);
      const maxY = Math.max(8, (window.innerHeight || 800) - 96);
      return {
        x: Math.min(Math.max(8, Number.isFinite(pos?.x) ? pos.x : 8), maxX),
        y: Math.min(Math.max(8, Number.isFinite(pos?.y) ? pos.y : 8), maxY)
      };
    }

    function defaultPos() {
      const width = boardWidth();
      return clampPos({
        x: (window.innerWidth || 1024) - width - 24,
        y: Math.max(72, Math.round((window.innerHeight || 800) * 0.12))
      });
    }

    /* ------------------------------------------------------------------ *
     * 样式
     * ------------------------------------------------------------------ */
    const CSS = `
.dsh-sticky-dock{
  appearance:none;display:inline-flex;align-items:center;gap:5px;min-width:0;
  padding:0;border:0;border-radius:6px;background:transparent;
  font:inherit;font-size:12px;line-height:18px;white-space:nowrap;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.92));
  cursor:pointer;user-select:none;
}
.dsh-sticky-dock:hover{color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-sticky-dock:active{opacity:.7}
.dsh-sticky-dock:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
.dsh-sticky-dock-count{
  min-width:16px;padding:0 4px;border-radius:999px;
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));
  font-size:11px;line-height:16px;text-align:center;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));
}

.dsh-sticky-board{
  position:fixed;z-index:950;box-sizing:border-box;pointer-events:auto;
  width:min(360px,calc(100vw - 16px));
  max-height:min(560px,calc(100vh - 96px));
  display:flex;flex-direction:column;
  border-radius:14px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
  background:var(--dsw-alias-bg-overlay,Canvas);
  box-shadow:0 18px 48px rgba(0,0,0,.24);
  color:var(--dsw-alias-label-primary,CanvasText);
  overflow:hidden;
}
.dsh-sticky-head{
  display:flex;align-items:center;gap:7px;flex:none;
  padding:10px 10px 9px 12px;
  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));
  cursor:grab;user-select:none;touch-action:none;
}
.dsh-sticky-head:active{cursor:grabbing}
.dsh-sticky-mark{
  flex:none;width:24px;height:24px;border-radius:7px;color:#fff;
  display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,#f2b705,#d97706);
}
.dsh-sticky-heading{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}
.dsh-sticky-title{font-size:13px;line-height:18px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-sticky-sub{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-sticky-head-actions{display:flex;align-items:center;gap:2px;flex:none}
.dsh-sticky-iconbtn{
  appearance:none;flex:none;width:26px;height:26px;padding:0;border:0;border-radius:7px;
  background:transparent;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));
  display:flex;align-items:center;justify-content:center;cursor:pointer;
}
.dsh-sticky-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-sticky-iconbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsh-sticky-iconbtn:disabled{opacity:.45;cursor:default}

.dsh-sticky-list{display:flex;flex-direction:column;gap:6px;padding:8px;overflow:auto;min-height:0}
.dsh-sticky-card{
  appearance:none;display:flex;flex-direction:column;gap:3px;width:100%;box-sizing:border-box;
  padding:8px 10px 8px 9px;border-radius:10px;text-align:left;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));
  border-left:3px solid var(--sticky-accent,#eab308);
  background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05));
  color:inherit;font:inherit;cursor:pointer;
}
.dsh-sticky-card:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
.dsh-sticky-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsh-sticky-card[data-color="yellow"]{--sticky-accent:#eab308}
.dsh-sticky-card[data-color="pink"]{--sticky-accent:#ec4899}
.dsh-sticky-card[data-color="blue"]{--sticky-accent:#3b82f6}
.dsh-sticky-card[data-color="green"]{--sticky-accent:#10b981}
.dsh-sticky-card[data-color="purple"]{--sticky-accent:#8b5cf6}
.dsh-sticky-card[data-color="gray"]{--sticky-accent:#9ca3af}
.dsh-sticky-card-title{
  display:block;font-size:13px;line-height:18px;font-weight:600;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.dsh-sticky-card-preview{
  display:block;font-size:12px;line-height:17px;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.92));
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
.dsh-sticky-card-meta{
  display:flex;align-items:center;gap:4px;margin-top:1px;
  font-size:11px;line-height:15px;color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.75));
  font-variant-numeric:tabular-nums;
}

.dsh-sticky-empty{
  display:flex;flex-direction:column;align-items:center;gap:6px;
  padding:34px 20px 38px;text-align:center;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));
}
.dsh-sticky-empty-title{font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.95))}
.dsh-sticky-empty-desc{font-size:12px;line-height:18px;max-width:260px}

.dsh-sticky-editor{display:flex;flex-direction:column;gap:8px;padding:10px 12px 12px;overflow:auto;min-height:0}
.dsh-sticky-editor-bar{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-sticky-ghost{
  appearance:none;display:inline-flex;align-items:center;gap:4px;padding:2px 7px 2px 4px;
  border:0;border-radius:7px;background:transparent;font:inherit;font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));cursor:pointer;
}
.dsh-sticky-ghost:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-sticky-ghost:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsh-sticky-save{
  flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));
  font-variant-numeric:tabular-nums;
}
.dsh-sticky-save[data-state="error"]{color:#e5484d}
.dsh-sticky-save[data-state="conflict"]{color:#d97706}
.dsh-sticky-input,.dsh-sticky-textarea{
  appearance:none;box-sizing:border-box;width:100%;font:inherit;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));
  border-radius:8px;background:var(--dsw-alias-bg-layer-1,transparent);
  color:var(--dsw-alias-label-primary,CanvasText);
  padding:6px 8px;
}
.dsh-sticky-input{font-size:13px;line-height:20px;font-weight:600}
.dsh-sticky-textarea{font-size:12px;line-height:19px;min-height:150px;resize:vertical;font-family:inherit}
.dsh-sticky-input:hover,.dsh-sticky-textarea:hover{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.42))}
.dsh-sticky-input:focus-visible,.dsh-sticky-textarea:focus-visible{
  outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px;border-color:transparent;
}
.dsh-sticky-tools{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.dsh-sticky-colors{display:flex;align-items:center;gap:6px}
.dsh-sticky-swatch{
  appearance:none;width:18px;height:18px;padding:0;border-radius:50%;
  border:2px solid transparent;background:var(--swatch);cursor:pointer;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.12);
}
.dsh-sticky-swatch[data-color="yellow"]{--swatch:#eab308}
.dsh-sticky-swatch[data-color="pink"]{--swatch:#ec4899}
.dsh-sticky-swatch[data-color="blue"]{--swatch:#3b82f6}
.dsh-sticky-swatch[data-color="green"]{--swatch:#10b981}
.dsh-sticky-swatch[data-color="purple"]{--swatch:#8b5cf6}
.dsh-sticky-swatch[data-color="gray"]{--swatch:#9ca3af}
.dsh-sticky-swatch[data-on="true"]{border-color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-sticky-swatch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
.dsh-sticky-chip{
  appearance:none;display:inline-flex;align-items:center;gap:4px;
  padding:3px 9px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));
  background:transparent;font:inherit;font-size:12px;line-height:16px;
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));cursor:pointer;
}
.dsh-sticky-chip:hover{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.45));color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-sticky-chip[data-on="true"]{border-color:transparent;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-sticky-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsh-sticky-foot{display:flex;align-items:center;justify-content:space-between;gap:10px}
.dsh-sticky-danger{
  appearance:none;display:inline-flex;align-items:center;gap:4px;padding:3px 8px;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));border-radius:7px;
  background:transparent;font:inherit;font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));cursor:pointer;
}
.dsh-sticky-danger:hover{border-color:rgba(229,72,77,.55);color:#e5484d}
.dsh-sticky-danger[data-confirm="true"]{border-color:rgba(229,72,77,.6);color:#e5484d}
.dsh-sticky-danger:focus-visible{outline:2px solid #e5484d;outline-offset:1px}
.dsh-sticky-stamp{font-size:11px;line-height:15px;color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.75));font-variant-numeric:tabular-nums}
.dsh-sticky-banner{
  display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:9px;
  font-size:12px;line-height:17px;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
  background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.92));
}
.dsh-sticky-banner[data-kind="error"]{border-color:rgba(229,72,77,.38);color:#e5484d}
.dsh-sticky-banner[data-kind="warn"]{border-color:rgba(217,119,6,.42);color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-sticky-banner-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsh-sticky-mini{
  appearance:none;padding:3px 9px;border-radius:7px;
  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));
  background:transparent;font:inherit;font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));cursor:pointer;
}
.dsh-sticky-mini:hover{color:var(--dsw-alias-label-primary,CanvasText);border-color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.6))}
.dsh-sticky-mini:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsh-sticky-footer{
  flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));
  font-size:11px;line-height:15px;color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.78));
}
.dsh-sticky-path{
  min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;
}

.dsh-sticky-panel{
  margin:4px 0;padding:14px 16px;border-radius:12px;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
  background:var(--dsw-alias-bg-layer-1,transparent);
}
.dsh-sticky-panel-head{display:flex;align-items:flex-start;gap:10px;margin-bottom:12px}
.dsh-sticky-panel-titles{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
.dsh-sticky-panel-title{font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-sticky-panel-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}
.dsh-sticky-panel-body{display:flex;flex-direction:column;gap:0}
.dsh-sticky-row{
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));
}
.dsh-sticky-row:first-child{border-top:0}
.dsh-sticky-row-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-sticky-row-title{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-sticky-row-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}
.dsh-sticky-row-controls{display:flex;align-items:center;gap:8px;flex:none;min-width:0;max-width:58%}
.dsh-sticky-code{
  min-width:0;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  padding:3px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));
  font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));
}
.dsh-sticky-btn{
  appearance:none;flex:none;padding:4px 12px;border-radius:7px;
  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));
  background:transparent;font:inherit;font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));cursor:pointer;
}
.dsh-sticky-btn:hover{border-color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.6));color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-sticky-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsh-sticky-help{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}
.dsh-sticky-help summary{cursor:pointer;padding:7px 0;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.92))}
.dsh-sticky-help p{margin:4px 0 8px}
.dsh-sticky-help code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}
`;

    function Styles() {
      return h("style", { "data-plugin-css": `${NS}/sticky-notes.css` }, CSS);
    }

    /* ------------------------------------------------------------------ *
     * 图标
     * ------------------------------------------------------------------ */
    function NoteIcon({ size }) {
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false", className: "dsh-sticky-icon" },
        h("path", {
          d: "M3.2 2.8h7.4l2.2 2.2v8.2H3.2z",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.4,
          strokeLinejoin: "round"
        }),
        h("path", {
          d: "M10.5 2.9v2.4h2.3",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.4,
          strokeLinejoin: "round"
        }),
        h("path", { d: "M5.3 7.3h5.4M5.3 9.8h3.8", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" })
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

    function BackIcon({ size }) {
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" },
        h("path", { d: "M9.8 3.6 5.4 8l4.4 4.4", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" })
      );
    }

    function PinIcon({ size }) {
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" },
        h("path", {
          d: "M9.7 1.9l4.4 4.4-1.3 1.3-.8-.2-2.4 2.4.2 2.3-1.2 1.2-2.5-2.5-3 3-.7-.7 3-3L3 7.9l1.2-1.2 2.3.2L9 4.5l-.2-.8z",
          fill: "currentColor"
        })
      );
    }

    function TrashIcon({ size }) {
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" },
        h("path", {
          d: "M3.5 5h9M6.3 5V3.6h3.4V5M4.7 5l.5 8.1h5.6l.5-8.1M6.7 7.2v4M9.3 7.2v4",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.3,
          strokeLinecap: "round",
          strokeLinejoin: "round"
        })
      );
    }

    function CopyIcon({ size }) {
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" },
        h("rect", { x: 5.2, y: 5.2, width: 7.2, height: 7.2, rx: 1.4, fill: "none", stroke: "currentColor", strokeWidth: 1.3 }),
        h("path", { d: "M3.6 10.4V3.6h6.8", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" })
      );
    }

    /* ------------------------------------------------------------------ *
     * 座位 1：用量栏里的「便签」开关
     * ------------------------------------------------------------------ */
    function StickyDock() {
      useLocaleWakeup();
      const currentPrefs = usePrefs();
      const current = useStore();
      React.useEffect(() => {
        if (current.status === "idle") void refresh();
      }, [current.status]);

      const count = current.status === "ready" ? current.notes.length : 0;
      return h(
        "button",
        {
          type: "button",
          className: "dsh-sticky-dock",
          title: translate("dock.tip"),
          "aria-pressed": currentPrefs.open,
          onClick: () => writePrefs({ open: !currentPrefs.open })
        },
        h(Styles, { key: "css" }),
        h(NoteIcon, { size: 13, key: "icon" }),
        h("span", { key: "label" }, translate("dock.label")),
        count > 0 ? h("span", { className: "dsh-sticky-dock-count", key: "count" }, String(count)) : null
      );
    }

    /* ------------------------------------------------------------------ *
     * 座位 2：悬浮便签板
     * ------------------------------------------------------------------ */
    function StickyBoard() {
      useLocaleWakeup();
      const currentPrefs = usePrefs();
      const current = useStore();
      const open = currentPrefs.open;

      const [pos, setPos] = React.useState(() => (currentPrefs.pos === null ? defaultPos() : clampPos(currentPrefs.pos)));
      const drag = React.useRef(null);
      const boardRef = React.useRef(null);

      const [mode, setMode] = React.useState("list");
      const [draft, setDraft] = React.useState(null);
      const [saveStatus, setSaveStatus] = React.useState("idle");
      const [saveError, setSaveError] = React.useState(null);
      const [conflict, setConflict] = React.useState(null);
      const [confirmDelete, setConfirmDelete] = React.useState(false);

      const draftRef = React.useRef(null);
      const baselineRef = React.useRef("");
      const editorToken = React.useRef(0);
      const saveTimer = React.useRef(0);
      const saveChain = React.useRef(Promise.resolve());
      const titleRef = React.useRef(null);

      const setDraftBoth = (next) => {
        draftRef.current = next;
        setDraft(next);
      };

      const closeEditor = () => {
        editorToken.current += 1;
        if (saveTimer.current) {
          window.clearTimeout(saveTimer.current);
          saveTimer.current = 0;
        }
        setMode("list");
        setDraftBoth(null);
        baselineRef.current = "";
        setSaveStatus("idle");
        setSaveError(null);
        setConflict(null);
        setConfirmDelete(false);
      };

      const openEditor = (note) => {
        editorToken.current += 1;
        if (saveTimer.current) {
          window.clearTimeout(saveTimer.current);
          saveTimer.current = 0;
        }
        const next = note === null ? emptyDraft() : draftOf(note);
        setDraftBoth(next);
        baselineRef.current = draftKey(next);
        setMode("edit");
        setSaveStatus("idle");
        setSaveError(null);
        setConflict(null);
        setConfirmDelete(false);
      };

      const schedulePersist = () => {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          saveTimer.current = 0;
          const latest = draftRef.current;
          if (latest !== null) void persist(latest, editorToken.current);
        }, SAVE_DELAY);
      };

      const updateDraft = (patch) => {
        const latest = draftRef.current;
        if (latest === null) return;
        const next = { ...latest, ...patch };
        setDraftBoth(next);
        setConfirmDelete(false);
        if (draftKey(next) === baselineRef.current) {
          setSaveStatus("saved");
          if (saveTimer.current) {
            window.clearTimeout(saveTimer.current);
            saveTimer.current = 0;
          }
          return;
        }
        setSaveStatus("dirty");
        setConflict(null);
        setSaveError(null);
        schedulePersist();
      };

      async function persist(candidate, token) {
        if (candidate === null || candidate === undefined) return false;
        if (candidate.id === null && candidate.title.trim() === "" && candidate.body.trim() === "") return false;
        const openedFor = token ?? editorToken.current;
        const run = saveChain.current.then(
          () => doSave(candidate, openedFor),
          () => doSave(candidate, openedFor)
        );
        saveChain.current = run.then(
          () => undefined,
          () => undefined
        );
        return run;
      }

      async function doSave(candidate, token) {
        if (token !== editorToken.current) return false;
        if (api === null) {
          setSaveError({ code: "sticky/offline", message: "", details: {} });
          setSaveStatus("error");
          return false;
        }
        const latest = draftRef.current;
        if (latest === null) return false;
        setSaveStatus("saving");
        setSaveError(null);
        try {
          const payload = {
            id: latest.id,
            title: candidate.title,
            body: candidate.body,
            color: candidate.color,
            pinned: candidate.pinned,
            baseRev: latest.id === null ? null : latest.rev
          };
          const result = await api.save(payload);
          localMutations += 1;
          if (isRecord(result) && Array.isArray(result.notes)) {
            publish({
              status: "ready",
              notes: result.notes,
              revision: typeof result.revision === "string" ? result.revision : store.revision,
              path: typeof result.path === "string" ? result.path : store.path,
              displayPath: typeof result.displayPath === "string" ? result.displayPath : store.displayPath,
              exists: true,
              loadedAt: Date.now(),
              error: null
            });
          }
          if (token !== editorToken.current) return true;

          const savedKey = draftKey(candidate);
          baselineRef.current = savedKey;
          const currentDraft = draftRef.current;
          if (currentDraft !== null && isRecord(result?.note)) {
            const merged = {
              ...currentDraft,
              id: result.note.id,
              rev: result.note.rev,
              createdAt: result.note.createdAt,
              updatedAt: result.note.updatedAt
            };
            setDraftBoth(merged);
            if (draftKey(merged) !== savedKey) {
              setSaveStatus("dirty");
              schedulePersist();
            } else {
              setSaveStatus("saved");
            }
          } else {
            setSaveStatus("saved");
          }
          setSaveError(null);
          setConflict(null);
          return true;
        } catch (error) {
          if (token !== editorToken.current) return false;
          const failure = toClientError(error);
          if (failure.code === "sticky/conflict") {
            setConflict(isRecord(failure.details?.current) ? failure.details.current : null);
            setSaveStatus("conflict");
            void refresh({ quiet: true });
          } else {
            setSaveError(failure);
            setSaveStatus("error");
          }
          return false;
        }
      }

      const flush = () => {
        if (saveTimer.current) {
          window.clearTimeout(saveTimer.current);
          saveTimer.current = 0;
        }
        const latest = draftRef.current;
        if (latest !== null && draftKey(latest) !== baselineRef.current) {
          void persist(latest);
        }
      };

      const handleBack = async () => {
        const latest = draftRef.current;
        if (latest === null) {
          closeEditor();
          return;
        }
        if (latest.id === null && latest.title.trim() === "" && latest.body.trim() === "") {
          closeEditor();
          return;
        }
        if (saveTimer.current) {
          window.clearTimeout(saveTimer.current);
          saveTimer.current = 0;
        }
        if (draftKey(latest) !== baselineRef.current) {
          const saved = await persist(latest);
          if (!saved) return;
        }
        closeEditor();
      };

      const overwrite = () => {
        const latest = draftRef.current;
        if (latest === null) return;
        const rev = isRecord(conflict) && Number.isInteger(conflict.rev) ? conflict.rev : null;
        const next = { ...latest, rev };
        setDraftBoth(next);
        setConflict(null);
        setSaveStatus("dirty");
        void persist(next);
      };

      const discard = () => {
        const latest = draftRef.current;
        if (latest === null) {
          closeEditor();
          return;
        }
        const note = latest.id === null ? null : current.notes.find((candidate) => candidate.id === latest.id);
        if (note === undefined || note === null) closeEditor();
        else openEditor(note);
      };

      const handleDelete = async () => {
        const latest = draftRef.current;
        if (latest === null) return;
        if (latest.id === null) {
          closeEditor();
          return;
        }
        if (api === null) {
          setSaveError({ code: "sticky/offline", message: "", details: {} });
          setSaveStatus("error");
          return;
        }
        try {
          const result = await api.remove(latest.id, latest.rev);
          localMutations += 1;
          if (isRecord(result) && Array.isArray(result.notes)) {
            publish({
              status: "ready",
              notes: result.notes,
              revision: typeof result.revision === "string" ? result.revision : store.revision,
              path: typeof result.path === "string" ? result.path : store.path,
              displayPath: typeof result.displayPath === "string" ? result.displayPath : store.displayPath,
              exists: true,
              loadedAt: Date.now(),
              error: null
            });
          }
          closeEditor();
        } catch (error) {
          const failure = toClientError(error);
          if (failure.code === "sticky/conflict") {
            setConflict(isRecord(failure.details?.current) ? failure.details.current : null);
            setSaveStatus("conflict");
          } else {
            setSaveError(failure);
            setSaveStatus("error");
          }
          void refresh({ quiet: true });
        }
      };

      const copyPath = async () => {
        const text = store.path || store.displayPath;
        if (text === "") return;
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          /* 没有剪贴板权限就不提示成功 */
        }
      };

      // 位置：拖动只在松手时写偏好；窗口尺寸变了收回视野。
      const posKey = currentPrefs.pos === null ? "" : `${currentPrefs.pos.x},${currentPrefs.pos.y}`;
      React.useLayoutEffect(() => {
        if (currentPrefs.pos !== null) setPos(clampPos(currentPrefs.pos));
      }, [posKey]);

      React.useEffect(() => {
        const onResize = () => setPos((previous) => clampPos(previous));
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }, []);

      React.useEffect(() => {
        if (!open) return undefined;
        void refresh({ quiet: current.status === "ready" });
        const timer = window.setInterval(() => {
          if (typeof document !== "undefined" && document.hidden) return;
          void refresh({ quiet: true });
        }, 10000);
        const onFocus = () => void refresh({ quiet: true });
        window.addEventListener("focus", onFocus);
        return () => {
          window.clearInterval(timer);
          window.removeEventListener("focus", onFocus);
        };
      }, [open]);

      React.useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => {
          if (event.key !== "Escape") return;
          if (mode === "edit") {
            event.preventDefault();
            void handleBack();
          } else {
            writePrefs({ open: false });
          }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [open, mode, handleBack]);

      // 新便签进入编辑后把光标放到标题。
      React.useEffect(() => {
        if (mode === "edit" && draft !== null && draft.id === null && titleRef.current !== null) {
          titleRef.current.focus();
        }
      }, [mode, draft === null ? null : draft.id]);

      React.useEffect(() => {
        if (!confirmDelete) return undefined;
        const timer = window.setTimeout(() => setConfirmDelete(false), 4000);
        return () => window.clearTimeout(timer);
      }, [confirmDelete]);

      React.useEffect(() => () => {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
      }, []);

      const onPointerDown = (event) => {
        if (event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest("button")) return;
        const rect = event.currentTarget.getBoundingClientRect();
        drag.current = {
          pointerId: event.pointerId,
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
          startX: event.clientX,
          startY: event.clientY,
          moved: false
        };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* 没有指针捕获也能拖 */
        }
      };

      const onPointerMove = (event) => {
        const currentDrag = drag.current;
        if (currentDrag === null || currentDrag.pointerId !== event.pointerId) return;
        const dx = event.clientX - currentDrag.startX;
        const dy = event.clientY - currentDrag.startY;
        if (!currentDrag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        currentDrag.moved = true;
        setPos(clampPos({ x: event.clientX - currentDrag.offsetX, y: event.clientY - currentDrag.offsetY }));
      };

      const onPointerUp = (event) => {
        const currentDrag = drag.current;
        if (currentDrag === null || currentDrag.pointerId !== event.pointerId) return;
        drag.current = null;
        if (!currentDrag.moved) return;
        writePrefs({ pos: clampPos({ x: event.clientX - currentDrag.offsetX, y: event.clientY - currentDrag.offsetY }) });
      };

      if (!open) return null;

      const notes = orderNotes(current.notes);
      const statusText = saveLabel(saveStatus);
      const pathText = current.displayPath || current.path;

      const banner = (() => {
        if (current.status === "error" || current.status === "offline") {
          return h(
            "div",
            { className: "dsh-sticky-banner", "data-kind": "error", key: "load-error" },
            h("span", null, errorText(current.error)),
            h(
              "div",
              { className: "dsh-sticky-banner-actions" },
              h("button", { type: "button", className: "dsh-sticky-mini", onClick: () => void refresh() }, translate("board.retry"))
            )
          );
        }
        return null;
      })();

      const listBody =
        current.status === "loading" || current.status === "idle"
          ? h("div", { className: "dsh-sticky-empty", key: "loading" }, h("div", { className: "dsh-sticky-empty-desc" }, translate("board.loading")))
          : notes.length === 0
            ? h(
                "div",
                { className: "dsh-sticky-empty", key: "empty" },
                h(NoteIcon, { size: 26 }),
                h("div", { className: "dsh-sticky-empty-title" }, translate("board.empty")),
                h("div", { className: "dsh-sticky-empty-desc" }, translate("board.emptyHint"))
              )
            : notes.map((note) =>
                h(
                  "button",
                  {
                    key: note.id,
                    type: "button",
                    className: "dsh-sticky-card",
                    "data-color": note.color,
                    title: note.title,
                    "aria-label": tf("board.noteAria", { title: note.title || translate("board.untitled") }),
                    onClick: () => openEditor(note)
                  },
                  h(
                    "span",
                    { className: "dsh-sticky-card-title" },
                    note.title || translate("board.untitled")
                  ),
                  note.body ? h("span", { className: "dsh-sticky-card-preview" }, previewOf(note.body, 120)) : null,
                  h(
                    "span",
                    { className: "dsh-sticky-card-meta" },
                    note.pinned === true ? h(PinIcon, { size: 10, key: "pin" }) : null,
                    h("span", { key: "time" }, relativeTime(note.updatedAt, Date.now(), tf))
                  )
                )
              );

      const editor =
        draft === null
          ? null
          : h(
              "div",
              { className: "dsh-sticky-editor", key: "editor" },
              h(
                "div",
                { className: "dsh-sticky-editor-bar" },
                h(
                  "button",
                  { type: "button", className: "dsh-sticky-ghost", onClick: () => void handleBack() },
                  h(BackIcon, { size: 13 }),
                  h("span", null, translate("board.back"))
                ),
                h("span", { className: "dsh-sticky-save", "data-state": saveStatus }, statusText)
              ),
              h("input", {
                ref: titleRef,
                className: "dsh-sticky-input",
                type: "text",
                value: draft.title,
                maxLength: 200,
                placeholder: translate("board.titlePlaceholder"),
                "aria-label": translate("board.titlePlaceholder"),
                onChange: (event) => updateDraft({ title: event.target.value }),
                onBlur: flush
              }),
              h("textarea", {
                className: "dsh-sticky-textarea",
                value: draft.body,
                maxLength: 20000,
                placeholder: translate("board.bodyPlaceholder"),
                "aria-label": translate("board.bodyPlaceholder"),
                onChange: (event) => updateDraft({ body: event.target.value }),
                onBlur: flush
              }),
              h(
                "div",
                { className: "dsh-sticky-tools" },
                h(
                  "div",
                  { className: "dsh-sticky-colors", role: "group", "aria-label": translate("board.color") },
                  COLORS.map((color) =>
                    h("button", {
                      key: color,
                      type: "button",
                      className: "dsh-sticky-swatch",
                      "data-color": color,
                      "data-on": draft.color === color,
                      title: translate(`color.${color}`),
                      "aria-label": translate(`color.${color}`),
                      "aria-pressed": draft.color === color,
                      onClick: () => updateDraft({ color })
                    })
                  )
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "dsh-sticky-chip",
                    "data-on": draft.pinned === true,
                    "aria-pressed": draft.pinned === true,
                    onClick: () => updateDraft({ pinned: draft.pinned !== true })
                  },
                  h(PinIcon, { size: 11 }),
                  h("span", null, draft.pinned === true ? translate("board.unpin") : translate("board.pin"))
                )
              ),
              saveStatus === "conflict"
                ? h(
                    "div",
                    { className: "dsh-sticky-banner", "data-kind": "warn" },
                    h("span", null, translate("board.conflictDesc")),
                    h(
                      "div",
                      { className: "dsh-sticky-banner-actions" },
                      h("button", { type: "button", className: "dsh-sticky-mini", onClick: overwrite }, translate("board.overwrite")),
                      h("button", { type: "button", className: "dsh-sticky-mini", onClick: discard }, translate("board.discard"))
                    )
                  )
                : null,
              saveStatus === "error" && saveError !== null
                ? h(
                    "div",
                    { className: "dsh-sticky-banner", "data-kind": "error" },
                    h("span", null, errorText(saveError)),
                    h(
                      "div",
                      { className: "dsh-sticky-banner-actions" },
                      h(
                        "button",
                        { type: "button", className: "dsh-sticky-mini", onClick: () => void persist(draftRef.current) },
                        translate("board.retry")
                      )
                    )
                  )
                : null,
              h(
                "div",
                { className: "dsh-sticky-foot" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "dsh-sticky-danger",
                    "data-confirm": confirmDelete,
                    onClick: () => {
                      if (!confirmDelete) {
                        setConfirmDelete(true);
                        return;
                      }
                      void handleDelete();
                    }
                  },
                  h(TrashIcon, { size: 12 }),
                  h("span", null, confirmDelete ? translate("board.deleteConfirm") : translate("board.delete"))
                ),
                draft.updatedAt
                  ? h(
                      "span",
                      { className: "dsh-sticky-stamp" },
                      `${translate("board.updated")} ${relativeTime(draft.updatedAt, Date.now(), tf)}`
                    )
                  : null
              )
            );

      return h(
        "div",
        {
          ref: boardRef,
          className: "dsh-sticky-board",
          role: "dialog",
          "aria-label": translate("board.title"),
          style: { left: `${pos.x}px`, top: `${pos.y}px` }
        },
        h(Styles, { key: "css" }),
        h(
          "div",
          {
            className: "dsh-sticky-head",
            key: "head",
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
            onDoubleClick: (event) => {
              if (event.target instanceof Element && event.target.closest("button")) return;
              writePrefs({ open: false });
            }
          },
          h("span", { className: "dsh-sticky-mark" }, h(NoteIcon, { size: 15 })),
          h(
            "div",
            { className: "dsh-sticky-heading" },
            h("span", { className: "dsh-sticky-title" }, translate("board.title")),
            h(
              "span",
              { className: "dsh-sticky-sub" },
              current.status === "ready" ? tf("board.count", { n: current.notes.length }) : pathText || translate("board.loading")
            )
          ),
          h(
            "div",
            { className: "dsh-sticky-head-actions" },
            mode === "list"
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "dsh-sticky-iconbtn",
                    title: translate("board.new"),
                    "aria-label": translate("board.new"),
                    onClick: () => openEditor(null)
                  },
                  h(PlusIcon, { size: 15 })
                )
              : null,
            h(
              "button",
              {
                type: "button",
                className: "dsh-sticky-iconbtn",
                title: translate("board.refresh"),
                "aria-label": translate("board.refresh"),
                onClick: () => void refresh()
              },
              h(RefreshIcon, { size: 14 })
            ),
            h(
              "button",
              {
                type: "button",
                className: "dsh-sticky-iconbtn",
                title: translate("board.close"),
                "aria-label": translate("board.close"),
                onClick: () => writePrefs({ open: false })
              },
              h(CloseIcon, { size: 14 })
            )
          )
        ),
        banner,
        mode === "edit" ? editor : h("div", { className: "dsh-sticky-list", key: "list" }, listBody),
        h(
          "div",
          { className: "dsh-sticky-footer", key: "footer" },
          h("span", { className: "dsh-sticky-path", title: current.path }, pathText || translate("board.loading")),
          h(
            "button",
            { type: "button", className: "dsh-sticky-mini", onClick: () => void copyPath(), title: translate("board.copy") },
            translate("board.copy")
          )
        )
      );
    }

    /* ------------------------------------------------------------------ *
     * 座位 3：插件页的设置卡片
     * ------------------------------------------------------------------ */
    function StickyPanel() {
      useLocaleWakeup();
      const currentPrefs = usePrefs();
      const current = useStore();
      const [copied, setCopied] = React.useState(false);

      React.useEffect(() => {
        if (current.status === "idle") void refresh();
      }, [current.status]);

      const copyPath = async () => {
        const text = current.path || current.displayPath;
        if (text === "") return;
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* 剪贴板不可用时不假装成功 */
        }
      };

      return h(
        "section",
        { className: "dsh-sticky-panel" },
        h(Styles, { key: "css" }),
        h(
          "div",
          { className: "dsh-sticky-panel-head", key: "head" },
          h("span", { className: "dsh-sticky-mark" }, h(NoteIcon, { size: 16 })),
          h(
            "div",
            { className: "dsh-sticky-panel-titles" },
            h("span", { className: "dsh-sticky-panel-title" }, translate("panel.title")),
            h("span", { className: "dsh-sticky-panel-desc" }, translate("panel.desc"))
          )
        ),
        h(
          "div",
          { className: "dsh-sticky-panel-body" },
          h(
            "div",
            { className: "dsh-sticky-row" },
            h(
              "div",
              { className: "dsh-sticky-row-text" },
              h("span", { className: "dsh-sticky-row-title" }, translate("panel.storage")),
              h("span", { className: "dsh-sticky-row-desc" }, translate("panel.storageDesc"))
            ),
            h(
              "div",
              { className: "dsh-sticky-row-controls" },
              h("code", { className: "dsh-sticky-code", title: current.path }, current.displayPath || "…"),
              h(
                "button",
                { type: "button", className: "dsh-sticky-btn", onClick: () => void copyPath() },
                copied ? translate("panel.copied") : translate("panel.copy")
              )
            )
          ),
          h(
            "div",
            { className: "dsh-sticky-row" },
            h(
              "div",
              { className: "dsh-sticky-row-text" },
              h("span", { className: "dsh-sticky-row-title" }, translate("panel.count")),
              h(
                "span",
                { className: "dsh-sticky-row-desc" },
                current.status === "ready"
                  ? `${current.notes.length}`
                  : current.status === "error" || current.status === "offline"
                    ? errorText(current.error)
                    : translate("board.loading")
              )
            ),
            h(
              "div",
              { className: "dsh-sticky-row-controls" },
              h(
                "button",
                { type: "button", className: "dsh-sticky-btn", onClick: () => writePrefs({ open: true }) },
                translate("panel.open")
              ),
              h(
                "button",
                { type: "button", className: "dsh-sticky-btn", onClick: () => void refresh() },
                translate("panel.refresh")
              )
            )
          ),
          h(
            "div",
            { className: "dsh-sticky-row" },
            h(
              "div",
              { className: "dsh-sticky-row-text" },
              h("span", { className: "dsh-sticky-row-title" }, translate("panel.status")),
              h(
                "span",
                { className: "dsh-sticky-row-desc" },
                current.status === "ready" ? translate("panel.connected") : translate("panel.offline")
              )
            ),
            h(
              "div",
              { className: "dsh-sticky-row-controls" },
              h(
                "button",
                { type: "button", className: "dsh-sticky-btn", onClick: () => writePrefs({ open: !currentPrefs.open }) },
                currentPrefs.open ? translate("board.close") : translate("panel.open")
              )
            )
          ),
          h(
            "details",
            { className: "dsh-sticky-help" },
            h("summary", null, translate("panel.format")),
            h("p", null, translate("panel.formatDesc")),
            h("p", null, translate("panel.localDesc"))
          )
        )
      );
    }

    /* ------------------------------------------------------------------ *
     * 装配
     * ------------------------------------------------------------------ */
    function registerLocale(ctx) {
      const locale = typeof ctx.get === "function" ? ctx.get("locale") : undefined;
      if (locale === undefined || typeof locale.register !== "function" || typeof locale.bind !== "function") {
        return;
      }
      const disposers = [];
      try {
        disposers.push(locale.register(NS, "zh", ZH));
        disposers.push(locale.register(NS, "en", EN));
        const bound = locale.bind(NS);
        if (typeof bound === "function") {
          translate = bound;
          localeFace = locale;
        }
      } catch (error) {
        console.warn(`[${NS}] 文案未能挂到 locale 服务，退回内置中文：`, error);
      }
      if (disposers.length > 0 && typeof ctx.effect === "function") {
        ctx.effect(
          () => () => {
            for (const dispose of disposers) {
              try {
                dispose();
              } catch {
                /* 已卸载 */
              }
            }
          },
          `${NS}/locale`
        );
      }
    }

    async function apply(ctx) {
      registerLocale(ctx);

      ctx.slots.inject(DOCK_SLOT, () =>
        ctx.slots.register({ name: DOCK_SLOT, id: "sticky-notes", order: 14 }, StickyDock)
      );
      ctx.slots.inject(OVERLAY_SLOT, () =>
        ctx.slots.register({ name: OVERLAY_SLOT, id: "sticky-notes-board", order: 24 }, StickyBoard)
      );
      for (const key of ["dsh-sticky-notes", "include:dsh-sticky-notes"]) {
        ctx.slots.inject(PANEL_SLOT, () =>
          ctx.slots.register({ name: PANEL_SLOT, key, priority: 40 }, StickyPanel)
        );
      }

      // 精确 Fetch 路由由 Host 半注册在 /api 下；浏览器这边只要有 fetch 就能用，
      // 不再依赖 client 侧是否已经提供 connection 服务。
      attach();
    }

    const moduleApi = { apply, inject: ["slots"] };
    if (typeof window !== "undefined" && window.__dshStickyNotesTest === true) {
      moduleApi.__internals = {
        previewOf,
        relativeTime,
        normalizePrefs,
        orderNotes,
        draftOf,
        emptyDraft,
        draftKey,
        createApi,
        toClientError,
        errorText,
        saveLabel,
        clampPos
      };
    }
    return moduleApi;
  }
});
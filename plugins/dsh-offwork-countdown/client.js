/**
 * dsh-offwork-countdown — 浏览器半。
 *
 * 三个座位共用同一份设置（localStorage，见 `writeSettings`）：
 *
 *  1. `conversation.composer.dock` —— 用量栏里的纯文字胶囊，颜色与旁边的用量
 *     元素完全一致（没有强调色）；下面还有一枚可点的计时器，文案可自定义
 *     （「距上次喝水」「距上次上厕所」「距上次站起来」……），点一下归零。
 *  2. `shell.overlay` —— 悬浮窗大卡片，按官方宣传图的灰阶做：图标 + 标题、
 *     大号 HH:MM:SS、粗进度条、页脚「下班时间 18:30 / 100%」。可拖、可双击关，
 *     位置支持 上方/下方 两档。
 *  3. `settings.section` —— 插件设置页：上班/午饭/午休结束/下班四个时间，午休开关、
 *     上午显示谁、计时器（开关 + 自定义文案 + 常用写法）、用量栏与悬浮窗开关、
 *     悬浮窗位置、双击关闭、恢复默认。
 *
 * 为什么状态在页面侧而不是 Host 的 Config：倒计时只依赖浏览器自己的钟和这几个
 * 偏好值，Host 半拿它没有用途；放在页面里改完即生效，不需要重载 DSH。
 *
 * 时间规则（`viewAt`）：周一到周五才算工作日；下班时间 ≤ 上班时间视为跨夜班次
 * （下班落在次日，这种班次不拆午休）；午休时段倒计时改数「距午休结束」，
 * 进度条在这个区间原地不动，因为午休不算工时。
 */
window.__ModuleLoader__.load({
  id: "dsh-offwork-countdown",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;

    const NS = "dsh-offwork-countdown";
    const STORAGE_KEY = "{{SECRET_m4kd92x7}}";
    const DOCK_SLOT = "conversation.composer.dock";
    const OVERLAY_SLOT = "shell.overlay";
    const PANEL_SLOT = "plugins.bundle.config";
    const DEFAULTS = {
      start: "09:00",
      end: "18:00",
      lunch: true,
      lunchStart: "12:00",
      lunchEnd: "13:00",
      morningLunch: false,
      timer: true,
      timerLabel: "",
      dock: true,
      dockSeconds: true,
      timerSeconds: true,
      floatSeconds: true,
      floatSide: "top",
      float: true,
      dblclick: true,
      lastDrink: null,
      pos: null
    };
    const MINUTE = 60000;
    const CARD_WIDTH = 268;
    /** 关掉秒之后的宽度（数字从 8 个字符变成 5 个）。 */
    const CARD_WIDTH_COMPACT = 190;
    const DRAG_THRESHOLD = 4;
    /**
     * 窗口右上那组最小化 / 最大化 / 关闭按钮是画在页面内容之上的（桌面端无边框窗口）。
     * 浮窗最小 y 要留出这一条，否则会被盖住；拖动与恢复旧位置时都按它夹。
     */
    const TOP_SAFE = 52;

    /* ------------------------------------------------------------------ *
     * 文案：内置中英两份；locale 服务可用时注册进它的命名空间，
     * 注册失败就退回内置中文，绝不出现裸 key。
     * ------------------------------------------------------------------ */
    const ZH = {
      "dock.toEnd": "距下班",
      "dock.toStart": "距上班",
      "dock.toLunch": "距午饭",
      "dock.lunch": "午休",
      "dock.offWork": "已下班",
      "dock.rest": "今天休息",
      "dock.tipPrefix": "工作时间",
      "dock.timerPrefix": "距上次",
      "dock.timerDefault": "喝水",
      "timer.tip": "点一下归零",
      "timer.presetDrink": "喝水",
      "timer.presetToilet": "上厕所",
      "timer.presetStand": "站起来",
      "timer.presetRest": "休息一下",
      "float.toEnd": "距离下班",
      "float.toStart": "距离上班",
      "float.toLunch": "距离午饭",
      "float.lunch": "午休中",
      "float.offWork": "已经下班",
      "float.rest": "今天休息",
      "float.restFooter": "工作日 周一至周五",
      "float.footerStart": "上班时间",
      "float.footerEnd": "下班时间",
      "float.footerLunch": "午饭时间",
      "float.footerLunchEnd": "午休结束",
      "float.tip": "拖动可以移动；双击关闭",
      "group.general": "通用",
      "group.dock": "用量栏",
      "group.timer": "计时器",
      "group.float": "悬浮窗",
      "group.other": "其他",
      "panel.title": "下班倒计时",
      "panel.desc": "时间、午休、计时器文案，以及各处的显示开关 —— 改完立刻生效。",
      "settings.timeTitle": "上下班时间",
      "settings.timeDesc": "下班时间不晚于上班时间时按跨夜班次计算，跨夜班次不拆午休。",
      "settings.start": "上班",
      "settings.end": "下班",
      "settings.lunch": "午休",
      "settings.lunchDesc": "午饭到午休结束这段时间不计入工时，进度条会跳过它。",
      "settings.lunchRange": "午休时间",
      "settings.lunchRangeDesc": "午饭到午休结束要落在上班与下班之间，否则按没有午休处理。",
      "settings.lunchStart": "午饭",
      "settings.lunchEnd": "午休结束",
      "settings.morningTitle": "上午显示",
      "settings.morningLunch": "上午显示午饭倒计时",
      "settings.morningLunchDesc": "打开时上午显示「距午饭」，关闭时全天显示「距下班」。",
      "settings.dock": "用量栏",
      "settings.dockDesc": "在输入框下方的用量栏里显示「距下班」一行。",
      "settings.seconds": "显示秒",
      "settings.secondsDesc": "关掉后只显示到分钟（01:27），不再每秒跳动。",
      "settings.timer": "计时器",
      "settings.timerDesc": "在用量栏显示一条可以点一下归零的计时；每天从上班时间重新起算，隔夜不累加。",
      "settings.timerLabel": "文案",
      "settings.timerLabelDesc": "用量栏里显示成「距上次」加上这里填的词；留空就是「喝水」。",
      "settings.timerPresets": "常用",
      "settings.timerPresetsDesc": "点一下直接填进上面的文案。",
      "settings.float": "悬浮窗",
      "settings.floatDesc": "在页面上显示大号倒计时卡片，可以拖到任意位置。",
      "settings.floatSide": "悬浮窗位置",
      "settings.floatSideDesc": "上方或下方，选一下就回到该位置；也可以直接拖动卡片。",
      "settings.sideTop": "上方",
      "settings.sideBottom": "下方",
      "settings.dblclick": "双击关闭",
      "settings.dblclickDesc": "双击悬浮窗就把它关掉；关掉后回这里重新打开。",
      "settings.resetTitle": "恢复默认",
      "settings.resetDesc": "时间回到 09:00–18:00、午休 12:00–13:00，显示项全部打开，位置回到上方。",
      "settings.resetAction": "重置"
    };
    const EN = {
      "dock.toEnd": "Off work in",
      "dock.toStart": "Work starts in",
      "dock.toLunch": "Lunch in",
      "dock.lunch": "Lunch break",
      "dock.offWork": "Off work",
      "dock.rest": "Day off",
      "dock.tipPrefix": "Work hours",
      "dock.timerPrefix": "Since last ",
      "dock.timerDefault": "drink",
      "timer.tip": "Click to reset",
      "timer.presetDrink": "drink",
      "timer.presetToilet": "bathroom break",
      "timer.presetStand": "stand-up",
      "timer.presetRest": "break",
      "float.toEnd": "Until off work",
      "float.toStart": "Until work starts",
      "float.toLunch": "Until lunch",
      "float.lunch": "On lunch break",
      "float.offWork": "Off work",
      "float.rest": "Day off",
      "float.restFooter": "Workdays, Monday to Friday",
      "float.footerStart": "Work starts at",
      "float.footerEnd": "Off work at",
      "float.footerLunch": "Lunch at",
      "float.footerLunchEnd": "Back at",
      "float.tip": "Drag to move · double-click to close",
      "group.general": "General",
      "group.dock": "Dock",
      "group.timer": "Timer",
      "group.float": "Floating card",
      "group.other": "Other",
      "panel.title": "Off-work countdown",
      "panel.desc": "Hours, lunch break, timer label and what is shown where — changes apply immediately.",
      "settings.timeTitle": "Work hours",
      "settings.timeDesc": "When the end time is not later than the start time, the shift crosses midnight and keeps no lunch break.",
      "settings.start": "Start",
      "settings.end": "End",
      "settings.lunch": "Lunch break",
      "settings.lunchDesc": "The time from lunch to the end of the break is not counted, so the bar skips it.",
      "settings.lunchRange": "Lunch hours",
      "settings.lunchRangeDesc": "Lunch must fall inside the work hours; otherwise no break is applied.",
      "settings.lunchStart": "Lunch",
      "settings.lunchEnd": "Back",
      "settings.morningTitle": "Morning readout",
      "settings.morningLunch": "Show lunch countdown in the morning",
      "settings.morningLunchDesc": "On: the morning shows the time until lunch. Off: it always shows the time until off work.",
      "settings.dock": "Dock line",
      "settings.dockDesc": "Show the countdown line in the composer dock below the input.",
      "settings.seconds": "Show seconds",
      "settings.secondsDesc": "Off: values stop at minutes (01:27) and no longer tick every second.",
      "settings.timer": "Timer",
      "settings.timerDesc": "A timer in the dock that resets when clicked; it starts again at work start each day and never carries over overnight.",
      "settings.timerLabel": "Label",
      "settings.timerLabelDesc": "Shown after the fixed prefix in the dock; leave it empty for “drink”.",
      "settings.timerPresets": "Presets",
      "settings.timerPresetsDesc": "Click one to fill the label above.",
      "settings.float": "Floating card",
      "settings.floatDesc": "Show the large countdown card, draggable anywhere on the page.",
      "settings.floatSide": "Card position",
      "settings.floatSideDesc": "Top or bottom — picking one moves the card there; you can also drag it.",
      "settings.sideTop": "Top",
      "settings.sideBottom": "Bottom",
      "settings.dblclick": "Double-click to close",
      "settings.dblclickDesc": "Double-clicking the card closes it; reopen it here.",
      "settings.resetTitle": "Restore defaults",
      "settings.resetDesc": "Back to 09:00–18:00 with lunch 12:00–13:00, everything shown, card back at the top.",
      "settings.resetAction": "Reset"
    };

    let translate = (key) => (Object.prototype.hasOwnProperty.call(ZH, key) ? ZH[key] : key);
    let localeFace;

    /* ------------------------------------------------------------------ *
     * 设置：模块内单一真相 + localStorage 持久化 + 订阅
     * ------------------------------------------------------------------ */

    /** "09:30" → { hours, minutes, minutesOfDay }；非法/越界返回 undefined。 */
    function parseClock(text) {
      const match = /^(\d{1,2}):(\d{2})$/.exec(typeof text === "string" ? text.trim() : "");
      if (match === null) return undefined;
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (hours > 23 || minutes > 59) return undefined;
      return { hours, minutes, minutesOfDay: hours * 60 + minutes };
    }

    /**
     * 位置存的是「贴哪个边 + 离边多远」：`{ ax, dx, ay, dy }`。
     * 老版本存的是像素 `{ x, y }`，读进来时按当前窗口换算一次，之后不会再随缩放漂移。
     */
    function normalizePos(raw) {
      if (raw === null || typeof raw !== "object") return null;
      if ((raw.ax === "left" || raw.ax === "right") && Number.isFinite(raw.dx)) {
        return {
          ax: raw.ax,
          dx: Math.max(0, raw.dx),
          ay: raw.ay === "bottom" ? "bottom" : "top",
          dy: Number.isFinite(raw.dy) ? Math.max(0, raw.dy) : 0
        };
      }
      if (
        Number.isFinite(raw.x) &&
        Number.isFinite(raw.y) &&
        typeof window !== "undefined" &&
        window.innerWidth > 0
      ) {
        return anchorFromPoint({ x: raw.x, y: raw.y }, CARD_WIDTH, 150);
      }
      return null;
    }

    /** 统一成补零的 `HH:MM` —— `<input type="time">` 只认这个格式，不补零会显示成空白。 */
    function padClock(value) {
      const parsed = parseClock(value);
      if (parsed === undefined) return undefined;
      return `${String(parsed.hours).padStart(2, "0")}:${String(parsed.minutes).padStart(2, "0")}`;
    }

    function normalize(raw) {
      const source = raw !== null && typeof raw === "object" ? raw : {};
      const clock = (value, fallback) => {
        const padded = padClock(value);
        return padded === undefined ? fallback : padded;
      };
      return {
        start: clock(source.start, DEFAULTS.start),
        end: clock(source.end, DEFAULTS.end),
        lunch: source.lunch !== false,
        lunchStart: clock(source.lunchStart, DEFAULTS.lunchStart),
        lunchEnd: clock(source.lunchEnd, DEFAULTS.lunchEnd),
        morningLunch: source.morningLunch === true,
        // v1/v2 里这个开关叫 water，老数据要继续有效。
        timer: source.timer !== false && source.water !== false,
        // 旧版把整句（「距上次喝水」）存进 timerLabel，现在只存尾巴那个词。
        timerLabel: (() => {
          let label = typeof source.timerLabel === "string" ? source.timerLabel : "";
          for (const prefix of ["距上次", "Since last "]) {
            if (label.startsWith(prefix)) label = label.slice(prefix.length);
          }
          return label.trim().slice(0, 24);
        })(),
        dock: source.dock !== false,
        dockSeconds: source.dockSeconds !== false,
        timerSeconds: source.timerSeconds !== false,
        floatSeconds: source.floatSeconds !== false,
        float: source.float !== false,
        dblclick: source.dblclick !== false,
        floatSide: source.floatSide === "bottom" ? "bottom" : "top",
        lastDrink: Number.isFinite(source.lastDrink) ? source.lastDrink : null,
        pos: normalizePos(source.pos)
      };
    }

    function readStored() {
      try {
        const text = window.localStorage.getItem(STORAGE_KEY);
        return text === null ? normalize(DEFAULTS) : normalize(JSON.parse(text));
      } catch (error) {
        console.warn(`[${NS}] 设置读取失败，使用默认值：`, error);
        return normalize(DEFAULTS);
      }
    }

    const listeners = new Set();
    let current = readStored();

    function subscribeSettings(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    function writeSettings(patch) {
      current = normalize({ ...current, ...patch });
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      } catch (error) {
        console.warn(`[${NS}] 设置未能写入 localStorage（本次改动仍然生效）：`, error);
      }
      for (const listener of listeners) {
        try {
          listener(current);
        } catch (error) {
          console.warn(`[${NS}] 设置订阅者抛错：`, error);
        }
      }
    }

    function useSettings() {
      const [snapshot, setSnapshot] = React.useState(current);
      React.useEffect(() => {
        setSnapshot(current);
        return subscribeSettings(setSnapshot);
      }, []);
      return snapshot;
    }

    /** locale 切换后重渲染一次：`translate` 在调用时读当前语言，但要有人把组件叫醒。 */
    function useLocaleWakeup() {
      const [, bump] = React.useState(0);
      React.useEffect(() => {
        if (localeFace === undefined) return undefined;
        return localeFace.subscribe(() => bump((count) => count + 1));
      }, []);
    }

    /** 每秒走一格；`active` 为假时不挂定时器（隐藏的座位不烧 CPU）。 */
    function useSecondTick(active) {
      const [now, setNow] = React.useState(() => Date.now());
      React.useEffect(() => {
        if (!active) return undefined;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
      }, [active]);
      return now;
    }

    /* ------------------------------------------------------------------ *
     * 计算：纯函数，边界都在这里
     * ------------------------------------------------------------------ */

    const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

    /**
     * 把设置摊平成一天的边界（分钟为单位）。
     *
     * 午休只在「正常白班」里生效：跨夜班次、或者午饭/午休结束没落在上班与下班
     * 之间（比如下班 12:30 却默认午休到 13:00），一律当作没有午休，绝不产生
     * 负数工时段。
     */
    function scheduleOf(settings) {
      const start = parseClock(settings.start);
      const end = parseClock(settings.end);
      const startMin = start === undefined ? 540 : start.minutesOfDay;
      const endRaw = end === undefined ? 1080 : end.minutesOfDay;
      const overnight = endRaw <= startMin;
      const endMin = overnight ? endRaw + 1440 : endRaw;

      let lunch = null;
      if (settings.lunch === true && !overnight) {
        const lunchStart = parseClock(settings.lunchStart);
        const lunchEnd = parseClock(settings.lunchEnd);
        if (
          lunchStart !== undefined &&
          lunchEnd !== undefined &&
          lunchStart.minutesOfDay > startMin &&
          lunchEnd.minutesOfDay < endRaw &&
          lunchEnd.minutesOfDay > lunchStart.minutesOfDay
        ) {
          lunch = { start: lunchStart.minutesOfDay, end: lunchEnd.minutesOfDay };
        }
      }

      return { startMin, endMin, overnight, lunch, morningLunch: settings.morningLunch === true };
    }

    /** 已干活的比例（午休不算工时），只用于「距下班」这一档的进度条。 */
    function workProgress(nowMin, schedule) {
      const lunchSpan = schedule.lunch === null ? 0 : schedule.lunch.end - schedule.lunch.start;
      const total = schedule.endMin - schedule.startMin - lunchSpan;
      if (total <= 0) return 1;
      let worked = Math.min(nowMin, schedule.endMin) - schedule.startMin;
      if (schedule.lunch !== null) {
        worked -= Math.max(0, Math.min(nowMin, schedule.lunch.end) - schedule.lunch.start);
      }
      return clamp01(worked / total);
    }

    /**
     * @returns {{kind: "rest"} |
     *           {kind: "before", target: "start", msLeft: number, progress: number} |
     *           {kind: "working", target: "lunchStart" | "end", msLeft: number, progress: number} |
     *           {kind: "lunch", target: "lunchEnd", msLeft: number, progress: number} |
     *           {kind: "after", target: "end", msLeft: number, progress: number}}
     */
    function viewAt(date, settings) {
      const day = date.getDay();
      if (day === 0 || day === 6) return { kind: "rest" };

      const schedule = scheduleOf(settings);
      const nowMin =
        date.getHours() * 60 +
        date.getMinutes() +
        date.getSeconds() / 60 +
        date.getMilliseconds() / MINUTE;
      const nowEff = schedule.overnight && nowMin < schedule.startMin ? nowMin + 1440 : nowMin;

      if (nowEff < schedule.startMin) {
        return {
          kind: "before",
          target: "start",
          msLeft: (schedule.startMin - nowEff) * MINUTE,
          progress: 0
        };
      }

      if (schedule.lunch !== null && nowEff >= schedule.lunch.start && nowEff < schedule.lunch.end) {
        const span = schedule.lunch.end - schedule.lunch.start;
        return {
          kind: "lunch",
          target: "lunchEnd",
          msLeft: (schedule.lunch.end - nowEff) * MINUTE,
          progress: clamp01((nowEff - schedule.lunch.start) / span)
        };
      }

      if (nowEff < schedule.endMin) {
        const morning = schedule.lunch !== null && nowEff < schedule.lunch.start;
        if (morning && schedule.morningLunch) {
          const span = schedule.lunch.start - schedule.startMin;
          return {
            kind: "working",
            target: "lunchStart",
            msLeft: (schedule.lunch.start - nowEff) * MINUTE,
            progress: clamp01((nowEff - schedule.startMin) / span)
          };
        }
        return {
          kind: "working",
          target: "end",
          msLeft: (schedule.endMin - nowEff) * MINUTE,
          progress: workProgress(nowEff, schedule)
        };
      }

      return {
        kind: "after",
        target: "end",
        msLeft: (nowEff - schedule.endMin) * MINUTE,
        progress: 1
      };
    }

    /** 毫秒 → HH:MM:SS；`withSeconds` 为 false 时只到 HH:MM（小时不封顶，负数按 0）。 */
    function formatDuration(ms, withSeconds) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      const pad = (value) => String(value).padStart(2, "0");
      return withSeconds === false
        ? `${pad(hours)}:${pad(minutes)}`
        : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }

    function percentOf(view) {
      if (view.kind === "rest") return 0;
      return Math.round(clamp01(view.progress) * 100);
    }

    /** 座位前缀不同、状态词表相同：dock 用短词，float 用完整句。 */
    function labelOf(view, prefix) {
      if (view.kind === "rest") return translate(`${prefix}.rest`);
      if (view.kind === "after") return translate(`${prefix}.offWork`);
      if (view.kind === "before") return translate(`${prefix}.toStart`);
      if (view.kind === "lunch") return translate(`${prefix}.lunch`);
      return translate(view.target === "lunchStart" ? `${prefix}.toLunch` : `${prefix}.toEnd`);
    }

    /** 计时器文案的「尾巴」：用户填的词（喝水 / 上厕所 / 站起来……），留空用默认。 */
    function timerTail(settings) {
      const custom = typeof settings.timerLabel === "string" ? settings.timerLabel.trim() : "";
      return custom === "" ? translate("dock.timerDefault") : custom;
    }

    /** 用量栏里实际显示的整句：「距上次」+ 尾巴。 */
    function timerLabelOf(settings) {
      return `${translate("dock.timerPrefix")}${timerTail(settings)}`;
    }

    /** 悬浮窗页脚左侧：当前数的那个时间点。 */
    function footerOf(view, settings) {
      switch (view.kind === "rest" ? "rest" : view.target) {
        case "rest":
          return translate("float.restFooter");
        case "start":
          return `${translate("float.footerStart")} ${settings.start}`;
        case "lunchStart":
          return `${translate("float.footerLunch")} ${settings.lunchStart}`;
        case "lunchEnd":
          return `${translate("float.footerLunchEnd")} ${settings.lunchEnd}`;
        default:
          return `${translate("float.footerEnd")} ${settings.end}`;
      }
    }

    /**
     * 计时器读数：距上一次点击多久（毫秒）。休息日、当天上班之前返回 null（不显示）。
     *
     * 基准取「今天上班时间」和「上次点击」里更晚的那个：昨晚点的、或者根本没
     * 点过，第二天上班都从上班那一刻重新算，绝不会一开页面就显示十几个小时。
     */
    function timerElapsed(date, settings) {
      const day = date.getDay();
      if (day === 0 || day === 6) return null;

      const schedule = scheduleOf(settings);
      const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const minutesNow = date.getHours() * 60 + date.getMinutes();
      let workStart = midnight + schedule.startMin * MINUTE;
      // 跨夜班次：凌晨还算昨晚那一班。
      if (schedule.overnight && minutesNow < schedule.startMin) workStart -= 1440 * MINUTE;

      const nowMs = date.getTime();
      if (nowMs < workStart) return null;
      const last = typeof settings.lastDrink === "number" ? settings.lastDrink : 0;
      return nowMs - Math.min(Math.max(workStart, last), nowMs);
    }

    /* ------------------------------------------------------------------ *
     * 悬浮窗的位置：按「贴哪个边 + 离边多远」存，不存像素坐标
     *
     * 存像素的话，窗口一缩小 x 会被夹进新视口，再放大就留在中间了。改成锚点后，
     * 画在哪由窗口尺寸现算：右锚就一直贴着右边，左锚就一直贴着左边。
     * ------------------------------------------------------------------ */
    /** 关掉秒之后数字短一大截，卡片跟着收窄，不然右边会空一块。 */
    function floatWidth(settings) {
      return settings.floatSeconds === false ? CARD_WIDTH_COMPACT : CARD_WIDTH;
    }

    /** 把点夹进可视区（顶部让开窗口按钮那一栏，底部留一条）。 */
    function clampPoint(point, width) {
      const cardWidth = width > 0 ? width : CARD_WIDTH;
      const maxX = Math.max(8, window.innerWidth - cardWidth - 8);
      const maxY = Math.max(TOP_SAFE, window.innerHeight - 72);
      return {
        x: Math.min(Math.max(8, point.x), maxX),
        y: Math.min(Math.max(TOP_SAFE, point.y), maxY)
      };
    }

    /** 设置页的「上方 / 下方」：贴右边 24px，贴顶 16vh 或贴底 96px。 */
    function defaultAnchor(side) {
      return {
        ax: "right",
        dx: 24,
        ay: side === "bottom" ? "bottom" : "top",
        dy: side === "bottom" ? 96 : Math.max(76, Math.round(window.innerHeight * 0.16))
      };
    }

    /** 锚点 → 当前窗口下的像素坐标（每次渲染现算，所以缩放时自动跟着走）。 */
    function resolveAnchor(anchor, width, height) {
      const cardWidth = width > 0 ? width : CARD_WIDTH;
      const cardHeight = height > 0 ? height : 150;
      return clampPoint(
        {
          x: anchor.ax === "right" ? window.innerWidth - cardWidth - anchor.dx : anchor.dx,
          y: anchor.ay === "bottom" ? window.innerHeight - cardHeight - anchor.dy : anchor.dy
        },
        width
      );
    }

    /** 拖动落点 → 锚点：按卡片中心落在哪半边决定贴左还是贴右、贴上还是贴下。 */
    function anchorFromPoint(point, width, height) {
      const cardWidth = width > 0 ? width : CARD_WIDTH;
      const cardHeight = height > 0 ? height : 150;
      const clamped = clampPoint(point, width);
      const ax = clamped.x + cardWidth / 2 <= window.innerWidth / 2 ? "left" : "right";
      const ay = clamped.y + cardHeight / 2 <= window.innerHeight / 2 ? "top" : "bottom";
      return {
        ax,
        dx: ax === "left" ? clamped.x : window.innerWidth - cardWidth - clamped.x,
        ay,
        dy: ay === "top" ? clamped.y : window.innerHeight - cardHeight - clamped.y
      };
    }

    /* ------------------------------------------------------------------ *
     * 样式：只用主题 token，只有 --dsw-alias-* 这一层依赖。
     * 没有强调色 —— 用量栏要跟旁边的用量元素一个样，悬浮窗按官方那张图的灰阶走。
     * ------------------------------------------------------------------ */
    const CSS = `
/* ── 用量栏（与旁边的用量文字同字号同色，不带图标与进度条）───── */
.dsh-offwork-dock{
  display:inline-flex;align-items:center;gap:6px;min-width:0;
  font-size:12px;line-height:18px;white-space:nowrap;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.92));
  user-select:none;
}
.dsh-offwork-dock-value{font-variant-numeric:tabular-nums;letter-spacing:.02em}
/* 按钮外面套一层：<style> 不能放进 <button>（button 只允许短语内容）。 */
.dsh-offwork-timer-wrap{display:inline-flex;align-items:center;min-width:0}
.dsh-offwork-timer{
  appearance:none;display:inline-flex;align-items:center;gap:6px;min-width:0;
  padding:0;border:0;border-radius:6px;background:transparent;
  font:inherit;font-size:12px;line-height:18px;white-space:nowrap;
  font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.92));
  cursor:pointer;
}
.dsh-offwork-timer:hover{color:var(--dsw-alias-label-secondary,rgba(127,127,127,.95))}
.dsh-offwork-timer:active{opacity:.7}
.dsh-offwork-timer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsh-offwork-timer-value{font-variant-numeric:tabular-nums;letter-spacing:.02em}

/* ── 悬浮窗（对齐官方宣传图的卡片）──────────────────────────── */
.dsh-offwork-icon{flex:none;display:block;opacity:.9}
.dsh-offwork-float{
  position:fixed;z-index:900;pointer-events:auto;box-sizing:border-box;
  padding:14px 16px 12px;border-radius:14px;
  background:var(--dsw-alias-bg-overlay,Canvas);
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
  box-shadow:0 10px 32px rgba(0,0,0,.18);
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));
  font-variant-numeric:tabular-nums;
  cursor:grab;user-select:none;touch-action:none;
}
.dsh-offwork-float:active{cursor:grabbing}
.dsh-offwork-float-head{display:flex;align-items:center;gap:7px;font-size:13px;line-height:20px;white-space:nowrap}
.dsh-offwork-float-time{
  margin:6px 0 10px;font-size:40px;line-height:1.12;font-weight:600;letter-spacing:-.01em;
  color:var(--dsw-alias-label-primary,CanvasText);
}
/* 关掉秒之后只剩「01:27」五个字符：字号提一档、卡片同时收窄，两边的留白才不显得空。 */
.dsh-offwork-float[data-compact="true"] .dsh-offwork-float-time{font-size:46px;margin:9px 0 12px}
.dsh-offwork-float-track{
  height:6px;border-radius:3px;overflow:hidden;
  background:var(--dsw-alias-border-l1,rgba(127,127,127,.24));
}
.dsh-offwork-float-fill{
  height:100%;border-radius:3px;
  background:var(--dsw-alias-label-primary,CanvasText);
  transition:width .4s linear;
}
.dsh-offwork-float-foot{
  display:flex;align-items:baseline;justify-content:space-between;gap:12px;
  margin-top:10px;font-size:12px;line-height:16px;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));
}

/* ── 设置页 ─────────────────────────────────────────────────── */
.dsh-offwork-page{display:flex;flex-direction:column;gap:20px;padding:14px 0 4px}
/* 插件页上的配置卡片（对齐宿主那张卡的观感） */
.dsh-offwork-panel{
  margin:4px 0;padding:14px 16px;border-radius:12px;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
  background:var(--dsw-alias-bg-layer-1,transparent);
}
.dsh-offwork-panel-head{display:flex;align-items:flex-start;gap:10px}
.dsh-offwork-panel-mark{
  flex:none;width:28px;height:28px;border-radius:8px;color:#fff;
  display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,#4f8df7,#1d4ed8);
}
.dsh-offwork-panel-titles{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
.dsh-offwork-panel-title{font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-offwork-panel-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}
.dsh-offwork-panel-toggle{
  appearance:none;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:6px;
  background:transparent;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));
  cursor:pointer;display:flex;align-items:center;justify-content:center;
}
.dsh-offwork-panel-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsh-offwork-panel-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsh-offwork-group{display:flex;flex-direction:column}
.dsh-offwork-group-title{
  margin-bottom:2px;font-size:12px;line-height:18px;font-weight:500;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));
}
.dsh-offwork-row{
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));
}
.dsh-offwork-group-title + .dsh-offwork-row{border-top:0}
.dsh-offwork-row-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-offwork-row-title{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-offwork-row-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}
.dsh-offwork-row-controls{display:flex;align-items:center;gap:10px;flex:none}
.dsh-offwork-field{
  display:inline-flex;align-items:center;gap:6px;white-space:nowrap;
  font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.85));
}
.dsh-offwork-input{
  font:inherit;font-size:12px;line-height:18px;
  padding:3px 6px;border-radius:6px;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));
  background:var(--dsw-alias-bg-layer-1,transparent);
  color:var(--dsw-alias-label-primary,CanvasText);
  font-variant-numeric:tabular-nums;color-scheme:inherit;
}
.dsh-offwork-input:hover{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.4))}
.dsh-offwork-input:focus-visible{
  outline:2px solid var(--dsw-alias-brand-primary,#5686fe);
  outline-offset:1px;border-color:transparent;
}
.dsh-offwork-input:disabled{opacity:.45;cursor:not-allowed}
.dsh-offwork-input:disabled:hover{border-color:var(--dsw-alias-border-l1,rgba(127,127,127,.28))}
.dsh-offwork-switch{
  appearance:none;position:relative;flex:none;width:34px;height:20px;padding:0;
  border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));
  cursor:pointer;transition:background .15s ease,border-color .15s ease;
}
.dsh-offwork-switch[data-on="true"]{
  background:var(--dsw-alias-brand-primary,#5686fe);border-color:transparent;
}
.dsh-offwork-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
.dsh-offwork-switch-knob{
  position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
  background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s ease;
}
.dsh-offwork-switch[data-on="true"] .dsh-offwork-switch-knob{transform:translateX(14px)}
.dsh-offwork-btn{
  appearance:none;flex:none;padding:4px 12px;border-radius:7px;
  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));
  background:transparent;font:inherit;font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.85));cursor:pointer;
}
.dsh-offwork-btn:hover{
  border-color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.6));
  color:var(--dsw-alias-label-primary,CanvasText);
}
.dsh-offwork-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}

/* ── 两档选择（上方 / 下方）────────────────────────────────── */
.dsh-offwork-seg{
  display:inline-flex;flex:none;gap:2px;padding:2px;
  border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));
}
.dsh-offwork-seg-btn{
  appearance:none;border:0;border-radius:6px;background:transparent;
  font:inherit;font-size:12px;line-height:18px;padding:2px 10px;
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.85));cursor:pointer;
}
.dsh-offwork-seg-btn:hover{color:var(--dsw-alias-label-primary,CanvasText)}
.dsh-offwork-seg-btn[data-on="true"]{
  background:var(--dsw-alias-bg-overlay,Canvas);
  color:var(--dsw-alias-label-primary,CanvasText);
  box-shadow:0 1px 2px rgba(0,0,0,.12);
}
.dsh-offwork-seg-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}

/* ── 文案输入与常用写法 ─────────────────────────────────────── */
.dsh-offwork-input-text{width:120px}
.dsh-offwork-field-prefix{
  font-size:12px;line-height:18px;white-space:nowrap;
  color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));
}
.dsh-offwork-row-controls-wrap{flex-wrap:wrap;justify-content:flex-end;max-width:340px}
.dsh-offwork-chip{
  appearance:none;flex:none;padding:2px 9px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));
  background:transparent;font:inherit;font-size:12px;line-height:16px;
  color:var(--dsw-alias-label-secondary,rgba(127,127,127,.85));cursor:pointer;
}
.dsh-offwork-chip:hover{
  border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.45));
  color:var(--dsw-alias-label-primary,CanvasText);
}
.dsh-offwork-chip[data-on="true"]{
  border-color:transparent;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));
  color:var(--dsw-alias-label-primary,CanvasText);
}
.dsh-offwork-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
`;

    /** 组件内渲染样式表：卸载即随之消失，不需要额外清理。 */
    function Styles() {
      return h("style", { "data-plugin-css": `${NS}/offwork.css` }, CSS);
    }

    function ClockIcon({ size }) {
      return h(
        "svg",
        {
          className: "dsh-offwork-icon",
          width: size,
          height: size,
          viewBox: "0 0 16 16",
          "aria-hidden": "true",
          focusable: "false"
        },
        h("circle", { cx: 8, cy: 8, r: 6.2, fill: "none", stroke: "currentColor", strokeWidth: 1.5 }),
        h("path", {
          d: "M8 4.6V8l2.4 1.7",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.5,
          strokeLinecap: "round",
          strokeLinejoin: "round"
        })
      );
    }

    /* ------------------------------------------------------------------ *
     * 座位 1：用量栏里的一行
     * ------------------------------------------------------------------ */
    function OffworkDock() {
      useLocaleWakeup();
      const settings = useSettings();
      const visible = settings.dock === true;
      const now = useSecondTick(visible);
      if (!visible) return null;

      const view = viewAt(new Date(now), settings);
      return h(
        "div",
        {
          className: "dsh-offwork-dock",
          title: `${translate("dock.tipPrefix")} ${settings.start}–${settings.end}`
        },
        h(Styles, { key: "css" }),
        h("span", { key: "label" }, labelOf(view, "dock")),
        view.kind === "rest"
          ? null
          : h("span", { className: "dsh-offwork-dock-value", key: "value" }, formatDuration(view.msLeft, settings.dockSeconds))
      );
    }

    /* ------------------------------------------------------------------ *
     * 座位 1b：用量栏里的计时器（点一下就归零）
     * ------------------------------------------------------------------ */
    function OffworkTimer() {
      useLocaleWakeup();
      const settings = useSettings();
      const visible = settings.timer === true;
      const now = useSecondTick(visible);
      if (!visible) return null;

      const elapsed = timerElapsed(new Date(now), settings);
      if (elapsed === null) return null;

      return h(
        "span",
        { className: "dsh-offwork-timer-wrap" },
        h(Styles, { key: "css" }),
        h(
          "button",
          {
            type: "button",
            className: "dsh-offwork-timer",
            title: translate("timer.tip"),
            onClick: () => writeSettings({ lastDrink: Date.now() })
          },
          h("span", { key: "label" }, timerLabelOf(settings)),
          h(
            "span",
            { className: "dsh-offwork-timer-value", key: "value" },
            formatDuration(elapsed, settings.timerSeconds)
          )
        )
      );
    }

    /* ------------------------------------------------------------------ *
     * 座位 2：悬浮窗
     * ------------------------------------------------------------------ */
    function OffworkFloat() {
      useLocaleWakeup();
      const settings = useSettings();
      const visible = settings.float === true;
      const now = useSecondTick(visible);
      const width = floatWidth(settings);
      const cardRef = React.useRef(null);
      const drag = React.useRef(null);
      /** 最近一次拖动的结束时刻：拖来拖去时浏览器也会给两次 click，别让「双击关闭」误伤。 */
      const lastDragAt = React.useRef(0);
      const [cardHeight, setCardHeight] = React.useState(0);
      const [dragPos, setDragPos] = React.useState(null);
      const [, bump] = React.useState(0);

      // 量卡片高度：贴底锚定与拖动换算都要用（首帧是 0，布局效果补上）。
      React.useLayoutEffect(() => {
        if (!visible) return;
        const height = cardRef.current === null ? 0 : cardRef.current.offsetHeight;
        setCardHeight((previous) => (Math.abs(previous - height) > 0.5 ? height : previous));
      });

      // 窗口缩放：位置由锚点现算，这里只需要叫醒一次渲染。
      // （旧实现把像素坐标存在 state 里，缩小窗口时被夹到中间，放大后就留在中间了。）
      React.useEffect(() => {
        const onResize = () => bump((count) => count + 1);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }, []);

      const anchor = settings.pos === null ? defaultAnchor(settings.floatSide) : settings.pos;
      const pos = dragPos === null ? resolveAnchor(anchor, width, cardHeight) : dragPos;

      const moveTo = (event) => {
        const current = drag.current;
        if (current === null || current.pointerId !== event.pointerId) return;
        const dx = event.clientX - current.startX;
        const dy = event.clientY - current.startY;
        if (!current.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        current.moved = true;
        setDragPos(
          clampPoint({ x: event.clientX - current.offsetX, y: event.clientY - current.offsetY }, width)
        );
      };

      const onPointerDown = (event) => {
        if (event.button !== 0) return;
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
          /* 没有指针捕获也能拖，只是可能丢事件 */
        }
      };

      const onPointerUp = (event) => {
        const current = drag.current;
        if (current === null || current.pointerId !== event.pointerId) return;
        drag.current = null;
        if (!current.moved) {
          setDragPos(null);
          return;
        }
        const point = clampPoint(
          { x: event.clientX - current.offsetX, y: event.clientY - current.offsetY },
          width
        );
        setDragPos(null);
        lastDragAt.current = Date.now();
        // 只把「贴边 + 距离」写进设置，拖动过程中不碰 localStorage。
        writeSettings({ pos: anchorFromPoint(point, width, cardHeight) });
      };

      const onPointerCancel = () => {
        drag.current = null;
        setDragPos(null);
      };

      if (!visible) return null;

      const view = viewAt(new Date(now), settings);
      const percent = percentOf(view);
      const label = labelOf(view, "float");
      const footer = footerOf(view, settings);

      return h(
        "div",
        {
          ref: cardRef,
          className: "dsh-offwork-float",
          role: "group",
          "data-compact": settings.floatSeconds === false ? "true" : "false",
          "aria-label": `${label} — ${footer}`,
          style: { left: `${pos.x}px`, top: `${pos.y}px`, width: `${width}px` },
          title: translate("float.tip"),
          onPointerDown,
          onPointerMove: moveTo,
          onPointerUp,
          onPointerCancel,
          onDoubleClick: () => {
            if (settings.dblclick !== true) return;
            // 刚拖过就不算双击：拖动本身也会产生 click，松手两次很容易误关。
            if (Date.now() - lastDragAt.current < 600) return;
            writeSettings({ float: false });
          }
        },
        h(Styles, { key: "css" }),
        h(
          "div",
          { className: "dsh-offwork-float-head", key: "head" },
          h(ClockIcon, { size: 16 }),
          h("span", null, label)
        ),
        h(
          "div",
          { className: "dsh-offwork-float-time", key: "time" },
          view.kind === "rest"
            ? settings.floatSeconds === false
              ? "--:--"
              : "--:--:--"
            : formatDuration(view.msLeft, settings.floatSeconds)
        ),
        h(
          "div",
          { className: "dsh-offwork-float-track", key: "track" },
          h("div", { className: "dsh-offwork-float-fill", style: { width: `${percent}%` } })
        ),
        h(
          "div",
          { className: "dsh-offwork-float-foot", key: "foot" },
          h("span", null, footer),
          h("span", null, view.kind === "rest" ? "—" : `${percent}%`)
        )
      );
    }

    /* ------------------------------------------------------------------ *
     * 座位 3：设置页
     * ------------------------------------------------------------------ */
    function OffworkSettingsSection() {
      useLocaleWakeup();
      const settings = useSettings();

      const timeField = (key, labelKey, disabled) =>
        h(
          "label",
          { className: "dsh-offwork-field", key },
          h("span", null, translate(labelKey)),
          h("input", {
            className: "dsh-offwork-input",
            type: "time",
            step: 60,
            value: settings[key],
            disabled: disabled === true,
            "aria-label": translate(labelKey),
            onChange: (event) => {
              const next = event.target.value;
              // 时间控件在输入过程中会给出半成品（"" 或 "1"），只接受完整合法的值。
              if (parseClock(next) === undefined) return;
              writeSettings({ [key]: next });
            }
          })
        );

      const toggle = (key, title, desc) =>
        h(
          "button",
          {
            key: `${key}-switch`,
            type: "button",
            role: "switch",
            "aria-checked": settings[key] === true,
            "aria-label": translate(title),
            className: "dsh-offwork-switch",
            "data-on": settings[key] === true ? "true" : "false",
            onClick: () => writeSettings({ [key]: settings[key] !== true })
          },
          h("span", { className: "dsh-offwork-switch-knob" })
        );

      const text = (title, desc) =>
        h(
          "div",
          { className: "dsh-offwork-row-text" },
          h("span", { className: "dsh-offwork-row-title" }, translate(title)),
          h("span", { className: "dsh-offwork-row-desc" }, translate(desc))
        );

      /** 两档选择：`options` 是 [值, 文案 key] 的数组，`extra` 一并写进设置。 */
      const segmented = (key, ariaKey, options, extra) =>
        h(
          "div",
          { className: "dsh-offwork-seg", role: "group", "aria-label": translate(ariaKey) },
          options.map(([value, labelKey]) =>
            h(
              "button",
              {
                key: value,
                type: "button",
                className: "dsh-offwork-seg-btn",
                "data-on": settings[key] === value ? "true" : "false",
                "aria-pressed": settings[key] === value,
                onClick: () => writeSettings({ [key]: value, ...extra })
              },
              translate(labelKey)
            )
          )
        );

      const row = (key, title, desc, control) =>
        h("div", { className: "dsh-offwork-row", key }, text(title, desc), control);

      const group = (key, title, rows) =>
        h(
          "div",
          { className: "dsh-offwork-group", key },
          h("div", { className: "dsh-offwork-group-title" }, translate(title)),
          rows
        );

      return h(
        "div",
        { className: "dsh-offwork-page" },

        group("general", "group.general", [
          row(
            "work-hours",
            "settings.timeTitle",
            "settings.timeDesc",
            h(
              "div",
              { className: "dsh-offwork-row-controls" },
              timeField("start", "settings.start", false),
              timeField("end", "settings.end", false)
            )
          ),
          row(
            "lunch-switch",
            "settings.lunch",
            "settings.lunchDesc",
            h(
              "div",
              { className: "dsh-offwork-row-controls" },
              toggle("lunch", "settings.lunch", "settings.lunchDesc")
            )
          ),
          row(
            "lunch-hours",
            "settings.lunchRange",
            "settings.lunchRangeDesc",
            h(
              "div",
              { className: "dsh-offwork-row-controls" },
              timeField("lunchStart", "settings.lunchStart", settings.lunch !== true),
              timeField("lunchEnd", "settings.lunchEnd", settings.lunch !== true)
            )
          ),
          row(
            "morning-switch",
            "settings.morningLunch",
            "settings.morningLunchDesc",
            h(
              "div",
              { className: "dsh-offwork-row-controls" },
              toggle("morningLunch", "settings.morningLunch", "settings.morningLunchDesc")
            )
          )
        ]),

        group("dock-group", "group.dock", [
          row(
            "dock-switch",
            "settings.dock",
            "settings.dockDesc",
            h("div", { className: "dsh-offwork-row-controls" }, toggle("dock", "settings.dock", "settings.dockDesc"))
          ),
          row(
            "dock-seconds",
            "settings.seconds",
            "settings.secondsDesc",
            h(
              "div",
              { className: "dsh-offwork-row-controls" },
              toggle("dockSeconds", "settings.seconds", "settings.secondsDesc")
            )
          )
        ]),

        group("timer-group", "group.timer", [
          row(
            "timer-switch",
            "settings.timer",
            "settings.timerDesc",
            h("div", { className: "dsh-offwork-row-controls" }, toggle("timer", "settings.timer", "settings.timerDesc"))
          ),
          row(
            "timer-seconds",
            "settings.seconds",
            "settings.secondsDesc",
            h(
              "div",
              { className: "dsh-offwork-row-controls" },
              toggle("timerSeconds", "settings.seconds", "settings.secondsDesc")
            )
          ),
          row(
            "timer-label",
            "settings.timerLabel",
            "settings.timerLabelDesc",
            h(
              "div",
              { className: "dsh-offwork-row-controls" },
              h("span", { className: "dsh-offwork-field-prefix" }, translate("dock.timerPrefix")),
              h("input", {
                className: "dsh-offwork-input dsh-offwork-input-text",
                type: "text",
                value: settings.timerLabel,
                maxLength: 24,
                placeholder: translate("dock.timerDefault"),
                "aria-label": translate("settings.timerLabel"),
                onChange: (event) => writeSettings({ timerLabel: event.target.value })
              })
            )
          ),
          row(
            "timer-presets",
            "settings.timerPresets",
            "settings.timerPresetsDesc",
            h(
              "div",
              { className: "dsh-offwork-row-controls dsh-offwork-row-controls-wrap" },
              ["timer.presetDrink", "timer.presetToilet", "timer.presetStand", "timer.presetRest"].map(
                (presetKey) =>
                  h(
                    "button",
                    {
                      key: presetKey,
                      type: "button",
                      className: "dsh-offwork-chip",
                      "data-on": timerTail(settings) === translate(presetKey) ? "true" : "false",
                      onClick: () => writeSettings({ timerLabel: translate(presetKey) })
                    },
                    translate(presetKey)
                  )
              )
            )
          )
        ]),

        group("float", "group.float", [
          row(
            "float-switch",
            "settings.float",
            "settings.floatDesc",
            h("div", { className: "dsh-offwork-row-controls" }, toggle("float", "settings.float", "settings.floatDesc"))
          ),
          row(
            "float-seconds",
            "settings.seconds",
            "settings.secondsDesc",
            h(
              "div",
              { className: "dsh-offwork-row-controls" },
              toggle("floatSeconds", "settings.seconds", "settings.secondsDesc")
            )
          ),
          row(
            "float-side",
            "settings.floatSide",
            "settings.floatSideDesc",
            h(
              "div",
              { className: "dsh-offwork-row-controls" },
              segmented("floatSide", "settings.floatSide", [
                ["top", "settings.sideTop"],
                ["bottom", "settings.sideBottom"]
              ], { pos: null })
            )
          ),
          row(
            "dblclick-switch",
            "settings.dblclick",
            "settings.dblclickDesc",
            h(
              "div",
              { className: "dsh-offwork-row-controls" },
              toggle("dblclick", "settings.dblclick", "settings.dblclickDesc")
            )
          )
        ]),

        group("other", "group.other", [
          row(
            "reset",
            "settings.resetTitle",
            "settings.resetDesc",
            h(
              "div",
              { className: "dsh-offwork-row-controls" },
              h(
                "button",
                {
                  type: "button",
                  className: "dsh-offwork-btn",
                  onClick: () => writeSettings({ ...DEFAULTS })
                },
                translate("settings.resetAction")
              )
            )
          )
        ])
      );
    }

    /* ------------------------------------------------------------------ *
     * 插件页里的配置卡片（plugins.bundle.config）
     *
     * 位置就是插件页简介下面、组件列表上面 —— 和 dsh-connect-workbuddy 那张卡
     * 同一个座位。整张卡自带折叠，默认展开。
     * ------------------------------------------------------------------ */
    function OffworkPanel() {
      useLocaleWakeup();
      const [open, setOpen] = React.useState(true);

      return h(
        "section",
        { className: "dsh-offwork-panel" },
        h(Styles, { key: "css" }),
        h(
          "div",
          { className: "dsh-offwork-panel-head", key: "head" },
          h("span", { className: "dsh-offwork-panel-mark" }, h(ClockIcon, { size: 16 })),
          h(
            "div",
            { className: "dsh-offwork-panel-titles" },
            h("span", { className: "dsh-offwork-panel-title" }, translate("panel.title")),
            h("span", { className: "dsh-offwork-panel-desc" }, translate("panel.desc"))
          ),
          h(
            "button",
            {
              type: "button",
              className: "dsh-offwork-panel-toggle",
              "aria-expanded": open,
              "aria-label": translate("panel.title"),
              onClick: () => setOpen((current) => !current)
            },
            h(
              "svg",
              {
                width: 14,
                height: 14,
                viewBox: "0 0 16 16",
                "aria-hidden": "true",
                style: { transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }
              },
              h("path", {
                d: "M4 6.5 8 10.5 12 6.5",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 1.6,
                strokeLinecap: "round",
                strokeLinejoin: "round"
              })
            )
          )
        ),
        open ? h(OffworkSettingsSection, { key: "body" }) : null
      );
    }

    /* ------------------------------------------------------------------ *
     * 装配
     * ------------------------------------------------------------------ */
    function registerLocale(ctx) {
      const locale = typeof ctx.get === "function" ? ctx.get("locale") : undefined;
      if (
        locale === undefined ||
        typeof locale.register !== "function" ||
        typeof locale.bind !== "function"
      ) {
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
        // 命名空间冲突等：保留内置中文，倒计时本身照常工作。
        console.warn(`[${NS}] 文案未能挂到 locale 服务，退回内置中文：`, error);
      }
      if (disposers.length > 0) {
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
        ctx.slots.register({ name: DOCK_SLOT, id: "offwork-countdown", order: 12 }, OffworkDock)
      );
      ctx.slots.inject(DOCK_SLOT, () =>
        ctx.slots.register({ name: DOCK_SLOT, id: "offwork-countdown-timer", order: 13 }, OffworkTimer)
      );
      ctx.slots.inject(OVERLAY_SLOT, () =>
        ctx.slots.register({ name: OVERLAY_SLOT, id: "offwork-countdown-float", order: 20 }, OffworkFloat)
      );
      // 插件页的配置卡片：宿主按 loader entry id 派发，不同版本也可能是包名，
      // 三种写法都挂（`include:` + 包名 / `include:` + patch 行 id / 纯包名）。
      for (const key of [
        "dsh-offwork-countdown",
        "include:dsh-offwork-countdown",
        "include:offwork-countdown"
      ]) {
        ctx.slots.inject(PANEL_SLOT, () =>
          ctx.slots.register({ name: PANEL_SLOT, key, priority: 30 }, OffworkPanel)
        );
      }
    }

    const api = { apply, inject: ["slots"] };
    // 纯函数单测入口：只有显式打开这个开关的测试页才看得到它。
    if (typeof window !== "undefined" && window.__dshOffworkCountdownTest === true) {
      api.__internals = {
        parseClock,
        viewAt,
        formatDuration,
        normalize,
        percentOf,
        scheduleOf,
        workProgress,
        timerElapsed,
        timerLabelOf,
        floatWidth,
        resolveAnchor,
        anchorFromPoint,
        defaultAnchor
      };
    }
    return api;
  }
});
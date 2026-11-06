/**
 * 纯函数单测：把 client.js 放进 vm 沙箱，拿到 apply / __internals，
 * 只测时间计算，不碰 React。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "client.js"), "utf8");

let spec;
const stored = new Map();
const win = {
  __dshOffworkCountdownTest: true,
  innerWidth: 1600,
  innerHeight: 1000,
  __ModuleLoader__: { load: (value) => { spec = value; } },
  localStorage: {
    getItem: (key) => (stored.has(key) ? stored.get(key) : null),
    setItem: (key, value) => { stored.set(key, String(value)); },
  },
  setInterval: () => 0,
  clearInterval: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};
const sandbox = { window: win, console, setInterval, clearInterval };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const ReactStub = {
  createElement: () => null,
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: () => ({ current: null }),
};
const module = spec.factory((name) => {
  if (name === "react") return ReactStub;
  throw new Error(`unexpected require: ${name}`);
});

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${actual}, want ${expected})`}`);
};
const near = (label, actual, expected, tolerance = 1000) => {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${actual}, want ~${expected})`}`);
};

const { parseClock, viewAt, formatDuration, normalize, percentOf, scheduleOf, timerElapsed, timerLabelOf, floatWidth, resolveAnchor, anchorFromPoint } =
  module.__internals;
const MIN = 60000;
const settings = { start: "09:00", end: "18:00" };

// ── 解析与格式化 ───────────────────────────────────────────────────────
check("parseClock 09:30", parseClock("09:30").minutesOfDay, 570);
check("parseClock 9:05（缺前导零）", parseClock("9:05").minutesOfDay, 545);
check("parseClock 24:00 非法", parseClock("24:00"), undefined);
check("parseClock 09:60 非法", parseClock("09:60"), undefined);
check("parseClock 空串非法", parseClock(""), undefined);
check("formatDuration 27m7s", formatDuration(27 * MIN + 7000), "00:27:07");
check("formatDuration 负数按 0", formatDuration(-5000), "00:00:00");
check("formatDuration 跨 100 小时", formatDuration(100 * 3600 * 1000), "100:00:00");
check("formatDuration 关掉秒", formatDuration(27 * MIN + 7000, false), "00:27");
check("formatDuration 关掉秒仍不丢小时", formatDuration(5 * 3600 * 1000 + 59 * MIN, false), "05:59");
check("有秒时悬浮窗宽 268", floatWidth({}), 268);
check("关秒后悬浮窗收窄到 190", floatWidth({ floatSeconds: false }), 190);

// ── 工作日各时段 ──────────────────────────────────────────────────────
const workday = (h, m, s = 0) => new Date(2026, 10, 5, h, m, s); // 2026-11-05 周四
console.log(`\n参考日 2026-11-05 getDay=${workday(12, 0).getDay()}（1–5 为工作日）\n`);

const mid = viewAt(workday(17, 32, 53), settings);
check("17:32:53 处于工作时段", mid.kind, "working");
check("17:32:53 数的是下班", mid.target, "end");
near("17:32:53 距下班 27m7s", mid.msLeft, 27 * MIN + 7000, 1000);
check("17:32:53 进度约 95%", percentOf(mid), 95);

const atStart = viewAt(workday(9, 0, 0), settings);
check("09:00 一开工就算工作时段", atStart.kind, "working");
near("09:00 剩余 9 小时", atStart.msLeft, 9 * 3600 * 1000, 10);

const before = viewAt(workday(8, 0, 0), settings);
check("08:00 属于上班前", before.kind, "before");
near("08:00 距上班 1 小时", before.msLeft, 3600 * 1000, 10);

const after = viewAt(workday(18, 0, 0), settings);
check("18:00 准点下班", after.kind, "after");
near("18:00 已下班 0", after.msLeft, 0, 10);
near("18:30 已下班 30 分钟", viewAt(workday(18, 30, 0), settings).msLeft, 30 * MIN, 10);

// ── 周末 ─────────────────────────────────────────────────────────────
check("周六 2026-11-07 休息", viewAt(new Date(2026, 10, 7, 10, 0), settings).kind, "rest");
check("周日 2026-11-08 休息", viewAt(new Date(2026, 10, 8, 10, 0), settings).kind, "rest");

// ── 跨夜班次：22:00 → 次日 06:00 ──────────────────────────────────────
const night = { start: "22:00", end: "06:00" };
check("22:30 夜班工作中", viewAt(workday(22, 30), night).kind, "working");
near("22:30 夜班剩 7.5 小时", viewAt(workday(22, 30), night).msLeft, 7.5 * 3600 * 1000, 1000);
check("次日 02:00 夜班仍工作中", viewAt(workday(2, 0), night).kind, "working");
near("次日 02:00 剩 4 小时", viewAt(workday(2, 0), night).msLeft, 4 * 3600 * 1000, 1000);
check("夜班白天 12:00 记为已下班", viewAt(workday(12, 0), night).kind, "after");

// ── 午休 ─────────────────────────────────────────────────────────────
const lunch = { ...settings, lunch: true, lunchStart: "12:00", lunchEnd: "13:00" };
const at11 = viewAt(workday(11, 0), lunch);
check("上午 11:00 数的是下班", at11.target, "end");
near("上午 11:00 距下班 7 小时（含午休，按墙钟）", at11.msLeft, 7 * 3600 * 1000, 1000);
check("上午 11:00 进度 25%（午休不计工时）", percentOf(at11), 25);

const atLunch = viewAt(workday(12, 30), lunch);
check("12:30 处于午休", atLunch.kind, "lunch");
check("午休数的是午休结束", atLunch.target, "lunchEnd");
near("12:30 还有 30 分钟回到工位", atLunch.msLeft, 30 * MIN, 1000);
check("午休进度 50%", percentOf(atLunch), 50);

const at14 = viewAt(workday(14, 0), lunch);
check("14:00 数的是下班", at14.target, "end");
near("14:00 距下班 4 小时", at14.msLeft, 4 * 3600 * 1000, 1000);
check("14:00 进度 50%（8 小时工时走掉一半）", percentOf(at14), 50);

const morningLunch = { ...lunch, morningLunch: true };
const at11Lunch = viewAt(workday(11, 0), morningLunch);
check("上午模式数的是午饭", at11Lunch.target, "lunchStart");
near("上午模式距午饭 1 小时", at11Lunch.msLeft, 3600 * 1000, 1000);
check("上午模式进度按上午时段算", percentOf(at11Lunch), 67);
check("下午不受上午模式影响", viewAt(workday(14, 0), morningLunch).target, "end");

const noLunch = viewAt(workday(12, 30), { ...settings, lunch: false });
check("关掉午休后中午仍是工作时段", noLunch.kind, "working");
near("关掉午休 12:30 距下班 5.5 小时", noLunch.msLeft, 5.5 * 3600 * 1000, 1000);
check("关掉午休进度按全时段算", percentOf(noLunch), 39);

const degenerate = { start: "09:00", end: "12:30", lunch: true, lunchStart: "12:00", lunchEnd: "13:00" };
check("午休越过下班线则忽略", scheduleOf(degenerate).lunch, null);
check("忽略午休后 12:00 仍工作", viewAt(workday(12, 0), degenerate).kind, "working");
check("跨夜班次不拆午休", scheduleOf({ ...night, lunch: true, lunchStart: "12:00", lunchEnd: "13:00" }).lunch, null);

// ── 计时器：从当天上班起算，隔夜不累加 ───────────────────────────────
const drink = (h, m, lastDrink) =>
  timerElapsed(workday(h, m), { ...settings, lastDrink: lastDrink ?? null });
check("上班前不显示", drink(8, 0, null), null);
near("10:00 从上班算起 1 小时", drink(10, 0, null), 3600 * 1000, 1000);
near("10:00 上次 09:30 → 30 分钟", drink(10, 0, workday(9, 30).getTime()), 30 * MIN, 1000);
near(
  "隔夜不累加：10:00 仍只从上班算 1 小时",
  drink(10, 0, new Date(2026, 10, 4, 17, 0).getTime()),
  3600 * 1000,
  1000
);
check("周六不显示", timerElapsed(new Date(2026, 10, 7, 10, 0), { ...settings, lastDrink: null }), null);
near(
  "夜班 02:00 从昨晚 22:00 起算",
  timerElapsed(workday(2, 0), { start: "22:00", end: "06:00", lastDrink: null }),
  4 * 3600 * 1000,
  1000
);

// ── 计时器文案：固定前缀 + 可自定义的尾巴 ────────────────────────────
check("默认文案", timerLabelOf({ timerLabel: "" }), "距上次喝水");
check("只有空格算留空", timerLabelOf({ timerLabel: "   " }), "距上次喝水");
check("自定义词拼在固定前缀后", timerLabelOf({ timerLabel: "上厕所" }), "距上次上厕所");
check("词里多余空格去掉", timerLabelOf({ timerLabel: "  站起来 " }), "距上次站起来");
check("非字符串退回默认", timerLabelOf({ timerLabel: 42 }), "距上次喝水");
check("旧版整句去掉前缀", normalize({ timerLabel: "距上次上厕所" }).timerLabel, "上厕所");
check("普通词原样保留", normalize({ timerLabel: "上厕所" }).timerLabel, "上厕所");

// ── 设置归一化（v1/v2 老数据要能升级）────────────────────────────────
// ── 时间字符串统一补零（<input type="time"> 只认 HH:MM）────────────────
check("9:05 补成 09:05", normalize({ start: "9:05" }).start, "09:05");
check("8:30 补成 08:30", normalize({ end: "8:30" }).end, "08:30");
check("24:00 退回默认", normalize({ end: "24:00" }).end, "18:00");
check("脏值退回默认", normalize({ start: "abc" }).start, "09:00");

const legacy = normalize({ start: "08:30", end: "17:30" });
check("老数据保留上班时间", legacy.start, "08:30");
check("老数据补出午休默认开", legacy.lunch, true);
check("老数据补出午休默认时段", `${legacy.lunchStart}-${legacy.lunchEnd}`, "12:00-13:00");
check("老数据补出「上午显示下班」", legacy.morningLunch, false);
check("老数据补出计时器默认开", legacy.timer, true);
check("老数据补出计时器文案为空", legacy.timerLabel, "");
check("老数据补出用量栏默认开", legacy.dock, true);
check("老数据补出三处「显示秒」默认开", `${legacy.dockSeconds}/${legacy.timerSeconds}/${legacy.floatSeconds}`, "true/true/true");
check("老数据补出悬浮窗默认开", legacy.float, true);
check("老数据补出双击关闭默认开", legacy.dblclick, true);
check("老数据补出位置上", legacy.floatSide, "top");
check("老数据 lastDrink 为空", legacy.lastDrink, null);
check("老数据 pos 为空", legacy.pos, null);
check("保留显式关闭的用量栏", normalize({ dock: false }).dock, false);
check("保留显式关闭的悬浮窗", normalize({ float: false }).float, false);
check("新键关闭计时器生效", normalize({ timer: false }).timer, false);
check("旧键关闭计时器依然生效", normalize({ water: false }).timer, false);
check("计时文案超长截断", normalize({ timerLabel: "x".repeat(40) }).timerLabel.length, 24);
check("位置下方保留", normalize({ floatSide: "bottom" }).floatSide, "bottom");
check("位置非法回退上方", normalize({ floatSide: "left" }).floatSide, "top");
check("lastDrink 非法回退 null", normalize({ lastDrink: "x" }).lastDrink, null);
check(
  "pos 存的是「贴边 + 距离」",
  JSON.stringify(normalize({ pos: { ax: "right", dx: 24, ay: "bottom", dy: 96 } }).pos),
  '{"ax":"right","dx":24,"ay":"bottom","dy":96}'
);
check("pos 缺 dx 则丢弃", normalize({ pos: { ax: "right" } }).pos, null);
check("pos 旧格式（像素）按当前窗口换算", JSON.stringify(normalize({ pos: { x: 1200, y: 200 } }).pos), '{"ax":"right","dx":132,"ay":"top","dy":200}');
check("pos 完全非法则丢弃", normalize({ pos: { x: "a", y: 1 } }).pos, null);

// ── 悬浮窗位置：窗口缩放时应当贴边跟随，而不是被夹在中间 ──────────────
const rightAnchor = { ax: "right", dx: 24, ay: "top", dy: 120 };
check("宽窗口：贴右边 24px", resolveAnchor(rightAnchor, 268, 150).x, 1600 - 268 - 24);
win.innerWidth = 1200;
check("缩窄窗口：仍然贴右边 24px", resolveAnchor(rightAnchor, 268, 150).x, 1200 - 268 - 24);
win.innerWidth = 1600;
check("再放大：回到最右，不会留在中间", resolveAnchor(rightAnchor, 268, 150).x, 1600 - 268 - 24);
win.innerWidth = 1200;
check(
  "左锚在窄窗口下也保持左边距",
  resolveAnchor({ ax: "left", dx: 40, ay: "top", dy: 120 }, 268, 150).x,
  40
);
check("距离大到放不下时夹进可视区", resolveAnchor({ ax: "right", dx: 5000, ay: "top", dy: 120 }, 268, 150).x, 8);
win.innerWidth = 1600;
check("贴底锚定按窗口高度算", resolveAnchor({ ax: "right", dx: 24, ay: "bottom", dy: 96 }, 268, 160).y, 1000 - 160 - 96);
check(
  "拖动落点换算成锚点（左下角）",
  JSON.stringify(anchorFromPoint({ x: 40, y: 700 }, 268, 160)),
  '{"ax":"left","dx":40,"ay":"bottom","dy":140}'
);

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);